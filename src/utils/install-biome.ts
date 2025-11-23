import { chmod } from "node:fs/promises";
import { arch, platform } from "node:os";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import { STATE, formatDetection, formatInstallation, formatSuccess } from "./emoji.js";

/**
 * Gets the platform-specific binary name for Biome
 *
 * @returns Platform-specific binary filename
 */
function getBiomeBinaryName(): string {
	const plat = platform();
	const architecture = arch();

	// Map platform and architecture to Biome binary names
	const platformMap: Record<string, Record<string, string>> = {
		linux: {
			x64: "biome-linux-x64",
			arm64: "biome-linux-arm64",
		},
		darwin: {
			x64: "biome-darwin-x64",
			arm64: "biome-darwin-arm64",
		},
		win32: {
			x64: "biome-win32-x64.exe",
			arm64: "biome-win32-arm64.exe",
		},
	};

	const binaryName = platformMap[plat]?.[architecture];
	if (!binaryName) {
		throw new Error(`Unsupported platform: ${plat}-${architecture}`);
	}

	return binaryName;
}

/**
 * Downloads and installs Biome CLI from GitHub releases
 *
 * @param version - Biome version to install (e.g., "2.3.6" or "latest")
 * @returns Path to the installed Biome binary
 */
async function downloadBiome(version: string): Promise<string> {
	const binaryName = getBiomeBinaryName();
	// Biome uses @biomejs/biome@version tag format (URL-encoded: %40biomejs%2Fbiome%40version)
	const downloadUrl = `https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%40${version}/${binaryName}`;

	core.info(`Downloading Biome ${version} from ${downloadUrl}`);

	try {
		// Download the binary
		const downloadPath = await tc.downloadTool(downloadUrl);

		// Determine final binary name
		const finalBinaryName = platform() === "win32" ? "biome.exe" : "biome";

		// Cache the binary
		const cachedPath = await tc.cacheFile(downloadPath, finalBinaryName, "biome", version);

		// Make executable (Unix only)
		if (platform() !== "win32") {
			await chmod(`${cachedPath}/${finalBinaryName}`, 0o755);
		}

		core.info(`Biome ${version} cached at ${cachedPath}`);
		return cachedPath;
	} catch (error) {
		throw new Error(`Failed to download Biome ${version}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Installs Biome CLI and adds it to PATH
 *
 * @param version - Biome version to install (e.g., "2.3.6" or "latest")
 */
export async function installBiome(version: string): Promise<void> {
	if (!version || version === "") {
		core.info(`${STATE.neutral} No Biome version specified, skipping installation`);
		return;
	}

	core.startGroup(formatInstallation(`Biome ${version}`));

	try {
		// Resolve "latest" to actual version by checking tool cache or downloading
		const resolvedVersion = version === "latest" ? version : version;

		// Check if already in tool cache
		let toolPath = tc.find("biome", resolvedVersion);

		if (toolPath) {
			core.info(formatDetection(`Biome ${resolvedVersion} in tool cache: ${toolPath}`, true));
		} else {
			core.info(`${STATE.neutral} Biome ${resolvedVersion} not found in cache, downloading...`);
			toolPath = await downloadBiome(resolvedVersion);
		}

		// Add to PATH
		core.addPath(toolPath);

		// Verify installation
		const binaryName = platform() === "win32" ? "biome.exe" : "biome";
		core.info(`Verifying Biome installation at: ${toolPath}/${binaryName}`);

		core.info(formatSuccess(`Biome ${version} installed successfully`));
	} catch (error) {
		// Don't fail the workflow if Biome installation fails
		core.warning(`${STATE.issue} Failed to install Biome: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		core.endGroup();
	}
}
