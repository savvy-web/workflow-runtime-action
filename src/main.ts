import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { parse } from "jsonc-parser";
import type { PackageManager } from "./utils/cache-utils.js";
import { restoreCache } from "./utils/cache-utils.js";
import { installBiome } from "./utils/install-biome.js";
import { installNode, setupPackageManager } from "./utils/install-node.js";

/**
 * Parsed package.json structure (subset of fields we need)
 */
interface PackageJson {
	/** The packageManager field from package.json (e.g., "pnpm@10.20.0") */
	packageManager?: string;
}

/**
 * Biome configuration file structure
 */
interface BiomeConfig {
	/** Schema URL that includes the Biome version */
	$schema?: string;
}

/**
 * Complete runtime setup configuration result
 */
interface SetupResult {
	/** Node.js version string or empty if using version file */
	nodeVersion: string;
	/** Path to version file (.nvmrc | .node-version) or empty if using input */
	nodeVersionFile: string;
	/** Source of the version configuration */
	nodeVersionSource: "nvmrc" | "node-version" | "input";
	/** The package manager to use */
	packageManager: PackageManager;
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
 * Validates that the package manager is supported
 *
 * @param packageManager - Package manager string to validate
 * @throws Error if package manager is not supported
 */
function validatePackageManager(packageManager: string): asserts packageManager is PackageManager {
	const validManagers: PackageManager[] = ["npm", "pnpm", "yarn"];
	if (!validManagers.includes(packageManager as PackageManager)) {
		throw new Error(`Invalid package_manager '${packageManager}'. Must be one of: ${validManagers.join(" | ")}`);
	}
}

/**
 * Detects package manager from package.json packageManager field or explicit input
 *
 * @param explicitInput - Explicit package manager from action input
 * @returns The detected or specified package manager
 */
async function detectPackageManager(explicitInput: string): Promise<PackageManager> {
	// If explicitly provided, validate and use it
	if (explicitInput) {
		validatePackageManager(explicitInput);
		core.info(`Using explicit package manager: ${explicitInput}`);
		return explicitInput;
	}

	// Try to detect from package.json
	try {
		const content = await readFile("package.json", "utf-8");
		const packageJson = JSON.parse(content) as PackageJson;

		if (packageJson.packageManager) {
			// packageManager format: "pnpm@8.0.0" or "yarn@3.0.0"
			const pmName = packageJson.packageManager.split("@")[0];
			if (["npm", "pnpm", "yarn"].includes(pmName)) {
				core.info(`Detected package manager from package.json: ${pmName}`);
				return pmName as PackageManager;
			}
		}
	} catch (error) {
		core.debug(`Could not read package.json: ${error instanceof Error ? error.message : String(error)}`);
	}

	// Default to npm
	core.info("No package manager specified or detected, defaulting to npm");
	return "npm";
}

/**
 * Detects Node.js version file or uses provided input
 *
 * @param explicitVersion - Node.js version from action input
 * @returns Node.js version configuration
 */
function detectNodeVersion(explicitVersion: string): {
	nodeVersion: string;
	nodeVersionFile: string;
	source: "nvmrc" | "node-version" | "input";
} {
	// Check for .nvmrc first (preferred)
	if (existsSync(".nvmrc")) {
		core.info("Detected Node.js version file: .nvmrc");
		return {
			nodeVersion: "",
			nodeVersionFile: ".nvmrc",
			source: "nvmrc",
		};
	}

	// Check for .node-version
	if (existsSync(".node-version")) {
		core.info("Detected Node.js version file: .node-version");
		return {
			nodeVersion: "",
			nodeVersionFile: ".node-version",
			source: "node-version",
		};
	}

	// No version file found, use input
	core.info(`No version file found, using node-version input: ${explicitVersion}`);
	return {
		nodeVersion: explicitVersion,
		nodeVersionFile: "",
		source: "input",
	};
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
	// Read inputs
	const packageManagerInput = core.getInput("package-manager") || "";
	const nodeVersionInput = core.getInput("node-version") || "lts/*";
	const biomeVersionInput = core.getInput("biome-version") || "";
	const installDeps = core.getInput("install-deps") !== "false";

	core.startGroup("🔍 Detecting runtime configuration");

	// 1. Detect Node.js version
	const nodeVersion = detectNodeVersion(nodeVersionInput);

	// 2. Detect package manager
	const packageManager = await detectPackageManager(packageManagerInput);

	// 3. Detect Turbo
	const turbo = detectTurbo();

	// 4. Detect Biome (conditional)
	const biome = await detectBiome(biomeVersionInput);

	core.endGroup();

	return {
		nodeVersion: nodeVersion.nodeVersion,
		nodeVersionFile: nodeVersion.nodeVersionFile,
		nodeVersionSource: nodeVersion.source,
		packageManager,
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
 * Main action entrypoint
 */
async function main(): Promise<void> {
	try {
		// 1. Detect configuration
		const config = await detectConfiguration();

		// Save package manager to state for post action
		core.saveState("PACKAGE_MANAGER", config.packageManager);

		// 2. Install Node.js
		await installNode({
			version: config.nodeVersion,
			versionFile: config.nodeVersionFile,
		});

		// 3. Setup package manager (pnpm/yarn need corepack)
		if (config.packageManager === "pnpm" || config.packageManager === "yarn") {
			await setupPackageManager(config.packageManager);
		}

		// 4. Restore cache before installing dependencies
		if (config.installDeps) {
			await restoreCache(config.packageManager);
		}

		// 5. Install dependencies
		if (config.installDeps) {
			await installDependencies(config.packageManager);
		}

		// 6. Install Biome (optional)
		if (config.biomeVersion) {
			await installBiome(config.biomeVersion);
		}

		// Set all outputs
		core.setOutput("node-version", config.nodeVersion || "from-file");
		core.setOutput("node-version-file", config.nodeVersionFile);
		core.setOutput("node-version-source", config.nodeVersionSource);
		core.setOutput("package-manager", config.packageManager);
		core.setOutput("turbo-enabled", config.turboEnabled.toString());
		core.setOutput("turbo-config-file", config.turboConfigFile);
		core.setOutput("biome-version", config.biomeVersion);
		core.setOutput("biome-config-file", config.biomeConfigFile);

		// Summary
		core.startGroup("✅ Runtime Setup Complete");
		core.notice(`Node.js: ${config.nodeVersion || `from ${config.nodeVersionFile}`}`);
		core.notice(`Package Manager: ${config.packageManager}`);
		core.notice(`Turbo: ${config.turboEnabled ? "enabled" : "disabled"}`);
		core.notice(`Biome: ${config.biomeVersion ? `v${config.biomeVersion}` : "not installed"}`);
		core.notice(`Dependencies: ${config.installDeps ? "installed" : "skipped"}`);
		core.endGroup();
	} catch (error) {
		core.setFailed(`Failed to setup runtime: ${error instanceof Error ? error.message : String(error)}`);
	}
}

await main();
