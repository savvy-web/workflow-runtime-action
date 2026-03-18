import type { ToolInstallOptions } from "@savvy-web/github-action-effects";
import { CommandRunner, ToolInstaller } from "@savvy-web/github-action-effects";
import { Context, Effect, Layer } from "effect";
import { descriptor as biomeDescriptor } from "./descriptors/biome.js";
import { descriptor as bunDescriptor } from "./descriptors/bun.js";
import { descriptor as denoDescriptor } from "./descriptors/deno.js";
import { createNodeDescriptor } from "./descriptors/node.js";
import { RuntimeInstallError } from "./errors.js";

/**
 * Extract a human-readable reason from an error.
 * Effect TaggedErrors have a `message` that may be empty and store data in custom fields.
 */
const extractErrorReason = (error: unknown): string => {
	if (error && typeof error === "object") {
		// Effect TaggedError: check for common fields
		const e = error as Record<string, unknown>;
		if (typeof e.reason === "string" && e.reason) return e.reason;
		if (typeof e.message === "string" && e.message) return e.message;
		if (typeof e._tag === "string") return `${e._tag}${e.reason ? `: ${e.reason}` : ""}`;
	}
	if (error instanceof Error && error.message) return error.message;
	const str = String(error);
	return str || "Unknown error";
};

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
 */
export const makeRuntimeInstaller = (descriptor: RuntimeDescriptor): RuntimeInstaller => ({
	install: (version) =>
		Effect.gen(function* () {
			const toolInstaller = yield* ToolInstaller;
			const runner = yield* CommandRunner;

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
						reason: extractErrorReason(error),
						cause: error,
					}),
				),
			),
		),
});

/**
 * Pre-built layers for runtimes that don't need dynamic config.
 */
export const BunInstallerLive = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(bunDescriptor));
export const DenoInstallerLive = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(denoDescriptor));
export const BiomeInstallerLive = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(biomeDescriptor));

/**
 * Creates a Node.js installer layer with corepack postInstall for the given package manager.
 */
export const makeNodeInstallerLive = (pmName: string, pmVersion: string): Layer.Layer<RuntimeInstaller> =>
	Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(createNodeDescriptor(pmName, pmVersion)));

/**
 * Returns the appropriate installer layer for the given runtime name.
 * Node requires package manager config for corepack setup.
 */
export const installerLayerFor = (
	name: string,
	pmConfig?: { name: string; version: string },
): Layer.Layer<RuntimeInstaller, RuntimeInstallError> => {
	switch (name) {
		case "node":
			return pmConfig
				? makeNodeInstallerLive(pmConfig.name, pmConfig.version)
				: Layer.fail(
						new RuntimeInstallError({
							runtime: "node",
							version: "unknown",
							reason: "Node installer requires package manager config for corepack setup",
						}),
					);
		case "bun":
			return BunInstallerLive;
		case "deno":
			return DenoInstallerLive;
		case "biome":
			return BiomeInstallerLive;
		default:
			return Layer.fail(
				new RuntimeInstallError({
					runtime: name,
					version: "unknown",
					reason: `Unknown runtime: ${name}`,
				}),
			);
	}
};
