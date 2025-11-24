import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as glob from "@actions/glob";
import { setOutput } from "./action-io.js";
import { formatCache, formatSuccess, getPackageManagerEmoji } from "./emoji.js";

/**
 * Supported package managers for caching
 */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "deno";

/**
 * Runtime versions for cache key generation
 */
export interface RuntimeVersions {
	/** Node.js version if installed */
	node?: string;
	/** Bun version if installed */
	bun?: string;
	/** Deno version if installed */
	deno?: string;
}

/**
 * Cache configuration for a package manager
 */
interface CacheConfig {
	/** Cache directory paths */
	cachePaths: string[];
	/** Lock file patterns to look for */
	lockFilePatterns: string[];
}

/**
 * Detects cache path for a package manager by querying it directly
 *
 * @param packageManager - Package manager to query
 * @returns Detected cache path or null if detection failed
 */
async function detectCachePath(packageManager: PackageManager): Promise<string | null> {
	try {
		let output = "";
		const options = {
			silent: true,
			listeners: {
				stdout: (data: Buffer): void => {
					output += data.toString();
				},
			},
		};

		switch (packageManager) {
			case "npm": {
				// npm config get cache
				const exitCode = await exec.exec("npm", ["config", "get", "cache"], options);
				if (exitCode === 0 && output.trim()) {
					return output.trim();
				}
				break;
			}

			case "pnpm": {
				// pnpm store path
				const exitCode = await exec.exec("pnpm", ["store", "path"], options);
				if (exitCode === 0 && output.trim()) {
					return output.trim();
				}
				break;
			}

			case "yarn": {
				// Try Yarn Berry first: yarn config get cacheFolder
				let exitCode = await exec.exec("yarn", ["config", "get", "cacheFolder"], options);
				if (exitCode === 0 && output.trim() && output.trim() !== "undefined") {
					return output.trim();
				}

				// Fallback to Yarn Classic: yarn cache dir
				output = "";
				exitCode = await exec.exec("yarn", ["cache", "dir"], options);
				if (exitCode === 0 && output.trim()) {
					return output.trim();
				}
				break;
			}

			case "bun": {
				// bun pm cache
				const exitCode = await exec.exec("bun", ["pm", "cache"], options);
				if (exitCode === 0 && output.trim()) {
					return output.trim();
				}
				break;
			}

			case "deno": {
				// Deno uses DENO_DIR environment variable
				// deno info --json provides cache location
				const exitCode = await exec.exec("deno", ["info", "--json"], options);
				if (exitCode === 0 && output.trim()) {
					try {
						const info = JSON.parse(output) as { denoDir?: string };
						if (info.denoDir) {
							return info.denoDir;
						}
					} catch {
						// Fall through to default
					}
				}
				break;
			}
		}
	} catch (error) {
		core.debug(
			`Failed to detect cache path for ${packageManager}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	return null;
}

/**
 * Gets default fallback cache paths for a package manager
 *
 * @param packageManager - The package manager
 * @returns Default cache paths based on platform
 */
function getDefaultCachePaths(packageManager: PackageManager): string[] {
	const plat = platform();

	switch (packageManager) {
		case "npm":
			return [plat === "win32" ? "~/AppData/Local/npm-cache" : "~/.npm"];

		case "pnpm":
			return [plat === "win32" ? "~/AppData/Local/pnpm/store" : "~/.local/share/pnpm/store"];

		case "yarn":
			return [
				plat === "win32" ? "~/AppData/Local/Yarn/Cache" : "~/.yarn/cache",
				plat === "win32" ? "~/AppData/Local/Yarn/Berry/cache" : "~/.cache/yarn",
			];

		case "bun":
			return [plat === "win32" ? "~/AppData/Local/bun/install/cache" : "~/.bun/install/cache"];

		case "deno":
			return [plat === "win32" ? "~/AppData/Local/deno" : "~/.cache/deno"];
	}
}

/**
 * Gets cache configuration for a package manager
 *
 * @param packageManager - The package manager to get config for
 * @returns Cache configuration with dynamically detected paths
 */
async function getCacheConfig(packageManager: PackageManager): Promise<CacheConfig> {
	// Detect cache path from package manager
	const detectedPath = await detectCachePath(packageManager);

	// Build cache paths array
	const globalCachePaths = detectedPath ? [detectedPath] : getDefaultCachePaths(packageManager);

	// Additional paths to cache based on package manager
	const additionalPaths: string[] = [];

	// Node-based package managers cache node_modules
	if (packageManager === "npm" || packageManager === "pnpm" || packageManager === "yarn") {
		additionalPaths.push("**/node_modules");
	}

	switch (packageManager) {
		case "yarn":
			// Yarn also needs to cache project-level .yarn directories
			additionalPaths.push("**/.yarn/cache", "**/.yarn/unplugged", "**/.yarn/install-state.gz");
			break;
		case "bun":
			// Bun caches node_modules and has its own cache
			additionalPaths.push("**/node_modules");
			break;
		case "deno":
			// Deno doesn't use node_modules, it caches dependencies globally
			// No additional paths needed
			break;
	}

	const cachePaths = [...globalCachePaths, ...additionalPaths];

	// Lock file patterns
	let lockFilePatterns: string[];
	switch (packageManager) {
		case "npm":
			lockFilePatterns = ["**/package-lock.json"];
			break;
		case "pnpm":
			lockFilePatterns = ["**/pnpm-lock.yaml", "**/pnpm-workspace.yaml", "**/.pnpmfile.cjs"];
			break;
		case "yarn":
			lockFilePatterns = ["**/yarn.lock"];
			break;
		case "bun":
			lockFilePatterns = ["**/bun.lock"];
			break;
		case "deno":
			lockFilePatterns = ["**/deno.lock"];
			break;
	}

	if (detectedPath) {
		core.info(`Detected ${packageManager} cache path: ${detectedPath}`);
	} else {
		core.debug(`Using default ${packageManager} cache paths: ${globalCachePaths.join(", ")}`);
	}

	return {
		cachePaths,
		lockFilePatterns,
	};
}

/**
 * Finds lock files matching the pattern
 *
 * @param patterns - Glob patterns to search for
 * @returns Array of found lock file paths
 */
async function findLockFiles(patterns: string[]): Promise<string[]> {
	const globber = await glob.create(patterns.join("\n"), {
		followSymbolicLinks: false,
	});

	return await globber.glob();
}

/**
 * Generates a hash from file contents
 *
 * @param files - Array of file paths to hash
 * @returns SHA256 hash of the combined file contents
 */
async function hashFiles(files: string[]): Promise<string> {
	const hash = createHash("sha256");

	for (const file of files) {
		try {
			const content = await readFile(file, "utf-8");
			hash.update(content);
		} catch (error) {
			core.warning(`Failed to read ${file} for hashing: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return hash.digest("hex");
}

/**
 * Gets combined cache configuration for multiple package managers
 *
 * @param packageManagers - Array of package managers to get combined config for
 * @returns Combined cache configuration with deduplicated paths
 */
async function getCombinedCacheConfig(packageManagers: PackageManager[]): Promise<CacheConfig> {
	// Use Sets for deduplication
	const cachePathsSet = new Set<string>();
	const lockFilePatternsSet = new Set<string>();

	// Collect configs from all package managers
	for (const pm of packageManagers) {
		const config = await getCacheConfig(pm);

		// Add all cache paths (Set automatically deduplicates)
		for (const path of config.cachePaths) {
			cachePathsSet.add(path);
		}

		// Add all lock file patterns
		for (const pattern of config.lockFilePatterns) {
			lockFilePatternsSet.add(pattern);
		}
	}

	// Convert Sets back to arrays
	const cachePaths = Array.from(cachePathsSet);
	const lockFilePatterns = Array.from(lockFilePatternsSet);

	return {
		cachePaths,
		lockFilePatterns,
	};
}

/**
 * Generates hash from runtime versions and package manager
 *
 * @param runtimeVersions - Runtime versions to include in hash
 * @param packageManager - Package manager name
 * @param packageManagerVersion - Package manager version
 * @param cacheHash - Optional cache hash (for testing, typically github.run_id)
 * @returns Hash string
 */
function generateVersionHash(
	runtimeVersions: RuntimeVersions,
	packageManager: PackageManager,
	packageManagerVersion: string,
	cacheHash?: string,
): string {
	const hash = createHash("sha256");

	// Add optional cache hash (for testing)
	if (cacheHash) {
		hash.update(cacheHash);
	}

	// Add runtime versions in sorted order for consistency
	const runtimeEntries = Object.entries(runtimeVersions).sort(([a], [b]) => a.localeCompare(b));
	for (const [runtime, version] of runtimeEntries) {
		if (version) {
			hash.update(`${runtime}:${version}`);
		}
	}

	// Add package manager
	hash.update(`${packageManager}:${packageManagerVersion}`);

	return hash.digest("hex");
}

/**
 * Generates cache key from runtime versions, package manager, and lock files
 *
 * @param runtimeVersions - Runtime versions being cached
 * @param packageManager - Package manager name
 * @param packageManagerVersion - Package manager version
 * @param lockFiles - Lock file paths
 * @param cacheHash - Optional cache hash (for testing, typically github.run_id)
 * @returns Cache key string in format: {os}-{version-hash}-{lockfile-hash}
 */
async function generateCacheKey(
	runtimeVersions: RuntimeVersions,
	packageManager: PackageManager,
	packageManagerVersion: string,
	lockFiles: string[],
	cacheHash?: string,
): Promise<string> {
	const plat = platform();
	const versionHash = generateVersionHash(runtimeVersions, packageManager, packageManagerVersion, cacheHash);
	const lockfileHash = await hashFiles(lockFiles);

	return `${plat}-${versionHash}-${lockfileHash}`;
}

/**
 * Generates restore keys for cache fallback
 *
 * @param runtimeVersions - Runtime versions being cached
 * @param packageManager - Package manager name
 * @param packageManagerVersion - Package manager version
 * @param cacheHash - Optional cache hash (for testing)
 * @returns Array of restore key prefixes
 */
function generateRestoreKeys(
	runtimeVersions: RuntimeVersions,
	packageManager: PackageManager,
	packageManagerVersion: string,
	cacheHash?: string,
): string[] {
	// When cache-hash is provided (testing mode), don't use restore keys
	// We want exact matches only for test validation
	if (cacheHash) {
		return [];
	}

	const plat = platform();
	const versionHash = generateVersionHash(runtimeVersions, packageManager, packageManagerVersion, cacheHash);

	// Restore keys in order of specificity:
	// 1. Match OS + version hash (any lockfile for same runtime/pm versions)
	return [`${plat}-${versionHash}-`];
}

/**
 * Restores package manager cache
 *
 * @param packageManagers - Package manager(s) to restore cache for
 * @param runtimeVersions - Runtime versions installed
 * @param packageManagerVersion - Package manager version
 * @param cacheHash - Optional cache hash (for testing, typically github.run_id)
 * @returns Cache key if restored, undefined if no cache found
 */
export async function restoreCache(
	packageManagers: PackageManager | PackageManager[],
	runtimeVersions: RuntimeVersions,
	packageManagerVersion: string,
	cacheHash?: string,
): Promise<string | undefined> {
	// Normalize to array
	const pmArray = Array.isArray(packageManagers) ? packageManagers : [packageManagers];

	// For cache key, we only use the primary package manager
	const primaryPm = pmArray[0];

	const pmList = pmArray.map((pm) => `${getPackageManagerEmoji(pm)} ${pm}`).join(", ");
	core.startGroup(formatCache("Restoring", pmList));

	try {
		const config = await getCombinedCacheConfig(pmArray);

		// Find lock files
		const lockFiles = await findLockFiles(config.lockFilePatterns);

		if (lockFiles.length === 0) {
			core.info(`No lock files found for ${pmList}, caching without lockfile hash`);
		} else {
			core.info(`Found lock files: ${lockFiles.join(", ")}`);
		}

		core.info(`Cache paths (${config.cachePaths.length} total): ${config.cachePaths.join(", ")}`);

		// Set outputs for observability
		setOutput("lockfiles", lockFiles.join(","));
		setOutput("cache-paths", config.cachePaths.join(","));

		// Generate cache keys
		const primaryKey = await generateCacheKey(runtimeVersions, primaryPm, packageManagerVersion, lockFiles, cacheHash);
		const restoreKeys = generateRestoreKeys(runtimeVersions, primaryPm, packageManagerVersion, cacheHash);

		core.info(`Primary key: ${primaryKey}`);
		core.info(`Restore keys: ${restoreKeys.join(", ")}`);

		// Attempt to restore cache
		const cacheKey = await cache.restoreCache(config.cachePaths, primaryKey, restoreKeys);

		if (cacheKey) {
			core.info(formatSuccess(`Cache restored from key: ${cacheKey}`));
			setOutput("cache-hit", cacheKey === primaryKey ? "true" : "partial");

			// Save state for post action
			core.saveState("CACHE_KEY", cacheKey);
			core.saveState("CACHE_PRIMARY_KEY", primaryKey);
			core.saveState("CACHE_PATHS", JSON.stringify(config.cachePaths));
			core.saveState("PACKAGE_MANAGERS", JSON.stringify(pmArray));
		} else {
			core.info("Cache not found");
			setOutput("cache-hit", "false");

			// Still save state for post action to save new cache
			core.saveState("CACHE_PRIMARY_KEY", primaryKey);
			core.saveState("CACHE_PATHS", JSON.stringify(config.cachePaths));
			core.saveState("PACKAGE_MANAGERS", JSON.stringify(pmArray));
		}

		core.endGroup();
		return cacheKey;
	} catch (error) {
		core.endGroup();
		core.warning(`Failed to restore cache: ${error instanceof Error ? error.message : String(error)}`);
		return undefined;
	}
}

/**
 * Saves package manager cache (called in post action)
 */
export async function saveCache(): Promise<void> {
	const pmList = "dependencies";
	core.startGroup(formatCache("Saving", pmList));

	try {
		// Retrieve saved state
		const cacheKey = core.getState("CACHE_KEY");
		const primaryKey = core.getState("CACHE_PRIMARY_KEY");
		const cachePathsJson = core.getState("CACHE_PATHS");
		const packageManagersJson = core.getState("PACKAGE_MANAGERS");

		if (!primaryKey) {
			core.info("No primary key found, skipping cache save");
			core.endGroup();
			return;
		}

		// Check if we already hit the cache
		if (cacheKey === primaryKey) {
			core.info(`Cache hit occurred on primary key ${primaryKey}, not saving cache`);
			core.endGroup();
			return;
		}

		const cachePaths = JSON.parse(cachePathsJson) as string[];
		const packageManagers = packageManagersJson ? (JSON.parse(packageManagersJson) as PackageManager[]) : [];

		const pmList = packageManagers.length > 0 ? packageManagers.join(", ") : "unknown";
		core.info(`Package managers: ${pmList}`);
		core.info(`Cache key: ${primaryKey}`);
		core.info(`Cache paths (${cachePaths.length} total):`);
		for (const path of cachePaths) {
			core.info(`  - ${path}`);
		}

		// Save the cache
		const cacheId = await cache.saveCache(cachePaths, primaryKey);

		if (cacheId === -1) {
			core.warning("Cache save failed");
		} else {
			core.info(formatSuccess(`Cache saved successfully with key: ${primaryKey}`));
		}

		core.endGroup();
	} catch (error) {
		core.endGroup();
		// Don't fail the workflow on cache save errors
		core.warning(`Failed to save cache: ${error instanceof Error ? error.message : String(error)}`);
	}
}
