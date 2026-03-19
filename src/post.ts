import {
	Action,
	ActionCacheLive,
	ActionStateLive,
	ActionsCacheLive,
	ActionsCoreLive,
} from "@savvy-web/github-action-effects";
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
	Effect.catchAll((error) => Effect.logWarning(`Post action cache save failed: ${extractErrorReason(error)}`)),
);

// Platform + business layers for post action
const PlatformLive = Layer.mergeAll(ActionsCoreLive, ActionsCacheLive);
export const PostLive = Layer.mergeAll(ActionCacheLive, ActionStateLive).pipe(Layer.provide(PlatformLive));

/* v8 ignore next 3 -- entry point guard, only runs in GitHub Actions */
if (process.env.GITHUB_ACTIONS) {
	await Action.run(post, { layer: PostLive });
}
