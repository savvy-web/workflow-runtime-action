import { debug, endGroup, getInput, info, setFailed, startGroup } from "@actions/core";

/**
 * Pre-action hook that runs before the main action
 *
 * @remarks
 * This runs before the main action and can be used for:
 * - Initial environment validation
 * - Logging inputs for debugging
 * - Setting up any prerequisites
 *
 * Currently just logs the start of the action for visibility.
 */
async function pre(): Promise<void> {
	try {
		startGroup("🚀 Starting Runtime Setup");
		info("Pre-action hook started");

		// Log all inputs for debugging
		const nodeVersion = getInput("node-version") || "auto-detect";
		const bunVersion = getInput("bun-version") || "auto-detect";
		const denoVersion = getInput("deno-version") || "auto-detect";
		const packageManager = getInput("package-manager") || "auto-detect";
		const packageManagerVersion = getInput("package-manager-version") || "auto-detect";
		const biomeVersion = getInput("biome-version") || "auto-detect";
		const installDeps = getInput("install-deps") || "true";
		const turboToken = getInput("turbo-token") ? "***" : "not provided";
		const turboTeam = getInput("turbo-team") || "not provided";
		const additionalLockfiles = getInput("additional-lockfiles") || "not provided";
		const additionalCachePaths = getInput("additional-cache-paths") || "not provided";

		debug(`Input - node-version: ${nodeVersion}`);
		debug(`Input - bun-version: ${bunVersion}`);
		debug(`Input - deno-version: ${denoVersion}`);
		debug(`Input - package-manager: ${packageManager}`);
		debug(`Input - package-manager-version: ${packageManagerVersion}`);
		debug(`Input - biome-version: ${biomeVersion}`);
		debug(`Input - install-deps: ${installDeps}`);
		debug(`Input - turbo-token: ${turboToken}`);
		debug(`Input - turbo-team: ${turboTeam}`);
		debug(`Input - additional-lockfiles: ${additionalLockfiles}`);
		debug(`Input - additional-cache-paths: ${additionalCachePaths}`);

		info("Pre-action hook completed");
		endGroup();
	} catch (error) {
		setFailed(`Pre-action failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

await pre();
