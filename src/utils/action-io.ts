import { getInput as coreGetInput, setOutput as coreSetOutput } from "@actions/core";

/**
 * Valid action input keys from action.yml
 */
const VALID_INPUTS: Set<string> = new Set([
	"node-version",
	"bun-version",
	"deno-version",
	"package-manager",
	"package-manager-version",
	"biome-version",
	"turbo-token",
	"turbo-team",
	"install-deps",
	"cache-bust",
	"additional-lockfiles",
	"additional-cache-paths",
] as const);

/**
 * Valid action output keys from action.yml
 */
const VALID_OUTPUTS: Set<string> = new Set([
	"node-version",
	"node-enabled",
	"bun-version",
	"bun-enabled",
	"deno-version",
	"deno-enabled",
	"package-manager",
	"package-manager-version",
	"biome-version",
	"biome-enabled",
	"turbo-enabled",
	"cache-hit",
	"lockfiles",
	"cache-paths",
] as const);

/**
 * Type-safe input key
 */
export type ActionInput =
	| "node-version"
	| "bun-version"
	| "deno-version"
	| "package-manager"
	| "package-manager-version"
	| "biome-version"
	| "turbo-token"
	| "turbo-team"
	| "install-deps"
	| "cache-bust"
	| "additional-lockfiles"
	| "additional-cache-paths";

/**
 * Type-safe output key
 */
export type ActionOutput =
	| "node-version"
	| "node-enabled"
	| "bun-version"
	| "bun-enabled"
	| "deno-version"
	| "deno-enabled"
	| "package-manager"
	| "package-manager-version"
	| "biome-version"
	| "biome-enabled"
	| "turbo-enabled"
	| "cache-hit"
	| "lockfiles"
	| "cache-paths";

/**
 * Get action input with validation
 *
 * @param name - Input name (validated against action.yml inputs)
 * @returns Input value or empty string if not set
 * @throws Error if input name is not valid
 */
export function getInput(name: ActionInput): string {
	if (!VALID_INPUTS.has(name)) {
		throw new Error(`Invalid input key: "${name}". Valid inputs are: ${Array.from(VALID_INPUTS).join(", ")}`);
	}
	return coreGetInput(name) || "";
}

/**
 * Set action output with validation
 *
 * @param name - Output name (validated against action.yml outputs)
 * @param value - Output value
 * @throws Error if output name is not valid
 */
export function setOutput(name: ActionOutput, value: string | boolean): void {
	if (!VALID_OUTPUTS.has(name)) {
		throw new Error(`Invalid output key: "${name}". Valid outputs are: ${Array.from(VALID_OUTPUTS).join(", ")}`);
	}
	coreSetOutput(name, String(value));
}
