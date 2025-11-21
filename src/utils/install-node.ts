import { readFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";

/**
 * Node.js version configuration
 */
interface NodeVersionConfig {
	/** Node.js version string (e.g., "20.11.0") or empty if using version file */
	version: string;
	/** Path to version file (.nvmrc or .node-version) or empty */
	versionFile: string;
}

/**
 * Reads Node.js version from a version file
 *
 * @param file - Path to version file (.nvmrc or .node-version)
 * @returns Version string from the file
 */
async function readVersionFile(file: string): Promise<string> {
	const content = await readFile(file, "utf-8");
	// Trim whitespace and remove common prefixes
	return content
		.trim()
		.replace(/^v/, "") // Remove leading 'v'
		.split("\n")[0]; // Take first line only
}

/**
 * Queries nodejs.org/dist/index.json to resolve version specs
 *
 * @param spec - Version spec (e.g., "lts/*", "20.x", "latest")
 * @returns Resolved version number (e.g., "20.19.5")
 */
async function queryNodeVersion(spec: string): Promise<string> {
	const http = await import("@actions/http-client");
	const client = new http.HttpClient("workflow-runtime-action");

	try {
		const response = await client.get("https://nodejs.org/dist/index.json");
		const body = await response.readBody();
		const versions = JSON.parse(body) as Array<{ version: string; lts: string | boolean }>;

		// Handle lts/*
		if (spec === "lts/*" || spec.toLowerCase() === "lts") {
			const ltsVersion = versions.find((v) => v.lts && typeof v.lts === "string");
			if (!ltsVersion) throw new Error("Could not find LTS version");
			return ltsVersion.version.replace(/^v/, "");
		}

		// Handle version ranges like "20.x" or "20"
		if (spec.includes(".x") || !spec.includes(".")) {
			const major = spec.split(".")[0];
			const matchingVersion = versions.find((v) => v.version.startsWith(`v${major}.`));
			if (!matchingVersion) throw new Error(`Could not find version matching ${spec}`);
			return matchingVersion.version.replace(/^v/, "");
		}

		// Exact version
		return spec.replace(/^v/, "");
	} catch (error) {
		throw new Error(`Failed to query Node.js versions: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Resolves Node.js version from input or version file
 *
 * @param version - Explicit version from input (e.g., "20.11.0", "lts/*")
 * @param versionFile - Path to version file
 * @returns Resolved version string
 */
async function resolveNodeVersion(version: string, versionFile: string): Promise<string> {
	if (versionFile) {
		core.info(`Reading Node.js version from ${versionFile}`);
		const fileVersion = await readVersionFile(versionFile);
		// Version from file might also be "lts/*" or similar
		if (fileVersion.includes("*") || fileVersion.includes(".x") || fileVersion.toLowerCase() === "lts") {
			return await queryNodeVersion(fileVersion);
		}
		return fileVersion;
	}

	if (version) {
		core.info(`Using Node.js version from input: ${version}`);
		// Resolve version specs
		if (version.includes("*") || version.includes(".x") || version.toLowerCase().startsWith("lts")) {
			return await queryNodeVersion(version);
		}
		return version;
	}

	// Default to LTS
	core.info("No version specified, defaulting to lts/*");
	return await queryNodeVersion("lts/*");
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
		const { readdirSync } = await import("node:fs");
		const { join } = await import("node:path");
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
		// Resolve version
		const versionSpec = await resolveNodeVersion(config.version, config.versionFile);

		// Check if already in tool cache
		let toolPath = tc.find("node", versionSpec);

		if (toolPath) {
			core.info(`✓ Found Node.js ${versionSpec} in tool cache: ${toolPath}`);
		} else {
			// Resolve exact version if using version spec (lts/*, 20.x, etc.)
			const exactVersion = versionSpec;

			// If version spec is lts/* or contains wildcards, we need to resolve it
			// For now, we'll use the spec as-is and let the download fail if needed
			// A production implementation would query nodejs.org/dist/index.json

			core.info(`Node.js ${exactVersion} not found in cache, downloading...`);
			toolPath = await downloadNode(exactVersion);
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

		core.info(`✓ Node.js ${versionSpec} installed successfully`);
		core.endGroup();

		return versionSpec;
	} catch (error) {
		core.endGroup();
		throw new Error(`Failed to install Node.js: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Sets up package manager using corepack
 *
 * @param packageManager - Package manager to enable (pnpm or yarn)
 */
export async function setupPackageManager(packageManager: "pnpm" | "yarn"): Promise<void> {
	core.startGroup(`🔧 Setting up ${packageManager}`);

	try {
		// Enable corepack first
		core.info("Enabling corepack...");
		await exec.exec("corepack", ["enable"]);

		// For pnpm, prepare latest version
		// For yarn, let corepack use the version from package.json or default
		if (packageManager === "pnpm") {
			core.info("Preparing pnpm...");
			await exec.exec("corepack", ["prepare", "pnpm@latest", "--activate"]);
		} else {
			// For yarn, just enable it - corepack will handle the version
			core.info("Preparing yarn...");
			await exec.exec("corepack", ["prepare", "yarn@stable", "--activate"]);
		}

		// Verify installation
		await exec.exec(packageManager, ["--version"]);

		core.info(`✓ ${packageManager} set up successfully`);
		core.endGroup();
	} catch (error) {
		core.endGroup();
		throw new Error(`Failed to setup ${packageManager}: ${error instanceof Error ? error.message : String(error)}`);
	}
}
