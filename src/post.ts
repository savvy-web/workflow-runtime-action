import { Action, ActionCacheLive, ActionStateLive } from "@savvy-web/github-action-effects";
import { Effect, Layer } from "effect";
import { saveCache } from "./cache.js";

// ---------------------------------------------------------------------------
// Post-action: save dependency cache
// ---------------------------------------------------------------------------

const post = Effect.gen(function* () {
	yield* saveCache();
}).pipe(
	// Non-fatal: cache save errors should warn, not fail the action
	Effect.catchAll((error) => Effect.logWarning(`Post action cache save failed: ${error}`)),
);

// PostLive only needs cache and state services
const PostLive = Layer.mergeAll(ActionCacheLive, ActionStateLive);

await Action.run(post, PostLive);
