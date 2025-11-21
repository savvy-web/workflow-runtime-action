import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { parse as parseJsonc } from "jsonc-parser";
import { parse } from "jsonc-parser";
import type { AsyncFunctionArguments as BaseAsyncFunctionArguments } from "./shared-types.js";

/**
 * Arguments passed to the main action function from github-script
 *
 * @remarks
 * Extends the base AsyncFunctionArguments to include the jsonc-parser dependency
 * which must be passed as an external module.
 */
interface AsyncFunctionArguments extends Pick<BaseAsyncFunctionArguments, "core"> {
	/** JSONC parser function for parsing Biome config files */
	parse: typeof parseJsonc;
}

/**
 * Supported package managers for Node.js projects
 */
type PackageManager = "npm" | "pnpm" | "yarn";

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
	/** Whether the package manager requires explicit setup (pnpm/yarn need corepack) */
	setupRequired: boolean;
	/** Cache type for actions/setup-node */
	cacheType: string;
	/** File paths to include in dependency cache key */
	cacheDependencyPaths: string[];
	/** Command to install dependencies with frozen lockfile */
	installCommand: string;
	/** Whether Turbo is enabled (turbo.json exists) */
	turboEnabled: boolean;
	/** Path to Turbo config file, or empty string if not found */
	turboConfigFile: string;
	/** Biome version to install (e.g., "2.3.6") or "latest" or empty to skip */
	biomeVersion: string;
	/** Path to Biome config file or empty string if not found */
	biomeConfigFile: string;
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
 * @param core - GitHub Actions core module
 * @param explicitInput - Explicit package manager from action input
 * @returns The detected or specified package manager
 */
async function detectPackageManager(
	core: AsyncFunctionArguments["core"],
	explicitInput: string,
): Promise<PackageManager> {
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
 * Gets package manager configuration for dependency installation
 *
 * @param packageManager - The package manager to configure
 * @returns Package manager configuration with cache settings and install command
 */
function getPackageManagerConfig(packageManager: PackageManager): {
	setupRequired: boolean;
	cacheType: string;
	cacheDependencyPaths: string[];
	installCommand: string;
} {
	switch (packageManager) {
		case "pnpm":
			return {
				setupRequired: true,
				cacheType: "pnpm",
				cacheDependencyPaths: ["pnpm-lock.yaml", "pnpm-workspace.yaml", ".pnpmfile.cjs"],
				installCommand: "pnpm install --frozen-lockfile",
			};
		case "yarn":
			return {
				setupRequired: true,
				cacheType: "yarn",
				cacheDependencyPaths: ["yarn.lock"],
				installCommand: "yarn install --frozen-lockfile --immutable",
			};
		case "npm":
			return {
				setupRequired: false,
				cacheType: "npm",
				cacheDependencyPaths: ["package-lock.json"],
				installCommand: "npm ci",
			};
	}
}

/**
 * Detects Node.js version file or uses provided input
 *
 * @param core - GitHub Actions core module
 * @param explicitVersion - Node.js version from action input
 * @returns Node.js version configuration
 */
function detectNodeVersion(
	core: AsyncFunctionArguments["core"],
	explicitVersion: string,
): {
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
 * @param core - GitHub Actions core module
 * @returns Turbo configuration status
 */
function detectTurbo(core: AsyncFunctionArguments["core"]): {
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
 * @param core - GitHub Actions core module
 * @param parse - JSONC parser function
 * @param explicitVersion - Explicit Biome version from action input
 * @returns Biome version and config file path
 */
async function detectBiome(
	core: AsyncFunctionArguments["core"],
	parse: AsyncFunctionArguments["parse"],
	explicitVersion: string,
): Promise<{
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
 * @param core - GitHub Actions core module
 * @param parse - JSONC parser function
 * @returns Complete runtime setup configuration
 */
async function setupRuntime(
	core: AsyncFunctionArguments["core"],
	parse: AsyncFunctionArguments["parse"],
): Promise<SetupResult> {
	// Read inputs from environment variables
	const packageManagerInput = process.env.INPUT_PACKAGE_MANAGER || "";
	const nodeVersionInput = process.env.INPUT_NODE_VERSION || "lts/*";
	const biomeVersionInput = process.env.INPUT_BIOME_VERSION || "";

	core.startGroup("🔍 Detecting runtime configuration");

	// 1. Detect Node.js version
	const nodeVersion = detectNodeVersion(core, nodeVersionInput);

	// 2. Detect package manager
	const packageManager = await detectPackageManager(core, packageManagerInput);
	const pmConfig = getPackageManagerConfig(packageManager);

	// 3. Detect Turbo
	const turbo = detectTurbo(core);

	// 4. Detect Biome (conditional)
	const biome = await detectBiome(core, parse, biomeVersionInput);

	core.endGroup();

	return {
		nodeVersion: nodeVersion.nodeVersion,
		nodeVersionFile: nodeVersion.nodeVersionFile,
		nodeVersionSource: nodeVersion.source,
		packageManager,
		setupRequired: pmConfig.setupRequired,
		cacheType: pmConfig.cacheType,
		cacheDependencyPaths: pmConfig.cacheDependencyPaths,
		installCommand: pmConfig.installCommand,
		turboEnabled: turbo.enabled,
		turboConfigFile: turbo.configFile,
		biomeVersion: biome.version,
		biomeConfigFile: biome.configFile,
	};
}

/**
 * Main action entrypoint: Detects and configures Node.js runtime environment
 *
 * @param args - Function arguments from github-script
 * @param args.core - GitHub Actions core module
 * @param args.parse - JSONC parser function
 *
 * @remarks
 * This is a comprehensive runtime setup action that:
 * 1. Detects or uses explicit Node.js version (from .nvmrc, .node-version, or input)
 * 2. Detects or uses explicit package manager (from package.json or input)
 * 3. Detects Turbo configuration (turbo.json)
 * 4. Conditionally detects Biome version (from config or input)
 *
 * Sets the following outputs:
 * - `node-version`: Node.js version string (empty if using version file)
 * - `node-version-file`: Path to version file (.nvmrc | .node-version | empty)
 * - `node-version-source`: Source of version (nvmrc | node-version | input)
 * - `package-manager`: Detected or specified package manager (npm | pnpm | yarn)
 * - `setup-required`: Whether package manager needs explicit setup (true for pnpm/yarn)
 * - `cache-type`: Cache type for actions/setup-node
 * - `cache-dependency-paths`: JSON array of dependency file paths for cache key
 * - `install-command`: Command to install dependencies with frozen lockfile
 * - `turbo-enabled`: Whether Turbo is configured (true | false)
 * - `turbo-config-file`: Path to turbo.json or empty
 * - `biome-version`: Biome version to install or empty to skip
 * - `biome-config-file`: Path to Biome config file or empty
 *
 * @example
 * ```yaml
 * - uses: actions/github-script@v8
 *   env:
 *     INPUT_PACKAGE_MANAGER: ${{ inputs.package-manager }}
 *     INPUT_NODE_VERSION: ${{ inputs.node-version }}
 *     INPUT_BIOME_VERSION: ${{ inputs.biome-version }}
 *   with:
 *     script: |
 *       const { parse } = await import('jsonc-parser');
 *       const { default: setupRuntime } = await import('${{ github.action_path }}/src/setup-runtime.ts');
 *       await setupRuntime({ core, parse });
 * ```
 */
export default async ({ core }: AsyncFunctionArguments): Promise<void> => {
	try {
		// Detect and configure runtime
		const config = await setupRuntime(core, parse);

		// Set all outputs
		core.setOutput("node-version", config.nodeVersion);
		core.setOutput("node-version-file", config.nodeVersionFile);
		core.setOutput("node-version-source", config.nodeVersionSource);
		core.setOutput("package-manager", config.packageManager);
		core.setOutput("setup-required", config.setupRequired.toString());
		core.setOutput("cache-type", config.cacheType);
		core.setOutput("cache-dependency-paths", JSON.stringify(config.cacheDependencyPaths));
		core.setOutput("install-command", config.installCommand);
		core.setOutput("turbo-enabled", config.turboEnabled.toString());
		core.setOutput("turbo-config-file", config.turboConfigFile);
		core.setOutput("biome-version", config.biomeVersion);
		core.setOutput("biome-config-file", config.biomeConfigFile);

		// Summary notice
		core.startGroup("📦 Runtime Configuration Summary");
		core.notice(`Runtime: Node.js ${config.nodeVersion || `(from ${config.nodeVersionFile})`}`);
		core.notice(`Package Manager: ${config.packageManager}`);
		core.notice(`Turbo: ${config.turboEnabled ? "enabled" : "disabled"}`);
		core.notice(`Biome: ${config.biomeVersion ? `v${config.biomeVersion}` : "not configured"}`);
		core.endGroup();

		// Debug output
		core.debug("All configuration values:");
		core.debug(JSON.stringify(config, null, 2));
	} catch (error) {
		core.setFailed(`Failed to setup runtime: ${error instanceof Error ? error.message : String(error)}`);
	}
};
