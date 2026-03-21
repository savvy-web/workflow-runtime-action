import { platform } from "node:os";
import { FileSystem } from "@effect/platform";
import { ActionCache, ActionEnvironment, ActionState, CommandRunner } from "@savvy-web/github-action-effects";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import {
	detectCachePath,
	findLockFiles,
	generateCacheKey,
	generateRestoreKeys,
	getCombinedCacheConfig,
	getDefaultCachePaths,
	getLockfilePatterns,
	restoreCache,
	saveCache,
} from "../src/cache.js";

// ---------------------------------------------------------------------------
// Helpers — cast all layers to Layer.Layer<never> so Effect.provide is happy
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: test mock requires any for mocked service tags
type AnyLayer = Layer.Layer<any>;
const asLayer = (l: AnyLayer): Layer.Layer<never> => l as Layer.Layer<never>;

// biome-ignore lint/suspicious/noExplicitAny: test mock requires any for mocked effect results
const run = <A>(effect: Effect.Effect<A, any, any>, layer: AnyLayer): Promise<A> =>
	Effect.runPromise(Effect.provide(effect, asLayer(layer)) as Effect.Effect<A, never, never>);

// ---------------------------------------------------------------------------
// Service layer factories
// ---------------------------------------------------------------------------

type FsFiles = Record<string, string>;

const makeFileSystemLayer = (files: FsFiles = {}): AnyLayer =>
	Layer.succeed(
		FileSystem.FileSystem,
		FileSystem.makeNoop({
			readFileString: (path) => {
				const content = files[path];
				if (content === undefined) {
					return Effect.fail(
						new (class extends Error {
							readonly _tag = "SystemError";
							readonly reason = "NotFound";
						})() as never,
					);
				}
				return Effect.succeed(content);
			},
			access: (path) => {
				if (path in files) {
					return Effect.succeed(undefined);
				}
				return Effect.fail(
					new (class extends Error {
						readonly _tag = "SystemError";
						readonly reason = "NotFound";
					})() as never,
				);
			},
		}),
	);

const makeEnvironmentLayer = (env: Record<string, string> = {}): AnyLayer =>
	Layer.succeed(ActionEnvironment, {
		get: (name: string) => {
			const v = env[name];
			if (v === undefined) return Effect.fail({ _tag: "ActionEnvironmentError", variable: name, reason: "Missing" });
			return Effect.succeed(v);
		},
		getOptional: (name: string) => {
			const v = env[name];
			if (v === undefined || v === "") return Effect.succeed(Option.none());
			return Effect.succeed(Option.some(v));
		},
		github: Effect.fail({ _tag: "ActionEnvironmentError", variable: "GITHUB_*", reason: "Not implemented in test" }),
		runner: Effect.fail({ _tag: "ActionEnvironmentError", variable: "RUNNER_*", reason: "Not implemented in test" }),
	} as never);

const makeCommandRunnerLayer = (
	handler: (cmd: string, args?: readonly string[]) => { exitCode: number; stdout: string; stderr: string },
): AnyLayer =>
	Layer.succeed(CommandRunner, {
		exec: (cmd: string, args?: readonly string[]) => Effect.succeed(handler(cmd, args).exitCode),
		execCapture: (cmd: string, args?: readonly string[]) => Effect.succeed(handler(cmd, args)),
		execJson: () => Effect.fail({ _tag: "CommandRunnerError", reason: "Not implemented" }),
		execLines: () => Effect.fail({ _tag: "CommandRunnerError", reason: "Not implemented" }),
	} as never);

const makeFailingCommandRunnerLayer = (): AnyLayer =>
	Layer.succeed(CommandRunner, {
		exec: () => Effect.fail({ _tag: "CommandRunnerError", command: "test", args: [], reason: "Command failed" }),
		execCapture: () => Effect.fail({ _tag: "CommandRunnerError", command: "test", args: [], reason: "Command failed" }),
		execJson: () => Effect.fail({ _tag: "CommandRunnerError", reason: "Not implemented" }),
		execLines: () => Effect.fail({ _tag: "CommandRunnerError", reason: "Not implemented" }),
	} as never);

interface CacheSaveCall {
	paths: readonly string[];
	key: string;
}

interface CacheRestoreCall {
	paths: readonly string[];
	key: string;
	restoreKeys?: readonly string[];
}

const makeCacheLayer = (opts: {
	restoreResult?: Option.Option<string>;
	saveCalls?: CacheSaveCall[];
	restoreCalls?: CacheRestoreCall[];
}): AnyLayer => {
	const saveCalls = opts.saveCalls ?? [];
	const restoreCalls = opts.restoreCalls ?? [];
	const restoreResult = opts.restoreResult ?? Option.none();

	return Layer.succeed(ActionCache, {
		save: (paths: readonly string[], key: string) => {
			saveCalls.push({ paths, key });
			return Effect.succeed(undefined);
		},
		restore: (paths: readonly string[], key: string, restoreKeys?: readonly string[]) => {
			restoreCalls.push({ paths, key, restoreKeys });
			return Effect.succeed(restoreResult);
		},
	} as never);
};

interface StateSaveCall {
	key: string;
	value: unknown;
}

const makeStateLayer = (opts: { saved?: StateSaveCall[]; stored?: Record<string, unknown> }): AnyLayer => {
	const saved = opts.saved ?? [];
	const stored = opts.stored ?? {};

	return Layer.succeed(ActionState, {
		save: (key: string, value: unknown) => {
			saved.push({ key, value });
			return Effect.succeed(undefined);
		},
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
// Tests
// ---------------------------------------------------------------------------

describe("getDefaultCachePaths", () => {
	it("returns correct paths for npm", () => {
		const paths = getDefaultCachePaths("npm");
		expect(paths.length).toBeGreaterThan(0);
		expect(paths.some((p) => p.includes("npm"))).toBe(true);
	});

	it("returns correct paths for pnpm", () => {
		const paths = getDefaultCachePaths("pnpm");
		expect(paths.some((p) => p.includes("pnpm"))).toBe(true);
	});

	it("returns correct paths for yarn", () => {
		const paths = getDefaultCachePaths("yarn");
		expect(paths.length).toBe(2);
		expect(paths.some((p) => p.includes("yarn") || p.includes("Yarn"))).toBe(true);
	});

	it("returns correct paths for bun", () => {
		const paths = getDefaultCachePaths("bun");
		expect(paths.some((p) => p.includes("bun"))).toBe(true);
	});

	it("returns correct paths for deno", () => {
		const paths = getDefaultCachePaths("deno");
		expect(paths.some((p) => p.includes("deno"))).toBe(true);
	});
});

describe("getLockfilePatterns", () => {
	it("returns package-lock.json and npm-shrinkwrap.json for npm", () => {
		const patterns = getLockfilePatterns("npm");
		expect(patterns).toContain("**/package-lock.json");
		expect(patterns).toContain("**/npm-shrinkwrap.json");
	});

	it("returns pnpm-lock.yaml for pnpm", () => {
		const patterns = getLockfilePatterns("pnpm");
		expect(patterns).toContain("**/pnpm-lock.yaml");
	});

	it("returns yarn.lock for yarn", () => {
		const patterns = getLockfilePatterns("yarn");
		expect(patterns).toContain("**/yarn.lock");
	});

	it("returns bun.lock and bun.lockb for bun", () => {
		const patterns = getLockfilePatterns("bun");
		expect(patterns).toContain("**/bun.lock");
		expect(patterns).toContain("**/bun.lockb");
	});

	it("returns deno.lock for deno", () => {
		const patterns = getLockfilePatterns("deno");
		expect(patterns).toContain("**/deno.lock");
	});
});

describe("generateCacheKey", () => {
	const runtimes = [{ name: "node", version: "24.11.0" }];
	const pm = { name: "pnpm", version: "10.20.0" };

	const baseLayer = Layer.mergeAll(
		makeFileSystemLayer({ "pnpm-lock.yaml": "lockfile-content" }),
		makeEnvironmentLayer({ GITHUB_REF: "refs/heads/main" }),
	);

	it("produces correct format: {os}-{versionHash}-{branchHash}-{lockfileHash}", async () => {
		const key = await run(generateCacheKey(runtimes, pm, ["pnpm-lock.yaml"]), baseLayer);

		expect(key).toMatch(/^[a-z0-9]+-[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{8}$/);
		expect(key.startsWith(platform())).toBe(true);
	});

	it("produces different keys for different versions", async () => {
		const key1 = await run(generateCacheKey(runtimes, pm, ["pnpm-lock.yaml"]), baseLayer);

		const key2 = await run(generateCacheKey([{ name: "node", version: "22.0.0" }], pm, ["pnpm-lock.yaml"]), baseLayer);

		expect(key1).not.toBe(key2);
	});

	it("produces different keys for different branches", async () => {
		const layer1 = Layer.mergeAll(
			makeFileSystemLayer({ "pnpm-lock.yaml": "content" }),
			makeEnvironmentLayer({ GITHUB_REF: "refs/heads/main" }),
		);

		const layer2 = Layer.mergeAll(
			makeFileSystemLayer({ "pnpm-lock.yaml": "content" }),
			makeEnvironmentLayer({ GITHUB_REF: "refs/heads/feature" }),
		);

		const key1 = await run(generateCacheKey(runtimes, pm, ["pnpm-lock.yaml"]), layer1);
		const key2 = await run(generateCacheKey(runtimes, pm, ["pnpm-lock.yaml"]), layer2);

		expect(key1).not.toBe(key2);
	});

	it("uses GITHUB_HEAD_REF for PRs over GITHUB_REF", async () => {
		const prLayer = Layer.mergeAll(
			makeFileSystemLayer({ "pnpm-lock.yaml": "content" }),
			makeEnvironmentLayer({
				GITHUB_HEAD_REF: "pr-branch",
				GITHUB_REF: "refs/heads/main",
			}),
		);

		const mainLayer = Layer.mergeAll(
			makeFileSystemLayer({ "pnpm-lock.yaml": "content" }),
			makeEnvironmentLayer({ GITHUB_REF: "refs/heads/main" }),
		);

		const prKey = await run(generateCacheKey(runtimes, pm, ["pnpm-lock.yaml"]), prLayer);
		const mainKey = await run(generateCacheKey(runtimes, pm, ["pnpm-lock.yaml"]), mainLayer);

		expect(prKey).not.toBe(mainKey);
	});
});

describe("restoreCache", () => {
	const runtimes = [{ name: "node", version: "24.11.0" }];
	const pm = { name: "pnpm", version: "10.20.0" };
	const cachePaths = ["/home/runner/.local/share/pnpm/store", "**/node_modules"];

	it("returns 'exact' when primary key matches and saves state", async () => {
		const stateSaved: StateSaveCall[] = [];

		const dynamicCacheLayer = Layer.succeed(ActionCache, {
			save: () => Effect.succeed(undefined),
			restore: (_paths: readonly string[], key: string) => {
				return Effect.succeed(Option.some(key));
			},
		} as never);

		const fullLayer = Layer.mergeAll(
			makeFileSystemLayer({}),
			makeEnvironmentLayer({ GITHUB_REF: "refs/heads/main" }),
			dynamicCacheLayer,
			makeStateLayer({ saved: stateSaved }),
		);

		const result = await run(restoreCache({ cachePaths, runtimes, packageManager: pm, lockfiles: [] }), fullLayer);

		expect(result).toBe("exact");
		expect(stateSaved.length).toBe(1);
		expect((stateSaved[0].value as { hit: string }).hit).toBe("exact");
	});

	it("returns 'partial' when restore key matches", async () => {
		const stateSaved: StateSaveCall[] = [];

		const dynamicCacheLayer = Layer.succeed(ActionCache, {
			save: () => Effect.succeed(undefined),
			restore: () => {
				return Effect.succeed(Option.some("some-other-key"));
			},
		} as never);

		const layer = Layer.mergeAll(
			makeFileSystemLayer({}),
			makeEnvironmentLayer({ GITHUB_REF: "refs/heads/main" }),
			dynamicCacheLayer,
			makeStateLayer({ saved: stateSaved }),
		);

		const result = await run(restoreCache({ cachePaths, runtimes, packageManager: pm, lockfiles: [] }), layer);

		expect(result).toBe("partial");
		expect((stateSaved[0].value as { hit: string }).hit).toBe("partial");
	});

	it("returns 'none' when no cache matches", async () => {
		const stateSaved: StateSaveCall[] = [];

		const layer = Layer.mergeAll(
			makeFileSystemLayer({}),
			makeEnvironmentLayer({ GITHUB_REF: "refs/heads/main" }),
			makeCacheLayer({ restoreResult: Option.none() }),
			makeStateLayer({ saved: stateSaved }),
		);

		const result = await run(restoreCache({ cachePaths, runtimes, packageManager: pm, lockfiles: [] }), layer);

		expect(result).toBe("none");
		expect((stateSaved[0].value as { hit: string }).hit).toBe("none");
	});
});

describe("saveCache", () => {
	it("saves when hit is 'partial'", async () => {
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

	it("saves when hit is 'none'", async () => {
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
	});

	it("skips when hit is 'exact'", async () => {
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

	it("skips when key is missing from state", async () => {
		const saveCalls: CacheSaveCall[] = [];

		const layer = Layer.mergeAll(
			makeCacheLayer({ saveCalls }),
			makeStateLayer({
				stored: {
					CACHE_STATE: { hit: "none", paths: ["/cache/path"] },
				},
			}),
		);

		await run(saveCache(), layer);

		expect(saveCalls.length).toBe(0);
	});
});

describe("getCombinedCacheConfig", () => {
	it("deduplicates paths across multiple package managers", async () => {
		const layer = makeFailingCommandRunnerLayer();

		const config = await run(getCombinedCacheConfig(["npm", "pnpm"]), layer);

		const nodeModulesCount = config.cachePaths.filter((p: string) => p === "**/node_modules").length;
		expect(nodeModulesCount).toBe(1);
	});

	it("includes tool cache paths for runtimes", async () => {
		const layer = makeFailingCommandRunnerLayer();
		const runtimes = [{ name: "node", version: "24.11.0" }];

		const config = await run(getCombinedCacheConfig(["pnpm"], runtimes), layer);

		const hasToolCache = config.cachePaths.some((p: string) => p.includes("hostedtoolcache/node/24.11.0"));
		expect(hasToolCache).toBe(true);
	});

	it("sorts paths with absolute paths first, then globs", async () => {
		const layer = makeFailingCommandRunnerLayer();

		const config = await run(getCombinedCacheConfig(["pnpm"]), layer);

		const firstGlobIdx = config.cachePaths.findIndex((p: string) => p.startsWith("*"));
		// Find last absolute path index by iterating
		let lastAbsoluteIdx = -1;
		for (let i = config.cachePaths.length - 1; i >= 0; i--) {
			if (!config.cachePaths[i].startsWith("*")) {
				lastAbsoluteIdx = i;
				break;
			}
		}

		if (firstGlobIdx !== -1 && lastAbsoluteIdx !== -1) {
			expect(lastAbsoluteIdx).toBeLessThan(firstGlobIdx);
		}
	});
});

describe("detectCachePath", () => {
	it("returns detected path from pnpm store path command", async () => {
		const layer = makeCommandRunnerLayer(() => ({
			exitCode: 0,
			stdout: "/home/runner/.local/share/pnpm/store\n",
			stderr: "",
		}));

		const result = await run(detectCachePath("pnpm"), layer);

		expect(result).toBe("/home/runner/.local/share/pnpm/store");
	});

	it("falls back to null on command failure", async () => {
		const layer = makeFailingCommandRunnerLayer();

		const result = await run(detectCachePath("pnpm"), layer);

		expect(result).toBeNull();
	});

	it("returns detected path for npm", async () => {
		const layer = makeCommandRunnerLayer(() => ({
			exitCode: 0,
			stdout: "/home/runner/.npm\n",
			stderr: "",
		}));

		const result = await run(detectCachePath("npm"), layer);

		expect(result).toBe("/home/runner/.npm");
	});

	it("returns detected path for yarn Berry", async () => {
		const layer = makeCommandRunnerLayer(() => ({
			exitCode: 0,
			stdout: "/home/runner/.yarn/cache\n",
			stderr: "",
		}));

		const result = await run(detectCachePath("yarn"), layer);

		expect(result).toBe("/home/runner/.yarn/cache");
	});

	it("returns detected path for bun", async () => {
		const layer = makeCommandRunnerLayer(() => ({
			exitCode: 0,
			stdout: "/home/runner/.bun/install/cache\n",
			stderr: "",
		}));

		const result = await run(detectCachePath("bun"), layer);

		expect(result).toBe("/home/runner/.bun/install/cache");
	});

	it("parses deno info --json for denoDir", async () => {
		const layer = makeCommandRunnerLayer(() => ({
			exitCode: 0,
			stdout: JSON.stringify({ denoDir: "/home/runner/.cache/deno" }),
			stderr: "",
		}));

		const result = await run(detectCachePath("deno"), layer);

		expect(result).toBe("/home/runner/.cache/deno");
	});
});

describe("findLockFiles", () => {
	it("finds lockfiles that exist at the workspace root", async () => {
		const layer = makeFileSystemLayer({
			"pnpm-lock.yaml": "lockfile content",
		});

		const result = await run(findLockFiles(["**/pnpm-lock.yaml"]), layer);

		expect(result).toEqual(["pnpm-lock.yaml"]);
	});

	it("returns empty array when no lockfiles exist", async () => {
		const layer = makeFileSystemLayer({});

		const result = await run(findLockFiles(["**/pnpm-lock.yaml", "**/yarn.lock"]), layer);

		expect(result).toEqual([]);
	});
});

describe("generateRestoreKeys", () => {
	const runtimes = [{ name: "node", version: "24.11.0" }];
	const pm = { name: "pnpm", version: "10.20.0" };

	it("returns restore key prefixes", async () => {
		const layer = makeEnvironmentLayer({ GITHUB_REF: "refs/heads/main" });

		const keys = await run(generateRestoreKeys(runtimes, pm), layer);

		expect(keys).toHaveLength(2);
		expect(keys[0]).toMatch(new RegExp(`^${platform()}-[a-f0-9]{8}-[a-f0-9]{8}-$`));
		expect(keys[1]).toMatch(new RegExp(`^${platform()}-[a-f0-9]{8}-$`));
	});

	it("returns empty array when cacheBust is set", async () => {
		const layer = makeEnvironmentLayer({ GITHUB_REF: "refs/heads/main" });

		const keys = await run(generateRestoreKeys(runtimes, pm, "test-bust"), layer);

		expect(keys).toEqual([]);
	});
});
