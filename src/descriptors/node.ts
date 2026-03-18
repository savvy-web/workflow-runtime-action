/**
 * Node.js runtime descriptor.
 *
 * Downloads from https://nodejs.org/dist/v{version}/
 * Archive format: tar.gz on Unix, zip on Windows
 *
 * Package manager setup (corepack/npm) is handled separately in main.ts
 * after all runtimes are installed, matching the old imperative approach.
 */

export const descriptor = {
	name: "node",

	getDownloadUrl(version: string, platform: string, arch: string): string {
		const archMap: Record<string, string> = {
			x64: "x64",
			arm64: "arm64",
			arm: "armv7l",
		};
		const nodeArch = archMap[arch] ?? arch;
		const isWindows = platform === "win32";
		const platName = isWindows ? "win" : platform;
		const ext = isWindows ? "zip" : "tar.gz";
		const fileName = `node-v${version}-${platName}-${nodeArch}.${ext}`;
		return `https://nodejs.org/dist/v${version}/${fileName}`;
	},

	getToolInstallOptions(
		_version: string,
		platform: string,
		_arch: string,
	): { archiveType?: "tar.gz" | "tar.xz" | "zip"; binSubPath?: string } {
		const isWindows = platform === "win32";
		if (isWindows) {
			return { archiveType: "zip" };
		}
		return { archiveType: "tar.gz", binSubPath: "bin" };
	},

	verifyCommand: ["node", "--version"] as [string, ...string[]],
};
