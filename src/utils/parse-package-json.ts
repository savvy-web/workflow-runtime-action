import { readFile } from "node:fs/promises";
import { info } from "@actions/core";

/**
 * Supported runtime names
 */
export type RuntimeName = "node" | "bun" | "deno";

/**
 * Supported package managers (excluding deno which is not a valid packageManager field value)
 */
export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun";

/**
 * Single runtime configuration from devEngines.runtime
 */
export interface RuntimeConfig {
	/** Runtime name (node | bun | deno) */
	name: RuntimeName;
	/** Absolute version (e.g., "24.11.0") - no semver ranges allowed */
	version: string;
	/** onFail behavior (optional) */
	onFail?: string;
}

/**
 * Package manager configuration parsed from packageManager field
 */
export interface PackageManagerConfig {
	/** Package manager name */
	name: PackageManagerName;
	/** Exact version */
	version: string;
	/** onFail behavior (optional) */
	onFail?: string;
}

/**
 * Complete package.json configuration
 */
export interface PackageJsonConfig {
	/** Package manager configuration */
	packageManager: PackageManagerConfig;
	/** Runtime configurations (one or more) */
	runtimes: RuntimeConfig[];
}

/**
 * Raw package.json structure (subset we need)
 */
interface RawPackageJson {
	devEngines?: {
		runtime?: RuntimeConfig | RuntimeConfig[];
		packageManager?: PackageManagerConfig | PackageManagerConfig[];
	};
}

/**
 * Validates that a runtime name is supported
 */
function isValidRuntimeName(name: unknown): name is RuntimeName {
	return typeof name === "string" && ["node", "bun", "deno"].includes(name);
}

/**
 * Validates that a package manager name is supported
 */
function isValidPackageManagerName(name: unknown): name is PackageManagerName {
	return typeof name === "string" && ["npm", "pnpm", "yarn", "bun"].includes(name);
}

/**
 * Validates that a version is an absolute version (no semver ranges)
 *
 * @param version - Version string to validate
 * @returns True if version is absolute (e.g., "24.11.0"), false if it contains semver operators
 */
function isAbsoluteVersion(version: string): boolean {
	// Check for semver range operators
	const hasRangeOperators = /[~^<>=*x]/.test(version);
	if (hasRangeOperators) {
		return false;
	}

	// Check for basic semver format: number.number.number with optional prerelease/build
	// Examples: "24.11.0", "1.0.0-beta.1", "2.3.4+build.123"
	const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
	return semverPattern.test(version);
}

/**
 * Validates a single package manager configuration
 *
 * @param packageManager - Package manager configuration to validate
 * @param index - Index in array (for error messages)
 * @throws Error if package manager configuration is invalid
 */
function validatePackageManagerConfig(
	packageManager: unknown,
	index: number,
): asserts packageManager is PackageManagerConfig {
	if (!packageManager || typeof packageManager !== "object") {
		throw new Error(`devEngines.packageManager[${index}] must be an object`);
	}

	const pm = packageManager as Record<string, unknown>;

	if (!("name" in pm) || !isValidPackageManagerName(pm.name)) {
		throw new Error(
			`devEngines.packageManager[${index}].name must be one of: npm, pnpm, yarn, bun (got: ${JSON.stringify(pm.name)})`,
		);
	}

	if (!("version" in pm) || typeof pm.version !== "string") {
		throw new Error(`devEngines.packageManager[${index}].version must be a string`);
	}

	if (!isAbsoluteVersion(pm.version)) {
		throw new Error(
			`devEngines.packageManager[${index}].version must be an absolute version (e.g., "10.20.0"), not a semver range. Got: "${pm.version}"`,
		);
	}
}

/**
 * Parses devEngines.packageManager (supports both object and array formats)
 *
 * @param devEngines - The devEngines object from package.json
 * @returns Package manager configuration (uses first if array)
 * @throws Error if format is invalid
 */
function parsePackageManagerConfig(devEngines: RawPackageJson["devEngines"]): PackageManagerConfig {
	if (!devEngines || !devEngines.packageManager) {
		throw new Error("package.json must have a devEngines.packageManager property");
	}

	const { packageManager } = devEngines;

	// Handle array format (use first package manager)
	if (Array.isArray(packageManager)) {
		if (packageManager.length === 0) {
			throw new Error("devEngines.packageManager array must not be empty");
		}

		// Validate first package manager
		validatePackageManagerConfig(packageManager[0], 0);
		return packageManager[0];
	}

	// Handle object format (single package manager)
	validatePackageManagerConfig(packageManager, 0);
	return packageManager;
}

/**
 * Validates a single runtime configuration
 *
 * @param runtime - Runtime configuration to validate
 * @param index - Index in array (for error messages)
 * @throws Error if runtime configuration is invalid
 */
function validateRuntimeConfig(runtime: unknown, index: number): asserts runtime is RuntimeConfig {
	if (!runtime || typeof runtime !== "object") {
		throw new Error(`devEngines.runtime[${index}] must be an object`);
	}

	const rt = runtime as Record<string, unknown>;

	if (!("name" in rt) || !isValidRuntimeName(rt.name)) {
		throw new Error(
			`devEngines.runtime[${index}].name must be one of: node, bun, deno (got: ${JSON.stringify(rt.name)})`,
		);
	}

	if (!("version" in rt) || typeof rt.version !== "string") {
		throw new Error(`devEngines.runtime[${index}].version must be a string`);
	}

	if (!isAbsoluteVersion(rt.version)) {
		throw new Error(
			`devEngines.runtime[${index}].version must be an absolute version (e.g., "24.11.0"), not a semver range. Got: "${rt.version}"`,
		);
	}
}

/**
 * Parses devEngines.runtime (supports both object and array formats)
 *
 * @param devEngines - The devEngines object from package.json
 * @returns Array of runtime configurations
 * @throws Error if format is invalid
 */
function parseRuntimeConfigs(devEngines: RawPackageJson["devEngines"]): RuntimeConfig[] {
	if (!devEngines || !devEngines.runtime) {
		throw new Error("package.json must have a devEngines.runtime property");
	}

	const { runtime } = devEngines;

	// Handle array format
	if (Array.isArray(runtime)) {
		if (runtime.length === 0) {
			throw new Error("devEngines.runtime array must not be empty");
		}

		// Validate each runtime
		for (let index = 0; index < runtime.length; index++) {
			validateRuntimeConfig(runtime[index], index);
		}

		return runtime;
	}

	// Handle object format (single runtime)
	validateRuntimeConfig(runtime, 0);
	return [runtime];
}

/**
 * Reads and parses package.json with required devEngines.runtime and devEngines.packageManager
 *
 * @param path - Path to package.json (defaults to "./package.json")
 * @returns Parsed package.json configuration
 * @throws Error if package.json is missing required fields or has invalid format
 */
export async function parsePackageJson(path: string = "package.json"): Promise<PackageJsonConfig> {
	try {
		const content = await readFile(path, "utf-8");
		const packageJson = JSON.parse(content) as RawPackageJson;

		// Parse package manager configuration
		const packageManager = parsePackageManagerConfig(packageJson.devEngines);
		info(`🟢 Detected package manager: ${packageManager.name}@${packageManager.version}`);

		// Parse runtime configurations
		const runtimes = parseRuntimeConfigs(packageJson.devEngines);
		info(`🟢 Detected runtime(s): ${runtimes.map((rt) => `${rt.name}@${rt.version}`).join(", ")}`);
		return {
			packageManager,
			runtimes,
		};
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`Failed to parse package.json: Invalid JSON - ${error.message}`);
		}

		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(
				`package.json not found at ${path}. This action requires a package.json with devEngines.runtime and devEngines.packageManager fields.`,
			);
		}

		throw error;
	}
}
