import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { context } from "@actions/github";
import * as glob from "@actions/glob";
import { setOutput } from "./action-io.js";
import { formatCache, formatSuccess, getPackageManagerEmoji } from "./emoji.js";

/**
 * Supported package managers for caching
 */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "deno";

/**
 * Runtime versions for cache key generation
 * Supports node, bun, deno, biome, and any future tools
 */
export type RuntimeVersions = Record<string, string | undefined>;

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
 * Parses list input supporting multiple formats:
 * - JSON arrays: '["one", "two", "three"]'
 * - Newlines with bullets: '* one\n* two'
 * - Newlines with dashes: '- one\n- two'
 * - Plain newlines: 'one\ntwo'
 * - Comma-separated: 'one, two, three'
 * - Single item: 'just-one'
 *
 * @param input - Input string in any supported format
 * @returns Array of trimmed, non-empty strings
 */
function parseListInput(input: string): string[] {
	if (!input || !input.trim()) {
		return [];
	}

	const trimmed = input.trim();

	// Try JSON array first
	if (trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (Array.isArray(parsed)) {
				return parsed.map((item) => String(item).trim()).filter(Boolean);
			}
		} catch {
			// Not valid JSON, fall through
		}
	}

	// Check for newlines
	if (trimmed.includes("\n")) {
		return trimmed
			.split("\n")
			.map((line) => line.replace(/^[\s]*[-*][\s]+/, "").trim()) // Strip list markers (bullets/dashes with trailing space)
			.filter(Boolean);
	}

	// Fall back to comma-separated
	return trimmed
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
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
			lockFilePatterns = ["**/package-lock.json", "**/npm-shrinkwrap.json"];
			break;
		case "pnpm":
			lockFilePatterns = ["**/pnpm-lock.yaml", "**/pnpm-workspace.yaml", "**/.pnpmfile.cjs"];
			break;
		case "yarn":
			// Yarn Classic uses yarn.lock, Yarn Berry (PnP) uses .pnp.cjs and .yarn/install-state.gz
			lockFilePatterns = ["**/yarn.lock", "**/.pnp.cjs", "**/.yarn/install-state.gz"];
			break;
		case "bun":
			// Bun uses bun.lock (new style) and bun.lockb (older style)
			lockFilePatterns = ["**/bun.lock", "**/bun.lockb"];
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
 * @returns Truncated SHA256 hash (8 chars) of the combined file contents
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

	// Use first 8 characters for shorter, more readable cache keys
	// 8 hex chars = 4.3 billion possibilities, collision risk is negligible for repo-scoped cache
	return hash.digest("hex").substring(0, 8);
}

/**
 * Gets tool cache paths for specific runtimes
 *
 * @param runtimeVersions - Runtime versions to get cache paths for
 * @returns Array of tool cache paths
 */
function getToolCachePaths(runtimeVersions: RuntimeVersions): string[] {
	const paths: string[] = [];
	const plat = platform();

	// Tool cache is at /opt/hostedtoolcache on Linux/macOS, C:\hostedtoolcache on Windows
	const toolCacheBase = plat === "win32" ? "C:\\hostedtoolcache" : "/opt/hostedtoolcache";

	// Add tool cache paths for each runtime being used
	if (runtimeVersions.node) {
		paths.push(`${toolCacheBase}/node/${runtimeVersions.node}`);
		// Also cache the x64/arm64 subdirectories
		paths.push(`${toolCacheBase}/node/${runtimeVersions.node}/*`);
	}

	if (runtimeVersions.bun) {
		paths.push(`${toolCacheBase}/bun/${runtimeVersions.bun}`);
		paths.push(`${toolCacheBase}/bun/${runtimeVersions.bun}/*`);
	}

	if (runtimeVersions.deno) {
		paths.push(`${toolCacheBase}/deno/${runtimeVersions.deno}`);
		paths.push(`${toolCacheBase}/deno/${runtimeVersions.deno}/*`);
	}

	if (runtimeVersions.biome) {
		paths.push(`${toolCacheBase}/biome/${runtimeVersions.biome}`);
		paths.push(`${toolCacheBase}/biome/${runtimeVersions.biome}/*`);
	}

	return paths;
}

/**
 * Gets combined cache configuration for multiple package managers and runtimes
 *
 * @param packageManagers - Array of package managers to get combined config for
 * @param runtimeVersions - Runtime versions to include tool cache paths for
 * @param additionalLockfiles - Additional lockfile patterns from user input
 * @param additionalCachePaths - Additional cache paths from user input
 * @returns Combined cache configuration with deduplicated paths
 */
async function getCombinedCacheConfig(
	packageManagers: PackageManager[],
	runtimeVersions: RuntimeVersions,
	additionalLockfiles: string[] = [],
	additionalCachePaths: string[] = [],
): Promise<CacheConfig> {
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

	// Add tool cache paths for runtimes
	const toolCachePaths = getToolCachePaths(runtimeVersions);
	for (const path of toolCachePaths) {
		cachePathsSet.add(path);
	}

	if (toolCachePaths.length > 0) {
		core.info(`Tool cache paths: ${toolCachePaths.join(", ")}`);
	}

	// Add user-provided additional lockfile patterns
	for (const pattern of additionalLockfiles) {
		lockFilePatternsSet.add(pattern);
	}

	if (additionalLockfiles.length > 0) {
		core.info(`Additional lockfile patterns: ${additionalLockfiles.join(", ")}`);
	}

	// Add user-provided additional cache paths
	for (const path of additionalCachePaths) {
		cachePathsSet.add(path);
	}

	if (additionalCachePaths.length > 0) {
		core.info(`Additional cache paths: ${additionalCachePaths.join(", ")}`);
	}

	// Convert Sets back to arrays and sort for consistency
	// Sort with absolute paths first, then glob patterns for better readability
	const sortPathsWithAbsoluteFirst = (paths: string[]): string[] => {
		const absolute = paths.filter((p) => !p.startsWith("*")).sort();
		const globs = paths.filter((p) => p.startsWith("*")).sort();
		return [...absolute, ...globs];
	};

	const cachePaths = sortPathsWithAbsoluteFirst(Array.from(cachePathsSet));
	const lockFilePatterns = sortPathsWithAbsoluteFirst(Array.from(lockFilePatternsSet));

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
 * @param cacheBust - Optional cache hash (for testing, typically github.run_id)
 * @returns Truncated hash string (8 chars)
 */
function generateVersionHash(
	runtimeVersions: RuntimeVersions,
	packageManager: PackageManager,
	packageManagerVersion: string,
	cacheBust?: string,
): string {
	const hash = createHash("sha256");

	// Add optional cache hash (for testing)
	if (cacheBust) {
		hash.update(cacheBust);
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

	// Use first 8 characters for shorter, more readable cache keys
	// 8 hex chars = 4.3 billion possibilities, collision risk is negligible for repo-scoped cache
	return hash.digest("hex").substring(0, 8);
}

/**
 * Gets the current branch name from GitHub Actions context
 *
 * @returns Branch name or empty string if not available
 */
function getBranchName(): string {
	// For PRs, use the head ref from the payload (PR branch name)
	const prHeadRef = context.payload.pull_request?.head?.ref;
	if (prHeadRef && typeof prHeadRef === "string") {
		return prHeadRef;
	}

	// For pushes, extract branch name from the ref (e.g., "refs/heads/main" -> "main")
	const ref = context.ref;
	if (ref?.startsWith("refs/heads/")) {
		return ref.replace("refs/heads/", "");
	}

	return "";
}

/**
 * Generates a short hash of the branch name for cache key
 *
 * Branch names can contain special characters (hyphens, slashes) that could
 * interfere with cache key parsing, so we hash them for consistency.
 * When no branch is available, hashes "null" to maintain consistent key format.
 *
 * @param branch - Branch name to hash
 * @returns 8-character hash of the branch name (or "null" if no branch)
 */
function hashBranch(branch: string): string {
	const hash = createHash("sha256");
	hash.update(branch || "null");
	return hash.digest("hex").substring(0, 8);
}

/**
 * Generates cache key from runtime versions, package manager, and lock files
 *
 * @param runtimeVersions - Runtime versions being cached
 * @param packageManager - Package manager name
 * @param packageManagerVersion - Package manager version
 * @param lockFiles - Lock file paths
 * @param cacheBust - Optional cache hash (for testing, typically github.run_id)
 * @returns Cache key string in format: {os}-{version-hash}-{branch-hash}-{lockfile-hash}
 */
async function generateCacheKey(
	runtimeVersions: RuntimeVersions,
	packageManager: PackageManager,
	packageManagerVersion: string,
	lockFiles: string[],
	cacheBust?: string,
): Promise<string> {
	const plat = platform();
	const versionHash = generateVersionHash(runtimeVersions, packageManager, packageManagerVersion, cacheBust);
	const branchHash = hashBranch(getBranchName());
	const lockfileHash = await hashFiles(lockFiles);

	// Format: {os}-{versionHash}-{branchHash}-{lockfileHash}
	return `${plat}-${versionHash}-${branchHash}-${lockfileHash}`;
}

/**
 * Generates restore keys for cache fallback
 *
 * Restore keys are tried in order, with the first match being used.
 * This prioritizes branch-specific caches while falling back to cross-branch caches.
 *
 * @param runtimeVersions - Runtime versions being cached
 * @param packageManager - Package manager name
 * @param packageManagerVersion - Package manager version
 * @param cacheBust - Optional cache hash (for testing)
 * @returns Array of restore key prefixes in priority order
 */
function generateRestoreKeys(
	runtimeVersions: RuntimeVersions,
	packageManager: PackageManager,
	packageManagerVersion: string,
	cacheBust?: string,
): string[] {
	// When cache-bust is provided (testing mode), don't use restore keys
	// We want exact matches only for test validation
	if (cacheBust) {
		return [];
	}

	const plat = platform();
	const versionHash = generateVersionHash(runtimeVersions, packageManager, packageManagerVersion, cacheBust);
	const branchHash = hashBranch(getBranchName());

	// Restore keys in order of specificity:
	// 1. Same branch + same runtime/pm versions (any lockfile)
	// 2. Any branch + same runtime/pm versions (cross-branch fallback)
	return [
		`${plat}-${versionHash}-${branchHash}-`, // Same branch, any lockfile
		`${plat}-${versionHash}-`, // Any branch, any lockfile
	];
}

/**
 * Restores package manager cache
 *
 * @param packageManagers - Package manager(s) to restore cache for
 * @param runtimeVersions - Runtime versions installed
 * @param packageManagerVersion - Package manager version
 * @param cacheBust - Optional cache hash (for testing, typically github.run_id)
 * @param additionalLockfiles - Optional multiline string of additional lockfile patterns
 * @param additionalCachePaths - Optional multiline string of additional cache paths
 * @returns Cache key if restored, undefined if no cache found
 */
export async function restoreCache(
	packageManagers: PackageManager | PackageManager[],
	runtimeVersions: RuntimeVersions,
	packageManagerVersion: string,
	cacheBust?: string,
	additionalLockfiles?: string,
	additionalCachePaths?: string,
): Promise<string | undefined> {
	// Normalize to array
	const pmArray = Array.isArray(packageManagers) ? packageManagers : [packageManagers];

	// For cache key, we only use the primary package manager
	const primaryPm = pmArray[0];

	const pmList = pmArray.map((pm) => `${getPackageManagerEmoji(pm)} ${pm}`).join(", ");
	core.startGroup(formatCache("Restoring", pmList));

	try {
		// Parse additional inputs
		const additionalLockfilesList = parseListInput(additionalLockfiles || "");
		const additionalCachePathsList = parseListInput(additionalCachePaths || "");

		const config = await getCombinedCacheConfig(
			pmArray,
			runtimeVersions,
			additionalLockfilesList,
			additionalCachePathsList,
		);

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
		const primaryKey = await generateCacheKey(runtimeVersions, primaryPm, packageManagerVersion, lockFiles, cacheBust);
		const restoreKeys = generateRestoreKeys(runtimeVersions, primaryPm, packageManagerVersion, cacheBust);

		core.info(`Primary key: ${primaryKey}`);
		core.info(`Restore keys: ${restoreKeys.length > 0 ? restoreKeys.join(", ") : "(none - exact match only)"}`);

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

		// Check if any cache paths exist
		let pathsExist = false;
		for (const path of cachePaths) {
			const globber = await glob.create(path, { followSymbolicLinks: false });
			const matches = await globber.glob();
			if (matches.length > 0) {
				pathsExist = true;
				break;
			}
		}

		if (!pathsExist) {
			core.info("No cache paths exist, skipping cache save");
			core.endGroup();
			return;
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
