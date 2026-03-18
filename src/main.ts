import { FileSystem } from "@effect/platform";
import {
	Action,
	ActionCacheLive,
	ActionEnvironmentLive,
	ActionInputs,
	ActionLogger,
	ActionOutputs,
	ActionStateLive,
	CommandRunner,
	CommandRunnerLive,
	ToolInstallerLive,
} from "@savvy-web/github-action-effects";
import type { Context } from "effect";
import { Effect, Layer, Option, Schema } from "effect";
import type { PackageManager } from "./cache.js";
import { findLockFiles, getCombinedCacheConfig, restoreCache } from "./cache.js";
import { detectBiome, detectTurbo, loadPackageJson, parseDevEngines } from "./config.js";
import { formatDetection, formatInstallation, formatPackageManager, formatRuntime, formatSuccess } from "./emoji.js";
import { DependencyInstallError } from "./errors.js";
import type { InstalledRuntime } from "./runtime-installer.js";
import { BiomeInstallerLive, RuntimeInstaller, installerLayerFor } from "./runtime-installer.js";
import type { DevEngineEntry } from "./schemas.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determines active package managers from the set of installed runtimes
 * and the primary package manager.
 */
const getActivePackageManagers = (
	runtimes: ReadonlyArray<DevEngineEntry>,
	primaryPackageManager: PackageManager,
): PackageManager[] => {
	const pms = new Set<PackageManager>();

	for (const rt of runtimes) {
		if (rt.name === "node") pms.add(primaryPackageManager);
		else if (rt.name === "bun") pms.add("bun");
		else if (rt.name === "deno") pms.add("deno");
	}

	return Array.from(pms);
};

/**
 * Install dependencies using the detected package manager.
 * Uses lockfile-aware flags for reproducible installs.
 */
const installDependencies = (
	packageManager: PackageManager,
): Effect.Effect<void, DependencyInstallError, CommandRunner | FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const runner = yield* CommandRunner;
		const fs = yield* FileSystem.FileSystem;

		const fileExists = (path: string) =>
			fs.access(path).pipe(
				Effect.map(() => true),
				Effect.orElse(() => Effect.succeed(false)),
			);

		if (packageManager === "deno") {
			yield* Effect.log("Deno caches dependencies automatically, skipping install step");
			return;
		}

		let command: string[];

		switch (packageManager) {
			case "npm": {
				const hasLock = yield* fileExists("package-lock.json");
				command = hasLock ? ["ci"] : ["install"];
				break;
			}
			case "pnpm": {
				const hasLock = yield* fileExists("pnpm-lock.yaml");
				command = hasLock ? ["install", "--frozen-lockfile"] : ["install"];
				break;
			}
			case "yarn": {
				const hasLock = yield* fileExists("yarn.lock");
				command = hasLock ? ["install", "--immutable"] : ["install", "--no-immutable"];
				break;
			}
			case "bun": {
				const hasLock = yield* fileExists("bun.lock");
				command = hasLock ? ["install", "--frozen-lockfile"] : ["install"];
				break;
			}
		}

		yield* runner.exec(packageManager, command).pipe(
			Effect.mapError(
				(cause) =>
					new DependencyInstallError({
						packageManager,
						reason: `Failed to install dependencies: ${cause instanceof Error ? cause.message : String(cause)}`,
						cause,
					}),
			),
		);

		yield* Effect.log(formatSuccess("Dependencies installed successfully"));
	});

/**
 * Sets all action outputs from the pipeline results.
 */
const setOutputs = (
	outputs: Context.Tag.Service<ActionOutputs>,
	installed: ReadonlyArray<InstalledRuntime>,
	config: {
		readonly packageManager: DevEngineEntry;
		readonly biome: Option.Option<string>;
		readonly turbo: boolean;
	},
	cacheHit: "exact" | "partial" | "none",
	lockfiles: string[],
	cachePaths: string[],
) =>
	Effect.gen(function* () {
		// Runtime outputs
		const nodeRt = installed.find((r) => r.name === "node");
		const bunRt = installed.find((r) => r.name === "bun");
		const denoRt = installed.find((r) => r.name === "deno");

		yield* outputs.set("node-version", nodeRt?.version ?? "");
		yield* outputs.set("node-enabled", nodeRt ? "true" : "false");
		yield* outputs.set("bun-version", bunRt?.version ?? "");
		yield* outputs.set("bun-enabled", bunRt ? "true" : "false");
		yield* outputs.set("deno-version", denoRt?.version ?? "");
		yield* outputs.set("deno-enabled", denoRt ? "true" : "false");

		// Package manager outputs
		yield* outputs.set("package-manager", config.packageManager.name);
		yield* outputs.set("package-manager-version", config.packageManager.version);

		// Biome outputs
		yield* outputs.set("biome-version", Option.isSome(config.biome) ? config.biome.value : "");
		yield* outputs.set("biome-enabled", Option.isSome(config.biome) ? "true" : "false");

		// Turbo output
		yield* outputs.set("turbo-enabled", config.turbo ? "true" : "false");

		// Cache outputs
		const cacheHitOutput = cacheHit === "exact" ? "true" : cacheHit === "partial" ? "partial" : "false";
		yield* outputs.set("cache-hit", cacheHitOutput);
		yield* outputs.set("lockfiles", lockfiles.join(","));
		yield* outputs.set("cache-paths", cachePaths.join(","));
	});

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

const main = Effect.gen(function* () {
	const inputs = yield* ActionInputs;
	const outputs = yield* ActionOutputs;
	const logger = yield* ActionLogger;

	// 1. Parse configuration
	const config = yield* logger.group(
		"Detect configuration",
		Effect.gen(function* () {
			const devEngines = yield* loadPackageJson;
			const parsed = parseDevEngines(devEngines);
			const runtimes = parsed.runtime;
			const packageManager = parsed.packageManager;
			const biome = yield* detectBiome(inputs);
			const turbo = yield* detectTurbo;

			yield* Effect.log(
				formatDetection(`runtime(s): ${runtimes.map((r) => `${r.name}@${r.version}`).join(", ")}`, true),
			);
			yield* Effect.log(formatDetection(`package manager: ${packageManager.name}@${packageManager.version}`, true));
			if (Option.isSome(biome)) {
				yield* Effect.log(formatDetection(`Biome: ${biome.value}`, true));
			}
			if (turbo) {
				yield* Effect.log(formatDetection("Turbo configuration", true));
			}

			return { runtimes, packageManager, biome, turbo };
		}),
	);

	// 2. Determine active package managers and cache config
	const pmName = config.packageManager.name as PackageManager;
	const activePackageManagers = getActivePackageManagers(config.runtimes, pmName);

	// Build runtime version list for tool cache inclusion
	const runtimeEntries: Array<{ name: string; version: string }> = config.runtimes.map((r) => ({
		name: r.name,
		version: r.version,
	}));
	if (Option.isSome(config.biome)) {
		runtimeEntries.push({ name: "biome", version: config.biome.value });
	}

	const cacheConfig = yield* getCombinedCacheConfig(activePackageManagers, runtimeEntries);

	// Read additional lockfile patterns and cache paths from inputs (optional, may be empty)
	const rawLockfiles = yield* inputs.getOptional("additional-lockfiles", Schema.String);
	const additionalLockfiles = Option.isSome(rawLockfiles)
		? rawLockfiles.value
				.split("\n")
				.map((s) => s.trim())
				.filter((s) => s.length > 0 && !s.startsWith("#"))
		: [];
	const rawCachePaths = yield* inputs.getOptional("additional-cache-paths", Schema.String);
	const additionalCachePaths = Option.isSome(rawCachePaths)
		? rawCachePaths.value
				.split("\n")
				.map((s) => s.trim())
				.filter((s) => s.length > 0 && !s.startsWith("#"))
		: [];

	const allLockfilePatterns = [...cacheConfig.lockfilePatterns, ...additionalLockfiles];
	const lockfiles = yield* findLockFiles(allLockfilePatterns);

	const cacheBust = yield* inputs.getOptional("cache-bust", Schema.String);
	const cacheBustValue = Option.isSome(cacheBust) && cacheBust.value !== "false" ? cacheBust.value : undefined;

	// Build final cache paths: base + additional inputs + turbo
	const turboPaths = config.turbo ? ["**/.turbo"] : [];
	const finalCachePaths = [...cacheConfig.cachePaths, ...additionalCachePaths, ...turboPaths];

	// Handle turbo env vars
	if (config.turbo) {
		const turboToken = yield* inputs.getOptional("turbo-token", Schema.String);
		const turboTeam = yield* inputs.getOptional("turbo-team", Schema.String);
		if (Option.isSome(turboToken) && turboToken.value !== "") {
			yield* outputs.exportVariable("TURBO_TOKEN", turboToken.value);
		}
		if (Option.isSome(turboTeam) && turboTeam.value !== "") {
			yield* outputs.exportVariable("TURBO_TEAM", turboTeam.value);
		}
	}

	// 3. Restore cache (non-fatal)
	const cacheResult = yield* logger.group(
		"Restore cache",
		restoreCache({
			cachePaths: finalCachePaths,
			runtimes: runtimeEntries,
			packageManager: { name: config.packageManager.name, version: config.packageManager.version },
			lockfiles,
			cacheBust: cacheBustValue,
		}).pipe(
			Effect.catchTag("CacheError", (e) =>
				Effect.gen(function* () {
					yield* Effect.logWarning(`Cache restore failed: ${e.reason}`);
					return "none" as const;
				}),
			),
		),
	);

	// 4. Install runtimes (pass PM config so Node's corepack postInstall knows what to activate)
	const pmConfig = { name: config.packageManager.name, version: config.packageManager.version };
	const installed = yield* logger.group(
		formatInstallation("runtimes"),
		Effect.forEach(config.runtimes, (rt) =>
			RuntimeInstaller.pipe(
				Effect.flatMap((installer) => installer.install(rt.version)),
				Effect.provide(installerLayerFor(rt.name, pmConfig)),
				Effect.tap((result) =>
					Effect.log(formatSuccess(`${formatRuntime(rt.name as "node" | "bun" | "deno")} ${result.version}`)),
				),
			),
		),
	);

	// 5. Install dependencies
	const installDeps = yield* inputs.getBooleanOptional("install-deps", true);
	if (installDeps) {
		yield* logger.group(
			formatInstallation(`dependencies with ${formatPackageManager(pmName)}`),
			installDependencies(pmName),
		);
	}

	// 6. Install Biome (non-fatal)
	if (Option.isSome(config.biome)) {
		const biomeVersion = config.biome.value;
		yield* logger.group(
			formatInstallation("Biome"),
			RuntimeInstaller.pipe(
				Effect.flatMap((installer) => installer.install(biomeVersion)),
				Effect.provide(BiomeInstallerLive),
				Effect.catchTag("RuntimeInstallError", (e) => Effect.logWarning(`Biome installation failed: ${e.reason}`)),
			),
		);
	}

	// 7. Set outputs
	yield* setOutputs(outputs, installed, config, cacheResult, lockfiles, finalCachePaths);

	// 8. Summary
	yield* logger.group(
		"Runtime Setup Complete",
		Effect.gen(function* () {
			yield* Effect.log(
				`Runtime(s): ${config.runtimes.map((r) => formatRuntime(r.name as "node" | "bun" | "deno")).join(", ")}`,
			);
			for (const rt of installed) {
				yield* Effect.log(`${formatRuntime(rt.name as "node" | "bun" | "deno")}: ${rt.version}`);
			}
			yield* Effect.log(`${formatPackageManager(pmName)}: ${config.packageManager.version}`);
			yield* Effect.log(`Turbo: ${config.turbo ? "enabled" : "disabled"}`);
			yield* Effect.log(`Biome: ${Option.isSome(config.biome) ? `v${config.biome.value}` : "not installed"}`);
			yield* Effect.log(`Dependencies: ${installDeps ? "installed" : "skipped"}`);
		}),
	);
});

// ---------------------------------------------------------------------------
// Layer composition and execution
// ---------------------------------------------------------------------------

const MainLive = Layer.mergeAll(
	ActionCacheLive,
	ToolInstallerLive,
	CommandRunnerLive,
	ActionStateLive,
	ActionEnvironmentLive,
);

await Action.run(main, MainLive);
