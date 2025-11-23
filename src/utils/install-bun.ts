import { chmod } from "node:fs/promises";
import { arch, platform } from "node:os";
import { join } from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { STATE, formatDetection, formatInstallation, formatRuntime, formatSuccess } from "./emoji.js";

/**
 * Bun version configuration
 */
export interface BunVersionConfig {
	/** Bun version string (e.g., "1.0.25") or empty for auto-detect */
	version: string;
}

/**
 * Gets the platform-specific archive name for Bun
 *
 * @returns Platform-specific archive filename
 */
function getBunArchiveName(): string {
	const plat = platform();
	const architecture = arch();

	// Map platform and architecture to Bun archive names
	// Bun uses "aarch64" for ARM64, not "arm64"
	const archMap: Record<string, string> = {
		x64: "x64",
		arm64: "aarch64",
	};

	const bunArch = archMap[architecture];
	if (!bunArch) {
		throw new Error(`Unsupported architecture for Bun: ${architecture}`);
	}

	// Platform-specific archive names
	const platformMap: Record<string, string> = {
		linux: `bun-linux-${bunArch}.zip`,
		darwin: `bun-darwin-${bunArch}.zip`,
		win32: "bun-windows-x64.zip",
	};

	const archiveName = platformMap[plat];
	if (!archiveName) {
		throw new Error(`Unsupported platform for Bun: ${plat}`);
	}

	return archiveName;
}

/**
 * Downloads and extracts Bun from GitHub releases
 *
 * @param version - Bun version to install (e.g., "1.0.25")
 * @returns Path to the installed Bun directory
 */
async function downloadBun(version: string): Promise<string> {
	const archiveName = getBunArchiveName();
	// Bun uses bun-v{version} tag format
	const downloadUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${archiveName}`;

	core.info(`Downloading Bun ${version} from ${downloadUrl}`);

	try {
		// Download the archive
		const downloadPath = await tc.downloadTool(downloadUrl);

		// Extract the zip file
		const extractedPath = await tc.extractZip(downloadPath);

		// Bun zip contains a directory like "bun-{platform}-{arch}"
		// The binary is inside this directory
		// Note: Windows uses "windows" in the directory name, not "win32"
		const plat = platform();
		const bunPlatform = plat === "win32" ? "windows" : plat;
		const bunArch = arch() === "arm64" ? "aarch64" : arch();
		const bunDir = join(extractedPath, `bun-${bunPlatform}-${bunArch}`);

		// Make binary executable (Unix only)
		if (plat !== "win32") {
			const binaryPath = join(bunDir, "bun");
			await chmod(binaryPath, 0o755);
		}

		// Cache the extracted directory
		const cachedPath = await tc.cacheDir(bunDir, "bun", version);

		core.info(`Bun ${version} cached at ${cachedPath}`);
		return cachedPath;
	} catch (error) {
		throw new Error(`Failed to download Bun ${version}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Installs Bun and adds it to PATH
 *
 * @param config - Bun version configuration
 * @returns Installed Bun version
 */
export async function installBun(config: BunVersionConfig): Promise<string> {
	core.startGroup(formatInstallation(formatRuntime("bun")));

	try {
		const { version } = config;

		if (!version) {
			throw new Error("Bun version is required");
		}

		// Check if already in tool cache
		let toolPath = tc.find("bun", version);

		if (toolPath) {
			core.info(formatDetection(`Bun ${version} in tool cache: ${toolPath}`, true));
		} else {
			core.info(`${STATE.neutral} Bun ${version} not found in cache, downloading...`);
			toolPath = await downloadBun(version);
		}

		// Add to PATH
		core.addPath(toolPath);

		// Verify installation
		await exec.exec("bun", ["--version"]);

		core.info(formatSuccess(`Bun ${version} installed successfully`));
		core.endGroup();

		return version;
	} catch (error) {
		core.endGroup();
		throw new Error(`Failed to install Bun: ${error instanceof Error ? error.message : String(error)}`);
	}
}
