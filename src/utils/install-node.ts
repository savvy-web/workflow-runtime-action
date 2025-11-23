import { readdirSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";

/**
 * Node.js version configuration
 */
interface NodeVersionConfig {
	/** Exact Node.js version (e.g., "20.11.0") */
	version: string;
}

/**
 * Gets the download URL for Node.js based on platform and architecture
 *
 * @param version - Node.js version (e.g., "20.11.0")
 * @returns Download URL for the Node.js archive
 */
function getDownloadUrl(version: string): string {
	const plat = platform();
	const architecture = arch();

	// Map Node.js architecture names
	const archMap: Record<string, string> = {
		x64: "x64",
		arm64: "arm64",
		arm: "armv7l",
	};

	const nodeArch = archMap[architecture] || architecture;

	// Determine file extension and format
	const isWindows = plat === "win32";
	const ext = isWindows ? "zip" : "tar.gz";
	const fileName = `node-v${version}-${plat}-${nodeArch}.${ext}`;

	return `https://nodejs.org/dist/v${version}/${fileName}`;
}

/**
 * Downloads and extracts Node.js to the tool cache
 *
 * @param version - Node.js version to install
 * @returns Path to the installed Node.js directory
 */
async function downloadNode(version: string): Promise<string> {
	const url = getDownloadUrl(version);

	core.info(`Downloading Node.js ${version} from ${url}`);

	try {
		// Download the archive
		const downloadPath = await tc.downloadTool(url);

		// Extract based on platform
		let extractedPath: string;
		if (platform() === "win32") {
			extractedPath = await tc.extractZip(downloadPath);
		} else {
			extractedPath = await tc.extractTar(downloadPath);
		}

		// Find the actual Node.js directory inside the extracted path
		// The tarball extracts to a directory like "node-vX.Y.Z-platform-arch"
		const extractedContents = readdirSync(extractedPath);
		const nodeDir = extractedContents.find((item) => item.startsWith("node-v"));

		if (!nodeDir) {
			throw new Error(`Could not find Node.js directory in extracted path: ${extractedPath}`);
		}

		const nodeFullPath = join(extractedPath, nodeDir);

		// Cache the extracted directory
		const cachedPath = await tc.cacheDir(nodeFullPath, "node", version);

		core.info(`Node.js ${version} cached at ${cachedPath}`);
		return cachedPath;
	} catch (error) {
		throw new Error(`Failed to download Node.js ${version}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Installs Node.js and adds it to PATH
 *
 * @param config - Node version configuration
 * @returns Installed Node.js version
 */
export async function installNode(config: NodeVersionConfig): Promise<string> {
	core.startGroup("📦 Installing Node.js");

	try {
		const { version } = config;

		// Check if already in tool cache
		let toolPath = tc.find("node", version);

		if (toolPath) {
			core.info(`✓ Found Node.js ${version} in tool cache: ${toolPath}`);
		} else {
			core.info(`Node.js ${version} not found in cache, downloading...`);
			toolPath = await downloadNode(version);
		}

		// Add to PATH
		if (platform() === "win32") {
			core.addPath(toolPath);
		} else {
			core.addPath(`${toolPath}/bin`);
		}

		// Verify installation
		await exec.exec("node", ["--version"]);
		await exec.exec("npm", ["--version"]);

		core.info(`✓ Node.js ${version} installed successfully`);
		core.endGroup();

		return version;
	} catch (error) {
		core.endGroup();
		throw new Error(`Failed to install Node.js: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Sets up package manager using corepack
 *
 * This function enables corepack and prepares the package manager specified in
 * package.json devEngines.packageManager. Corepack will automatically read the
 * configuration from package.json.
 *
 * @param packageManagerName - Package manager name for logging (pnpm or yarn)
 * @param packageManagerVersion - Package manager version for logging
 */
export async function setupPackageManager(packageManagerName: string, packageManagerVersion: string): Promise<void> {
	core.startGroup(`🔧 Setting up package manager via corepack`);

	try {
		// Enable corepack first
		core.info("Enabling corepack...");
		await exec.exec("corepack", ["enable"]);

		// Prepare package manager using explicit version from devEngines.packageManager
		core.info(`Preparing package manager ${packageManagerName}@${packageManagerVersion}...`);
		await exec.exec("corepack", ["prepare", `${packageManagerName}@${packageManagerVersion}`, "--activate"]);

		// Verify installation
		await exec.exec(packageManagerName, ["--version"]);

		core.info(`✓ Package manager ${packageManagerName}@${packageManagerVersion} set up successfully`);
		core.endGroup();
	} catch (error) {
		core.endGroup();
		throw new Error(`Failed to setup package manager: ${error instanceof Error ? error.message : String(error)}`);
	}
}
