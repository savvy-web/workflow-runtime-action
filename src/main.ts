import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { parse } from "jsonc-parser";
import { getInput, setOutput } from "./utils/action-io.js";
import type { PackageManager } from "./utils/cache-utils.js";
import { restoreCache } from "./utils/cache-utils.js";
import { installBiome } from "./utils/install-biome.js";
import { installBun } from "./utils/install-bun.js";
import { installDeno } from "./utils/install-deno.js";
import { installNode, setupNpm, setupPackageManager } from "./utils/install-node.js";
import type { RuntimeName } from "./utils/parse-package-json.js";
import { parsePackageJson } from "./utils/parse-package-json.js";

/**
 * Biome configuration file structure
 */
interface BiomeConfig {
	/** Schema URL that includes the Biome version */
	$schema?: string;
}

/**
 * Runtime version map for tracking installed versions
 */
interface RuntimeVersions {
	/** Node.js version if installed */
	node?: string;
	/** Bun version if installed */
	bun?: string;
	/** Deno version if installed */
	deno?: string;
}

/**
 * Complete runtime setup configuration result
 */
interface SetupResult {
	/** Detected runtimes to install */
	runtimes: RuntimeName[];
	/** Version for each runtime from package.json */
	runtimeVersions: RuntimeVersions;
	/** The package manager to use */
	packageManager: PackageManager;
	/** Package manager version */
	packageManagerVersion: string;
	/** Whether Turbo is enabled (turbo.json exists) */
	turboEnabled: boolean;
	/** Path to Turbo config file, or empty string if not found */
	turboConfigFile: string;
	/** Biome version to install (e.g., "2.3.6") or "latest" or empty to skip */
	biomeVersion: string;
	/** Path to Biome config file or empty string if not found */
	biomeConfigFile: string;
	/** Whether to install dependencies */
	installDeps: boolean;
}

/**
 * Detects if Turborepo is configured in the repository
 *
 * @returns Turbo configuration status
 */
function detectTurbo(): {
	enabled: boolean;
	configFile: string;
} {
	if (existsSync("turbo.json")) {
		core.info("✓ Detected Turbo configuration: turbo.json");
		return {
			enabled: true,
			configFile: "turbo.json",
		};
	}

	core.info("No Turbo configuration found");
	return {
		enabled: false,
		configFile: "",
	};
}

/**
 * Detects which Biome config file exists in the repository
 *
 * @returns Path to detected config file, or empty string if none found
 */
function detectBiomeConfigFile(): string {
	if (existsSync("biome.jsonc")) {
		return "biome.jsonc";
	}

	if (existsSync("biome.json")) {
		return "biome.json";
	}

	return "";
}

/**
 * Extracts Biome version from a schema URL
 *
 * @param schemaUrl - The $schema URL from the config file
 * @returns Extracted version string, or undefined if pattern doesn't match
 */
function extractBiomeVersionFromSchema(schemaUrl: string): string | undefined {
	const versionMatch = schemaUrl.match(/\/schemas\/(\d+\.\d+\.\d+)\//);
	return versionMatch?.[1];
}

/**
 * Detects Biome version from config file or explicit input
 *
 * @param explicitVersion - Explicit Biome version from action input
 * @returns Biome version and config file path
 */
async function detectBiome(explicitVersion: string): Promise<{
	version: string;
	configFile: string;
}> {
	// If version was explicitly provided, use it
	if (explicitVersion) {
		core.info(`Using explicit Biome version: ${explicitVersion}`);
		return {
			version: explicitVersion,
			configFile: "",
		};
	}

	// Detect config file
	const configFile = detectBiomeConfigFile();

	if (!configFile) {
		core.info("No Biome config file found, skipping Biome installation");
		return {
			version: "",
			configFile: "",
		};
	}

	core.info(`Detected Biome config: ${configFile}`);

	try {
		// Parse config file
		const content = await readFile(configFile, "utf-8");
		const config = parse(content) as BiomeConfig;

		if (!config.$schema) {
			core.warning(`No $schema field found in ${configFile}, using 'latest' version`);
			return {
				version: "latest",
				configFile,
			};
		}

		// Extract version from schema URL
		const version = extractBiomeVersionFromSchema(config.$schema);

		if (!version) {
			core.warning(
				`Could not parse version from $schema in ${configFile} (URL: ${config.$schema}), using 'latest' version`,
			);
			return {
				version: "latest",
				configFile,
			};
		}

		core.info(`✓ Detected Biome version: ${version} from ${configFile}`);
		return {
			version,
			configFile,
		};
	} catch (error) {
		core.warning(
			`Failed to parse ${configFile}: ${error instanceof Error ? error.message : String(error)}, using 'latest' version`,
		);
		return {
			version: "latest",
			configFile,
		};
	}
}

/**
 * Main setup function that orchestrates all detection and configuration
 *
 * @returns Complete runtime setup configuration
 */
async function detectConfiguration(): Promise<SetupResult> {
	// Read all inputs
	const nodeVersionInput = getInput("node-version");
	const bunVersionInput = getInput("bun-version");
	const denoVersionInput = getInput("deno-version");
	const packageManagerInput = getInput("package-manager");
	const packageManagerVersionInput = getInput("package-manager-version");
	const biomeVersionInput = getInput("biome-version");
	const installDeps = getInput("install-deps") !== "false";

	// Validate that package-manager and package-manager-version are used together
	const hasExplicitRuntime = nodeVersionInput || bunVersionInput || denoVersionInput;

	if (packageManagerVersionInput && !packageManagerInput) {
		throw new Error(
			"package-manager-version input requires package-manager to be specified. Please provide both inputs together.",
		);
	}

	if (packageManagerInput && !packageManagerVersionInput && hasExplicitRuntime) {
		throw new Error(
			"To use explicit mode (skip auto-detection), you must provide both package-manager and package-manager-version together with at least one runtime version.",
		);
	}

	core.startGroup("🔍 Detecting runtime configuration");

	// Check if we're in explicit mode (runtime version + package manager + package manager version)
	const hasExplicitPackageManager = packageManagerInput && packageManagerVersionInput;
	const isExplicitMode = hasExplicitRuntime && hasExplicitPackageManager;

	const runtimeVersions: RuntimeVersions = {};
	const runtimes: RuntimeName[] = [];
	let packageManager: PackageManager;
	let packageManagerVersion: string;

	if (isExplicitMode) {
		// Explicit mode - use inputs directly, no package.json required
		core.info("Using explicit configuration from inputs");

		// Build runtime versions from inputs
		if (nodeVersionInput) {
			runtimes.push("node");
			runtimeVersions.node = nodeVersionInput;
		}
		if (bunVersionInput) {
			runtimes.push("bun");
			runtimeVersions.bun = bunVersionInput;
		}
		if (denoVersionInput) {
			runtimes.push("deno");
			runtimeVersions.deno = denoVersionInput;
		}

		// Set package manager (both are guaranteed to be present by validation above)
		packageManager = packageManagerInput as PackageManager;
		packageManagerVersion = packageManagerVersionInput;

		core.info(`✓ Configured runtime(s): ${runtimes.map((rt) => `${rt}@${runtimeVersions[rt]}`).join(", ")}`);
		core.info(`✓ Configured package manager: ${packageManager}@${packageManagerVersion}`);
	} else {
		// Auto-detect mode - parse package.json
		core.info("Auto-detecting configuration from package.json");

		const packageJsonConfig = await parsePackageJson();

		// Build runtime versions map from devEngines.runtime
		for (const runtime of packageJsonConfig.runtimes) {
			runtimes.push(runtime.name);
			runtimeVersions[runtime.name] = runtime.version;
		}

		packageManager = packageJsonConfig.packageManager.name as PackageManager;
		packageManagerVersion = packageJsonConfig.packageManager.version;
	}

	// Detect Turbo (works in both modes)
	const turbo = detectTurbo();

	// Detect Biome (works in both modes)
	const biome = await detectBiome(biomeVersionInput);

	core.endGroup();

	return {
		runtimes,
		runtimeVersions,
		packageManager,
		packageManagerVersion,
		turboEnabled: turbo.enabled,
		turboConfigFile: turbo.configFile,
		biomeVersion: biome.version,
		biomeConfigFile: biome.configFile,
		installDeps,
	};
}

/**
 * Installs dependencies using the detected package manager
 *
 * @param packageManager - Package manager to use
 */
async function installDependencies(packageManager: PackageManager): Promise<void> {
	core.startGroup(`📦 Installing dependencies with ${packageManager}`);

	try {
		let command: string[];

		switch (packageManager) {
			case "npm":
				// Use npm ci if lock file exists, otherwise npm install
				command = existsSync("package-lock.json") ? ["ci"] : ["install"];
				break;
			case "pnpm":
				// Use frozen lockfile if pnpm-lock.yaml exists
				command = existsSync("pnpm-lock.yaml") ? ["install", "--frozen-lockfile"] : ["install"];
				break;
			case "yarn":
				// Use immutable mode if yarn.lock exists
				// Otherwise explicitly allow lockfile creation (Yarn 4+ defaults to immutable in CI)
				if (existsSync("yarn.lock")) {
					command = ["install", "--immutable"];
				} else {
					command = ["install", "--no-immutable"];
				}
				break;
			case "bun":
				// Use frozen lockfile if bun.lockb exists
				command = existsSync("bun.lockb") ? ["install", "--frozen-lockfile"] : ["install"];
				break;
			case "deno":
				// Deno caches dependencies automatically on first use
				// Skip explicit install step as 'deno install' is for CLI tools in Deno 1.x
				core.info("Deno caches dependencies automatically, skipping install step");
				core.endGroup();
				return;
		}

		await exec.exec(packageManager, command);

		core.info(`✓ Dependencies installed successfully`);
		core.endGroup();
	} catch (error) {
		core.endGroup();
		throw new Error(`Failed to install dependencies: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Gets all active package managers based on installed runtimes
 *
 * @param runtimes - Array of installed runtimes
 * @param primaryPackageManager - Primary package manager (for Node.js)
 * @returns Array of all active package managers
 */
function getActivePackageManagers(runtimes: RuntimeName[], primaryPackageManager: PackageManager): PackageManager[] {
	const packageManagers: PackageManager[] = [];

	for (const runtime of runtimes) {
		if (runtime === "node") {
			// Node.js uses the primary package manager (npm/pnpm/yarn)
			if (!packageManagers.includes(primaryPackageManager)) {
				packageManagers.push(primaryPackageManager);
			}
		} else if (runtime === "bun") {
			// Bun uses its own package manager
			if (!packageManagers.includes("bun")) {
				packageManagers.push("bun");
			}
		} else if (runtime === "deno") {
			// Deno uses its own package manager
			if (!packageManagers.includes("deno")) {
				packageManagers.push("deno");
			}
		}
	}

	return packageManagers;
}

/**
 * Main action entrypoint
 */
async function main(): Promise<void> {
	try {
		// 1. Detect configuration
		const config = await detectConfiguration();

		// Get all active package managers based on runtimes
		const activePackageManagers = getActivePackageManagers(config.runtimes, config.packageManager);
		core.info(`Active package managers: ${activePackageManagers.join(", ")}`);

		// Save package manager to state for post action
		core.saveState("PACKAGE_MANAGER", config.packageManager);

		// 2. Install all detected runtimes
		const installedVersions: RuntimeVersions = {};

		for (const runtime of config.runtimes) {
			if (runtime === "node") {
				const version = config.runtimeVersions.node;
				if (!version) {
					throw new Error("Node.js runtime detected but no version specified in devEngines.runtime");
				}
				const installedVersion = await installNode({ version });
				installedVersions.node = installedVersion;
			} else if (runtime === "bun") {
				const version = config.runtimeVersions.bun;
				if (!version) {
					throw new Error("Bun runtime detected but no version specified in devEngines.runtime");
				}
				const installedVersion = await installBun({ version });
				installedVersions.bun = installedVersion;
			} else if (runtime === "deno") {
				const version = config.runtimeVersions.deno;
				if (!version) {
					throw new Error("Deno runtime detected but no version specified in devEngines.runtime");
				}
				const installedVersion = await installDeno({ version });
				installedVersions.deno = installedVersion;
			}
		}

		// 3. Setup package manager
		if (config.packageManager === "npm") {
			// npm comes with Node.js but may need version update
			await setupNpm(config.packageManagerVersion);
		} else if (config.packageManager === "pnpm" || config.packageManager === "yarn") {
			// pnpm/yarn use corepack
			await setupPackageManager(config.packageManager, config.packageManagerVersion);
		}
		// bun and deno are their own package managers, no setup needed

		// 4. Restore cache before installing dependencies (using all active package managers)
		if (config.installDeps) {
			await restoreCache(activePackageManagers);
		}

		// 5. Install dependencies for each package manager
		if (config.installDeps) {
			for (const pm of activePackageManagers) {
				await installDependencies(pm);
			}
		}

		// 6. Install Biome (optional)
		if (config.biomeVersion) {
			await installBiome(config.biomeVersion);
		}

		// Set all outputs
		setOutput("node-version", installedVersions.node || "");
		setOutput("node-enabled", !!installedVersions.node);
		setOutput("bun-version", installedVersions.bun || "");
		setOutput("bun-enabled", !!installedVersions.bun);
		setOutput("deno-version", installedVersions.deno || "");
		setOutput("deno-enabled", !!installedVersions.deno);
		setOutput("package-manager", config.packageManager);
		setOutput("package-manager-version", config.packageManagerVersion);
		setOutput("biome-version", config.biomeVersion);
		setOutput("biome-enabled", !!config.biomeVersion);
		setOutput("turbo-enabled", config.turboEnabled);

		// Summary
		core.startGroup("✅ Runtime Setup Complete");
		core.info(`Runtime(s): ${config.runtimes.join(", ")}`);
		if (installedVersions.node) core.info(`Node.js: ${installedVersions.node}`);
		if (installedVersions.bun) core.info(`Bun: ${installedVersions.bun}`);
		if (installedVersions.deno) core.info(`Deno: ${installedVersions.deno}`);
		core.info(`Package Manager: ${config.packageManager}@${config.packageManagerVersion}`);
		core.info(`Turbo: ${config.turboEnabled ? "enabled" : "disabled"}`);
		core.info(`Biome: ${config.biomeVersion ? `v${config.biomeVersion}` : "not installed"}`);
		core.info(`Dependencies: ${config.installDeps ? "installed" : "skipped"}`);
		core.endGroup();
	} catch (error) {
		core.setFailed(`Failed to setup runtime: ${error instanceof Error ? error.message : String(error)}`);
	}
}

await main();
