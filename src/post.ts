import { endGroup, startGroup, warning } from "@actions/core";
import { saveCache } from "./utils/cache-utils.js";

/**
 * Post-action hook that runs after the main action completes
 *
 * @remarks
 * This runs after the main action completes and handles:
 * - Saving the dependency cache for future runs
 * - Cleanup operations (if needed)
 *
 * Cache is only saved if:
 * 1. Dependencies were installed
 * 2. No cache hit occurred on the primary key
 * 3. The workflow completed successfully
 */
async function post(): Promise<void> {
	try {
		startGroup("🏁 Post-action: Saving cache");

		// Save the cache if needed
		await saveCache();

		endGroup();
	} catch (error) {
		endGroup();
		// Don't fail the workflow on post-action errors
		warning(`Post-action encountered an error: ${error instanceof Error ? error.message : String(error)}`);
	}
}

await post();
