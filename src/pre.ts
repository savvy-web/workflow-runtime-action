import * as core from "@actions/core";

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
		core.startGroup("🚀 Starting Runtime Setup");
		core.info("Pre-action hook started");

		// Log all inputs for debugging
		const nodeVersion = core.getInput("node-version") || "auto-detect";
		const bunVersion = core.getInput("bun-version") || "auto-detect";
		const denoVersion = core.getInput("deno-version") || "auto-detect";
		const packageManager = core.getInput("package-manager") || "auto-detect";
		const packageManagerVersion = core.getInput("package-manager-version") || "auto-detect";
		const biomeVersion = core.getInput("biome-version") || "auto-detect";
		const installDeps = core.getInput("install-deps") || "true";
		const turboToken = core.getInput("turbo-token") ? "***" : "not provided";
		const turboTeam = core.getInput("turbo-team") || "not provided";

		core.debug(`Input - node-version: ${nodeVersion}`);
		core.debug(`Input - bun-version: ${bunVersion}`);
		core.debug(`Input - deno-version: ${denoVersion}`);
		core.debug(`Input - package-manager: ${packageManager}`);
		core.debug(`Input - package-manager-version: ${packageManagerVersion}`);
		core.debug(`Input - biome-version: ${biomeVersion}`);
		core.debug(`Input - install-deps: ${installDeps}`);
		core.debug(`Input - turbo-token: ${turboToken}`);
		core.debug(`Input - turbo-team: ${turboTeam}`);

		core.info("Pre-action hook completed");
		core.endGroup();
	} catch (error) {
		core.setFailed(`Pre-action failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

await pre();
