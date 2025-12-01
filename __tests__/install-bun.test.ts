import { chmod } from "node:fs/promises";
import { arch, platform } from "node:os";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBun } from "../src/utils/install-bun.js";

// Mock all dependencies
vi.mock("@actions/core");
vi.mock("@actions/exec");
vi.mock("@actions/tool-cache");
vi.mock("node:fs/promises");
vi.mock("node:os");

describe("installBun", () => {
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
		vi.mocked(tc.downloadTool).mockResolvedValue("/tmp/bun.zip");
		vi.mocked(tc.extractZip).mockResolvedValue("/tmp/extracted");
		vi.mocked(tc.cacheDir).mockResolvedValue("/cached/bun/1.0.25");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("version handling", () => {
		it("should require version parameter", async () => {
			await expect(installBun({ version: "" })).rejects.toThrow("Bun version is required");

			expect(tc.find).not.toHaveBeenCalled();
			expect(tc.downloadTool).not.toHaveBeenCalled();
		});

		it("should install specific version", async () => {
			await installBun({ version: "1.0.25" });

			expect(tc.find).toHaveBeenCalledWith("bun", "1.0.25");
			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/oven-sh/bun/releases/download/bun-v1.0.25/bun-linux-x64.zip",
			);
		});

		it("should return installed version", async () => {
			const version = await installBun({ version: "1.0.25" });

			expect(version).toBe("1.0.25");
		});
	});

	describe("caching", () => {
		it("should use cached version when available", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/bun/1.0.25");

			await installBun({ version: "1.0.25" });

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Detected Bun 1.0.25 in tool cache"));
			expect(tc.downloadTool).not.toHaveBeenCalled();
			expect(core.addPath).toHaveBeenCalledWith("/cached/bun/1.0.25");
		});

		it("should download and cache when not found", async () => {
			vi.mocked(tc.find).mockReturnValue("");

			await installBun({ version: "1.0.25" });

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("not found in cache, downloading"));
			expect(tc.downloadTool).toHaveBeenCalled();
			expect(tc.extractZip).toHaveBeenCalledWith("/tmp/bun.zip");
			expect(tc.cacheDir).toHaveBeenCalled();
			expect(core.addPath).toHaveBeenCalledWith("/cached/bun/1.0.25");
		});
	});

	describe("platform-specific archives", () => {
		it("should download Linux x64 archive", async () => {
			vi.mocked(platform).mockReturnValue("linux");
			vi.mocked(arch).mockReturnValue("x64");

			await installBun({ version: "1.0.25" });

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/oven-sh/bun/releases/download/bun-v1.0.25/bun-linux-x64.zip",
			);
		});

		it("should download Linux ARM64 (aarch64) archive", async () => {
			vi.mocked(platform).mockReturnValue("linux");
			vi.mocked(arch).mockReturnValue("arm64");

			await installBun({ version: "1.0.25" });

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/oven-sh/bun/releases/download/bun-v1.0.25/bun-linux-aarch64.zip",
			);
		});

		it("should download macOS x64 archive", async () => {
			vi.mocked(platform).mockReturnValue("darwin");
			vi.mocked(arch).mockReturnValue("x64");

			await installBun({ version: "1.0.25" });

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/oven-sh/bun/releases/download/bun-v1.0.25/bun-darwin-x64.zip",
			);
		});

		it("should download macOS ARM64 (aarch64) archive", async () => {
			vi.mocked(platform).mockReturnValue("darwin");
			vi.mocked(arch).mockReturnValue("arm64");

			await installBun({ version: "1.0.25" });

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/oven-sh/bun/releases/download/bun-v1.0.25/bun-darwin-aarch64.zip",
			);
		});

		it("should download Windows x64 archive", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(arch).mockReturnValue("x64");

			await installBun({ version: "1.0.25" });

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/oven-sh/bun/releases/download/bun-v1.0.25/bun-windows-x64.zip",
			);
		});

		it("should throw error for unsupported architecture", async () => {
			vi.mocked(platform).mockReturnValue("linux");
			vi.mocked(arch).mockReturnValue("ia32");

			await expect(installBun({ version: "1.0.25" })).rejects.toThrow("Unsupported architecture for Bun");
		});

		it("should throw error for unsupported platform", async () => {
			vi.mocked(platform).mockReturnValue("freebsd");
			vi.mocked(arch).mockReturnValue("x64");

			await expect(installBun({ version: "1.0.25" })).rejects.toThrow("Unsupported platform for Bun");
		});
	});

	describe("permissions", () => {
		it("should make binary executable on Linux", async () => {
			vi.mocked(platform).mockReturnValue("linux");

			await installBun({ version: "1.0.25" });

			expect(chmod).toHaveBeenCalledWith(expect.stringContaining("/bun"), 0o755);
		});

		it("should make binary executable on macOS", async () => {
			vi.mocked(platform).mockReturnValue("darwin");

			await installBun({ version: "1.0.25" });

			expect(chmod).toHaveBeenCalledWith(expect.stringContaining("/bun"), 0o755);
		});

		it("should skip chmod on Windows", async () => {
			vi.mocked(platform).mockReturnValue("win32");

			await installBun({ version: "1.0.25" });

			expect(chmod).not.toHaveBeenCalled();
		});
	});

	describe("verification", () => {
		it("should verify Bun installation", async () => {
			await installBun({ version: "1.0.25" });

			expect(exec.exec).toHaveBeenCalledWith("bun", ["--version"]);
		});

		it("should handle verification errors", async () => {
			vi.mocked(exec.exec).mockRejectedValue(new Error("Command not found"));

			await expect(installBun({ version: "1.0.25" })).rejects.toThrow("Failed to install Bun");
		});
	});

	describe("URL format", () => {
		it("should use correct GitHub release URL format", async () => {
			await installBun({ version: "1.0.25" });

			// URL should use bun-v{version} tag format
			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/oven-sh/bun/releases/download/bun-v1.0.25/bun-linux-x64.zip",
			);
		});

		it("should handle different version formats", async () => {
			await installBun({ version: "1.3.3" });

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/oven-sh/bun/releases/download/bun-v1.3.3/bun-linux-x64.zip",
			);
		});
	});

	describe("error handling", () => {
		it("should throw on download failure", async () => {
			vi.mocked(tc.downloadTool).mockRejectedValue(new Error("404 Not Found"));

			await expect(installBun({ version: "1.0.25" })).rejects.toThrow("Failed to download Bun 1.0.25");
			await expect(installBun({ version: "1.0.25" })).rejects.toThrow("404 Not Found");
		});

		it("should throw on extraction failure", async () => {
			vi.mocked(tc.extractZip).mockRejectedValue(new Error("Invalid zip"));

			await expect(installBun({ version: "1.0.25" })).rejects.toThrow("Failed to download Bun 1.0.25");
		});

		it("should throw on cache failure", async () => {
			vi.mocked(tc.cacheDir).mockRejectedValue(new Error("Cache write failed"));

			await expect(installBun({ version: "1.0.25" })).rejects.toThrow("Failed to download Bun 1.0.25");
		});

		it("should handle non-Error exceptions", async () => {
			vi.mocked(tc.downloadTool).mockRejectedValue("String error");

			await expect(installBun({ version: "1.0.25" })).rejects.toThrow("String error");
		});

		it("should propagate errors to caller", async () => {
			vi.mocked(tc.downloadTool).mockRejectedValue(new Error("Network error"));

			// Should throw, not suppress
			await expect(installBun({ version: "1.0.25" })).rejects.toThrow();
		});
	});

	describe("success logging", () => {
		it("should log success message", async () => {
			await installBun({ version: "1.0.25" });

			expect(core.info).toHaveBeenCalledWith("✅ Bun 1.0.25 installed successfully");
		});

		it("should group output", async () => {
			await installBun({ version: "1.0.25" });

			expect(core.startGroup).toHaveBeenCalledWith("⚙️ Installing 🥟 Bun");
			expect(core.endGroup).toHaveBeenCalled();
		});

		it("should end group even on failure", async () => {
			vi.mocked(tc.downloadTool).mockRejectedValue(new Error("Download failed"));

			await expect(installBun({ version: "1.0.25" })).rejects.toThrow();

			expect(core.endGroup).toHaveBeenCalled();
		});
	});
});
