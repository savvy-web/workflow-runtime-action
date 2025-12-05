import { chmod } from "node:fs/promises";
import { arch, platform } from "node:os";
import { addPath, endGroup, info, startGroup } from "@actions/core";
import { exec } from "@actions/exec";
import { cacheDir, downloadTool, extractZip, find } from "@actions/tool-cache";
import { formatDetection, formatInstallation, formatRuntime, formatSuccess } from "./emoji.js";

/**
 * Deno version configuration
 */
export interface DenoVersionConfig {
	/** Deno version string (e.g., "1.40.0") or empty for auto-detect */
	version: string;
}

/**
 * Gets the platform-specific archive name for Deno using Rust target triples
 *
 * @returns Platform-specific archive filename
 */
function getDenoArchiveName(): string {
	const plat = platform();
	const architecture = arch();

	// Map to Rust target triples used by Deno
	const targetMap: Record<string, Record<string, string>> = {
		linux: {
			x64: "x86_64-unknown-linux-gnu",
			arm64: "aarch64-unknown-linux-gnu",
		},
		darwin: {
			x64: "x86_64-apple-darwin",
			arm64: "aarch64-apple-darwin",
		},
		win32: {
			x64: "x86_64-pc-windows-msvc",
		},
	};

	const target = targetMap[plat]?.[architecture];
	if (!target) {
		throw new Error(`Unsupported platform for Deno: ${plat}-${architecture}`);
	}

	return `deno-${target}.zip`;
}

/**
 * Downloads and extracts Deno from GitHub releases
 *
 * @param version - Deno version to install (e.g., "1.40.0")
 * @returns Path to the installed Deno directory
 */
async function downloadDeno(version: string): Promise<string> {
	const archiveName = getDenoArchiveName();
	// Deno uses v{version} tag format
	const downloadUrl = `https://github.com/denoland/deno/releases/download/v${version}/${archiveName}`;

	info(`Downloading Deno ${version} from ${downloadUrl}`);

	try {
		// Download the archive
		const downloadPath = await downloadTool(downloadUrl);

		// Extract the zip file
		const extractedPath = await extractZip(downloadPath);

		// Make binary executable (Unix only)
		if (platform() !== "win32") {
			const binaryPath = `${extractedPath}/deno`;
			await chmod(binaryPath, 0o755);
		}

		// Cache the extracted directory
		const cachedPath = await cacheDir(extractedPath, "deno", version);

		info(`Deno ${version} cached at ${cachedPath}`);
		return cachedPath;
	} catch (error) {
		throw new Error(`Failed to download Deno ${version}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Installs Deno and adds it to PATH
 *
 * @param config - Deno version configuration
 * @returns Installed Deno version
 */
export async function installDeno(config: DenoVersionConfig): Promise<string> {
	startGroup(formatInstallation(formatRuntime("deno")));

	try {
		const { version } = config;

		if (!version) {
			throw new Error("Deno version is required");
		}

		// Check if already in tool cache
		let toolPath = find("deno", version);

		if (toolPath) {
			info(formatDetection(`Deno ${version} in tool cache: ${toolPath}`, true));
		} else {
			info(formatDetection(`Deno ${version} in cache`, false));
			toolPath = await downloadDeno(version);
		}

		// Add to PATH
		addPath(toolPath);

		// Verify installation
		await exec("deno", ["--version"]);

		info(formatSuccess(`Deno ${version} installed successfully`));
		endGroup();

		return version;
	} catch (error) {
		endGroup();
		throw new Error(`Failed to install Deno: ${error instanceof Error ? error.message : String(error)}`);
	}
}
