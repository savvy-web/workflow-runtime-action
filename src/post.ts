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
	Effect.catchAll((error) => Effect.logWarning(`Post action cache save failed: ${extractErrorReason(error)}`)),
);

// PostLive only needs cache and state services
export const PostLive = Layer.mergeAll(ActionCacheLive, ActionStateLive);

/* v8 ignore next 3 -- entry point guard, only runs in GitHub Actions */
if (process.env.GITHUB_ACTIONS) {
	await Action.run(post, PostLive);
}
