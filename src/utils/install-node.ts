import { readdirSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { formatDetection, formatInstallation, formatRuntime, formatSetup, formatSuccess } from "./emoji.js";
import { wrapError } from "./error.js";

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
	// Node.js uses "win" in filenames, not "win32"
	const platName = isWindows ? "win" : plat;
	const fileName = `node-v${version}-${platName}-${nodeArch}.${ext}`;

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
		throw wrapError(`Failed to download Node.js ${version}`, error);
	}
}

/**
 * Installs Node.js and adds it to PATH
 *
 * @param config - Node version configuration
 * @returns Installed Node.js version
 */
export async function installNode(config: NodeVersionConfig): Promise<string> {
	core.startGroup(formatInstallation(formatRuntime("node")));

	try {
		const { version } = config;

		// Check if already in tool cache
		let toolPath = tc.find("node", version);

		if (toolPath) {
			core.info(formatDetection(`Node.js ${version} in tool cache: ${toolPath}`, true));
		} else {
			core.info(formatDetection(`Node.js ${version} in cache`, false));
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

		core.info(formatSuccess(`Node.js ${version} installed successfully`));
		core.endGroup();

		return version;
	} catch (error) {
		core.endGroup();
		throw wrapError("Failed to install Node.js", error);
	}
}

/**
 * Sets up npm to a specific version
 *
 * Node.js comes with a bundled npm version, but we may need a different version
 * as specified in devEngines.packageManager. This function installs the correct
 * npm version globally.
 *
 * @param npmVersion - npm version to install (e.g., "10.0.0")
 */
export async function setupNpm(npmVersion: string): Promise<void> {
	core.startGroup(formatSetup(`npm@${npmVersion}`));

	try {
		// Get current npm version
		let currentVersion = "";
		await exec.exec("npm", ["--version"], {
			listeners: {
				stdout: (data: Buffer) => {
					currentVersion += data.toString().trim();
				},
			},
		});

		core.info(`Current npm version: ${currentVersion}`);
		core.info(`Required npm version: ${npmVersion}`);

		// Only install if version doesn't match
		if (currentVersion !== npmVersion) {
			core.info(`Installing npm@${npmVersion}...`);
			// Use sudo on Linux/macOS for global npm install to avoid permission issues
			const plat = platform();
			if (plat === "linux" || plat === "darwin") {
				await exec.exec("sudo", ["npm", "install", "-g", `npm@${npmVersion}`]);
			} else {
				await exec.exec("npm", ["install", "-g", `npm@${npmVersion}`]);
			}

			// Verify installation
			let installedVersion = "";
			await exec.exec("npm", ["--version"], {
				listeners: {
					stdout: (data: Buffer) => {
						installedVersion += data.toString().trim();
					},
				},
			});

			core.info(formatSuccess(`npm@${installedVersion} installed successfully`));
		} else {
			core.info(formatSuccess(`npm version ${currentVersion} already matches required version`));
		}

		core.endGroup();
	} catch (error) {
		core.endGroup();
		throw wrapError("Failed to setup npm", error);
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
	core.startGroup(formatSetup(`${packageManagerName} via corepack`));

	try {
		// Check Node.js version - corepack is not bundled with Node.js >= 25.0.0
		let nodeVersion = "";
		await exec.exec("node", ["--version"], {
			listeners: {
				stdout: (data: Buffer) => {
					nodeVersion += data.toString().trim();
				},
			},
		});

		// Parse version (format: v25.0.0 -> [25, 0, 0])
		const versionMatch = nodeVersion.match(/^v(\d+)\.\d+\.\d+$/);
		if (versionMatch) {
			const majorVersion = Number.parseInt(versionMatch[1], 10);

			if (majorVersion >= 25) {
				core.info(`Node.js ${nodeVersion} detected - corepack not bundled, installing globally...`);
				await exec.exec("npm", ["install", "-g", "corepack@latest"]);
				core.info(formatSuccess("corepack installed successfully"));
			}
		}

		// Enable corepack first
		core.info("Enabling corepack...");
		await exec.exec("corepack", ["enable"]);

		// Prepare package manager using explicit version from devEngines.packageManager
		core.info(`Preparing package manager ${packageManagerName}@${packageManagerVersion}...`);
		await exec.exec("corepack", ["prepare", `${packageManagerName}@${packageManagerVersion}`, "--activate"]);

		// Verify installation
		await exec.exec(packageManagerName, ["--version"]);

		core.info(formatSuccess(`Package manager ${packageManagerName}@${packageManagerVersion} set up successfully`));
		core.endGroup();
	} catch (error) {
		core.endGroup();
		throw wrapError("Failed to setup package manager", error);
	}
}
