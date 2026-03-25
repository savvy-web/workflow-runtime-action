/**
 * Bun runtime descriptor.
 *
 * Downloads from https://github.com/oven-sh/bun/releases/download/bun-v{version}/
 * Archive format: always zip
 * Arch mapping: arm64 -> aarch64
 * Platform mapping: win32 -> windows (in archive name)
 */

/** Resolve Bun's arch string — arm64 becomes aarch64, Windows always x64. */
const resolveBunArch = (platform: string, arch: string): string => {
	if (platform === "win32") return "x64";
	return arch === "arm64" ? "aarch64" : arch;
};

export const descriptor = {
	name: "bun",

	getDownloadUrl(version: string, platform: string, arch: string): string {
		const bunArch = resolveBunArch(platform, arch);
		const bunPlatform = platform === "win32" ? "windows" : platform;
		return `https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-${bunPlatform}-${bunArch}.zip`;
	},

	getToolInstallOptions(
		_version: string,
		platform: string,
		arch: string,
	): { archiveType?: "tar.gz" | "tar.xz" | "zip"; binSubPath?: string } {
		const bunArch = resolveBunArch(platform, arch);
		const bunPlatform = platform === "win32" ? "windows" : platform;
		return { archiveType: "zip", binSubPath: `bun-${bunPlatform}-${bunArch}` };
	},

	verifyCommand: ["bun", "--version"] as [string, ...string[]],
};
