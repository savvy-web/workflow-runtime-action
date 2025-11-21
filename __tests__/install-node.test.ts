import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { HttpClient } from "@actions/http-client";
import * as tc from "@actions/tool-cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installNode, setupPackageManager } from "../src/utils/install-node.js";

// Mock all modules
vi.mock("@actions/core");
vi.mock("@actions/exec");
vi.mock("@actions/http-client");
vi.mock("@actions/tool-cache");
vi.mock("node:fs/promises");
vi.mock("node:fs");
vi.mock("node:os");

describe("installNode", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Setup default mocks
		vi.mocked(platform).mockReturnValue("linux");
		vi.mocked(arch).mockReturnValue("x64");
		vi.mocked(core.info).mockImplementation(() => {});
		vi.mocked(core.addPath).mockImplementation(() => {});
		vi.mocked(core.startGroup).mockImplementation(() => {});
		vi.mocked(core.endGroup).mockImplementation(() => {});
		vi.mocked(exec.exec).mockResolvedValue(0);
		vi.mocked(tc.find).mockReturnValue("");
		vi.mocked(tc.downloadTool).mockResolvedValue("/tmp/download");
		vi.mocked(tc.extractTar).mockResolvedValue("/tmp/extracted");
		vi.mocked(tc.extractZip).mockResolvedValue("/tmp/extracted");
		vi.mocked(tc.cacheDir).mockResolvedValue("/cached/node");
		vi.mocked(readdirSync).mockReturnValue(["node-v20.11.0-linux-x64"] as unknown as ReturnType<typeof readdirSync>);
		vi.mocked(readFile).mockResolvedValue("20.11.0\n");

		// Mock HttpClient for version resolution
		const mockGet = vi.fn().mockResolvedValue({
			readBody: vi.fn().mockResolvedValue(
				JSON.stringify([
					{ version: "v20.19.5", lts: "Iron" },
					{ version: "v20.19.4", lts: "Iron" },
					{ version: "v20.18.0", lts: false },
					{ version: "v18.20.0", lts: "Hydrogen" },
				]),
			),
		});
		vi.mocked(HttpClient).mockImplementation(function (this: InstanceType<typeof HttpClient>) {
			return { get: mockGet } as unknown as InstanceType<typeof HttpClient>;
		} as unknown as typeof HttpClient);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("exact version installation", () => {
		it("should use cached Node.js when available", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node-20.11.0");

			await installNode({ version: "20.11.0", versionFile: "" });

			expect(tc.find).toHaveBeenCalledWith("node", "20.11.0");
			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Found Node.js 20.11.0 in tool cache"));
			expect(tc.downloadTool).not.toHaveBeenCalled();
		});

		it("should download Node.js when not cached", async () => {
			vi.mocked(tc.find).mockReturnValue("");

			await installNode({ version: "20.11.0", versionFile: "" });

			expect(tc.find).toHaveBeenCalledWith("node", "20.11.0");
			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("not found in cache, downloading"));
			expect(tc.downloadTool).toHaveBeenCalled();
			expect(tc.extractTar).toHaveBeenCalled();
			expect(tc.cacheDir).toHaveBeenCalled();
		});

		it("should add correct path on Linux", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");

			await installNode({ version: "20.11.0", versionFile: "" });

			expect(core.addPath).toHaveBeenCalledWith("/cached/node/bin");
		});

		it("should add correct path on Windows", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(tc.find).mockReturnValue("/cached/node");

			await installNode({ version: "20.11.0", versionFile: "" });

			expect(core.addPath).toHaveBeenCalledWith("/cached/node");
		});

		it("should verify installation", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");

			await installNode({ version: "20.11.0", versionFile: "" });

			expect(exec.exec).toHaveBeenCalledWith("node", ["--version"]);
			expect(exec.exec).toHaveBeenCalledWith("npm", ["--version"]);
		});
	});

	describe("version file handling", () => {
		it("should read version from .nvmrc", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");
			vi.mocked(readFile).mockResolvedValue("20.11.0\n");

			await installNode({ version: "", versionFile: ".nvmrc" });

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Reading Node.js version from .nvmrc"));
			expect(readFile).toHaveBeenCalledWith(".nvmrc", "utf-8");
		});

		it("should strip v prefix from version file", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");
			vi.mocked(readFile).mockResolvedValue("v20.11.0\n");

			await installNode({ version: "", versionFile: ".nvmrc" });

			expect(tc.find).toHaveBeenCalledWith("node", "20.11.0");
		});

		it("should handle multiline version files", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");
			vi.mocked(readFile).mockResolvedValue("20.11.0\n# comment\nmore text");

			await installNode({ version: "", versionFile: ".nvmrc" });

			expect(tc.find).toHaveBeenCalledWith("node", "20.11.0");
		});
	});

	describe("version resolution", () => {
		it("should resolve lts/* from input version", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");

			await installNode({ version: "lts/*", versionFile: "" });

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Using Node.js version from input: lts/*"));
			expect(tc.find).toHaveBeenCalledWith("node", "20.19.5");
		});

		it("should resolve lts from input version", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");

			await installNode({ version: "lts", versionFile: "" });

			expect(tc.find).toHaveBeenCalledWith("node", "20.19.5");
		});

		it("should resolve version range (20.x) from input", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");

			await installNode({ version: "20.x", versionFile: "" });

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Using Node.js version from input: 20.x"));
			expect(tc.find).toHaveBeenCalledWith("node", "20.19.5");
		});

		it("should resolve version range (20) from input", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");

			await installNode({ version: "20", versionFile: "" });

			expect(tc.find).toHaveBeenCalledWith("node", "20.19.5");
		});

		it("should resolve lts/* from version file", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");
			vi.mocked(readFile).mockResolvedValue("lts/*\n");

			await installNode({ version: "", versionFile: ".nvmrc" });

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Reading Node.js version from .nvmrc"));
			expect(tc.find).toHaveBeenCalledWith("node", "20.19.5");
		});

		it("should resolve version range (20.x) from version file", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");
			vi.mocked(readFile).mockResolvedValue("20.x\n");

			await installNode({ version: "", versionFile: ".nvmrc" });

			expect(tc.find).toHaveBeenCalledWith("node", "20.19.5");
		});

		it("should resolve lts from version file", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");
			vi.mocked(readFile).mockResolvedValue("lts\n");

			await installNode({ version: "", versionFile: ".nvmrc" });

			expect(tc.find).toHaveBeenCalledWith("node", "20.19.5");
		});

		it("should default to lts/* when no version or file specified", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");

			await installNode({ version: "", versionFile: "" });

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("No version specified, defaulting to lts/*"));
			expect(tc.find).toHaveBeenCalledWith("node", "20.19.5");
		});
	});

	describe("Windows extraction", () => {
		it("should use extractZip on Windows", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(tc.find).mockReturnValue("");
			vi.mocked(readdirSync).mockReturnValue(["node-v20.11.0-win32-x64"] as unknown as ReturnType<typeof readdirSync>);

			await installNode({ version: "20.11.0", versionFile: "" });

			expect(tc.extractZip).toHaveBeenCalledWith("/tmp/download");
			expect(tc.extractTar).not.toHaveBeenCalled();
		});
	});

	describe("error handling", () => {
		it("should throw error on download failure", async () => {
			vi.mocked(tc.find).mockReturnValue("");
			vi.mocked(tc.downloadTool).mockRejectedValue(new Error("Network error"));

			await expect(installNode({ version: "20.11.0", versionFile: "" })).rejects.toThrow("Failed to install Node.js");
		});

		it("should throw error on extraction failure", async () => {
			vi.mocked(tc.find).mockReturnValue("");
			vi.mocked(tc.extractTar).mockRejectedValue(new Error("Extraction failed"));

			await expect(installNode({ version: "20.11.0", versionFile: "" })).rejects.toThrow("Failed to install Node.js");
		});

		it("should throw error when node directory not found in extraction", async () => {
			vi.mocked(tc.find).mockReturnValue("");
			vi.mocked(readdirSync).mockReturnValue(["some-other-file"] as unknown as ReturnType<typeof readdirSync>);

			await expect(installNode({ version: "20.11.0", versionFile: "" })).rejects.toThrow("Failed to install Node.js");
		});
	});
});

describe("setupPackageManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		vi.mocked(core.info).mockImplementation(() => {});
		vi.mocked(core.startGroup).mockImplementation(() => {});
		vi.mocked(core.endGroup).mockImplementation(() => {});
		vi.mocked(exec.exec).mockResolvedValue(0);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("pnpm setup", () => {
		it("should enable corepack and install pnpm", async () => {
			await setupPackageManager("pnpm");

			expect(core.info).toHaveBeenCalledWith("Enabling corepack...");
			expect(exec.exec).toHaveBeenCalledWith("corepack", ["enable"]);
			expect(core.info).toHaveBeenCalledWith("Preparing pnpm...");
			expect(exec.exec).toHaveBeenCalledWith("corepack", ["prepare", "pnpm@latest", "--activate"]);
			expect(exec.exec).toHaveBeenCalledWith("pnpm", ["--version"]);
		});
	});

	describe("yarn setup", () => {
		it("should enable corepack and install yarn", async () => {
			await setupPackageManager("yarn");

			expect(core.info).toHaveBeenCalledWith("Enabling corepack...");
			expect(exec.exec).toHaveBeenCalledWith("corepack", ["enable"]);
			expect(core.info).toHaveBeenCalledWith("Preparing yarn...");
			expect(exec.exec).toHaveBeenCalledWith("corepack", ["prepare", "yarn@stable", "--activate"]);
			expect(exec.exec).toHaveBeenCalledWith("yarn", ["--version"]);
		});
	});

	describe("error handling", () => {
		it("should throw error when corepack enable fails", async () => {
			vi.mocked(exec.exec).mockRejectedValueOnce(new Error("Corepack not found"));

			await expect(setupPackageManager("pnpm")).rejects.toThrow("Failed to setup pnpm");
			expect(core.endGroup).toHaveBeenCalled();
		});

		it("should throw error when prepare fails", async () => {
			vi.mocked(exec.exec).mockResolvedValueOnce(0); // corepack enable
			vi.mocked(exec.exec).mockRejectedValueOnce(new Error("Network error")); // prepare fails

			await expect(setupPackageManager("yarn")).rejects.toThrow("Failed to setup yarn");
		});

		it("should throw error when verification fails", async () => {
			vi.mocked(exec.exec).mockResolvedValueOnce(0); // corepack enable
			vi.mocked(exec.exec).mockResolvedValueOnce(0); // prepare
			vi.mocked(exec.exec).mockRejectedValueOnce(new Error("Command not found")); // version check

			await expect(setupPackageManager("pnpm")).rejects.toThrow("Failed to setup pnpm");
		});
	});
});
