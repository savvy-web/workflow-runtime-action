/**
 * Biome CLI binary name map.
 *
 * Biome is a single binary download (not an archive), so it doesn't use
 * the RuntimeInstaller pattern. This map is imported by installBiome()
 * in main.ts to construct the download URL.
 *
 * URL format: https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%40{version}/{binaryName}
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
