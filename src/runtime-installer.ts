import type { CommandRunner, ToolInstallOptions, ToolInstaller } from "@savvy-web/github-action-effects";
import { CommandRunner as CommandRunnerTag, ToolInstaller as ToolInstallerTag } from "@savvy-web/github-action-effects";
import { Context, Effect, Layer } from "effect";
import { descriptor as biomeDescriptor } from "./descriptors/biome.js";
import { descriptor as bunDescriptor } from "./descriptors/bun.js";
import { descriptor as denoDescriptor } from "./descriptors/deno.js";
import { descriptor as nodeDescriptor } from "./descriptors/node.js";
import { RuntimeInstallError } from "./errors.js";

/**
 * Descriptor for a runtime or tool that can be installed.
 */
export interface RuntimeDescriptor {
	readonly name: string;
	readonly getDownloadUrl: (version: string, platform: string, arch: string) => string;
	readonly getToolInstallOptions: (version: string, platform: string, arch: string) => Partial<ToolInstallOptions>;
	readonly verifyCommand: readonly [string, ...string[]];
	readonly postInstall?: (version: string) => Effect.Effect<void, RuntimeInstallError, CommandRunner>;
}

/**
 * Result of a successful runtime installation.
 */
export interface InstalledRuntime {
	readonly name: string;
	readonly version: string;
	readonly path: string;
}

/**
 * Service interface for installing a specific runtime.
 */
export interface RuntimeInstaller {
	readonly install: (
		version: string,
	) => Effect.Effect<InstalledRuntime, RuntimeInstallError, ToolInstaller | CommandRunner>;
}

/**
 * Service tag for RuntimeInstaller.
 */
export const RuntimeInstaller = Context.GenericTag<RuntimeInstaller>("RuntimeInstaller");

/**
 * Factory: creates a RuntimeInstaller from a descriptor.
 *
 * The returned install function:
 * 1. Computes download URL from descriptor
 * 2. Calls ToolInstaller.installAndAddToPath(name, version, url, options)
 * 3. Runs CommandRunner.exec(verifyCommand[0], verifyCommand.slice(1))
 * 4. Runs descriptor.postInstall if defined
 * 5. Returns InstalledRuntime { name, version, path }
 * 6. Wraps ALL errors (ToolInstallerError, CommandRunnerError) in RuntimeInstallError
 */
export const makeRuntimeInstaller = (descriptor: RuntimeDescriptor): RuntimeInstaller => ({
	install: (version) =>
		Effect.gen(function* () {
			const toolInstaller = yield* ToolInstallerTag;
			const runner = yield* CommandRunnerTag;

			const url = descriptor.getDownloadUrl(version, process.platform, process.arch);
			const options = descriptor.getToolInstallOptions(version, process.platform, process.arch);

			const toolPath = yield* toolInstaller.installAndAddToPath(descriptor.name, version, url, options);
			yield* runner.exec(descriptor.verifyCommand[0], [...descriptor.verifyCommand.slice(1)]);

			if (descriptor.postInstall) {
				yield* descriptor.postInstall(version);
			}

			return { name: descriptor.name, version, path: toolPath } satisfies InstalledRuntime;
		}).pipe(
			Effect.catchAll((error) =>
				Effect.fail(
					new RuntimeInstallError({
						runtime: descriptor.name,
						version,
						reason: error instanceof Error ? error.message : String(error),
						cause: error,
					}),
				),
			),
		),
});

/**
 * Pre-built layers for each supported runtime.
 */
export const NodeInstallerLive = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(nodeDescriptor));
export const BunInstallerLive = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(bunDescriptor));
export const DenoInstallerLive = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(denoDescriptor));
export const BiomeInstallerLive = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(biomeDescriptor));

/**
 * Returns the appropriate installer layer for the given runtime name.
 */
export const installerLayerFor = (name: string): Layer.Layer<RuntimeInstaller> => {
	switch (name) {
		case "node":
			return NodeInstallerLive;
		case "bun":
			return BunInstallerLive;
		case "deno":
			return DenoInstallerLive;
		case "biome":
			return BiomeInstallerLive;
		default:
			throw new Error(`Unknown runtime: ${name}`);
	}
};
