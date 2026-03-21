/**
 * Deno runtime descriptor.
 *
 * Downloads from https://github.com/denoland/deno/releases/download/v{version}/
 * Archive format: always zip
 * Uses Rust target triples for platform/arch identification
 */

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

export const descriptor = {
	name: "deno",

	getDownloadUrl(version: string, platform: string, arch: string): string {
		const target = targetMap[platform]?.[arch];
		if (!target) {
			throw new Error(`Unsupported platform for Deno: ${platform}-${arch}`);
		}

		const archiveName = `deno-${target}.zip`;
		return `https://github.com/denoland/deno/releases/download/v${version}/${archiveName}`;
	},

	getToolInstallOptions(
		_version: string,
		_platform: string,
		_arch: string,
	): { archiveType?: "tar.gz" | "tar.xz" | "zip"; binSubPath?: string } {
		return { archiveType: "zip" };
	},

	verifyCommand: ["deno", "--version"] as [string, ...string[]],
};
