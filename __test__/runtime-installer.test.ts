import { ActionOutputs, CommandRunner, ToolInstaller } from "@savvy-web/github-action-effects";
import type { Context } from "effect";
import { Data, Effect, Exit, Layer, Logger, Option } from "effect";
import { describe, expect, it } from "vitest";
import { RuntimeInstallError } from "../src/errors.js";
import type { RuntimeDescriptor } from "../src/runtime-installer.js";
import { makeRuntimeInstaller } from "../src/runtime-installer.js";

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
// ToolInstallerTest helper — matches new 0.11.0 primitives API
// ---------------------------------------------------------------------------

const makeTestToolInstaller = (state: ToolInstallerTestState) => ({
	find: (_tool: string, _version: string) => Effect.succeed(Option.none<string>()),
	download: (_url: string) => Effect.succeed("/tmp/downloaded-file"),
	extractTar: (_file: string) => Effect.succeed("/tmp/extracted"),
	extractZip: (_file: string) => Effect.succeed("/tmp/extracted"),
	cacheDir: (_sourceDir: string, tool: string, version: string) => {
		const toolPath = `/tools/${tool}/${version}`;
		state.installed.push({ name: tool, version, path: toolPath });
		state.cached.add(`${tool}@${version}`);
		return Effect.succeed(toolPath);
	},
	cacheFile: (_sourceFile: string, _targetFile: string, tool: string, version: string) => {
		const toolPath = `/tools/${tool}/${version}`;
		state.installed.push({ name: tool, version, path: toolPath });
		state.cached.add(`${tool}@${version}`);
		return Effect.succeed(toolPath);
	},
});

const ToolInstallerTest = {
	layer: (state: ToolInstallerTestState) =>
		Layer.succeed(ToolInstaller, makeTestToolInstaller(state) as unknown as Context.Tag.Service<typeof ToolInstaller>),
	empty: (): ToolInstallerTestState => ({ installed: [], cached: new Set(), addedToPaths: [] }),
};

// ---------------------------------------------------------------------------
// ActionOutputsTest helper — tracks addPath calls
// ---------------------------------------------------------------------------

const makeTestOutputs = (state: ToolInstallerTestState) => ({
	set: () => Effect.void,
	setJson: () => Effect.void,
	summary: () => Effect.void,
	exportVariable: () => Effect.void,
	addPath: (path: string) => {
		state.addedToPaths.push(path);
		return Effect.void;
	},
	setFailed: () => Effect.void,
	setSecret: () => Effect.void,
});

const makeOutputsLayer = (state: ToolInstallerTestState) =>
	Layer.succeed(ActionOutputs, makeTestOutputs(state) as unknown as Context.Tag.Service<typeof ActionOutputs>);

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
	layer: (responses: ReadonlyMap<string, CommandResponse>) =>
		Layer.succeed(CommandRunner, makeTestRunner(responses) as unknown as Context.Tag.Service<typeof CommandRunner>),
	empty: () =>
		Layer.succeed(CommandRunner, makeTestRunner(new Map()) as unknown as Context.Tag.Service<typeof CommandRunner>),
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
		installer
			.install(version)
			.pipe(
				Effect.provide(
					testLayer as unknown as Layer.Layer<
						| Context.Tag.Identifier<typeof ToolInstaller>
						| Context.Tag.Identifier<typeof CommandRunner>
						| Context.Tag.Identifier<typeof ActionOutputs>
					>,
				),
				Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none)),
			),
	);
};

const runInstallExit = (version: string, descriptor: RuntimeDescriptor, testLayer: Layer.Layer<never>) => {
	const installer = makeRuntimeInstaller(descriptor);
	return Effect.runPromise(
		Effect.exit(
			installer
				.install(version)
				.pipe(
					Effect.provide(
						testLayer as unknown as Layer.Layer<
							| Context.Tag.Identifier<typeof ToolInstaller>
							| Context.Tag.Identifier<typeof CommandRunner>
							| Context.Tag.Identifier<typeof ActionOutputs>
						>,
					),
					Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none)),
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
			const testLayer = Layer.mergeAll(
				ToolInstallerTest.layer(toolState),
				CommandRunnerTest.empty(),
				makeOutputsLayer(toolState),
			);

			const result = await runInstall("24.11.0", nodeTestDescriptor, testLayer as Layer.Layer<never>);

			expect(result.name).toBe("node");
			expect(result.version).toBe("24.11.0");
			expect(result.path).toContain("/tools/node/24.11.0");
		});

		it("records cacheDir call and addPath in test state", async () => {
			const toolState = ToolInstallerTest.empty();
			const testLayer = Layer.mergeAll(
				ToolInstallerTest.layer(toolState),
				CommandRunnerTest.empty(),
				makeOutputsLayer(toolState),
			);

			await runInstall("24.11.0", nodeTestDescriptor, testLayer as Layer.Layer<never>);

			expect(toolState.installed).toHaveLength(1);
			expect(toolState.installed[0]).toMatchObject({ name: "node", version: "24.11.0" });
			expect(toolState.addedToPaths).toHaveLength(1);
		});

		it("exec is called with the verify command args", async () => {
			const toolState = ToolInstallerTest.empty();
			const cmdResponses = new Map<string, CommandResponse>([
				["node --version", { exitCode: 0, stdout: "v24.11.0", stderr: "" }],
			]);
			const testLayer = Layer.mergeAll(
				ToolInstallerTest.layer(toolState),
				CommandRunnerTest.layer(cmdResponses),
				makeOutputsLayer(toolState),
			);

			const result = await runInstall("24.11.0", nodeTestDescriptor, testLayer as Layer.Layer<never>);
			expect(result.name).toBe("node");
		});
	});

	describe("install wraps ToolInstallerError as RuntimeInstallError", () => {
		it("fails with RuntimeInstallError when ToolInstaller.download fails", async () => {
			const toolState = ToolInstallerTest.empty();
			const failingToolInstaller = {
				find: () => Effect.succeed(Option.none()),
				download: () =>
					Effect.fail(
						new ToolInstallerError({
							tool: "node",
							version: "24.11.0",
							operation: "download",
							reason: "Network error",
						}),
					),
				extractTar: () => Effect.succeed("/tmp/extracted"),
				extractZip: () => Effect.succeed("/tmp/extracted"),
				cacheDir: () => Effect.succeed("/tools/node/24.11.0"),
				cacheFile: () => Effect.succeed("/tools/node/24.11.0"),
			};

			const testLayer = Layer.mergeAll(
				Layer.succeed(ToolInstaller, failingToolInstaller as unknown as Context.Tag.Service<typeof ToolInstaller>),
				CommandRunnerTest.empty(),
				makeOutputsLayer(toolState),
			);

			const exit = await runInstallExit("24.11.0", nodeTestDescriptor, testLayer as Layer.Layer<never>);

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
			const testLayer = Layer.mergeAll(
				ToolInstallerTest.layer(toolState),
				CommandRunnerTest.layer(cmdResponses),
				makeOutputsLayer(toolState),
			);

			const exit = await runInstallExit("24.11.0", nodeTestDescriptor, testLayer as Layer.Layer<never>);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
				const err = exit.cause.error as RuntimeInstallError;
				expect(err).toBeInstanceOf(RuntimeInstallError);
				expect(err.runtime).toBe("node");
				expect(err.version).toBe("24.11.0");
			}
		});
	});

	describe("installerLayerFor", () => {
		it("fails with RuntimeInstallError for unknown runtime name", async () => {
			const mod = await import("../src/runtime-installer.js");
			const layer = mod.installerLayerFor("unknown");
			const exit = await Effect.runPromise(
				Effect.exit(
					mod.RuntimeInstaller.pipe(
						Effect.flatMap((i) => i.install("1.0.0")),
						Effect.provide(layer),
						Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none)),
					) as unknown as Effect.Effect<never, RuntimeInstallError>,
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
				expect(exit.cause.error).toBeInstanceOf(RuntimeInstallError);
				expect((exit.cause.error as RuntimeInstallError).reason).toContain("Unknown runtime: unknown");
			}
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
	});
});

// ---------------------------------------------------------------------------
// extractErrorReason tests
// ---------------------------------------------------------------------------

describe("extractErrorReason", () => {
	it("extracts reason from object with reason field", async () => {
		const mod = await import("../src/runtime-installer.js");
		expect(mod.extractErrorReason({ reason: "something failed" })).toBe("something failed");
	});

	it("extracts message from Error instances", async () => {
		const mod = await import("../src/runtime-installer.js");
		expect(mod.extractErrorReason(new Error("err msg"))).toBe("err msg");
	});

	it("extracts message from object with message field", async () => {
		const mod = await import("../src/runtime-installer.js");
		expect(mod.extractErrorReason({ message: "msg" })).toBe("msg");
	});

	it("formats _tag when present", async () => {
		const mod = await import("../src/runtime-installer.js");
		expect(mod.extractErrorReason({ _tag: "SomeError" })).toBe("SomeError");
	});

	it("prefers reason over _tag when both present", async () => {
		const mod = await import("../src/runtime-installer.js");
		expect(mod.extractErrorReason({ _tag: "SomeError", reason: "details" })).toBe("details");
	});

	it("returns string representation for primitives", async () => {
		const mod = await import("../src/runtime-installer.js");
		expect(mod.extractErrorReason("plain string")).toBe("plain string");
		expect(mod.extractErrorReason(42)).toBe("42");
	});

	it("returns 'Unknown error' for empty values", async () => {
		const mod = await import("../src/runtime-installer.js");
		expect(mod.extractErrorReason("")).toBe("Unknown error");
		expect(mod.extractErrorReason(null)).toBe("null");
	});
});

// ---------------------------------------------------------------------------
// formatCauseDetail tests
// ---------------------------------------------------------------------------

describe("formatCauseDetail", () => {
	it("extracts cause detail from error with structured cause", async () => {
		const mod = await import("../src/runtime-installer.js");
		const error = { cause: { reason: "timeout", operation: "restore", key: "cache-key" } };
		expect(mod.formatCauseDetail(error)).toBe("reason=timeout, operation=restore, key=cache-key");
	});

	it("uses ? for missing cause fields", async () => {
		const mod = await import("../src/runtime-installer.js");
		const error = { cause: {} };
		expect(mod.formatCauseDetail(error)).toBe("reason=?, operation=?, key=?");
	});

	it("returns undefined for error without cause", async () => {
		const mod = await import("../src/runtime-installer.js");
		expect(mod.formatCauseDetail({ reason: "no cause" })).toBeUndefined();
	});

	it("returns undefined for non-object error", async () => {
		const mod = await import("../src/runtime-installer.js");
		expect(mod.formatCauseDetail("string error")).toBeUndefined();
		expect(mod.formatCauseDetail(null)).toBeUndefined();
	});

	it("returns undefined when cause is undefined", async () => {
		const mod = await import("../src/runtime-installer.js");
		expect(mod.formatCauseDetail({ cause: undefined })).toBeUndefined();
	});
});
