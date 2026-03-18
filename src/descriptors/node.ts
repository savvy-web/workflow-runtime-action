/**
 * Node.js runtime descriptor.
 *
 * Downloads from https://nodejs.org/dist/v{version}/
 * Archive format: tar.gz on Unix, zip on Windows
 * postInstall: enables corepack for package manager versioning
 */

import { CommandRunner } from "@savvy-web/github-action-effects";
import { Effect } from "effect";
import { RuntimeInstallError } from "../errors.js";
import type { RuntimeDescriptor } from "../runtime-installer.js";

const extractReason = (error: unknown): string => {
	if (error && typeof error === "object") {
		const e = error as Record<string, unknown>;
		if (typeof e.reason === "string" && e.reason) return e.reason;
		if (typeof e.message === "string" && e.message) return e.message;
	}
	return String(error) || "Unknown error";
};

/**
 * Enables corepack and activates the specified package manager version.
 * Runs from a temp directory to avoid pnpm workspace config interference.
 *
 * For npm as package manager, installs the exact version globally instead.
 * For Node >= 25, installs corepack globally first (no longer bundled).
 */
const postInstall =
	(packageManagerName: string, packageManagerVersion: string) =>
	(_version: string, toolPath: string): Effect.Effect<void, RuntimeInstallError, CommandRunner> =>
		Effect.gen(function* () {
			const runner = yield* CommandRunner;

			// Use tmpdir for pnpm to avoid pnpm-workspace.yaml configDependencies interference
			// See: https://github.com/renovatebot/renovate/issues/39902
			// For npm/yarn this is unnecessary and can cause corepack shim issues
			const useTmpdir = packageManagerName === "pnpm";
			const execOpts = useTmpdir
				? { cwd: yield* Effect.sync(() => (require("node:os") as { tmpdir: () => string }).tmpdir()) }
				: {};

			// Check if corepack needs to be installed (Node >= 25)
			const nodeVersionOut = yield* runner.execCapture("node", ["--version"], execOpts);
			const versionMatch = nodeVersionOut.stdout.trim().match(/^v(\d+)\.\d+\.\d+$/);
			if (versionMatch) {
				const major = Number.parseInt(versionMatch[1], 10);
				if (major >= 25) {
					yield* Effect.log("Node.js >= 25 detected, installing corepack globally...");
					yield* runner.exec("npm", ["install", "-g", "--force", "corepack@latest"], execOpts);
				}
			}

			if (packageManagerName === "npm") {
				// npm is NOT managed by corepack -- install the exact version into the
				// tool-cached Node's prefix so it takes precedence on PATH.
				// toolPath comes from ToolInstaller.installAndAddToPath, e.g.:
				//   /opt/hostedtoolcache/node/24.9.0/x64/bin (with binSubPath)
				//   /opt/hostedtoolcache/node/24.9.0/x64 (without binSubPath)
				const { dirname, basename, join } = yield* Effect.sync(
					() =>
						require("node:path") as {
							dirname: (p: string) => string;
							basename: (p: string) => string;
							join: (...p: string[]) => string;
						},
				);
				const nodePrefix = basename(toolPath) === "bin" ? dirname(toolPath) : toolPath;
				const npmBin = join(toolPath, basename(toolPath) === "bin" ? "npm" : "bin/npm");

				const currentOut = yield* runner.execCapture(npmBin, ["--version"]);
				const currentVersion = currentOut.stdout.trim();
				if (currentVersion !== packageManagerVersion) {
					yield* Effect.log(`Upgrading npm from ${currentVersion} to ${packageManagerVersion}...`);
					yield* Effect.log(`Installing npm@${packageManagerVersion} into ${nodePrefix}...`);
					yield* runner.exec(npmBin, ["install", "-g", `--prefix=${nodePrefix}`, `npm@${packageManagerVersion}`]);
				} else {
					yield* Effect.log(`npm ${currentVersion} already matches required version`);
				}
			} else {
				// pnpm, yarn -- use corepack
				yield* Effect.log("Enabling corepack...");
				yield* runner.exec("corepack", ["enable"], execOpts);

				yield* Effect.log(`Preparing ${packageManagerName}@${packageManagerVersion}...`);
				yield* runner.exec(
					"corepack",
					["prepare", `${packageManagerName}@${packageManagerVersion}`, "--activate"],
					execOpts,
				);
			}

			// Verify
			yield* runner.exec(packageManagerName, ["--version"], execOpts);
			yield* Effect.log(`${packageManagerName}@${packageManagerVersion} activated`);
		}).pipe(
			Effect.catchAll((error) =>
				Effect.fail(
					new RuntimeInstallError({
						runtime: "node",
						version: _version,
						reason: `corepack setup failed: ${extractReason(error)}`,
						cause: error,
					}),
				),
			),
		);

export const descriptor: RuntimeDescriptor = {
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

	// postInstall is set dynamically in main.ts based on the devEngines.packageManager config
	// This is a placeholder — the real postInstall is created via createNodePostInstall()
};

/**
 * Creates a node descriptor with corepack postInstall for the given package manager.
 */
export const createNodeDescriptor = (pmName: string, pmVersion: string): RuntimeDescriptor => ({
	...descriptor,
	postInstall: postInstall(pmName, pmVersion),
});
