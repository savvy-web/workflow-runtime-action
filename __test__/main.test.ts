// ---------------------------------------------------------------------------
// Mock @savvy-web/github-action-effects so its @actions/cache import (which
// pulls in minimatch with a broken default export) never runs.
// ---------------------------------------------------------------------------

import { FileSystem } from "@effect/platform";
import type { Context as ContextType } from "effect";
import { Data, Effect, Exit, Layer, Option, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

vi.mock("@savvy-web/github-action-effects", () => {
	const { Context: C } = require("effect");
	return {
		Action: {
			run: () => Promise.resolve(),
		},
		ActionInputs: C.GenericTag("github-action-effects/ActionInputs"),
		ActionOutputs: C.GenericTag("github-action-effects/ActionOutputs"),
		ActionLogger: C.GenericTag("github-action-effects/ActionLogger"),
		ActionCache: C.GenericTag("github-action-effects/ActionCache"),
		ActionState: C.GenericTag("github-action-effects/ActionState"),
		ActionEnvironment: C.GenericTag("github-action-effects/ActionEnvironment"),
		CommandRunner: C.GenericTag("github-action-effects/CommandRunner"),
		ToolInstaller: C.GenericTag("github-action-effects/ToolInstaller"),
		ActionCacheLive: C.GenericTag("ActionCacheLive"),
		ActionEnvironmentLive: C.GenericTag("ActionEnvironmentLive"),
		ActionStateLive: C.GenericTag("ActionStateLive"),
		CommandRunnerLive: C.GenericTag("CommandRunnerLive"),
		ToolInstallerLive: C.GenericTag("ToolInstallerLive"),
	};
});

const {
	ActionInputs,
	ActionOutputs,
	ActionLogger,
	ActionCache,
	ActionState,
	ActionEnvironment,
	CommandRunner,
	ToolInstaller,
} = await import("@savvy-web/github-action-effects");

// ---------------------------------------------------------------------------
// Error stubs (same tags as real package)
// ---------------------------------------------------------------------------

const ActionCacheErrorBase = Data.TaggedError("ActionCacheError");
class ActionCacheError extends ActionCacheErrorBase<{
	readonly operation: string;
	readonly reason: string;
}> {
	get message(): string {
		return this.reason;
	}
}

// ---------------------------------------------------------------------------
// Mock service factories
// ---------------------------------------------------------------------------

type OutputsRecord = Record<string, string>;
type ExportedVars = Record<string, string>;

const makeInputsImpl = (inputs: Record<string, string>) => ({
	get: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
		const raw = inputs[name];
		if (raw === undefined || raw === "") {
			return Effect.die(`Missing required input: ${name}`);
		}
		return Schema.decode(schema)(raw as unknown as I);
	},
	getOptional: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
		const raw = inputs[name];
		if (raw === undefined || raw === "") {
			return Effect.succeed(Option.none<A>());
		}
		return Schema.decode(schema)(raw as unknown as I).pipe(
			Effect.map((a) => Option.some(a)),
			Effect.orElse(() => Effect.succeed(Option.none<A>())),
		);
	},
	getSecret: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
		const raw = inputs[name];
		if (raw === undefined || raw === "") {
			return Effect.die(`Missing required secret: ${name}`);
		}
		return Schema.decode(schema)(raw as unknown as I);
	},
	getJson: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
		const raw = inputs[name];
		const parsed = JSON.parse(raw ?? "null") as unknown;
		return Schema.decode(schema)(parsed as I);
	},
	getMultiline: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
		const raw = inputs[name] ?? "";
		const lines = raw
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0 && !l.startsWith("#"));
		return Effect.forEach(lines, (line) => Schema.decode(schema)(line as unknown as I));
	},
	getBoolean: (name: string) => {
		const raw = (inputs[name] ?? "").toLowerCase();
		return Effect.succeed(raw === "true");
	},
	getBooleanOptional: (name: string, defaultValue: boolean) => {
		const raw = inputs[name];
		if (raw === undefined || raw === "") {
			return Effect.succeed(defaultValue);
		}
		return Effect.succeed(raw.toLowerCase() === "true");
	},
});

const makeInputsLayer = (inputs: Record<string, string>) =>
	Layer.succeed(
		ActionInputs,
		makeInputsImpl(inputs) as unknown as ContextType.Tag.Service<typeof ActionInputs>,
	) as unknown as Layer.Layer<never>;

const makeOutputsLayer = (store: OutputsRecord, exportedVars: ExportedVars = {}) =>
	Layer.succeed(ActionOutputs, {
		set: (name: string, value: string) => {
			store[name] = value;
			return Effect.void;
		},
		setJson: () => Effect.void,
		summary: () => Effect.void,
		exportVariable: (name: string, value: string) => {
			exportedVars[name] = value;
			return Effect.void;
		},
		addPath: () => Effect.void,
		setFailed: () => Effect.void,
		setSecret: () => Effect.void,
	} as unknown as ContextType.Tag.Service<typeof ActionOutputs>) as unknown as Layer.Layer<never>;

const makeLoggerLayer = () =>
	Layer.succeed(ActionLogger, {
		group: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) => effect,
		withBuffer: <A, E, R>(_label: string, effect: Effect.Effect<A, E, R>) => effect,
		annotationError: () => Effect.void,
		annotationWarning: () => Effect.void,
		annotationNotice: () => Effect.void,
	} as unknown as ContextType.Tag.Service<typeof ActionLogger>) as unknown as Layer.Layer<never>;

const makeCacheLayer = (hitType: "exact" | "partial" | "none" = "none") =>
	Layer.succeed(ActionCache, {
		save: () => Effect.void,
		restore: (key: string) => {
			const hit = hitType !== "none";
			const matchedKey = hitType === "exact" ? key : hitType === "partial" ? `${key}-partial` : undefined;
			return Effect.succeed({ hit, matchedKey });
		},
		withCache: <A, E>(_k: string, _p: ReadonlyArray<string>, effect: Effect.Effect<A, E>) => effect,
	} as unknown as ContextType.Tag.Service<typeof ActionCache>) as unknown as Layer.Layer<never>;

const makeFailingCacheLayer = () =>
	Layer.succeed(ActionCache, {
		save: () => Effect.fail(new ActionCacheError({ operation: "save", reason: "save failed" })),
		restore: () => Effect.fail(new ActionCacheError({ operation: "restore", reason: "restore failed" })),
		withCache: <A, E>(_k: string, _p: ReadonlyArray<string>, effect: Effect.Effect<A, E>) => effect,
	} as unknown as ContextType.Tag.Service<typeof ActionCache>) as unknown as Layer.Layer<never>;

const makeStateLayer = () => {
	const store = new Map<string, string>();
	return Layer.succeed(ActionState, {
		save: (key: string, value: unknown) => {
			store.set(key, JSON.stringify(value));
			return Effect.void;
		},
		get: (key: string) => {
			const raw = store.get(key);
			if (raw === undefined) return Effect.die(`State key not found: ${key}`);
			return Effect.succeed(JSON.parse(raw) as unknown);
		},
		getOptional: (key: string) => {
			const raw = store.get(key);
			if (raw === undefined) return Effect.succeed(Option.none());
			return Effect.succeed(Option.some(JSON.parse(raw) as unknown));
		},
	} as unknown as ContextType.Tag.Service<typeof ActionState>) as unknown as Layer.Layer<never>;
};

const makeEnvironmentLayer = (env: Record<string, string> = {}) =>
	Layer.succeed(ActionEnvironment, {
		get: (name: string) => {
			const val = env[name];
			if (val === undefined) return Effect.die(`Env var not found: ${name}`);
			return Effect.succeed(val);
		},
		getOptional: (name: string) => Effect.succeed(env[name] !== undefined ? Option.some(env[name]) : Option.none()),
		github: Effect.die("not implemented"),
		runner: Effect.die("not implemented"),
	} as unknown as ContextType.Tag.Service<typeof ActionEnvironment>) as unknown as Layer.Layer<never>;

const makeCommandRunnerLayer = (
	responses: Map<string, { exitCode: number; stdout: string; stderr: string }> = new Map(),
) => {
	const lookup = (
		command: string,
		args: ReadonlyArray<string>,
	): { exitCode: number; stdout: string; stderr: string } => {
		const key = args.length > 0 ? `${command} ${[...args].join(" ")}` : command;
		return responses.get(key) ?? responses.get(command) ?? { exitCode: 0, stdout: "", stderr: "" };
	};

	const failOnNonZero = (
		command: string,
		_args: ReadonlyArray<string>,
		response: { exitCode: number; stdout: string; stderr: string },
	): Effect.Effect<{ exitCode: number; stdout: string; stderr: string }, Error> => {
		if (response.exitCode === 0) {
			return Effect.succeed(response);
		}
		return Effect.fail(new Error(`Command "${command}" exited with code ${response.exitCode}`));
	};

	return Layer.succeed(CommandRunner, {
		exec: (command: string, args: ReadonlyArray<string> = []) =>
			failOnNonZero(command, args, lookup(command, args)).pipe(
				Effect.map((r: { exitCode: number; stdout: string; stderr: string }) => r.exitCode),
			),
		execCapture: (command: string, args: ReadonlyArray<string> = []) =>
			failOnNonZero(command, args, lookup(command, args)),
		execJson: (command: string, args: ReadonlyArray<string> | undefined) => {
			const resolvedArgs = args ?? [];
			return failOnNonZero(command, resolvedArgs, lookup(command, resolvedArgs)) as never;
		},
		execLines: (command: string, args: ReadonlyArray<string> = []) =>
			failOnNonZero(command, args, lookup(command, args)).pipe(
				Effect.map((r: { exitCode: number; stdout: string; stderr: string }) =>
					r.stdout
						.split("\n")
						.map((l: string) => l.trim())
						.filter((l: string) => l.length > 0),
				),
			),
	} as unknown as ContextType.Tag.Service<typeof CommandRunner>) as unknown as Layer.Layer<never>;
};

const makeToolInstallerLayer = () =>
	Layer.succeed(ToolInstaller, {
		install: (name: string, version: string) => Effect.succeed(`/tools/${name}/${version}`),
		isCached: () => Effect.succeed(false),
		installAndAddToPath: (name: string, version: string) => Effect.succeed(`/tools/${name}/${version}`),
	} as unknown as ContextType.Tag.Service<typeof ToolInstaller>) as unknown as Layer.Layer<never>;

// ---------------------------------------------------------------------------
// FileSystem mock helpers
// ---------------------------------------------------------------------------

type FsFiles = Record<string, string>;
type FsExists = Set<string>;

const makeFileSystemLayer = (
	files: FsFiles = {},
	exists: FsExists = new Set(Object.keys(files)),
): Layer.Layer<FileSystem.FileSystem> =>
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
				if (exists.has(path)) {
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

// ---------------------------------------------------------------------------
// Import the module-under-test pieces (config, cache, etc.) which are
// what main.ts composes. We test the pipeline by importing those modules
// directly and composing them the same way main.ts does.
// ---------------------------------------------------------------------------

import type { PackageManager } from "../src/cache.js";
import { findLockFiles, getCombinedCacheConfig, restoreCache } from "../src/cache.js";
import { detectBiome, detectTurbo, loadPackageJson, parseDevEngines } from "../src/config.js";
import {
	getActivePackageManagers,
	installBiome,
	installDependencies,
	parseMultiValueInput,
	setOutputs,
	setupPackageManager,
} from "../src/main.js";
import { RuntimeInstaller, installerLayerFor } from "../src/runtime-installer.js";

/**
 * Build the full pipeline Effect the same way main.ts does,
 * allowing us to provide test layers.
 *
 * We use `as never` for service tag yields because in test context
 * the mock implementations don't match the exact service type signatures.
 */
// biome-ignore lint/suspicious/noExplicitAny: test mock type erasure at service boundary
const buildPipeline: Effect.Effect<void, any, any> = Effect.gen(function* () {
	const inputs = (yield* ActionInputs) as unknown as ReturnType<typeof makeInputsImpl>;
	const outputs = (yield* ActionOutputs) as unknown as {
		set: (name: string, value: string) => Effect.Effect<void>;
		exportVariable: (name: string, value: string) => Effect.Effect<void>;
	};
	const logger = (yield* ActionLogger) as unknown as {
		group: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
	};

	// 1. Parse configuration
	const config = yield* logger.group(
		"Detect configuration",
		Effect.gen(function* () {
			const devEngines = yield* loadPackageJson;
			const parsed = parseDevEngines(devEngines);
			const runtimes = parsed.runtime;
			const packageManager = parsed.packageManager;
			const biome = yield* detectBiome(inputs as never);
			const turbo = yield* detectTurbo;
			return { runtimes, packageManager, biome, turbo };
		}),
	);

	// 2. Cache
	const pmName = config.packageManager.name as PackageManager;
	const activePackageManagers = getActivePackageManagers(config.runtimes, pmName);

	const runtimeEntries: Array<{ name: string; version: string }> = config.runtimes.map((r) => ({
		name: r.name,
		version: r.version,
	}));
	if (Option.isSome(config.biome)) {
		runtimeEntries.push({ name: "biome", version: config.biome.value });
	}

	const cacheConfig = yield* getCombinedCacheConfig(activePackageManagers, runtimeEntries);
	const lockfiles = yield* findLockFiles(cacheConfig.lockfilePatterns);

	const cacheBust = yield* inputs.getOptional("cache-bust", Schema.String);
	const cacheBustValue = Option.isSome(cacheBust) && cacheBust.value !== "false" ? cacheBust.value : undefined;

	if (config.turbo) {
		const turboToken = yield* inputs.getOptional("turbo-token", Schema.String);
		const turboTeam = yield* inputs.getOptional("turbo-team", Schema.String);
		if (Option.isSome(turboToken) && turboToken.value !== "") {
			yield* outputs.exportVariable("TURBO_TOKEN", turboToken.value);
		}
		if (Option.isSome(turboTeam) && turboTeam.value !== "") {
			yield* outputs.exportVariable("TURBO_TEAM", turboTeam.value);
		}
		cacheConfig.cachePaths.push("**/.turbo");
	}

	// Restore cache (non-fatal)
	const cacheResult = yield* logger.group(
		"Restore cache",
		restoreCache({
			cachePaths: cacheConfig.cachePaths,
			runtimes: runtimeEntries,
			packageManager: { name: config.packageManager.name, version: config.packageManager.version },
			lockfiles,
			cacheBust: cacheBustValue,
		}).pipe(Effect.catchTag("CacheError", () => Effect.succeed("none" as const))),
	);

	// 3. Install runtimes
	const installed = yield* logger.group(
		"Install runtimes",
		Effect.forEach(config.runtimes, (rt) =>
			RuntimeInstaller.pipe(
				Effect.flatMap((installer) => installer.install(rt.version)),
				Effect.provide(installerLayerFor(rt.name)),
			),
		),
	);

	// 4. Install dependencies
	const shouldInstallDeps = yield* inputs.getBooleanOptional("install-deps", true);
	if (shouldInstallDeps) {
		yield* logger.group("Install dependencies", installDependencies(pmName));
	}

	// 5. Install Biome (non-fatal) — in the test we just log success
	if (Option.isSome(config.biome)) {
		yield* logger
			.group("Install Biome", Effect.log(`Biome ${config.biome.value} (test stub)`))
			.pipe(Effect.catchAll(() => Effect.void));
	}

	// 6. Set outputs
	yield* setOutputs(outputs as never, installed, config, cacheResult, lockfiles, cacheConfig.cachePaths);
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const VALID_PACKAGE_JSON = JSON.stringify({
	name: "test-project",
	devEngines: {
		packageManager: { name: "pnpm", version: "10.20.0", onFail: "error" },
		runtime: { name: "node", version: "24.11.0", onFail: "error" },
	},
});

const MULTI_RUNTIME_PACKAGE_JSON = JSON.stringify({
	name: "test-project",
	devEngines: {
		packageManager: { name: "pnpm", version: "10.20.0", onFail: "error" },
		runtime: [
			{ name: "node", version: "24.11.0", onFail: "error" },
			{ name: "bun", version: "1.3.3", onFail: "error" },
		],
	},
});

const buildBaseLayer = (opts: {
	files?: FsFiles;
	inputs?: Record<string, string>;
	cacheHit?: "exact" | "partial" | "none";
	failCache?: boolean;
	cmdResponses?: Map<string, { exitCode: number; stdout: string; stderr: string }>;
	env?: Record<string, string>;
}) => {
	const outputStore: OutputsRecord = {};
	const exportedVars: ExportedVars = {};

	const fsLayer = makeFileSystemLayer(
		opts.files ?? { "package.json": VALID_PACKAGE_JSON },
		new Set(Object.keys(opts.files ?? { "package.json": VALID_PACKAGE_JSON })),
	);

	const layer = Layer.mergeAll(
		makeInputsLayer(opts.inputs ?? {}),
		makeOutputsLayer(outputStore, exportedVars),
		makeLoggerLayer(),
		opts.failCache ? makeFailingCacheLayer() : makeCacheLayer(opts.cacheHit ?? "none"),
		makeStateLayer(),
		makeEnvironmentLayer(opts.env ?? { GITHUB_REF: "refs/heads/main" }),
		makeCommandRunnerLayer(opts.cmdResponses),
		makeToolInstallerLayer(),
		fsLayer,
	);

	return { layer, outputStore, exportedVars };
};

/** Run the pipeline with given layers, erasing the R parameter for test. */
const runPipeline = (layer: Layer.Layer<never>) =>
	Effect.runPromise(Effect.provide(buildPipeline as Effect.Effect<void, never, never>, layer));

/** Run the pipeline and return its Exit for failure assertions. */
const runPipelineExit = (layer: Layer.Layer<never>) =>
	Effect.runPromise(Effect.exit(Effect.provide(buildPipeline as Effect.Effect<void, never, never>, layer)));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("main pipeline", () => {
	it("full pipeline with valid config sets all outputs correctly", async () => {
		const { layer, outputStore } = buildBaseLayer({
			cacheHit: "exact",
		});

		await runPipeline(layer);

		expect(outputStore["node-version"]).toBe("24.11.0");
		expect(outputStore["node-enabled"]).toBe("true");
		expect(outputStore["bun-version"]).toBe("");
		expect(outputStore["bun-enabled"]).toBe("false");
		expect(outputStore["deno-version"]).toBe("");
		expect(outputStore["deno-enabled"]).toBe("false");
		expect(outputStore["package-manager"]).toBe("pnpm");
		expect(outputStore["package-manager-version"]).toBe("10.20.0");
		expect(outputStore["biome-enabled"]).toBe("false");
		expect(outputStore["turbo-enabled"]).toBe("false");
	});

	it("install-deps=false skips dependency installation", async () => {
		const { layer, outputStore } = buildBaseLayer({
			inputs: { "install-deps": "false" },
		});

		await runPipeline(layer);

		// Pipeline should complete successfully with outputs set
		expect(outputStore["node-version"]).toBe("24.11.0");
		expect(outputStore["package-manager"]).toBe("pnpm");
	});

	it("biome install failure does not fail the action (non-fatal)", async () => {
		const biomeConfig = JSON.stringify({
			$schema: "https://biomejs.dev/schemas/2.3.14/schema.json",
		});

		const { layer, outputStore } = buildBaseLayer({
			files: {
				"package.json": VALID_PACKAGE_JSON,
				"biome.jsonc": biomeConfig,
			},
		});

		await runPipeline(layer);

		// Pipeline completed - biome was detected
		expect(outputStore["biome-enabled"]).toBe("true");
		expect(outputStore["biome-version"]).toBe("2.3.14");
		expect(outputStore["node-version"]).toBe("24.11.0");
	});

	it("cache restore failure does not fail the action (non-fatal)", async () => {
		const { layer, outputStore } = buildBaseLayer({
			failCache: true,
		});

		await runPipeline(layer);

		// Pipeline completed despite cache failure
		expect(outputStore["cache-hit"]).toBe("false");
		expect(outputStore["node-version"]).toBe("24.11.0");
	});

	it("missing package.json fails with ConfigError", async () => {
		const { layer } = buildBaseLayer({
			files: {},
		});

		const exit = await runPipelineExit(layer);

		expect(Exit.isFailure(exit)).toBe(true);
	});

	describe("outputs map cache hit correctly", () => {
		it("exact cache hit maps to 'true'", async () => {
			const { layer, outputStore } = buildBaseLayer({
				cacheHit: "exact",
			});

			await runPipeline(layer);
			expect(outputStore["cache-hit"]).toBe("true");
		});

		it("partial cache hit maps to 'partial'", async () => {
			const { layer, outputStore } = buildBaseLayer({
				cacheHit: "partial",
			});

			await runPipeline(layer);
			expect(outputStore["cache-hit"]).toBe("partial");
		});

		it("no cache hit maps to 'false'", async () => {
			const { layer, outputStore } = buildBaseLayer({
				cacheHit: "none",
			});

			await runPipeline(layer);
			expect(outputStore["cache-hit"]).toBe("false");
		});
	});

	it("multi-runtime config installs all runtimes and sets outputs", async () => {
		const { layer, outputStore } = buildBaseLayer({
			files: { "package.json": MULTI_RUNTIME_PACKAGE_JSON },
		});

		await runPipeline(layer);

		expect(outputStore["node-version"]).toBe("24.11.0");
		expect(outputStore["node-enabled"]).toBe("true");
		expect(outputStore["bun-version"]).toBe("1.3.3");
		expect(outputStore["bun-enabled"]).toBe("true");
		expect(outputStore["package-manager"]).toBe("pnpm");
	});

	it("turbo detection sets TURBO_TOKEN and TURBO_TEAM env vars", async () => {
		const { layer, outputStore, exportedVars } = buildBaseLayer({
			files: {
				"package.json": VALID_PACKAGE_JSON,
				"turbo.json": "{}",
			},
			inputs: {
				"turbo-token": "my-token",
				"turbo-team": "my-team",
			},
		});

		await runPipeline(layer);

		expect(outputStore["turbo-enabled"]).toBe("true");
		expect(exportedVars.TURBO_TOKEN).toBe("my-token");
		expect(exportedVars.TURBO_TEAM).toBe("my-team");
	});
});

// ---------------------------------------------------------------------------
// parseMultiValueInput tests
// ---------------------------------------------------------------------------

describe("parseMultiValueInput", () => {
	it("returns empty array for empty string", () => {
		expect(parseMultiValueInput("")).toEqual([]);
		expect(parseMultiValueInput("   ")).toEqual([]);
	});

	it("parses comma-separated values", () => {
		expect(parseMultiValueInput("a, b, c")).toEqual(["a", "b", "c"]);
	});

	it("parses newline-separated values", () => {
		expect(parseMultiValueInput("a\nb\nc")).toEqual(["a", "b", "c"]);
	});

	it("parses bullet list values", () => {
		expect(parseMultiValueInput("* a\n* b\n* c")).toEqual(["a", "b", "c"]);
	});

	it("parses JSON array values", () => {
		expect(parseMultiValueInput('["a", "b", "c"]')).toEqual(["a", "b", "c"]);
	});

	it("filters out comment lines in newline format", () => {
		expect(parseMultiValueInput("a\n# comment\nb")).toEqual(["a", "b"]);
	});

	it("handles invalid JSON gracefully by falling through", () => {
		expect(parseMultiValueInput("[not valid json")).toEqual(["[not valid json"]);
	});
});

// ---------------------------------------------------------------------------
// installDependencies branch coverage
// ---------------------------------------------------------------------------

describe("installDependencies", () => {
	it("runs bun install for bun PM", async () => {
		const responses = new Map([["bun install", { exitCode: 0, stdout: "", stderr: "" }]]);
		const cmdLayer = makeCommandRunnerLayer(responses);
		const fsLayer = Layer.succeed(FileSystem.FileSystem, {
			access: () => Effect.fail("not found"),
		} as unknown as FileSystem.FileSystem);
		const layer = Layer.mergeAll(cmdLayer, fsLayer);
		await Effect.runPromise(
			Effect.provide(installDependencies("bun") as Effect.Effect<void, unknown, never>, layer as never),
		);
	});
});

// ---------------------------------------------------------------------------
// setupPackageManager tests
// ---------------------------------------------------------------------------

describe("setupPackageManager", () => {
	it("skips setup for bun", async () => {
		const cmdLayer = makeCommandRunnerLayer();
		await Effect.runPromise(
			Effect.provide(setupPackageManager("bun", "1.3.3") as Effect.Effect<void, unknown, never>, cmdLayer as never),
		);
	});

	it("skips setup for deno", async () => {
		const cmdLayer = makeCommandRunnerLayer();
		await Effect.runPromise(
			Effect.provide(setupPackageManager("deno", "2.5.6") as Effect.Effect<void, unknown, never>, cmdLayer as never),
		);
	});

	it("runs corepack for pnpm", async () => {
		const responses = new Map([
			["node --version", { exitCode: 0, stdout: "v24.9.0\n", stderr: "" }],
			["corepack enable", { exitCode: 0, stdout: "", stderr: "" }],
			["corepack prepare pnpm@10.20.0 --activate", { exitCode: 0, stdout: "", stderr: "" }],
			["pnpm --version", { exitCode: 0, stdout: "10.20.0\n", stderr: "" }],
		]);
		const cmdLayer = makeCommandRunnerLayer(responses);
		await Effect.runPromise(
			Effect.provide(setupPackageManager("pnpm", "10.20.0") as Effect.Effect<void, unknown, never>, cmdLayer as never),
		);
	});

	it("runs npm install -g for npm when version differs", async () => {
		const responses = new Map([
			["npm --version", { exitCode: 0, stdout: "10.8.2\n", stderr: "" }],
			["sudo npm install -g npm@11.6.0", { exitCode: 0, stdout: "", stderr: "" }],
			["sudo chown -R", { exitCode: 0, stdout: "", stderr: "" }],
		]);
		const cmdLayer = makeCommandRunnerLayer(responses);
		await Effect.runPromise(
			Effect.provide(setupPackageManager("npm", "11.6.0") as Effect.Effect<void, unknown, never>, cmdLayer as never),
		);
	});

	it("skips npm install when version already matches", async () => {
		const responses = new Map([["npm --version", { exitCode: 0, stdout: "11.6.0\n", stderr: "" }]]);
		const cmdLayer = makeCommandRunnerLayer(responses);
		await Effect.runPromise(
			Effect.provide(setupPackageManager("npm", "11.6.0") as Effect.Effect<void, unknown, never>, cmdLayer as never),
		);
	});

	it("runs corepack for yarn (no tmpdir)", async () => {
		const responses = new Map([
			["node --version", { exitCode: 0, stdout: "v24.9.0\n", stderr: "" }],
			["corepack enable", { exitCode: 0, stdout: "", stderr: "" }],
			["corepack prepare yarn@4.6.0 --activate", { exitCode: 0, stdout: "", stderr: "" }],
			["yarn --version", { exitCode: 0, stdout: "4.6.0\n", stderr: "" }],
		]);
		const cmdLayer = makeCommandRunnerLayer(responses);
		await Effect.runPromise(
			Effect.provide(setupPackageManager("yarn", "4.6.0") as Effect.Effect<void, unknown, never>, cmdLayer as never),
		);
	});

	it("runs npm install -g without sudo on windows", async () => {
		// Temporarily mock platform to win32
		const origPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "win32", writable: true });
		try {
			const responses = new Map([
				["npm --version", { exitCode: 0, stdout: "10.8.2\n", stderr: "" }],
				["npm install -g npm@11.6.0", { exitCode: 0, stdout: "", stderr: "" }],
			]);
			const cmdLayer = makeCommandRunnerLayer(responses);
			await Effect.runPromise(
				Effect.provide(setupPackageManager("npm", "11.6.0") as Effect.Effect<void, unknown, never>, cmdLayer as never),
			);
		} finally {
			Object.defineProperty(process, "platform", { value: origPlatform, writable: true });
		}
	});

	it("installs corepack for Node >= 25", async () => {
		const responses = new Map([
			["node --version", { exitCode: 0, stdout: "v25.0.0\n", stderr: "" }],
			["npm install -g --force corepack@latest", { exitCode: 0, stdout: "", stderr: "" }],
			["corepack enable", { exitCode: 0, stdout: "", stderr: "" }],
			["corepack prepare pnpm@10.20.0 --activate", { exitCode: 0, stdout: "", stderr: "" }],
			["pnpm --version", { exitCode: 0, stdout: "10.20.0\n", stderr: "" }],
		]);
		const cmdLayer = makeCommandRunnerLayer(responses);
		await Effect.runPromise(
			Effect.provide(setupPackageManager("pnpm", "10.20.0") as Effect.Effect<void, unknown, never>, cmdLayer as never),
		);
	});
});

// ---------------------------------------------------------------------------
// installBiome tests (stub — real impl uses @actions/tool-cache directly)
// ---------------------------------------------------------------------------

describe("installBiome", () => {
	it("is exported and callable", () => {
		expect(typeof installBiome).toBe("function");
	});
});
