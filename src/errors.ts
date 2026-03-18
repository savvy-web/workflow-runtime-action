import { Data } from "effect";

/* v8 ignore start */

/**
 * Error thrown when configuration is invalid or missing.
 * e.g., missing devEngines, invalid version format, missing package.json
 */
export class ConfigError extends Data.TaggedError("ConfigError")<{
	readonly reason: string;
	readonly file?: string;
	readonly cause?: unknown;
}> {}

/**
 * Error thrown when a runtime (node, bun, deno) fails to install.
 */
export class RuntimeInstallError extends Data.TaggedError("RuntimeInstallError")<{
	readonly runtime: string;
	readonly version: string;
	readonly reason: string;
	readonly cause?: unknown;
}> {}

/**
 * Error thrown when setting up a package manager (pnpm, yarn, npm, bun) fails.
 */
export class PackageManagerSetupError extends Data.TaggedError("PackageManagerSetupError")<{
	readonly packageManager: string;
	readonly version: string;
	readonly reason: string;
	readonly cause?: unknown;
}> {}

/**
 * Error thrown when installing dependencies fails.
 */
export class DependencyInstallError extends Data.TaggedError("DependencyInstallError")<{
	readonly packageManager: string;
	readonly reason: string;
	readonly cause?: unknown;
}> {}

/**
 * Error thrown when a cache operation (save, restore, key-generation) fails.
 */
export class CacheError extends Data.TaggedError("CacheError")<{
	readonly operation: "save" | "restore" | "key-generation";
	readonly reason: string;
	readonly cause?: unknown;
}> {}
