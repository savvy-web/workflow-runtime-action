/**
 * Bun runtime descriptor.
 *
 * Downloads from https://github.com/oven-sh/bun/releases/download/bun-v{version}/
 * Archive format: always zip
 * Arch mapping: arm64 -> aarch64
 * Platform mapping: win32 -> windows (in archive name)
 */

export const descriptor = {
	name: "bun",

	getDownloadUrl(version: string, platform: string, arch: string): string {
		// Bun uses "aarch64" for ARM64, not "arm64"
		const archMap: Record<string, string> = {
			x64: "x64",
			arm64: "aarch64",
		};
		const bunArch = archMap[arch] ?? arch;

		// Platform-specific archive names
		// Bun does not officially support Windows ARM64 yet.
		// Always use x64 on Windows regardless of arch.
		let archiveName: string;
		if (platform === "win32") {
			archiveName = "bun-windows-x64.zip";
		} else if (platform === "darwin") {
			archiveName = `bun-darwin-${bunArch}.zip`;
		} else {
			// linux
			archiveName = `bun-linux-${bunArch}.zip`;
		}

		return `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${archiveName}`;
	},

	getToolInstallOptions(
		_version: string,
		platform: string,
		arch: string,
	): { archiveType?: "tar.gz" | "tar.xz" | "zip"; binSubPath?: string } {
		// Bun zip extracts to bun-{platform}-{arch}/ containing the binary
		const bunPlatform = platform === "win32" ? "windows" : platform;
		// Bun does not officially support Windows ARM64 yet.
		// Always use x64 on Windows regardless of arch (mirrors getDownloadUrl behaviour).
		const effectiveArch = platform === "win32" ? "x64" : arch;
		const bunArch = effectiveArch === "arm64" ? "aarch64" : effectiveArch;
		return { archiveType: "zip", binSubPath: `bun-${bunPlatform}-${bunArch}` };
	},

	verifyCommand: ["bun", "--version"] as [string, ...string[]],
};
