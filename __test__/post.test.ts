import { ActionCache, ActionState } from "@savvy-web/github-action-effects";
import { Effect, Layer, Logger, Option } from "effect";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: test mock requires any for mocked service tags
type AnyLayer = Layer.Layer<any>;
const asLayer = (l: AnyLayer): Layer.Layer<never> => l as Layer.Layer<never>;

// biome-ignore lint/suspicious/noExplicitAny: test mock requires any for mocked effect results
const run = <A>(effect: Effect.Effect<A, any, any>, layer: AnyLayer): Promise<A> =>
	Effect.runPromise(
		effect.pipe(
			Effect.provide(asLayer(layer)),
			Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none)),
		) as Effect.Effect<A, never, never>,
	);

// ---------------------------------------------------------------------------
// Service layer factories
// ---------------------------------------------------------------------------

interface CacheSaveCall {
	paths: readonly string[];
	key: string;
}

const makeCacheLayer = (opts: { saveCalls?: CacheSaveCall[]; failSave?: boolean } = {}): AnyLayer => {
	const saveCalls = opts.saveCalls ?? [];
	return Layer.succeed(ActionCache, {
		save: (paths: readonly string[], key: string) => {
			if (opts.failSave) {
				return Effect.fail({ _tag: "ActionCacheError", key, operation: "save", reason: "save failed" });
			}
			saveCalls.push({ paths, key });
			return Effect.succeed(undefined);
		},
		restore: () => Effect.succeed(Option.none()),
	} as never);
};

const makeStateLayer = (opts: { stored?: Record<string, unknown> } = {}): AnyLayer => {
	const stored = opts.stored ?? {};
	return Layer.succeed(ActionState, {
		save: () => Effect.succeed(undefined),
		get: (key: string) => {
			const v = stored[key];
			if (v === undefined) return Effect.fail({ _tag: "ActionStateError", key, reason: "Not found" });
			return Effect.succeed(v);
		},
		getOptional: (key: string) => {
			const v = stored[key];
			if (v === undefined) return Effect.succeed(Option.none());
			return Effect.succeed(Option.some(v));
		},
	} as never);
};

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------

import { saveCache } from "../src/cache.js";
import { post } from "../src/post.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("post action (saveCache integration)", () => {
	it("saveCache is called when state has hit 'partial'", async () => {
		const saveCalls: CacheSaveCall[] = [];

		const layer = Layer.mergeAll(
			makeCacheLayer({ saveCalls }),
			makeStateLayer({
				stored: {
					CACHE_STATE: { hit: "partial", key: "test-key", paths: ["/cache/path"] },
				},
			}),
		);

		await run(saveCache(), layer);

		expect(saveCalls.length).toBe(1);
		expect(saveCalls[0].key).toBe("test-key");
		expect(saveCalls[0].paths).toEqual(["/cache/path"]);
	});

	it("saveCache is called when state has hit 'none'", async () => {
		const saveCalls: CacheSaveCall[] = [];

		const layer = Layer.mergeAll(
			makeCacheLayer({ saveCalls }),
			makeStateLayer({
				stored: {
					CACHE_STATE: { hit: "none", key: "test-key", paths: ["/cache/path"] },
				},
			}),
		);

		await run(saveCache(), layer);

		expect(saveCalls.length).toBe(1);
		expect(saveCalls[0].key).toBe("test-key");
	});

	it("saveCache skips when state has hit 'exact'", async () => {
		const saveCalls: CacheSaveCall[] = [];

		const layer = Layer.mergeAll(
			makeCacheLayer({ saveCalls }),
			makeStateLayer({
				stored: {
					CACHE_STATE: { hit: "exact", key: "test-key", paths: ["/cache/path"] },
				},
			}),
		);

		await run(saveCache(), layer);

		expect(saveCalls.length).toBe(0);
	});

	it("post action handles missing state gracefully (warns, doesn't fail)", async () => {
		// No CACHE_STATE stored — saveCache will fail to read it, post wraps with catchAll
		const layer = Layer.mergeAll(
			makeCacheLayer(),
			// Empty state — get("CACHE_STATE") will fail
			makeStateLayer({ stored: {} }),
		);

		// Use the real post Effect from src/post.ts
		// Should resolve without throwing
		await expect(run(post, layer)).resolves.toBeUndefined();
	});

	it("post action handles cache save errors gracefully (warns, doesn't fail)", async () => {
		const layer = Layer.mergeAll(
			// failSave: true — save() returns a failure
			makeCacheLayer({ failSave: true }),
			makeStateLayer({
				stored: {
					CACHE_STATE: { hit: "partial", key: "test-key", paths: ["/cache/path"] },
				},
			}),
		);

		// Use the real post Effect from src/post.ts
		// Should resolve without throwing despite cache save failure
		await expect(run(post, layer)).resolves.toBeUndefined();
	});
});
