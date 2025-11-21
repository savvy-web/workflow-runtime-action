import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import type { Globber } from "@actions/glob";
import * as glob from "@actions/glob";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreCache, saveCache } from "../src/utils/cache-utils.js";

// Mock all dependencies
vi.mock("@actions/core");
vi.mock("@actions/cache");
vi.mock("@actions/glob");
vi.mock("node:fs/promises");
vi.mock("node:crypto");
vi.mock("node:os");

describe("restoreCache", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Setup default mocks
		vi.mocked(platform).mockReturnValue("linux");
		vi.mocked(arch).mockReturnValue("x64");

		vi.mocked(core.info).mockImplementation(() => {});
		vi.mocked(core.warning).mockImplementation(() => {});
		vi.mocked(core.startGroup).mockImplementation(() => {});
		vi.mocked(core.endGroup).mockImplementation(() => {});
		vi.mocked(core.setOutput).mockImplementation(() => {});
		vi.mocked(core.saveState).mockImplementation(() => {});
		vi.mocked(core.getState).mockReturnValue("");

		vi.mocked(cache.restoreCache).mockResolvedValue(undefined);
		vi.mocked(cache.saveCache).mockResolvedValue(1);

		// Mock globber
		const globber = {
			glob: vi.fn().mockResolvedValue(["package-lock.json"]),
			getSearchPaths: vi.fn().mockReturnValue([]),
			globGenerator: vi.fn(),
		};
		vi.mocked(glob.create).mockResolvedValue(globber as unknown as Globber);

		// Mock file reading and hashing
		vi.mocked(readFile).mockResolvedValue("lockfile content");

		const mockHash = {
			update: vi.fn().mockReturnThis(),
			digest: vi.fn().mockReturnValue("abc123def456"),
		};
		vi.mocked(createHash).mockReturnValue(mockHash as never);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("npm caching", () => {
		it("should restore npm cache with correct paths", async () => {
			await restoreCache("npm");

			expect(cache.restoreCache).toHaveBeenCalledWith(["~/.npm", "**/node_modules"], "npm-linux-x64-abc123def456", [
				"npm-linux-x64-",
			]);
		});

		it("should use Windows paths on win32", async () => {
			vi.mocked(platform).mockReturnValue("win32");

			await restoreCache("npm");

			expect(cache.restoreCache).toHaveBeenCalledWith(
				["~/AppData/Local/npm-cache", "**/node_modules"],
				"npm-win32-x64-abc123def456",
				["npm-win32-x64-"],
			);
		});

		it("should find package-lock.json files", async () => {
			await restoreCache("npm");

			expect(glob.create).toHaveBeenCalledWith("**/package-lock.json", expect.any(Object));
		});

		it("should warn when no lock files found", async () => {
			const globber = await glob.create("**/*.json");
			vi.mocked(globber.glob).mockResolvedValue([]);

			const result = await restoreCache("npm");

			expect(core.warning).toHaveBeenCalledWith("No lock files found for npm, skipping cache");
			expect(result).toBeUndefined();
		});
	});

	describe("pnpm caching", () => {
		it("should restore pnpm cache with correct paths", async () => {
			await restoreCache("pnpm");

			expect(cache.restoreCache).toHaveBeenCalledWith(
				["~/.local/share/pnpm/store", "**/node_modules"],
				"pnpm-linux-x64-abc123def456",
				["pnpm-linux-x64-"],
			);
		});

		it("should use Windows paths on win32", async () => {
			vi.mocked(platform).mockReturnValue("win32");

			await restoreCache("pnpm");

			expect(cache.restoreCache).toHaveBeenCalledWith(
				["~/AppData/Local/pnpm/store", "**/node_modules"],
				"pnpm-win32-x64-abc123def456",
				["pnpm-win32-x64-"],
			);
		});

		it("should find pnpm-lock.yaml files", async () => {
			await restoreCache("pnpm");

			expect(glob.create).toHaveBeenCalledWith("**/pnpm-lock.yaml", expect.any(Object));
		});
	});

	describe("yarn caching", () => {
		it("should restore yarn cache with correct paths", async () => {
			await restoreCache("yarn");

			expect(cache.restoreCache).toHaveBeenCalledWith(
				[
					"~/.yarn/cache",
					"~/.cache/yarn",
					"**/node_modules",
					"**/.yarn/cache",
					"**/.yarn/unplugged",
					"**/.yarn/install-state.gz",
				],
				"yarn-linux-x64-abc123def456",
				["yarn-linux-x64-"],
			);
		});

		it("should use Windows paths on win32", async () => {
			vi.mocked(platform).mockReturnValue("win32");

			await restoreCache("yarn");

			expect(cache.restoreCache).toHaveBeenCalledWith(
				expect.arrayContaining(["~/AppData/Local/Yarn/Cache", "~/AppData/Local/Yarn/Berry/cache"]),
				"yarn-win32-x64-abc123def456",
				["yarn-win32-x64-"],
			);
		});

		it("should find yarn.lock files", async () => {
			await restoreCache("yarn");

			expect(glob.create).toHaveBeenCalledWith("**/yarn.lock", expect.any(Object));
		});
	});

	describe("cache hit detection", () => {
		it("should set cache-hit to true on exact match", async () => {
			vi.mocked(cache.restoreCache).mockResolvedValue("npm-linux-x64-abc123def456");

			await restoreCache("npm");

			expect(core.setOutput).toHaveBeenCalledWith("cache-hit", "true");
		});

		it("should set cache-hit to partial on restore key match", async () => {
			vi.mocked(cache.restoreCache).mockResolvedValue("npm-linux-x64-differenthash");

			await restoreCache("npm");

			expect(core.setOutput).toHaveBeenCalledWith("cache-hit", "partial");
		});

		it("should set cache-hit to false when no cache found", async () => {
			vi.mocked(cache.restoreCache).mockResolvedValue(undefined);

			await restoreCache("npm");

			expect(core.setOutput).toHaveBeenCalledWith("cache-hit", "false");
		});
	});

	describe("state management", () => {
		it("should save cache state when cache is restored", async () => {
			vi.mocked(cache.restoreCache).mockResolvedValue("npm-linux-x64-abc123def456");

			await restoreCache("npm");

			expect(core.saveState).toHaveBeenCalledWith("CACHE_KEY", "npm-linux-x64-abc123def456");
			expect(core.saveState).toHaveBeenCalledWith("CACHE_PRIMARY_KEY", "npm-linux-x64-abc123def456");
			expect(core.saveState).toHaveBeenCalledWith("CACHE_PATHS", expect.any(String));
		});

		it("should save state even when cache not found", async () => {
			vi.mocked(cache.restoreCache).mockResolvedValue(undefined);

			await restoreCache("npm");

			expect(core.saveState).toHaveBeenCalledWith("CACHE_PRIMARY_KEY", expect.any(String));
			expect(core.saveState).toHaveBeenCalledWith("CACHE_PATHS", expect.any(String));
		});
	});

	describe("error handling", () => {
		it("should handle cache restore errors gracefully", async () => {
			vi.mocked(cache.restoreCache).mockRejectedValue(new Error("Cache service unavailable"));

			const result = await restoreCache("npm");

			expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Failed to restore cache"));
			expect(result).toBeUndefined();
		});

		it("should warn on file read errors during hashing", async () => {
			vi.mocked(readFile).mockRejectedValue(new Error("File not found"));

			await restoreCache("npm");

			expect(core.warning).toHaveBeenCalledWith(
				expect.stringContaining("Failed to read package-lock.json for hashing"),
			);
		});
	});

	describe("architecture handling", () => {
		it("should include ARM64 in cache key", async () => {
			vi.mocked(arch).mockReturnValue("arm64");

			await restoreCache("npm");

			expect(cache.restoreCache).toHaveBeenCalledWith(expect.any(Array), expect.stringContaining("npm-linux-arm64-"), [
				"npm-linux-arm64-",
			]);
		});

		it("should handle different platforms", async () => {
			vi.mocked(platform).mockReturnValue("darwin");
			vi.mocked(arch).mockReturnValue("arm64");

			await restoreCache("pnpm");

			expect(cache.restoreCache).toHaveBeenCalledWith(
				expect.any(Array),
				expect.stringContaining("pnpm-darwin-arm64-"),
				["pnpm-darwin-arm64-"],
			);
		});
	});
});

describe("saveCache", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		vi.mocked(core.info).mockImplementation(() => {});
		vi.mocked(core.warning).mockImplementation(() => {});
		vi.mocked(core.startGroup).mockImplementation(() => {});
		vi.mocked(core.endGroup).mockImplementation(() => {});
		vi.mocked(core.getState).mockReturnValue("");

		vi.mocked(cache.saveCache).mockResolvedValue(1);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("cache saving", () => {
		it("should save cache with correct key and paths", async () => {
			vi.mocked(core.getState).mockImplementation((name: string) => {
				if (name === "CACHE_PRIMARY_KEY") return "npm-linux-x64-abc123";
				if (name === "CACHE_PATHS") return JSON.stringify(["~/.npm", "**/node_modules"]);
				if (name === "CACHE_KEY") return "";
				return "";
			});

			await saveCache();

			expect(cache.saveCache).toHaveBeenCalledWith(["~/.npm", "**/node_modules"], "npm-linux-x64-abc123");
			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Cache saved successfully"));
		});

		it("should skip saving when no primary key", async () => {
			vi.mocked(core.getState).mockReturnValue("");

			await saveCache();

			expect(core.info).toHaveBeenCalledWith("No primary key found, skipping cache save");
			expect(cache.saveCache).not.toHaveBeenCalled();
		});

		it("should skip saving when cache hit occurred", async () => {
			vi.mocked(core.getState).mockImplementation((name: string) => {
				if (name === "CACHE_PRIMARY_KEY") return "npm-linux-x64-abc123";
				if (name === "CACHE_KEY") return "npm-linux-x64-abc123";
				if (name === "CACHE_PATHS") return JSON.stringify(["~/.npm"]);
				return "";
			});

			await saveCache();

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Cache hit occurred on primary key"));
			expect(cache.saveCache).not.toHaveBeenCalled();
		});

		it("should warn when cache save fails", async () => {
			vi.mocked(core.getState).mockImplementation((name: string) => {
				if (name === "CACHE_PRIMARY_KEY") return "npm-linux-x64-abc123";
				if (name === "CACHE_PATHS") return JSON.stringify(["~/.npm"]);
				if (name === "CACHE_KEY") return "";
				return "";
			});

			vi.mocked(cache.saveCache).mockResolvedValue(-1);

			await saveCache();

			expect(core.warning).toHaveBeenCalledWith("Cache save failed");
		});
	});

	describe("error handling", () => {
		it("should handle cache save errors gracefully", async () => {
			vi.mocked(core.getState).mockImplementation((name: string) => {
				if (name === "CACHE_PRIMARY_KEY") return "npm-linux-x64-abc123";
				if (name === "CACHE_PATHS") return JSON.stringify(["~/.npm"]);
				if (name === "CACHE_KEY") return "";
				return "";
			});

			vi.mocked(cache.saveCache).mockRejectedValue(new Error("Cache service unavailable"));

			await saveCache();

			expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Failed to save cache"));
		});

		it("should handle non-Error exceptions", async () => {
			vi.mocked(core.getState).mockImplementation((name: string) => {
				if (name === "CACHE_PRIMARY_KEY") return "npm-linux-x64-abc123";
				if (name === "CACHE_PATHS") return JSON.stringify(["~/.npm"]);
				if (name === "CACHE_KEY") return "";
				return "";
			});

			vi.mocked(cache.saveCache).mockRejectedValue("String error");

			await saveCache();

			expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("String error"));
		});
	});

	describe("output grouping", () => {
		it("should group cache save output", async () => {
			vi.mocked(core.getState).mockImplementation((name: string) => {
				if (name === "CACHE_PRIMARY_KEY") return "npm-linux-x64-abc123";
				if (name === "CACHE_PATHS") return JSON.stringify(["~/.npm"]);
				if (name === "CACHE_KEY") return "";
				return "";
			});

			await saveCache();

			expect(core.startGroup).toHaveBeenCalledWith("💾 Saving cache");
			expect(core.endGroup).toHaveBeenCalled();
		});

		it("should end group even on error", async () => {
			vi.mocked(core.getState).mockImplementation((name: string) => {
				if (name === "CACHE_PRIMARY_KEY") return "npm-linux-x64-abc123";
				if (name === "CACHE_PATHS") return JSON.stringify(["~/.npm"]);
				if (name === "CACHE_KEY") return "";
				return "";
			});

			vi.mocked(cache.saveCache).mockRejectedValue(new Error("Network error"));

			await saveCache();

			expect(core.endGroup).toHaveBeenCalled();
		});
	});
});
