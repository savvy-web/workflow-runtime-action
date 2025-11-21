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
		core.startGroup("🚀 Starting Node.js Runtime Setup");
		core.info("Pre-action hook started");

		// Log inputs for debugging
		const nodeVersion = core.getInput("node-version") || "lts/*";
		const packageManager = core.getInput("package-manager") || "auto-detect";
		const biomeVersion = core.getInput("biome-version") || "auto-detect";
		const installDeps = core.getInput("install-deps") || "true";

		core.debug(`Input - node-version: ${nodeVersion}`);
		core.debug(`Input - package-manager: ${packageManager}`);
		core.debug(`Input - biome-version: ${biomeVersion}`);
		core.debug(`Input - install-deps: ${installDeps}`);

		core.info("Pre-action hook completed");
		core.endGroup();
	} catch (error) {
		core.setFailed(`Pre-action failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

await pre();
