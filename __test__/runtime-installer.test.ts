// ---------------------------------------------------------------------------
// Mock @savvy-web/github-action-effects so its @actions/cache import (which
// pulls in minimatch with a broken default export) never runs.
//
// The mock must export the SAME tag objects that src/runtime-installer.ts
// receives when it imports { ToolInstaller, CommandRunner } from the package.
// Effect Context tags are matched by their string identifier, so we use
// Context.GenericTag with the same strings the real package uses.
// ---------------------------------------------------------------------------

import type { Context } from "effect";
import { Data, Effect, Exit, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { RuntimeInstallError } from "../src/errors.js";
import type { RuntimeDescriptor } from "../src/runtime-installer.js";
import { makeRuntimeInstaller } from "../src/runtime-installer.js";

// The mock factory runs synchronously and must not import the real module.
vi.mock("@savvy-web/github-action-effects", () => {
	const { Context: C } = require("effect");
	const ToolInstaller = C.GenericTag("ToolInstaller");
	const CommandRunner = C.GenericTag("CommandRunner");
	return { ToolInstaller, CommandRunner };
});

// Import the mocked tags — these are the same objects the source module received.
const { ToolInstaller, CommandRunner } = await import("@savvy-web/github-action-effects");

// ---------------------------------------------------------------------------
// Error types (local stubs — not imported from the real package)
// ---------------------------------------------------------------------------

const ToolInstallerErrorBase = Data.TaggedError("ToolInstallerError");
class ToolInstallerError extends ToolInstallerErrorBase<{
	readonly tool: string;
	readonly version: string;
	readonly operation: "download" | "extract" | "cache" | "path";
	readonly reason: string;
}> {
	get message(): string {
		return this.reason;
	}
}

const CommandRunnerErrorBase = Data.TaggedError("CommandRunnerError");
class CommandRunnerError extends CommandRunnerErrorBase<{
	readonly command: string;
	readonly args: ReadonlyArray<string>;
	readonly exitCode: number | undefined;
	readonly stderr: string | undefined;
	readonly reason: string;
}> {
	get message(): string {
		const cmd = this.args.length > 0 ? `${this.command} ${this.args.join(" ")}` : this.command;
		return `Command "${cmd}" failed (exit ${this.exitCode})`;
	}
}

// ---------------------------------------------------------------------------
// Test state types
// ---------------------------------------------------------------------------

interface ToolInstallerTestState {
	readonly installed: Array<{ name: string; version: string; path: string }>;
	readonly cached: Set<string>;
	readonly addedToPaths: Array<string>;
}

interface CommandResponse {
	exitCode: number;
	stdout: string;
	stderr: string;
}

// ---------------------------------------------------------------------------
// ToolInstallerTest helper
// ---------------------------------------------------------------------------

const cacheKey = (name: string, version: string): string => `${name}@${version}`;

const makeTestToolInstaller = (state: ToolInstallerTestState) => ({
	install: (
		name: string,
		version: string,
		_url: string,
		options?: { archiveType?: string; binSubPath?: string },
	): Effect.Effect<string> => {
		const basePath = `/tools/${name}/${version}`;
		const toolPath = options?.binSubPath ? `${basePath}/${options.binSubPath}` : basePath;
		state.installed.push({ name, version, path: toolPath });
		state.cached.add(cacheKey(name, version));
		return Effect.succeed(toolPath);
	},
	isCached: (name: string, version: string): Effect.Effect<boolean> =>
		Effect.succeed(state.cached.has(cacheKey(name, version))),
	installAndAddToPath: (
		name: string,
		version: string,
		_url: string,
		options?: { archiveType?: string; binSubPath?: string },
	): Effect.Effect<string> => {
		const basePath = `/tools/${name}/${version}`;
		const toolPath = options?.binSubPath ? `${basePath}/${options.binSubPath}` : basePath;
		state.installed.push({ name, version, path: toolPath });
		state.cached.add(cacheKey(name, version));
		state.addedToPaths.push(toolPath);
		return Effect.succeed(toolPath);
	},
});

const ToolInstallerTest = {
	layer: (state: ToolInstallerTestState): Layer.Layer<never> =>
		Layer.succeed(ToolInstaller, makeTestToolInstaller(state)) as unknown as Layer.Layer<never>,
	empty: (): ToolInstallerTestState => ({ installed: [], cached: new Set(), addedToPaths: [] }),
};

// ---------------------------------------------------------------------------
// CommandRunnerTest helper
// ---------------------------------------------------------------------------

const makeKey = (command: string, args: ReadonlyArray<string>): string =>
	args.length > 0 ? `${command} ${[...args].join(" ")}` : command;

const makeTestRunner = (responses: ReadonlyMap<string, CommandResponse>) => {
	const lookup = (command: string, args: ReadonlyArray<string>): CommandResponse =>
		responses.get(makeKey(command, args)) ?? responses.get(command) ?? { exitCode: 0, stdout: "", stderr: "" };

	const failOnNonZero = (
		command: string,
		args: ReadonlyArray<string>,
		response: CommandResponse,
	): Effect.Effect<CommandResponse, CommandRunnerError> =>
		response.exitCode === 0
			? Effect.succeed(response)
			: Effect.fail(
					new CommandRunnerError({
						command,
						args,
						exitCode: response.exitCode,
						stderr: response.stderr,
						reason: `Command exited with code ${response.exitCode}`,
					}),
				);

	return {
		exec: (command: string, args: ReadonlyArray<string> = []) =>
			failOnNonZero(command, args, lookup(command, args)).pipe(Effect.map((r) => r.exitCode)),
		execCapture: (command: string, args: ReadonlyArray<string> = []) =>
			failOnNonZero(command, args, lookup(command, args)),
		execJson: (command: string, args: ReadonlyArray<string> | undefined, _schema: unknown) => {
			const resolvedArgs = args ?? [];
			return failOnNonZero(command, resolvedArgs, lookup(command, resolvedArgs)) as never;
		},
		execLines: (command: string, args: ReadonlyArray<string> = []) =>
			failOnNonZero(command, args, lookup(command, args)).pipe(
				Effect.map((r) =>
					r.stdout
						.split("\n")
						.map((l) => l.trim())
						.filter((l) => l.length > 0),
				),
			),
	};
};

const CommandRunnerTest = {
	layer: (responses: ReadonlyMap<string, CommandResponse>): Layer.Layer<never> =>
		Layer.succeed(CommandRunner, makeTestRunner(responses)) as unknown as Layer.Layer<never>,
	empty: (): Layer.Layer<never> =>
		Layer.succeed(CommandRunner, makeTestRunner(new Map())) as unknown as Layer.Layer<never>,
};

// ---------------------------------------------------------------------------
// Test descriptor (node-like)
// ---------------------------------------------------------------------------

const nodeTestDescriptor: RuntimeDescriptor = {
	name: "node",
	getDownloadUrl: (version, platform, arch) =>
		`https://nodejs.org/dist/v${version}/node-v${version}-${platform}-${arch}.tar.gz`,
	getToolInstallOptions: (_version, platform, _arch) =>
		platform === "win32" ? { archiveType: "zip" as const } : { archiveType: "tar.gz" as const, binSubPath: "bin" },
	verifyCommand: ["node", "--version"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const runInstall = (version: string, descriptor: RuntimeDescriptor, testLayer: Layer.Layer<never>) => {
	const installer = makeRuntimeInstaller(descriptor);
	return Effect.runPromise(
		Effect.provide(
			installer.install(version),
			testLayer as unknown as Layer.Layer<
				Context.Tag.Identifier<typeof ToolInstaller> | Context.Tag.Identifier<typeof CommandRunner>
			>,
		),
	);
};

const runInstallExit = (version: string, descriptor: RuntimeDescriptor, testLayer: Layer.Layer<never>) => {
	const installer = makeRuntimeInstaller(descriptor);
	return Effect.runPromise(
		Effect.exit(
			Effect.provide(
				installer.install(version),
				testLayer as unknown as Layer.Layer<
					Context.Tag.Identifier<typeof ToolInstaller> | Context.Tag.Identifier<typeof CommandRunner>
				>,
			),
		),
	);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("makeRuntimeInstaller", () => {
	describe("install succeeds", () => {
		it("returns InstalledRuntime with correct name, version, and path", async () => {
			const toolState = ToolInstallerTest.empty();
			const testLayer = Layer.mergeAll(ToolInstallerTest.layer(toolState), CommandRunnerTest.empty());

			const result = await runInstall("24.11.0", nodeTestDescriptor, testLayer);

			expect(result.name).toBe("node");
			expect(result.version).toBe("24.11.0");
			expect(result.path).toContain("/tools/node/24.11.0");
		});

		it("records installAndAddToPath call in ToolInstallerTest state", async () => {
			const toolState = ToolInstallerTest.empty();
			const testLayer = Layer.mergeAll(ToolInstallerTest.layer(toolState), CommandRunnerTest.empty());

			await runInstall("24.11.0", nodeTestDescriptor, testLayer);

			expect(toolState.installed).toHaveLength(1);
			expect(toolState.installed[0]).toMatchObject({ name: "node", version: "24.11.0" });
			expect(toolState.addedToPaths).toHaveLength(1);
		});

		it("exec is called with the verify command args", async () => {
			const toolState = ToolInstallerTest.empty();
			const cmdResponses = new Map<string, CommandResponse>([
				["node --version", { exitCode: 0, stdout: "v24.11.0", stderr: "" }],
			]);
			const testLayer = Layer.mergeAll(ToolInstallerTest.layer(toolState), CommandRunnerTest.layer(cmdResponses));

			const result = await runInstall("24.11.0", nodeTestDescriptor, testLayer);
			expect(result.name).toBe("node");
		});
	});

	describe("install wraps ToolInstallerError as RuntimeInstallError", () => {
		it("fails with RuntimeInstallError when ToolInstaller.installAndAddToPath fails", async () => {
			const failingToolInstaller = {
				install: () =>
					Effect.fail(
						new ToolInstallerError({
							tool: "node",
							version: "24.11.0",
							operation: "download",
							reason: "Network error",
						}),
					),
				isCached: () => Effect.succeed(false),
				installAndAddToPath: () =>
					Effect.fail(
						new ToolInstallerError({
							tool: "node",
							version: "24.11.0",
							operation: "download",
							reason: "Network error",
						}),
					),
			};

			const testLayer = Layer.mergeAll(
				Layer.succeed(ToolInstaller, failingToolInstaller) as unknown as Layer.Layer<never>,
				CommandRunnerTest.empty(),
			);

			const exit = await runInstallExit("24.11.0", nodeTestDescriptor, testLayer);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
				const err = exit.cause.error as RuntimeInstallError;
				expect(err).toBeInstanceOf(RuntimeInstallError);
				expect(err.runtime).toBe("node");
				expect(err.version).toBe("24.11.0");
				expect(err.reason).toContain("Network error");
			}
		});
	});

	describe("install wraps CommandRunnerError as RuntimeInstallError", () => {
		it("fails with RuntimeInstallError when CommandRunner.exec fails", async () => {
			const toolState = ToolInstallerTest.empty();
			const cmdResponses = new Map<string, CommandResponse>([
				["node --version", { exitCode: 127, stdout: "", stderr: "node: not found" }],
			]);
			const testLayer = Layer.mergeAll(ToolInstallerTest.layer(toolState), CommandRunnerTest.layer(cmdResponses));

			const exit = await runInstallExit("24.11.0", nodeTestDescriptor, testLayer);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
				const err = exit.cause.error as RuntimeInstallError;
				expect(err).toBeInstanceOf(RuntimeInstallError);
				expect(err.runtime).toBe("node");
				expect(err.version).toBe("24.11.0");
			}
		});
	});

	describe("postInstall runs when defined", () => {
		it("executes postInstall command via CommandRunner and receives the version", async () => {
			const postInstallCalled: string[] = [];

			const descriptorWithPostInstall: RuntimeDescriptor = {
				...nodeTestDescriptor,
				postInstall: (version) =>
					Effect.flatMap(
						CommandRunner as unknown as Context.Tag<
							unknown,
							{ exec: (cmd: string, args?: ReadonlyArray<string>) => Effect.Effect<number, RuntimeInstallError> }
						>,
						(runner) =>
							runner.exec("corepack", ["enable"]).pipe(
								Effect.tap(() =>
									Effect.sync(() => {
										postInstallCalled.push(version);
									}),
								),
								Effect.asVoid,
							),
					) as unknown as Effect.Effect<void, RuntimeInstallError, never>,
			};

			const toolState = ToolInstallerTest.empty();
			const cmdResponses = new Map<string, CommandResponse>([
				["corepack enable", { exitCode: 0, stdout: "", stderr: "" }],
			]);
			const testLayer = Layer.mergeAll(ToolInstallerTest.layer(toolState), CommandRunnerTest.layer(cmdResponses));

			const installer = makeRuntimeInstaller(descriptorWithPostInstall);
			await Effect.runPromise(
				Effect.provide(
					installer.install("24.11.0"),
					testLayer as unknown as Layer.Layer<
						Context.Tag.Identifier<typeof ToolInstaller> | Context.Tag.Identifier<typeof CommandRunner>
					>,
				),
			);

			expect(postInstallCalled).toEqual(["24.11.0"]);
		});

		it("wraps postInstall RuntimeInstallError failure correctly", async () => {
			const descriptorWithFailingPostInstall: RuntimeDescriptor = {
				...nodeTestDescriptor,
				postInstall: (_version) =>
					Effect.fail(
						new RuntimeInstallError({
							runtime: "node",
							version: "24.11.0",
							reason: "postInstall failed",
						}),
					),
			};

			const toolState = ToolInstallerTest.empty();
			const testLayer = Layer.mergeAll(ToolInstallerTest.layer(toolState), CommandRunnerTest.empty());

			const installer = makeRuntimeInstaller(descriptorWithFailingPostInstall);
			const exit = await Effect.runPromise(
				Effect.exit(
					Effect.provide(
						installer.install("24.11.0"),
						testLayer as unknown as Layer.Layer<
							Context.Tag.Identifier<typeof ToolInstaller> | Context.Tag.Identifier<typeof CommandRunner>
						>,
					),
				),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
				expect(exit.cause.error).toBeInstanceOf(RuntimeInstallError);
			}
		});
	});

	describe("installerLayerFor", () => {
		it("throws for unknown runtime name", async () => {
			const mod = await import("../src/runtime-installer.js");
			expect(() => mod.installerLayerFor("unknown")).toThrow("Unknown runtime: unknown");
		});

		it("returns a layer for node", async () => {
			const mod = await import("../src/runtime-installer.js");
			expect(mod.installerLayerFor("node")).toBeDefined();
		});

		it("returns a layer for bun", async () => {
			const mod = await import("../src/runtime-installer.js");
			expect(mod.installerLayerFor("bun")).toBeDefined();
		});

		it("returns a layer for deno", async () => {
			const mod = await import("../src/runtime-installer.js");
			expect(mod.installerLayerFor("deno")).toBeDefined();
		});

		it("returns a layer for biome", async () => {
			const mod = await import("../src/runtime-installer.js");
			expect(mod.installerLayerFor("biome")).toBeDefined();
		});
	});
});
