import { Schema } from "effect";

/**
 * Validates that a version string is absolute (no semver ranges).
 * Rejects strings containing: ^, ~, >, <, =, *, x, X
 */
export const AbsoluteVersion = Schema.String.pipe(
	Schema.filter(
		(v) => {
			// Reject semver range operators and wildcards
			const hasRangeOperators = /[~^<>=*xX]/.test(v);
			if (hasRangeOperators) {
				return false;
			}
			// Must match basic semver format: digits.digits.digits with optional prerelease/build
			const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
			return semverPattern.test(v);
		},
		{ message: () => "Must be an absolute version (e.g., '24.11.0'), not a semver range" },
	),
);

/**
 * Supported runtime names
 */
export const RuntimeName = Schema.Literal("node", "bun", "deno");
export type RuntimeName = typeof RuntimeName.Type;

/**
 * Supported package manager names
 */
export const PackageManagerName = Schema.Literal("npm", "pnpm", "yarn", "bun");
export type PackageManagerName = typeof PackageManagerName.Type;

/**
 * A single devEngines entry (runtime or packageManager)
 */
export const DevEngineEntry = Schema.Struct({
	name: Schema.String,
	version: AbsoluteVersion,
	onFail: Schema.optional(Schema.String),
});
export type DevEngineEntry = typeof DevEngineEntry.Type;

/**
 * devEngines.runtime — single object or array
 */
const DevEngineRuntime = Schema.Union(DevEngineEntry, Schema.Array(DevEngineEntry));

/**
 * Complete devEngines schema
 */
export const DevEngines = Schema.Struct({
	packageManager: DevEngineEntry,
	runtime: DevEngineRuntime,
});
export type DevEngines = typeof DevEngines.Type;

/**
 * An installed runtime with name, version, and enabled flag
 */
export const InstalledRuntime = Schema.Struct({
	name: RuntimeName,
	version: Schema.String,
	enabled: Schema.Boolean,
});
export type InstalledRuntime = typeof InstalledRuntime.Type;

/**
 * Cache state schema
 */
export const CacheStateSchema = Schema.Struct({
	hit: Schema.Literal("exact", "partial", "none"),
	key: Schema.optional(Schema.String),
	paths: Schema.optional(Schema.Array(Schema.String)),
});
export type CacheState = typeof CacheStateSchema.Type;
