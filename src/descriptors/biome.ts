/**
 * Biome CLI descriptor.
 *
 * Downloads from https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%40{version}/
 * Single binary download (NOT an archive) -- no archiveType needed
 * URL uses URL-encoded @ characters: %40biomejs%2Fbiome%40{version}
 */

export const binaryMap: Record<string, Record<string, string>> = {
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

export const descriptor = {
	name: "biome",

	getDownloadUrl(version: string, platform: string, arch: string): string {
		const binaryName = binaryMap[platform]?.[arch];
		if (!binaryName) {
			throw new Error(`Unsupported platform for Biome: ${platform}-${arch}`);
		}

		return `https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%40${version}/${binaryName}`;
	},

	getToolInstallOptions(
		_version: string,
		_platform: string,
		_arch: string,
	): { archiveType?: "tar.gz" | "tar.xz" | "zip"; binSubPath?: string } {
		// Biome is a raw binary, not an archive
		return {};
	},

	verifyCommand: ["biome", "--version"] as [string, ...string[]],
};
