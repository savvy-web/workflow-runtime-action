import { chmod } from "node:fs/promises";
import { arch, platform } from "node:os";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBiome } from "../src/utils/install-biome.js";

// Mock all dependencies
vi.mock("@actions/core");
vi.mock("@actions/tool-cache");
vi.mock("node:fs/promises");
vi.mock("node:os");

describe("installBiome", () => {
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

		vi.mocked(tc.find).mockReturnValue("");
		vi.mocked(tc.downloadTool).mockResolvedValue("/tmp/biome");
		vi.mocked(tc.cacheFile).mockResolvedValue("/cached/biome");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("version handling", () => {
		it("should skip installation when version is empty", async () => {
			await installBiome("");

			expect(core.info).toHaveBeenCalledWith("No Biome version specified, skipping installation");
			expect(tc.find).not.toHaveBeenCalled();
			expect(tc.downloadTool).not.toHaveBeenCalled();
		});

		it("should install specific version", async () => {
			await installBiome("2.3.6");

			expect(tc.find).toHaveBeenCalledWith("biome", "2.3.6");
			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%402.3.6/biome-linux-x64",
			);
		});

		it("should install latest version", async () => {
			await installBiome("latest");

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%40latest/biome-linux-x64",
			);
		});
	});

	describe("caching", () => {
		it("should use cached version when available", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/biome/2.3.6");

			await installBiome("2.3.6");

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Found Biome 2.3.6 in tool cache"));
			expect(tc.downloadTool).not.toHaveBeenCalled();
			expect(core.addPath).toHaveBeenCalledWith("/cached/biome/2.3.6");
		});

		it("should download and cache when not found", async () => {
			vi.mocked(tc.find).mockReturnValue("");

			await installBiome("2.3.6");

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("not found in cache, downloading"));
			expect(tc.downloadTool).toHaveBeenCalled();
			expect(tc.cacheFile).toHaveBeenCalledWith("/tmp/biome", "biome", "biome", "2.3.6");
			expect(core.addPath).toHaveBeenCalledWith("/cached/biome");
		});
	});

	describe("platform-specific binaries", () => {
		it("should download Linux x64 binary", async () => {
			vi.mocked(platform).mockReturnValue("linux");
			vi.mocked(arch).mockReturnValue("x64");

			await installBiome("2.3.6");

			expect(tc.downloadTool).toHaveBeenCalledWith(expect.stringContaining("/biome-linux-x64"));
		});

		it("should download Linux ARM64 binary", async () => {
			vi.mocked(platform).mockReturnValue("linux");
			vi.mocked(arch).mockReturnValue("arm64");

			await installBiome("2.3.6");

			expect(tc.downloadTool).toHaveBeenCalledWith(expect.stringContaining("/biome-linux-arm64"));
		});

		it("should download macOS x64 binary", async () => {
			vi.mocked(platform).mockReturnValue("darwin");
			vi.mocked(arch).mockReturnValue("x64");

			await installBiome("2.3.6");

			expect(tc.downloadTool).toHaveBeenCalledWith(expect.stringContaining("/biome-darwin-x64"));
		});

		it("should download macOS ARM64 binary", async () => {
			vi.mocked(platform).mockReturnValue("darwin");
			vi.mocked(arch).mockReturnValue("arm64");

			await installBiome("2.3.6");

			expect(tc.downloadTool).toHaveBeenCalledWith(expect.stringContaining("/biome-darwin-arm64"));
		});

		it("should download Windows x64 binary", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(arch).mockReturnValue("x64");

			await installBiome("2.3.6");

			expect(tc.downloadTool).toHaveBeenCalledWith(expect.stringContaining("/biome-win32-x64.exe"));
			expect(tc.cacheFile).toHaveBeenCalledWith("/tmp/biome", "biome.exe", "biome", "2.3.6");
		});

		it("should download Windows ARM64 binary", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(arch).mockReturnValue("arm64");

			await installBiome("2.3.6");

			expect(tc.downloadTool).toHaveBeenCalledWith(expect.stringContaining("/biome-win32-arm64.exe"));
		});

		it("should throw error for unsupported platform", async () => {
			vi.mocked(platform).mockReturnValue("freebsd");
			vi.mocked(arch).mockReturnValue("x64");

			await installBiome("2.3.6");

			expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Failed to install Biome"));
		});
	});

	describe("permissions", () => {
		it("should make binary executable on Linux", async () => {
			vi.mocked(platform).mockReturnValue("linux");

			await installBiome("2.3.6");

			expect(chmod).toHaveBeenCalledWith("/cached/biome/biome", 0o755);
		});

		it("should make binary executable on macOS", async () => {
			vi.mocked(platform).mockReturnValue("darwin");

			await installBiome("2.3.6");

			expect(chmod).toHaveBeenCalledWith("/cached/biome/biome", 0o755);
		});

		it("should skip chmod on Windows", async () => {
			vi.mocked(platform).mockReturnValue("win32");

			await installBiome("2.3.6");

			expect(chmod).not.toHaveBeenCalled();
		});
	});

	describe("URL encoding", () => {
		it("should use correct URL-encoded format", async () => {
			await installBiome("2.3.6");

			// URL should use %40 for @ and %2F for /
			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%402.3.6/biome-linux-x64",
			);
		});

		it("should use URL encoding for latest version", async () => {
			await installBiome("latest");

			expect(tc.downloadTool).toHaveBeenCalledWith(
				"https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%40latest/biome-linux-x64",
			);
		});
	});

	describe("error handling", () => {
		it("should warn on download failure", async () => {
			vi.mocked(tc.downloadTool).mockRejectedValue(new Error("404 Not Found"));

			await installBiome("2.3.6");

			expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Failed to install Biome"));
			expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("404 Not Found"));
		});

		it("should warn on cache failure", async () => {
			vi.mocked(tc.cacheFile).mockRejectedValue(new Error("Cache write failed"));

			await installBiome("2.3.6");

			expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Failed to install Biome"));
		});

		it("should handle non-Error exceptions", async () => {
			vi.mocked(tc.downloadTool).mockRejectedValue("String error");

			await installBiome("2.3.6");

			expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("String error"));
		});

		it("should not fail the workflow on error", async () => {
			vi.mocked(tc.downloadTool).mockRejectedValue(new Error("Network error"));

			// Should not throw
			await expect(installBiome("2.3.6")).resolves.toBeUndefined();
			expect(core.warning).toHaveBeenCalled();
		});
	});

	describe("success logging", () => {
		it("should log success message", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/biome");

			await installBiome("2.3.6");

			expect(core.info).toHaveBeenCalledWith("✓ Biome 2.3.6 installed successfully");
		});

		it("should group output", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/biome");

			await installBiome("2.3.6");

			expect(core.startGroup).toHaveBeenCalledWith("🔧 Installing Biome 2.3.6");
			expect(core.endGroup).toHaveBeenCalled();
		});
	});
});
