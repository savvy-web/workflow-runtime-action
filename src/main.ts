// Force ncc to bundle packages used via dynamic import in github-action-effects Live layers

import { chmod } from "node:fs/promises";
import { arch as osArch, platform as osPlatform, tmpdir } from "node:os";
import * as actionsCore from "@actions/core";
import * as toolCache from "@actions/tool-cache";
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
import { binaryMap as biomeBinaryMap } from "./descriptors/biome.js";
import { formatDetection, formatInstallation, formatPackageManager, formatRuntime, formatSuccess } from "./emoji.js";
import { DependencyInstallError, PackageManagerSetupError } from "./errors.js";
import type { InstalledRuntime } from "./runtime-installer.js";
import { RuntimeInstaller, extractErrorReason, installerLayerFor } from "./runtime-installer.js";
import type { PackageManagerEntry, RuntimeEntry } from "./schemas.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses a multi-value input string supporting multiple formats:
 * - Newline-separated: "a\nb\nc"
 * - Bullet lists: "* a\n* b\n* c"
 * - Comma-separated: "a, b, c"
 * - JSON arrays: '["a", "b", "c"]'
 */
export const parseMultiValueInput = (raw: string): string[] => {
	const trimmed = raw.trim();
	if (!trimmed) return [];

	// JSON array?
	if (trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed.map((s: unknown) => String(s).trim()).filter((s) => s.length > 0);
			}
		} catch {
			// Not valid JSON, fall through to other formats
		}
	}

	// Newline or bullet list?
	if (trimmed.includes("\n")) {
		return trimmed
			.split("\n")
			.map((s) => s.trim().replace(/^\*\s*/, "")) // Strip bullet prefix
			.filter((s) => s.length > 0 && !s.startsWith("#"));
	}

	// Comma-separated
	return trimmed
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
};

/**
 * Install Biome CLI as a raw binary (not an archive).
 * Uses @actions/tool-cache directly since ToolInstaller only supports archives.
 * Not unit-testable — requires real @actions/tool-cache (tracked in github-action-effects#40).
 */
/* v8 ignore start -- imperative @actions/tool-cache code, tested via CI fixtures */
export const installBiome = (version: string): Effect.Effect<void, Error> =>
	Effect.tryPromise({
		try: async () => {
			const plat = osPlatform();
			const architecture = osArch();

			// Check tool cache first
			const cached = toolCache.find("biome", version);
			if (cached) {
				actionsCore.addPath(cached);
				return;
			}

			// Build download URL using shared binaryMap from descriptor
			const binaryName = biomeBinaryMap[plat]?.[architecture];
			if (!binaryName) throw new Error(`Unsupported platform for Biome: ${plat}-${architecture}`);

			const url = `https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%40${version}/${binaryName}`;
			const downloadPath = await toolCache.downloadTool(url);

			// Cache as a single file, renamed to "biome" (or "biome.exe" on Windows)
			const finalName = plat === "win32" ? "biome.exe" : "biome";
			const cachedPath = await toolCache.cacheFile(downloadPath, finalName, "biome", version);

			// Make executable on Unix
			if (plat !== "win32") {
				await chmod(`${cachedPath}/${finalName}`, 0o755);
			}

			actionsCore.addPath(cachedPath);
		},
		catch: (error) => new Error(`Biome install failed: ${error instanceof Error ? error.message : String(error)}`),
	});
/* v8 ignore stop */

/**
 * Determines active package managers from the set of installed runtimes
 * and the primary package manager.
 */
export const getActivePackageManagers = (
	runtimes: ReadonlyArray<RuntimeEntry>,
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
export const installDependencies = (
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
			/* v8 ignore next 5 -- error path tested via CI fixtures */
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
 * Setup the package manager version after Node is installed and on PATH.
 * npm: sudo npm install -g on linux/darwin (global prefix is /usr/local)
 * pnpm/yarn: corepack prepare --activate (from tmpdir to avoid workspace interference)
 * bun/deno: no setup needed (they ARE their own package manager)
 */
export const setupPackageManager = (
	packageManager: PackageManager,
	version: string,
): Effect.Effect<void, PackageManagerSetupError, CommandRunner> =>
	Effect.gen(function* () {
		if (packageManager === "bun" || packageManager === "deno") {
			yield* Effect.log(`${packageManager} is its own package manager, no additional setup needed`);
			return;
		}

		const runner = yield* CommandRunner;

		if (packageManager === "npm") {
			// npm: install exact version globally via sudo (prefix is /usr/local)
			const currentOut = yield* runner.execCapture("npm", ["--version"]);
			const currentVersion = currentOut.stdout.trim();
			if (currentVersion !== version) {
				yield* Effect.log(`Upgrading npm from ${currentVersion} to ${version}...`);
				const plat = osPlatform();
				if (plat === "linux" || plat === "darwin") {
					yield* runner.exec("sudo", ["npm", "install", "-g", `npm@${version}`]);
					// Fix npm cache ownership after sudo (sudo creates root-owned files in ~/.npm)
					const npmCacheDir = `${process.env.HOME}/.npm`;
					yield* runner
						.exec("sudo", ["chown", "-R", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, npmCacheDir])
						.pipe(Effect.catchAll(() => Effect.void));
				} else {
					yield* runner.exec("npm", ["install", "-g", `npm@${version}`]);
				}
			} else {
				yield* Effect.log(`npm ${currentVersion} already matches required version`);
			}
		} else {
			// pnpm/yarn: use corepack (from tmpdir for pnpm to avoid workspace interference)
			const useTmpdir = packageManager === "pnpm";
			const execOpts = useTmpdir ? { cwd: tmpdir() } : {};

			// Check if corepack needs to be installed (Node >= 25)
			const nodeVersionOut = yield* runner.execCapture("node", ["--version"], execOpts);
			const versionMatch = nodeVersionOut.stdout.trim().match(/^v(\d+)\.\d+\.\d+$/);
			if (versionMatch) {
				const major = Number.parseInt(versionMatch[1], 10);
				if (major >= 25) {
					yield* Effect.log("Node.js >= 25 detected, installing corepack globally...");
					const plat = osPlatform();
					if (plat === "linux" || plat === "darwin") {
						yield* runner.exec("sudo", ["npm", "install", "-g", "--force", "corepack@latest"], execOpts);
					} else {
						yield* runner.exec("npm", ["install", "-g", "--force", "corepack@latest"], execOpts);
					}
				}
			}

			yield* Effect.log("Enabling corepack...");
			yield* runner.exec("corepack", ["enable"], execOpts);

			yield* Effect.log(`Preparing ${packageManager}@${version}...`);
			yield* runner.exec("corepack", ["prepare", `${packageManager}@${version}`, "--activate"], execOpts);
		}

		// Verify
		yield* runner.exec(packageManager, ["--version"]);
		yield* Effect.log(formatSuccess(`${packageManager}@${version} activated`));
	}).pipe(
		/* v8 ignore next 5 -- error path tested via CI fixtures */
		Effect.mapError(
			(cause) =>
				new PackageManagerSetupError({
					packageManager,
					version,
					reason: `Package manager setup failed: ${extractErrorReason(cause)}`,
					cause,
				}),
		),
	);

/**
 * Sets all action outputs from the pipeline results.
 */
export const setOutputs = (
	outputs: Context.Tag.Service<ActionOutputs>,
	installed: ReadonlyArray<InstalledRuntime>,
	config: {
		readonly packageManager: PackageManagerEntry;
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

/* v8 ignore start -- pipeline orchestration; individual functions tested separately */
export const main = Effect.gen(function* () {
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
	// Supports: newlines, bullet lists, comma-separated, JSON arrays
	const rawLockfiles = yield* inputs.getOptional("additional-lockfiles", Schema.String);
	const additionalLockfiles = Option.isSome(rawLockfiles) ? parseMultiValueInput(rawLockfiles.value) : [];
	const rawCachePaths = yield* inputs.getOptional("additional-cache-paths", Schema.String);
	const additionalCachePaths = Option.isSome(rawCachePaths) ? parseMultiValueInput(rawCachePaths.value) : [];

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

	// 4. Install runtimes
	const installed = yield* logger.group(
		formatInstallation("runtimes"),
		Effect.forEach(config.runtimes, (rt) =>
			RuntimeInstaller.pipe(
				Effect.flatMap((installer) => installer.install(rt.version)),
				Effect.provide(installerLayerFor(rt.name)),
				Effect.tap((result) =>
					Effect.log(formatSuccess(`${formatRuntime(rt.name as "node" | "bun" | "deno")} ${result.version}`)),
				),
			),
		),
	);

	// 5. Setup package manager (after runtimes are installed and on PATH)
	yield* logger.group(
		formatInstallation(`${formatPackageManager(pmName)} via ${pmName === "npm" ? "npm" : "corepack"}`),
		setupPackageManager(pmName, config.packageManager.version),
	);

	// 6. Install dependencies
	const installDeps = yield* inputs.getBooleanOptional("install-deps", true);
	if (installDeps) {
		yield* logger.group(
			formatInstallation(`dependencies with ${formatPackageManager(pmName)}`),
			installDependencies(pmName),
		);
	}

	// 7. Install Biome (non-fatal) -- uses direct download since biome is a raw binary, not an archive
	if (Option.isSome(config.biome)) {
		const biomeVersion = config.biome.value;
		yield* logger.group(
			formatInstallation("Biome"),
			installBiome(biomeVersion).pipe(
				Effect.catchAll((e) =>
					Effect.logWarning(`Biome installation failed: ${e instanceof Error ? e.message : String(e)}`),
				),
			),
		);
	}

	// 8. Set outputs
	yield* setOutputs(outputs, installed, config, cacheResult, lockfiles, finalCachePaths);

	// 9. Summary
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
/* v8 ignore stop */

// ---------------------------------------------------------------------------
// Layer composition and execution
// ---------------------------------------------------------------------------

export const MainLive = Layer.mergeAll(
	ActionCacheLive,
	ToolInstallerLive,
	CommandRunnerLive,
	ActionStateLive,
	ActionEnvironmentLive,
);

/* v8 ignore next 3 -- entry point guard, only runs in GitHub Actions */
if (process.env.GITHUB_ACTIONS) {
	await Action.run(main, MainLive);
}
