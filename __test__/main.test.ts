import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { parse } from "jsonc-parser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as actionIo from "../src/utils/action-io.js";
import * as cacheUtils from "../src/utils/cache-utils.js";
import * as installBiomeMod from "../src/utils/install-biome.js";
import * as installBunMod from "../src/utils/install-bun.js";
import * as installDenoMod from "../src/utils/install-deno.js";
import * as installNodeMod from "../src/utils/install-node.js";
import * as parsePackageJsonMod from "../src/utils/parse-package-json.js";

// Mock all external dependencies
vi.mock("node:fs", () => ({ existsSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
vi.mock("@actions/core");
vi.mock("@actions/exec", () => ({ exec: vi.fn() }));
vi.mock("jsonc-parser", () => ({ parse: vi.fn() }));

// Mock internal modules
vi.mock("../src/utils/action-io.js", () => ({
	getInput: vi.fn(),
	setOutput: vi.fn(),
}));
vi.mock("../src/utils/cache-utils.js", () => ({
	restoreCache: vi.fn(),
}));
vi.mock("../src/utils/install-biome.js", () => ({
	installBiome: vi.fn(),
}));
vi.mock("../src/utils/install-bun.js", () => ({
	installBun: vi.fn(),
}));
vi.mock("../src/utils/install-deno.js", () => ({
	installDeno: vi.fn(),
}));
vi.mock("../src/utils/install-node.js", () => ({
	installNode: vi.fn(),
	setupNpm: vi.fn(),
	setupPackageManager: vi.fn(),
}));
vi.mock("../src/utils/parse-package-json.js", () => ({
	parsePackageJson: vi.fn(),
}));

/**
 * Restore all mock implementations to their defaults.
 * Must be called after vi.resetAllMocks() since that clears implementations.
 */
function setDefaults() {
	vi.mocked(actionIo.getInput).mockReturnValue("");
	vi.mocked(existsSync).mockReturnValue(false);
	vi.mocked(readFile).mockResolvedValue("{}");
	vi.mocked(exec.exec).mockResolvedValue(0);
	vi.mocked(parse).mockReturnValue({});
	vi.mocked(parsePackageJsonMod.parsePackageJson).mockResolvedValue({
		packageManager: { name: "pnpm", version: "10.20.0" },
		runtimes: [{ name: "node", version: "24.11.0" }],
	});
	vi.mocked(installNodeMod.installNode).mockResolvedValue("24.11.0");
	vi.mocked(installNodeMod.setupNpm).mockResolvedValue(undefined);
	vi.mocked(installNodeMod.setupPackageManager).mockResolvedValue(undefined);
	vi.mocked(installBunMod.installBun).mockResolvedValue("1.3.3");
	vi.mocked(installDenoMod.installDeno).mockResolvedValue("2.5.6");
	vi.mocked(installBiomeMod.installBiome).mockResolvedValue("2.3.14");
	vi.mocked(cacheUtils.restoreCache).mockResolvedValue(undefined);
}

/** Import and execute main.js (triggers await main()) */
async function runMain() {
	await import("../src/main.js");
}

describe("main action", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.resetAllMocks();
		setDefaults();
	});

	describe("auto-detect mode", () => {
		it("should detect node+pnpm from package.json", async () => {
			await runMain();

			expect(parsePackageJsonMod.parsePackageJson).toHaveBeenCalled();
			expect(installNodeMod.installNode).toHaveBeenCalledWith({ version: "24.11.0" });
			expect(installNodeMod.setupPackageManager).toHaveBeenCalledWith("pnpm", "10.20.0");
			expect(cacheUtils.restoreCache).toHaveBeenCalled();
			expect(actionIo.setOutput).toHaveBeenCalledWith("node-version", "24.11.0");
			expect(actionIo.setOutput).toHaveBeenCalledWith("node-enabled", true);
			expect(actionIo.setOutput).toHaveBeenCalledWith("package-manager", "pnpm");
			expect(actionIo.setOutput).toHaveBeenCalledWith("package-manager-version", "10.20.0");
		});

		it("should setup npm when npm is the package manager", async () => {
			vi.mocked(parsePackageJsonMod.parsePackageJson).mockResolvedValue({
				packageManager: { name: "npm", version: "10.0.0" },
				runtimes: [{ name: "node", version: "24.11.0" }],
			});

			await runMain();

			expect(installNodeMod.setupNpm).toHaveBeenCalledWith("10.0.0");
			expect(installNodeMod.setupPackageManager).not.toHaveBeenCalled();
		});

		it("should skip PM setup when bun is the package manager", async () => {
			vi.mocked(parsePackageJsonMod.parsePackageJson).mockResolvedValue({
				packageManager: { name: "bun", version: "1.3.3" },
				runtimes: [{ name: "bun", version: "1.3.3" }],
			});

			await runMain();

			expect(installBunMod.installBun).toHaveBeenCalledWith({ version: "1.3.3" });
			expect(installNodeMod.setupNpm).not.toHaveBeenCalled();
			expect(installNodeMod.setupPackageManager).not.toHaveBeenCalled();
		});

		it("should install multiple runtimes", async () => {
			vi.mocked(parsePackageJsonMod.parsePackageJson).mockResolvedValue({
				packageManager: { name: "pnpm", version: "10.20.0" },
				runtimes: [
					{ name: "node", version: "24.11.0" },
					{ name: "bun", version: "1.3.3" },
					{ name: "deno", version: "2.5.6" },
				],
			});

			await runMain();

			expect(installNodeMod.installNode).toHaveBeenCalledWith({ version: "24.11.0" });
			expect(installBunMod.installBun).toHaveBeenCalledWith({ version: "1.3.3" });
			expect(installDenoMod.installDeno).toHaveBeenCalledWith({ version: "2.5.6" });
			expect(actionIo.setOutput).toHaveBeenCalledWith("bun-version", "1.3.3");
			expect(actionIo.setOutput).toHaveBeenCalledWith("bun-enabled", true);
			expect(actionIo.setOutput).toHaveBeenCalledWith("deno-version", "2.5.6");
			expect(actionIo.setOutput).toHaveBeenCalledWith("deno-enabled", true);
		});
	});

	describe("explicit mode", () => {
		it("should use explicit inputs when all provided", async () => {
			vi.mocked(actionIo.getInput).mockImplementation((key: string) => {
				const inputs: Record<string, string> = {
					"node-version": "22.0.0",
					"package-manager": "pnpm",
					"package-manager-version": "9.0.0",
				};
				return inputs[key] || "";
			});

			await runMain();

			expect(parsePackageJsonMod.parsePackageJson).not.toHaveBeenCalled();
			expect(installNodeMod.installNode).toHaveBeenCalledWith({ version: "22.0.0" });
			expect(installNodeMod.setupPackageManager).toHaveBeenCalledWith("pnpm", "9.0.0");
		});

		it("should handle bun as both runtime and PM in explicit mode", async () => {
			vi.mocked(actionIo.getInput).mockImplementation((key: string) => {
				const inputs: Record<string, string> = {
					"bun-version": "1.3.3",
					"package-manager": "bun",
				};
				return inputs[key] || "";
			});

			await runMain();

			expect(parsePackageJsonMod.parsePackageJson).not.toHaveBeenCalled();
			expect(installBunMod.installBun).toHaveBeenCalledWith({ version: "1.3.3" });
			expect(actionIo.setOutput).toHaveBeenCalledWith("package-manager", "bun");
			expect(actionIo.setOutput).toHaveBeenCalledWith("package-manager-version", "1.3.3");
		});

		it("should handle deno as both runtime and PM in explicit mode", async () => {
			vi.mocked(actionIo.getInput).mockImplementation((key: string) => {
				const inputs: Record<string, string> = {
					"deno-version": "2.5.6",
					"package-manager": "deno",
				};
				return inputs[key] || "";
			});

			await runMain();

			expect(parsePackageJsonMod.parsePackageJson).not.toHaveBeenCalled();
			expect(installDenoMod.installDeno).toHaveBeenCalledWith({ version: "2.5.6" });
		});

		it("should fail when package-manager-version is set without package-manager", async () => {
			vi.mocked(actionIo.getInput).mockImplementation((key: string) => {
				if (key === "package-manager-version") return "10.0.0";
				return "";
			});

			await runMain();

			expect(core.setFailed).toHaveBeenCalledWith(
				expect.stringContaining("package-manager-version input requires package-manager"),
			);
		});

		it("should fail when non-runtime PM is set without version in explicit mode", async () => {
			vi.mocked(actionIo.getInput).mockImplementation((key: string) => {
				const inputs: Record<string, string> = {
					"node-version": "24.0.0",
					"package-manager": "pnpm",
				};
				return inputs[key] || "";
			});

			await runMain();

			expect(core.setFailed).toHaveBeenCalledWith(
				expect.stringContaining("you must provide both package-manager and package-manager-version"),
			);
		});
	});

	describe("turbo detection", () => {
		it("should detect turbo.json and include .turbo in cache paths", async () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "turbo.json");

			await runMain();

			expect(actionIo.setOutput).toHaveBeenCalledWith("turbo-enabled", true);
			expect(cacheUtils.restoreCache).toHaveBeenCalledWith(
				expect.any(Array),
				expect.any(Object),
				expect.any(String),
				undefined,
				undefined,
				expect.stringContaining("**/.turbo"),
			);
		});

		it("should report turbo as disabled when no turbo.json", async () => {
			await runMain();

			expect(actionIo.setOutput).toHaveBeenCalledWith("turbo-enabled", false);
		});
	});

	describe("biome detection", () => {
		it("should use explicit biome version from input", async () => {
			vi.mocked(actionIo.getInput).mockImplementation((key: string) => {
				if (key === "biome-version") return "2.3.14";
				return "";
			});

			await runMain();

			expect(installBiomeMod.installBiome).toHaveBeenCalledWith("2.3.14");
			expect(actionIo.setOutput).toHaveBeenCalledWith("biome-enabled", true);
		});

		it("should detect biome version from biome.jsonc $schema", async () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "biome.jsonc");
			vi.mocked(readFile).mockResolvedValue("{}");
			vi.mocked(parse).mockReturnValue({
				$schema: "https://biomejs.dev/schemas/2.3.14/schema.json",
			});

			await runMain();

			expect(installBiomeMod.installBiome).toHaveBeenCalledWith("2.3.14");
		});

		it("should detect biome version from biome.json fallback", async () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "biome.json");
			vi.mocked(readFile).mockResolvedValue("{}");
			vi.mocked(parse).mockReturnValue({
				$schema: "https://biomejs.dev/schemas/2.0.0/schema.json",
			});

			await runMain();

			expect(installBiomeMod.installBiome).toHaveBeenCalledWith("2.0.0");
		});

		it("should use 'latest' when config has no $schema", async () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "biome.jsonc");
			vi.mocked(readFile).mockResolvedValue("{}");
			vi.mocked(parse).mockReturnValue({});

			await runMain();

			expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("No $schema field"));
			expect(installBiomeMod.installBiome).toHaveBeenCalledWith("latest");
		});

		it("should use 'latest' when $schema version cannot be parsed", async () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "biome.jsonc");
			vi.mocked(readFile).mockResolvedValue("{}");
			vi.mocked(parse).mockReturnValue({
				$schema: "https://example.com/unknown-format",
			});

			await runMain();

			expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Could not parse version"));
			expect(installBiomeMod.installBiome).toHaveBeenCalledWith("latest");
		});

		it("should use 'latest' when config file fails to parse", async () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "biome.jsonc");
			vi.mocked(readFile).mockRejectedValue(new Error("Permission denied"));

			await runMain();

			expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Failed to parse"));
			expect(installBiomeMod.installBiome).toHaveBeenCalledWith("latest");
		});

		it("should skip biome when no config and no explicit version", async () => {
			await runMain();

			expect(installBiomeMod.installBiome).not.toHaveBeenCalled();
			expect(actionIo.setOutput).toHaveBeenCalledWith("biome-version", "");
			expect(actionIo.setOutput).toHaveBeenCalledWith("biome-enabled", false);
		});
	});

	describe("dependency installation", () => {
		it("should use npm ci when package-lock.json exists", async () => {
			vi.mocked(parsePackageJsonMod.parsePackageJson).mockResolvedValue({
				packageManager: { name: "npm", version: "10.0.0" },
				runtimes: [{ name: "node", version: "24.11.0" }],
			});
			vi.mocked(existsSync).mockImplementation((path) => path === "package-lock.json");

			await runMain();

			expect(exec.exec).toHaveBeenCalledWith("npm", ["ci"]);
		});

		it("should use npm install when no lock file", async () => {
			vi.mocked(parsePackageJsonMod.parsePackageJson).mockResolvedValue({
				packageManager: { name: "npm", version: "10.0.0" },
				runtimes: [{ name: "node", version: "24.11.0" }],
			});

			await runMain();

			expect(exec.exec).toHaveBeenCalledWith("npm", ["install"]);
		});

		it("should use pnpm install --frozen-lockfile when pnpm-lock.yaml exists", async () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "pnpm-lock.yaml");

			await runMain();

			expect(exec.exec).toHaveBeenCalledWith("pnpm", ["install", "--frozen-lockfile"]);
		});

		it("should use pnpm install when no lock file", async () => {
			await runMain();

			expect(exec.exec).toHaveBeenCalledWith("pnpm", ["install"]);
		});

		it("should use yarn install --immutable when yarn.lock exists", async () => {
			vi.mocked(parsePackageJsonMod.parsePackageJson).mockResolvedValue({
				packageManager: { name: "yarn", version: "4.0.0" },
				runtimes: [{ name: "node", version: "24.11.0" }],
			});
			vi.mocked(existsSync).mockImplementation((path) => path === "yarn.lock");

			await runMain();

			expect(exec.exec).toHaveBeenCalledWith("yarn", ["install", "--immutable"]);
		});

		it("should use yarn install --no-immutable when no yarn.lock", async () => {
			vi.mocked(parsePackageJsonMod.parsePackageJson).mockResolvedValue({
				packageManager: { name: "yarn", version: "4.0.0" },
				runtimes: [{ name: "node", version: "24.11.0" }],
			});

			await runMain();

			expect(exec.exec).toHaveBeenCalledWith("yarn", ["install", "--no-immutable"]);
		});

		it("should use bun install --frozen-lockfile when bun.lock exists", async () => {
			vi.mocked(parsePackageJsonMod.parsePackageJson).mockResolvedValue({
				packageManager: { name: "bun", version: "1.3.3" },
				runtimes: [{ name: "bun", version: "1.3.3" }],
			});
			vi.mocked(existsSync).mockImplementation((path) => path === "bun.lock");

			await runMain();

			expect(exec.exec).toHaveBeenCalledWith("bun", ["install", "--frozen-lockfile"]);
		});

		it("should skip install for deno package manager", async () => {
			vi.mocked(actionIo.getInput).mockImplementation((key: string) => {
				const inputs: Record<string, string> = {
					"deno-version": "2.5.6",
					"package-manager": "deno",
				};
				return inputs[key] || "";
			});

			await runMain();

			expect(exec.exec).not.toHaveBeenCalledWith("deno", expect.any(Array));
		});

		it("should skip dependency installation when install-deps is false", async () => {
			vi.mocked(actionIo.getInput).mockImplementation((key: string) => {
				if (key === "install-deps") return "false";
				return "";
			});

			await runMain();

			expect(exec.exec).not.toHaveBeenCalled();
		});

		it("should handle dependency installation failure", async () => {
			vi.mocked(exec.exec).mockRejectedValue(new Error("install failed"));

			await runMain();

			expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("Failed to install dependencies"));
		});
	});

	describe("error handling", () => {
		it("should call setFailed when main throws", async () => {
			vi.mocked(parsePackageJsonMod.parsePackageJson).mockRejectedValue(new Error("package.json not found"));

			await runMain();

			expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("package.json not found"));
		});

		it("should handle non-Error throws", async () => {
			vi.mocked(parsePackageJsonMod.parsePackageJson).mockRejectedValue("unknown error");

			await runMain();

			expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("unknown error"));
		});

		it("should fail when runtime is missing version", async () => {
			vi.mocked(parsePackageJsonMod.parsePackageJson).mockResolvedValue({
				packageManager: { name: "pnpm", version: "10.20.0" },
				runtimes: [{ name: "node", version: "" }],
			});

			await runMain();

			expect(core.setFailed).toHaveBeenCalledWith(
				expect.stringContaining("Node.js runtime detected but no version specified"),
			);
		});
	});

	describe("state and outputs", () => {
		it("should save package manager state for post action", async () => {
			await runMain();

			expect(core.saveState).toHaveBeenCalledWith("PACKAGE_MANAGER", "pnpm");
		});

		it("should set all outputs correctly for node+pnpm", async () => {
			await runMain();

			expect(actionIo.setOutput).toHaveBeenCalledWith("node-version", "24.11.0");
			expect(actionIo.setOutput).toHaveBeenCalledWith("node-enabled", true);
			expect(actionIo.setOutput).toHaveBeenCalledWith("bun-version", "");
			expect(actionIo.setOutput).toHaveBeenCalledWith("bun-enabled", false);
			expect(actionIo.setOutput).toHaveBeenCalledWith("deno-version", "");
			expect(actionIo.setOutput).toHaveBeenCalledWith("deno-enabled", false);
			expect(actionIo.setOutput).toHaveBeenCalledWith("package-manager", "pnpm");
			expect(actionIo.setOutput).toHaveBeenCalledWith("package-manager-version", "10.20.0");
			expect(actionIo.setOutput).toHaveBeenCalledWith("biome-version", "");
			expect(actionIo.setOutput).toHaveBeenCalledWith("biome-enabled", false);
			expect(actionIo.setOutput).toHaveBeenCalledWith("turbo-enabled", false);
		});
	});
});
