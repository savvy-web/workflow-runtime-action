/**
 * Emoji helpers for consistent, visually appealing logs
 */

/**
 * Runtime emojis
 */
export const RUNTIME = {
	node: "📦",
	bun: "🥟",
	deno: "🦕",
} as const;

/**
 * Package manager emojis
 */
export const PACKAGE_MANAGER = {
	npm: "📦",
	pnpm: "⚡",
	yarn: "🧶",
	bun: "🥟",
	deno: "🦕",
} as const;

/**
 * Informational state emojis
 */
export const STATE = {
	good: "🟢",
	neutral: "⚪",
	warning: "🟡",
	issue: "🔴",
} as const;

/**
 * Operation emojis
 */
export const OPERATION = {
	detection: "🔍",
	setup: "🔧",
	cache: "♻️",
	installation: "⚙️",
} as const;

/**
 * Status emojis
 */
export const STATUS = {
	pass: "✅",
	neutral: "☑️",
	fail: "🚫",
	warning: "⚠️",
} as const;

/**
 * Get emoji for a runtime
 */
export function getRuntimeEmoji(runtime: "node" | "bun" | "deno"): string {
	return RUNTIME[runtime];
}

/**
 * Get emoji for a package manager
 */
export function getPackageManagerEmoji(pm: "npm" | "pnpm" | "yarn" | "bun" | "deno"): string {
	return PACKAGE_MANAGER[pm];
}

/**
 * Format a runtime name with its emoji
 */
export function formatRuntime(runtime: "node" | "bun" | "deno"): string {
	return `${RUNTIME[runtime]} ${runtime.charAt(0).toUpperCase() + runtime.slice(1)}`;
}

/**
 * Format a package manager name with its emoji
 */
export function formatPackageManager(pm: "npm" | "pnpm" | "yarn" | "bun" | "deno"): string {
	const name = pm === "npm" ? "npm" : pm.charAt(0).toUpperCase() + pm.slice(1);
	return `${PACKAGE_MANAGER[pm]} ${name}`;
}

/**
 * Format a detection message
 */
export function formatDetection(item: string, found: boolean): string {
	const emoji = found ? STATE.good : STATE.neutral;
	const status = found ? "Detected" : "No";
	return `${emoji} ${status} ${item}`;
}

/**
 * Format a setup message
 */
export function formatSetup(item: string): string {
	return `${OPERATION.setup} Setting up ${item}`;
}

/**
 * Format a cache message
 */
export function formatCache(action: "Restoring" | "Saving", item: string): string {
	return `${OPERATION.cache} ${action} cache for: ${item}`;
}

/**
 * Format an installation message
 */
export function formatInstallation(item: string): string {
	return `${OPERATION.installation} Installing ${item}`;
}

/**
 * Format a success message
 */
export function formatSuccess(message: string): string {
	return `${STATUS.pass} ${message}`;
}

/**
 * Format a warning message
 */
export function formatWarning(message: string): string {
	return `${STATUS.warning} ${message}`;
}

/**
 * Format a failure message
 */
export function formatFailure(message: string): string {
	return `${STATUS.fail} ${message}`;
}
