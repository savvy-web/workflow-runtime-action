import { chmod } from "node:fs/promises";
import { arch, platform } from "node:os";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDeno } from "../src/utils/install-deno.js";

// Mock all dependencies
vi.mock("@actions/core");
vi.mock("@actions/exec");
vi.mock("@actions/tool-cache");
vi.mock("node:fs/promises");
vi.mock("node:os");

describe("installDeno", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Setup default mocks
		vi.mocked(platform).mockReturnValue("linux");
		vi.mocked(arch).mockReturnValue("x64");
		vi.mocked(chmod).mockResolvedValue(undefined);

		vi.mocked(core.info).mockImplementation(() => {});
		vi.mocked(core.warning).mockImplementation(() => {});
		vi.mocked(core.startGroup).mockImplementation(() => {});
		vi.mocked(core.endGroup).mockImplementation(() => {});
		vi.mocked(core.addPath).mockImplementation(() => {});

		vi.mocked(exec.exec).mockResolvedValue(0);

		vi.mocked(tc.find).mockReturnValue("");
		vi.mocked(tc.downloadTool).mockResolvedValue("/tmp/deno.zip");
		vi.mocked(tc.extractZip).mockResolvedValue("/tmp/extracted");
		vi.mocked(tc.cacheDir).mockResolvedValue("/cached/deno/1.40.0");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("version handling", () => {
		it("should require version parameter", async () => {
			await expect(installDeno({ version: "" })).rejects.toThrow("Deno version is required");

			expect(tc.find).not.toHaveBeenCalled();
			expect(tc.downloadTool).not.toHaveBeenCalled();
		});

		it("should install specific version", async () => {
			await installDeno({ version: "1.40.0" });

			expect(tc.find).toHaveBeenCalledWith("deno", "1.40.0");
			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/denoland/deno/releases/download/v1.40.0/deno-x86_64-unknown-linux-gnu.zip",
			);
		});

		it("should return installed version", async () => {
			const version = await installDeno({ version: "1.40.0" });

			expect(version).toBe("1.40.0");
		});
	});

	describe("caching", () => {
		it("should use cached version when available", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/deno/1.40.0");

			await installDeno({ version: "1.40.0" });

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Found Deno 1.40.0 in tool cache"));
			expect(tc.downloadTool).not.toHaveBeenCalled();
			expect(core.addPath).toHaveBeenCalledWith("/cached/deno/1.40.0");
		});

		it("should download and cache when not found", async () => {
			vi.mocked(tc.find).mockReturnValue("");

			await installDeno({ version: "1.40.0" });

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("not found in cache, downloading"));
			expect(tc.downloadTool).toHaveBeenCalled();
			expect(tc.extractZip).toHaveBeenCalledWith("/tmp/deno.zip");
			expect(tc.cacheDir).toHaveBeenCalled();
			expect(core.addPath).toHaveBeenCalledWith("/cached/deno/1.40.0");
		});
	});

	describe("platform-specific archives (Rust target triples)", () => {
		it("should download Linux x64 archive", async () => {
			vi.mocked(platform).mockReturnValue("linux");
			vi.mocked(arch).mockReturnValue("x64");

			await installDeno({ version: "1.40.0" });

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/denoland/deno/releases/download/v1.40.0/deno-x86_64-unknown-linux-gnu.zip",
			);
		});

		it("should download Linux ARM64 (aarch64) archive", async () => {
			vi.mocked(platform).mockReturnValue("linux");
			vi.mocked(arch).mockReturnValue("arm64");

			await installDeno({ version: "1.40.0" });

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/denoland/deno/releases/download/v1.40.0/deno-aarch64-unknown-linux-gnu.zip",
			);
		});

		it("should download macOS x64 archive", async () => {
			vi.mocked(platform).mockReturnValue("darwin");
			vi.mocked(arch).mockReturnValue("x64");

			await installDeno({ version: "1.40.0" });

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/denoland/deno/releases/download/v1.40.0/deno-x86_64-apple-darwin.zip",
			);
		});

		it("should download macOS ARM64 (aarch64) archive", async () => {
			vi.mocked(platform).mockReturnValue("darwin");
			vi.mocked(arch).mockReturnValue("arm64");

			await installDeno({ version: "1.40.0" });

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/denoland/deno/releases/download/v1.40.0/deno-aarch64-apple-darwin.zip",
			);
		});

		it("should download Windows x64 archive", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(arch).mockReturnValue("x64");

			await installDeno({ version: "1.40.0" });

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/denoland/deno/releases/download/v1.40.0/deno-x86_64-pc-windows-msvc.zip",
			);
		});

		it("should throw error for unsupported architecture on Windows", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(arch).mockReturnValue("arm64");

			await expect(installDeno({ version: "1.40.0" })).rejects.toThrow("Unsupported platform for Deno");
		});

		it("should throw error for unsupported platform", async () => {
			vi.mocked(platform).mockReturnValue("freebsd");
			vi.mocked(arch).mockReturnValue("x64");

			await expect(installDeno({ version: "1.40.0" })).rejects.toThrow("Unsupported platform for Deno");
		});
	});

	describe("permissions", () => {
		it("should make binary executable on Linux", async () => {
			vi.mocked(platform).mockReturnValue("linux");

			await installDeno({ version: "1.40.0" });

			expect(chmod).toHaveBeenCalledWith("/tmp/extracted/deno", 0o755);
		});

		it("should make binary executable on macOS", async () => {
			vi.mocked(platform).mockReturnValue("darwin");

			await installDeno({ version: "1.40.0" });

			expect(chmod).toHaveBeenCalledWith("/tmp/extracted/deno", 0o755);
		});

		it("should skip chmod on Windows", async () => {
			vi.mocked(platform).mockReturnValue("win32");

			await installDeno({ version: "1.40.0" });

			expect(chmod).not.toHaveBeenCalled();
		});
	});

	describe("verification", () => {
		it("should verify Deno installation", async () => {
			await installDeno({ version: "1.40.0" });

			expect(exec.exec).toHaveBeenCalledWith("deno", ["--version"]);
		});

		it("should handle verification errors", async () => {
			vi.mocked(exec.exec).mockRejectedValue(new Error("Command not found"));

			await expect(installDeno({ version: "1.40.0" })).rejects.toThrow("Failed to install Deno");
		});
	});

	describe("URL format", () => {
		it("should use correct GitHub release URL format", async () => {
			await installDeno({ version: "1.40.0" });

			// URL should use v{version} tag format
			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/denoland/deno/releases/download/v1.40.0/deno-x86_64-unknown-linux-gnu.zip",
			);
		});

		it("should handle different version formats", async () => {
			await installDeno({ version: "2.1.4" });

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/denoland/deno/releases/download/v2.1.4/deno-x86_64-unknown-linux-gnu.zip",
			);
		});

		it("should prepend v to version in URL", async () => {
			await installDeno({ version: "1.3.3" });

			expect(tc.downloadTool).toHaveBeenCalledWith(expect.stringContaining("/v1.3.3/"));
		});
	});

	describe("error handling", () => {
		it("should throw on download failure", async () => {
			vi.mocked(tc.downloadTool).mockRejectedValue(new Error("404 Not Found"));

			await expect(installDeno({ version: "1.40.0" })).rejects.toThrow("Failed to download Deno 1.40.0");
			await expect(installDeno({ version: "1.40.0" })).rejects.toThrow("404 Not Found");
		});

		it("should throw on extraction failure", async () => {
			vi.mocked(tc.extractZip).mockRejectedValue(new Error("Invalid zip"));

			await expect(installDeno({ version: "1.40.0" })).rejects.toThrow("Failed to download Deno 1.40.0");
		});

		it("should throw on cache failure", async () => {
			vi.mocked(tc.cacheDir).mockRejectedValue(new Error("Cache write failed"));

			await expect(installDeno({ version: "1.40.0" })).rejects.toThrow("Failed to download Deno 1.40.0");
		});

		it("should handle non-Error exceptions", async () => {
			vi.mocked(tc.downloadTool).mockRejectedValue("String error");

			await expect(installDeno({ version: "1.40.0" })).rejects.toThrow("String error");
		});

		it("should propagate errors to caller", async () => {
			vi.mocked(tc.downloadTool).mockRejectedValue(new Error("Network error"));

			// Should throw, not suppress
			await expect(installDeno({ version: "1.40.0" })).rejects.toThrow();
		});
	});

	describe("success logging", () => {
		it("should log success message", async () => {
			await installDeno({ version: "1.40.0" });

			expect(core.info).toHaveBeenCalledWith("✓ Deno 1.40.0 installed successfully");
		});

		it("should group output", async () => {
			await installDeno({ version: "1.40.0" });

			expect(core.startGroup).toHaveBeenCalledWith("📦 Installing Deno");
			expect(core.endGroup).toHaveBeenCalled();
		});

		it("should end group even on failure", async () => {
			vi.mocked(tc.downloadTool).mockRejectedValue(new Error("Download failed"));

			await expect(installDeno({ version: "1.40.0" })).rejects.toThrow();

			expect(core.endGroup).toHaveBeenCalled();
		});
	});
});
