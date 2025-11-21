import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as glob from "@actions/glob";

/**
 * Supported package managers for caching
 */
export type PackageManager = "npm" | "pnpm" | "yarn";

/**
 * Cache configuration for a package manager
 */
interface CacheConfig {
	/** Cache directory paths */
	cachePaths: string[];
	/** Lock file patterns to look for */
	lockFilePatterns: string[];
	/** Cache key prefix */
	keyPrefix: string;
}

/**
 * Gets cache configuration for a package manager
 *
 * @param packageManager - The package manager to get config for
 * @returns Cache configuration
 */
function getCacheConfig(packageManager: PackageManager): CacheConfig {
	const plat = platform();
	const architecture = arch();

	switch (packageManager) {
		case "pnpm":
			return {
				cachePaths: [plat === "win32" ? "~/AppData/Local/pnpm/store" : "~/.local/share/pnpm/store", "**/node_modules"],
				lockFilePatterns: ["**/pnpm-lock.yaml"],
				keyPrefix: `pnpm-${plat}-${architecture}`,
			};

		case "yarn":
			return {
				cachePaths: [
					plat === "win32" ? "~/AppData/Local/Yarn/Cache" : "~/.yarn/cache",
					plat === "win32" ? "~/AppData/Local/Yarn/Berry/cache" : "~/.cache/yarn",
					"**/node_modules",
					"**/.yarn/cache",
					"**/.yarn/unplugged",
					"**/.yarn/install-state.gz",
				],
				lockFilePatterns: ["**/yarn.lock"],
				keyPrefix: `yarn-${plat}-${architecture}`,
			};

		case "npm":
			return {
				cachePaths: [plat === "win32" ? "~/AppData/Local/npm-cache" : "~/.npm", "**/node_modules"],
				lockFilePatterns: ["**/package-lock.json"],
				keyPrefix: `npm-${plat}-${architecture}`,
			};
	}
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
 * Generates cache key from lock files
 *
 * @param packageManager - Package manager being cached
 * @param lockFiles - Lock file paths
 * @returns Cache key string
 */
async function generateCacheKey(packageManager: PackageManager, lockFiles: string[]): Promise<string> {
	const config = getCacheConfig(packageManager);
	const fileHash = await hashFiles(lockFiles);

	return `${config.keyPrefix}-${fileHash}`;
}

/**
 * Generates restore keys for cache fallback
 *
 * @param packageManager - Package manager being cached
 * @returns Array of restore key prefixes
 */
function generateRestoreKeys(packageManager: PackageManager): string[] {
	const config = getCacheConfig(packageManager);
	return [`${config.keyPrefix}-`];
}

/**
 * Restores package manager cache
 *
 * @param packageManager - Package manager to restore cache for
 * @returns Cache key if restored, undefined if no cache found
 */
export async function restoreCache(packageManager: PackageManager): Promise<string | undefined> {
	core.startGroup(`📦 Restoring ${packageManager} cache`);

	try {
		const config = getCacheConfig(packageManager);

		// Find lock files
		const lockFiles = await findLockFiles(config.lockFilePatterns);

		if (lockFiles.length === 0) {
			core.warning(`No lock files found for ${packageManager}, skipping cache`);
			core.endGroup();
			return undefined;
		}

		core.info(`Found lock files: ${lockFiles.join(", ")}`);

		// Generate cache keys
		const primaryKey = await generateCacheKey(packageManager, lockFiles);
		const restoreKeys = generateRestoreKeys(packageManager);

		core.info(`Primary key: ${primaryKey}`);
		core.info(`Restore keys: ${restoreKeys.join(", ")}`);

		// Attempt to restore cache
		const cacheKey = await cache.restoreCache(config.cachePaths, primaryKey, restoreKeys);

		if (cacheKey) {
			core.info(`✓ Cache restored from key: ${cacheKey}`);
			core.setOutput("cache-hit", cacheKey === primaryKey ? "true" : "partial");

			// Save state for post action
			core.saveState("CACHE_KEY", cacheKey);
			core.saveState("CACHE_PRIMARY_KEY", primaryKey);
			core.saveState("CACHE_PATHS", JSON.stringify(config.cachePaths));
		} else {
			core.info("Cache not found");
			core.setOutput("cache-hit", "false");

			// Still save state for post action to save new cache
			core.saveState("CACHE_PRIMARY_KEY", primaryKey);
			core.saveState("CACHE_PATHS", JSON.stringify(config.cachePaths));
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
	core.startGroup("💾 Saving cache");

	try {
		// Retrieve saved state
		const cacheKey = core.getState("CACHE_KEY");
		const primaryKey = core.getState("CACHE_PRIMARY_KEY");
		const cachePathsJson = core.getState("CACHE_PATHS");

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

		core.info(`Saving cache with key: ${primaryKey}`);
		core.info(`Cache paths: ${cachePaths.join(", ")}`);

		// Save the cache
		const cacheId = await cache.saveCache(cachePaths, primaryKey);

		if (cacheId === -1) {
			core.warning("Cache save failed");
		} else {
			core.info(`✓ Cache saved successfully with key: ${primaryKey}`);
		}

		core.endGroup();
	} catch (error) {
		core.endGroup();
		// Don't fail the workflow on cache save errors
		core.warning(`Failed to save cache: ${error instanceof Error ? error.message : String(error)}`);
	}
}
