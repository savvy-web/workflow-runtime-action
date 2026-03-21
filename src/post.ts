import { NodeFileSystem } from "@effect/platform-node";
import { Action, ActionCacheLive, ActionStateLive } from "@savvy-web/github-action-effects";
import { Effect, Layer } from "effect";
import { saveCache } from "./cache.js";
import { extractErrorReason } from "./runtime-installer.js";

// ---------------------------------------------------------------------------
// Post-action: save dependency cache
// ---------------------------------------------------------------------------

export const post = Effect.gen(function* () {
	yield* saveCache();
}).pipe(
	// Non-fatal: cache save errors should warn, not fail the action
	Effect.catchAll((error) =>
		Effect.gen(function* () {
			yield* Effect.logWarning(`Post action cache save failed: ${extractErrorReason(error)}`);
			if (error && typeof error === "object" && "cause" in error) {
				const cause = (error as { cause?: Record<string, unknown> }).cause;
				if (cause) {
					yield* Effect.logWarning(
						`Post action cache save cause detail: reason=${cause.reason ?? "?"}, operation=${cause.operation ?? "?"}, key=${cause.key ?? "?"}`,
					);
				}
			}
		}),
	),
);

// Business logic layers for post action — Action.run provides core services
// ActionStateLive requires FileSystem, so we provide NodeFileSystem.layer.
export const PostLive = Layer.mergeAll(ActionCacheLive, ActionStateLive.pipe(Layer.provide(NodeFileSystem.layer)));

/* v8 ignore next 3 -- entry point guard, only runs in GitHub Actions */
if (process.env.GITHUB_ACTIONS) {
	await Action.run(post, { layer: PostLive });
}
