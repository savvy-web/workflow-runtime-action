import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import type { Globber } from "@actions/glob";
import * as glob from "@actions/glob";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreCache, saveCache } from "../src/utils/cache-utils.js";

// Mock all dependencies
vi.mock("@actions/core");
vi.mock("@actions/cache");
vi.mock("@actions/exec");
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
		vi.mocked(core.debug).mockImplementation(() => {});
		vi.mocked(core.warning).mockImplementation(() => {});
		vi.mocked(core.startGroup).mockImplementation(() => {});
		vi.mocked(core.endGroup).mockImplementation(() => {});
		vi.mocked(core.setOutput).mockImplementation(() => {});
		vi.mocked(core.saveState).mockImplementation(() => {});
		vi.mocked(core.getState).mockReturnValue("");

		vi.mocked(cache.restoreCache).mockResolvedValue(undefined);
		vi.mocked(cache.saveCache).mockResolvedValue(1);

		// Mock exec.exec for cache path detection
		// Default: simulate successful cache path detection for each package manager
		vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
			const argsStr = args?.join(" ") || "";

			// Simulate cache path detection commands
			if (command === "npm" && argsStr === "config get cache") {
				if (options?.listeners?.stdout) {
					options.listeners.stdout(Buffer.from("/home/user/.npm\n"));
				}
				return 0;
			}

			if (command === "pnpm" && argsStr === "store path") {
				if (options?.listeners?.stdout) {
					options.listeners.stdout(Buffer.from("/home/user/.local/share/pnpm/store\n"));
				}
				return 0;
			}

			if (command === "yarn" && argsStr === "config get cacheFolder") {
				if (options?.listeners?.stdout) {
					options.listeners.stdout(Buffer.from("/home/user/.yarn/cache\n"));
				}
				return 0;
			}

			return 0;
		});

		// Mock globber
		const globber = {
			glob: vi.fn().mockResolvedValue(["package-lock.json"]),
			getSearchPaths: vi.fn().mockReturnValue([]),
			globGenerator: vi.fn(),
		};
		vi.mocked(glob.create).mockResolvedValue(globber as unknown as Globber);

		// Mock file reading and hashing
		vi.mocked(readFile).mockResolvedValue("lockfile content");

		// Mock createHash - it's called twice per restoreCache call:
		// 1. For version hash (runtime versions + package manager)
		// 2. For lockfile hash
		vi.mocked(createHash).mockImplementation(() => {
			const mockHash = {
				update: vi.fn().mockReturnThis(),
				digest: vi.fn().mockReturnValue("abc123def456"),
			};
			return mockHash as never;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("npm caching", () => {
		it("should restore npm cache with detected path", async () => {
			await restoreCache("npm", { node: "24.11.0" }, "10.20.0");

			expect(exec.exec).toHaveBeenCalledWith("npm", ["config", "get", "cache"], expect.any(Object));
			expect(cache.restoreCache).toHaveBeenCalledWith(
				["/home/user/.npm", "**/node_modules"],
				"linux-abc123def456-abc123def456",
				["linux-abc123def456-"],
			);
			expect(core.setOutput).toHaveBeenCalledWith("lockfiles", "package-lock.json");
			expect(core.setOutput).toHaveBeenCalledWith("cache-paths", "/home/user/.npm,**/node_modules");
		});

		it("should use default paths when detection fails", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(exec.exec).mockResolvedValue(1); // Simulate failure

			await restoreCache("npm", { node: "24.11.0" }, "10.20.0");

			expect(cache.restoreCache).toHaveBeenCalledWith(
				["~/AppData/Local/npm-cache", "**/node_modules"],
				"win32-abc123def456-abc123def456",
				["win32-abc123def456-"],
			);
		});

		it("should find package-lock.json files", async () => {
			await restoreCache("npm", { node: "24.11.0" }, "10.20.0");

			expect(glob.create).toHaveBeenCalledWith("**/package-lock.json", expect.any(Object));
		});

		it("should warn when no lock files found", async () => {
			const globber = await glob.create("**/*.json");
			vi.mocked(globber.glob).mockResolvedValue([]);

			await restoreCache("npm", { node: "24.11.0" }, "10.20.0");

			expect(core.info).toHaveBeenCalledWith("No lock files found for 📦 npm, caching without lockfile hash");
			expect(core.setOutput).toHaveBeenCalledWith("lockfiles", "");
			// Cache paths should still be set even without lockfiles
			expect(core.setOutput).toHaveBeenCalledWith("cache-paths", expect.any(String));
			// Should still attempt to restore cache
			expect(cache.restoreCache).toHaveBeenCalled();
		});
	});

	describe("pnpm caching", () => {
		it("should restore pnpm cache with detected path", async () => {
			await restoreCache("pnpm", { node: "24.11.0" }, "10.20.0");

			expect(exec.exec).toHaveBeenCalledWith("pnpm", ["store", "path"], expect.any(Object));
			expect(cache.restoreCache).toHaveBeenCalledWith(
				["/home/user/.local/share/pnpm/store", "**/node_modules"],
				"linux-abc123def456-abc123def456",
				["linux-abc123def456-"],
			);
		});

		it("should use default paths when detection fails", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(exec.exec).mockResolvedValue(1); // Simulate failure

			await restoreCache("pnpm", { node: "24.11.0" }, "10.20.0");

			expect(cache.restoreCache).toHaveBeenCalledWith(
				["~/AppData/Local/pnpm/store", "**/node_modules"],
				"win32-abc123def456-abc123def456",
				["win32-abc123def456-"],
			);
		});

		it("should find pnpm-lock.yaml files", async () => {
			await restoreCache("pnpm", { node: "24.11.0" }, "10.20.0");

			expect(glob.create).toHaveBeenCalledWith(
				"**/pnpm-lock.yaml\n**/pnpm-workspace.yaml\n**/.pnpmfile.cjs",
				expect.any(Object),
			);
		});
	});

	describe("yarn caching", () => {
		it("should restore yarn cache with detected path", async () => {
			await restoreCache("yarn", { node: "24.11.0" }, "10.20.0");

			expect(exec.exec).toHaveBeenCalledWith("yarn", ["config", "get", "cacheFolder"], expect.any(Object));
			expect(cache.restoreCache).toHaveBeenCalledWith(
				[
					"/home/user/.yarn/cache",
					"**/node_modules",
					"**/.yarn/cache",
					"**/.yarn/unplugged",
					"**/.yarn/install-state.gz",
				],
				"linux-abc123def456-abc123def456",
				["linux-abc123def456-"],
			);
		});

		it("should use default paths when detection fails", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(exec.exec).mockResolvedValue(1); // Simulate failure

			await restoreCache("yarn", { node: "24.11.0" }, "10.20.0");

			expect(cache.restoreCache).toHaveBeenCalledWith(
				expect.arrayContaining(["~/AppData/Local/Yarn/Cache", "~/AppData/Local/Yarn/Berry/cache"]),
				"win32-abc123def456-abc123def456",
				["win32-abc123def456-"],
			);
		});

		it("should find yarn.lock files", async () => {
			await restoreCache("yarn", { node: "24.11.0" }, "10.20.0");

			expect(glob.create).toHaveBeenCalledWith(
				"**/yarn.lock\n**/.pnp.cjs\n**/.yarn/install-state.gz",
				expect.any(Object),
			);
		});

		it("should fallback to yarn cache dir for Yarn Classic", async () => {
			// Mock Yarn Berry returning "undefined", then Yarn Classic succeeding
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				const argsStr = args?.join(" ") || "";

				if (command === "yarn" && argsStr === "config get cacheFolder") {
					// Yarn Berry returns "undefined" when cacheFolder not set
					if (options?.listeners?.stdout) {
						options.listeners.stdout(Buffer.from("undefined\n"));
					}
					return 0;
				}

				if (command === "yarn" && argsStr === "cache dir") {
					// Yarn Classic fallback
					if (options?.listeners?.stdout) {
						options.listeners.stdout(Buffer.from("/home/user/.cache/yarn/v6\n"));
					}
					return 0;
				}

				return 0;
			});

			await restoreCache("yarn", { node: "24.11.0" }, "10.20.0");

			expect(exec.exec).toHaveBeenCalledWith("yarn", ["config", "get", "cacheFolder"], expect.any(Object));
			expect(exec.exec).toHaveBeenCalledWith("yarn", ["cache", "dir"], expect.any(Object));
			expect(cache.restoreCache).toHaveBeenCalledWith(
				expect.arrayContaining(["/home/user/.cache/yarn/v6"]),
				"linux-abc123def456-abc123def456",
				["linux-abc123def456-"],
			);
		});
	});

	describe("bun caching", () => {
		beforeEach(() => {
			// Mock bun pm cache command
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "bun" && args?.join(" ") === "pm cache") {
					if (options?.listeners?.stdout) {
						options.listeners.stdout(Buffer.from("/home/user/.bun/install/cache\n"));
					}
					return 0;
				}
				return 0;
			});

			// Mock globber for bun.lock
			const globber = {
				glob: vi.fn().mockResolvedValue(["bun.lock"]),
				getSearchPaths: vi.fn().mockReturnValue([]),
				globGenerator: vi.fn(),
			};
			vi.mocked(glob.create).mockResolvedValue(globber as unknown as Globber);
		});

		it("should restore bun cache with detected path", async () => {
			await restoreCache("bun", { bun: "1.3.3" }, "1.3.3");

			expect(exec.exec).toHaveBeenCalledWith("bun", ["pm", "cache"], expect.any(Object));
			expect(cache.restoreCache).toHaveBeenCalledWith(
				["/home/user/.bun/install/cache", "**/node_modules"],
				"linux-abc123def456-abc123def456",
				["linux-abc123def456-"],
			);
		});

		it("should use default paths when detection fails", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(exec.exec).mockResolvedValue(1); // Simulate failure

			await restoreCache("bun", { bun: "1.3.3" }, "1.3.3");

			expect(cache.restoreCache).toHaveBeenCalledWith(
				["~/AppData/Local/bun/install/cache", "**/node_modules"],
				"win32-abc123def456-abc123def456",
				["win32-abc123def456-"],
			);
		});

		it("should find bun.lock files", async () => {
			await restoreCache("bun", { bun: "1.3.3" }, "1.3.3");

			expect(glob.create).toHaveBeenCalledWith("**/bun.lock", expect.any(Object));
		});
	});

	describe("deno caching", () => {
		beforeEach(() => {
			// Mock deno info --json command
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "deno" && args?.join(" ") === "info --json") {
					if (options?.listeners?.stdout) {
						options.listeners.stdout(Buffer.from(JSON.stringify({ denoDir: "/home/user/.cache/deno" })));
					}
					return 0;
				}
				return 0;
			});

			// Mock globber for deno.lock
			const globber = {
				glob: vi.fn().mockResolvedValue(["deno.lock"]),
				getSearchPaths: vi.fn().mockReturnValue([]),
				globGenerator: vi.fn(),
			};
			vi.mocked(glob.create).mockResolvedValue(globber as unknown as Globber);
		});

		it("should restore deno cache with detected path", async () => {
			await restoreCache("deno", { deno: "2.1.0" }, "2.1.0");

			expect(exec.exec).toHaveBeenCalledWith("deno", ["info", "--json"], expect.any(Object));
			expect(cache.restoreCache).toHaveBeenCalledWith(["/home/user/.cache/deno"], "linux-abc123def456-abc123def456", [
				"linux-abc123def456-",
			]);
			expect(core.setOutput).toHaveBeenCalledWith("lockfiles", "deno.lock");
			expect(core.setOutput).toHaveBeenCalledWith("cache-paths", "/home/user/.cache/deno");
		});

		it("should use default paths when detection fails", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(exec.exec).mockResolvedValue(1); // Simulate failure

			await restoreCache("deno", { deno: "2.1.0" }, "2.1.0");

			expect(cache.restoreCache).toHaveBeenCalledWith(["~/AppData/Local/deno"], "win32-abc123def456-abc123def456", [
				"win32-abc123def456-",
			]);
		});

		it("should find deno.lock files", async () => {
			await restoreCache("deno", { deno: "2.1.0" }, "2.1.0");

			expect(glob.create).toHaveBeenCalledWith("**/deno.lock", expect.any(Object));
		});

		it("should handle JSON parsing errors gracefully", async () => {
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "deno" && args?.join(" ") === "info --json") {
					if (options?.listeners?.stdout) {
						options.listeners.stdout(Buffer.from("invalid json"));
					}
					return 0;
				}
				return 0;
			});

			await restoreCache("deno", { deno: "2.1.0" }, "2.1.0");

			// Should fallback to default paths
			expect(cache.restoreCache).toHaveBeenCalledWith(["~/.cache/deno"], "linux-abc123def456-abc123def456", [
				"linux-abc123def456-",
			]);
		});
	});

	describe("cache path detection", () => {
		it("should handle detection errors gracefully", async () => {
			// Mock exec.exec to throw an error
			vi.mocked(exec.exec).mockRejectedValue(new Error("Command failed"));

			await restoreCache("npm", { node: "24.11.0" }, "10.20.0");

			// Should fallback to default paths
			expect(cache.restoreCache).toHaveBeenCalledWith(
				expect.arrayContaining(["~/.npm"]),
				expect.any(String),
				expect.any(Array),
			);
		});
	});

	describe("cache hit detection", () => {
		it("should set cache-hit to true on exact match", async () => {
			// Mock the exact key that will be generated
			const exactKey = "linux-abc123-abc123def456";
			vi.mocked(cache.restoreCache).mockResolvedValue(exactKey);

			// Mock createHash to return consistent values
			const mockHash = {
				update: vi.fn().mockReturnThis(),
				digest: vi.fn().mockReturnValueOnce("abc123").mockReturnValueOnce("abc123def456"),
			};
			vi.mocked(createHash).mockReturnValue(mockHash as never);

			await restoreCache("npm", { node: "24.11.0" }, "10.20.0");

			expect(core.setOutput).toHaveBeenCalledWith("cache-hit", "true");
		});

		it("should set cache-hit to partial on restore key match", async () => {
			// Mock a partial match (different lockfile hash)
			const partialKey = "linux-abc123-differenthash";
			vi.mocked(cache.restoreCache).mockResolvedValue(partialKey);

			// Mock createHash to return consistent values
			const mockHash = {
				update: vi.fn().mockReturnThis(),
				digest: vi.fn().mockReturnValueOnce("abc123").mockReturnValueOnce("abc123def456"),
			};
			vi.mocked(createHash).mockReturnValue(mockHash as never);

			await restoreCache("npm", { node: "24.11.0" }, "10.20.0");

			expect(core.setOutput).toHaveBeenCalledWith("cache-hit", "partial");
		});

		it("should set cache-hit to false when no cache found", async () => {
			vi.mocked(cache.restoreCache).mockResolvedValue(undefined);

			await restoreCache("npm", { node: "24.11.0" }, "10.20.0");

			expect(core.setOutput).toHaveBeenCalledWith("cache-hit", "false");
		});
	});

	describe("state management", () => {
		it("should save cache state when cache is restored", async () => {
			vi.mocked(cache.restoreCache).mockResolvedValue("linux-abc123-abc123def456");

			await restoreCache("npm", { node: "24.11.0" }, "10.20.0");

			expect(core.saveState).toHaveBeenCalledWith("CACHE_KEY", "linux-abc123-abc123def456");
			expect(core.saveState).toHaveBeenCalledWith("CACHE_PRIMARY_KEY", expect.any(String));
			expect(core.saveState).toHaveBeenCalledWith("CACHE_PATHS", expect.any(String));
		});

		it("should save state even when cache not found", async () => {
			vi.mocked(cache.restoreCache).mockResolvedValue(undefined);

			await restoreCache("npm", { node: "24.11.0" }, "10.20.0");

			expect(core.saveState).toHaveBeenCalledWith("CACHE_PRIMARY_KEY", expect.any(String));
			expect(core.saveState).toHaveBeenCalledWith("CACHE_PATHS", expect.any(String));
		});
	});

	describe("error handling", () => {
		it("should handle cache restore errors gracefully", async () => {
			vi.mocked(cache.restoreCache).mockRejectedValue(new Error("Cache service unavailable"));

			const result = await restoreCache("npm", { node: "24.11.0" }, "10.20.0");

			expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Failed to restore cache"));
			expect(result).toBeUndefined();
		});

		it("should warn on file read errors during hashing", async () => {
			vi.mocked(readFile).mockRejectedValue(new Error("File not found"));

			await restoreCache("npm", { node: "24.11.0" }, "10.20.0");

			expect(core.warning).toHaveBeenCalledWith(
				expect.stringContaining("Failed to read package-lock.json for hashing"),
			);
		});
	});

	describe("architecture handling", () => {
		it("should include platform in cache key", async () => {
			vi.mocked(platform).mockReturnValue("linux");

			await restoreCache("npm", { node: "24.11.0" }, "10.20.0");

			expect(cache.restoreCache).toHaveBeenCalledWith(expect.any(Array), "linux-abc123def456-abc123def456", [
				"linux-abc123def456-",
			]);
		});

		it("should handle different platforms", async () => {
			vi.mocked(platform).mockReturnValue("darwin");

			await restoreCache("pnpm", { node: "24.11.0" }, "10.20.0");

			expect(cache.restoreCache).toHaveBeenCalledWith(expect.any(Array), "darwin-abc123def456-abc123def456", [
				"darwin-abc123def456-",
			]);
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
				if (name === "CACHE_PRIMARY_KEY") return "linux-abc123-abc123";
				if (name === "CACHE_PATHS") return JSON.stringify(["~/.npm", "**/node_modules"]);
				if (name === "CACHE_KEY") return "";
				return "";
			});

			await saveCache();

			expect(cache.saveCache).toHaveBeenCalledWith(["~/.npm", "**/node_modules"], "linux-abc123-abc123");
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
				if (name === "CACHE_PRIMARY_KEY") return "linux-abc123-abc123";
				if (name === "CACHE_KEY") return "linux-abc123-abc123";
				if (name === "CACHE_PATHS") return JSON.stringify(["~/.npm"]);
				return "";
			});

			await saveCache();

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Cache hit occurred on primary key"));
			expect(cache.saveCache).not.toHaveBeenCalled();
		});

		it("should warn when cache save fails", async () => {
			vi.mocked(core.getState).mockImplementation((name: string) => {
				if (name === "CACHE_PRIMARY_KEY") return "linux-abc123-abc123";
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
				if (name === "CACHE_PRIMARY_KEY") return "linux-abc123-abc123";
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
				if (name === "CACHE_PRIMARY_KEY") return "linux-abc123-abc123";
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
				if (name === "CACHE_PRIMARY_KEY") return "linux-abc123-abc123";
				if (name === "CACHE_PATHS") return JSON.stringify(["~/.npm"]);
				if (name === "CACHE_KEY") return "";
				return "";
			});

			await saveCache();

			expect(core.startGroup).toHaveBeenCalledWith("♻️ Saving cache for: dependencies");
			expect(core.endGroup).toHaveBeenCalled();
		});

		it("should end group even on error", async () => {
			vi.mocked(core.getState).mockImplementation((name: string) => {
				if (name === "CACHE_PRIMARY_KEY") return "linux-abc123-abc123";
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

describe("multi-package manager support", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Setup default mocks
		vi.mocked(platform).mockReturnValue("linux");
		vi.mocked(arch).mockReturnValue("x64");

		vi.mocked(core.info).mockImplementation(() => {});
		vi.mocked(core.debug).mockImplementation(() => {});
		vi.mocked(core.warning).mockImplementation(() => {});
		vi.mocked(core.startGroup).mockImplementation(() => {});
		vi.mocked(core.endGroup).mockImplementation(() => {});
		vi.mocked(core.setOutput).mockImplementation(() => {});
		vi.mocked(core.saveState).mockImplementation(() => {});
		vi.mocked(core.getState).mockReturnValue("");

		vi.mocked(cache.restoreCache).mockResolvedValue(undefined);
		vi.mocked(cache.saveCache).mockResolvedValue(1);

		// Mock exec.exec for cache path detection
		vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
			const argsStr = args?.join(" ") || "";

			if (command === "pnpm" && argsStr === "store path") {
				if (options?.listeners?.stdout) {
					options.listeners.stdout(Buffer.from("/home/user/.local/share/pnpm/store\n"));
				}
				return 0;
			}

			if (command === "deno" && argsStr === "info --json") {
				if (options?.listeners?.stdout) {
					options.listeners.stdout(Buffer.from(JSON.stringify({ denoDir: "/home/user/.cache/deno" })));
				}
				return 0;
			}

			if (command === "bun" && argsStr === "pm cache") {
				if (options?.listeners?.stdout) {
					options.listeners.stdout(Buffer.from("/home/user/.bun/install/cache\n"));
				}
				return 0;
			}

			return 0;
		});

		// Mock file reading and hashing
		vi.mocked(readFile).mockResolvedValue("lockfile content");

		// Mock createHash - it's called twice per restoreCache call
		vi.mocked(createHash).mockImplementation(() => {
			const mockHash = {
				update: vi.fn().mockReturnThis(),
				digest: vi.fn().mockReturnValue("multihash123"),
			};
			return mockHash as never;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("restoreCache with multiple package managers", () => {
		it("should accept array of package managers", async () => {
			// Mock globber to return lock files for both package managers
			const globber = {
				glob: vi.fn().mockResolvedValue(["pnpm-lock.yaml", "deno.lock"]),
				getSearchPaths: vi.fn().mockReturnValue([]),
				globGenerator: vi.fn(),
			};
			vi.mocked(glob.create).mockResolvedValue(globber as unknown as Globber);

			await restoreCache(["pnpm", "deno"], { node: "24.11.0", deno: "2.1.0" }, "10.20.0");

			// Should use the primary package manager (first in array) for cache key
			expect(cache.restoreCache).toHaveBeenCalledWith(expect.any(Array), "linux-multihash123-multihash123", [
				"linux-multihash123-",
			]);
		});

		it("should deduplicate cache paths from multiple package managers", async () => {
			const globber = {
				glob: vi.fn().mockResolvedValue(["pnpm-lock.yaml", "deno.lock"]),
				getSearchPaths: vi.fn().mockReturnValue([]),
				globGenerator: vi.fn(),
			};
			vi.mocked(glob.create).mockResolvedValue(globber as unknown as Globber);

			await restoreCache(["pnpm", "deno"], { node: "24.11.0", deno: "2.1.0" }, "10.20.0");

			const cacheCall = vi.mocked(cache.restoreCache).mock.calls[0];
			const cachePaths = cacheCall[0];

			// Check that paths are deduplicated (no duplicates)
			const uniquePaths = new Set(cachePaths);
			expect(cachePaths.length).toBe(uniquePaths.size);

			// Should include pnpm store path
			expect(cachePaths).toContain("/home/user/.local/share/pnpm/store");

			// Should include deno cache path
			expect(cachePaths).toContain("/home/user/.cache/deno");

			// Should include node_modules for pnpm (but only once)
			const nodeModulesCount = cachePaths.filter((p: string) => p === "**/node_modules").length;
			expect(nodeModulesCount).toBe(1);
		});

		it("should combine lock file patterns from all package managers", async () => {
			const globber = {
				glob: vi.fn().mockResolvedValue(["pnpm-lock.yaml", "bun.lock"]),
				getSearchPaths: vi.fn().mockReturnValue([]),
				globGenerator: vi.fn(),
			};
			vi.mocked(glob.create).mockResolvedValue(globber as unknown as Globber);

			await restoreCache(["pnpm", "bun"], { node: "24.11.0", bun: "1.3.3" }, "10.20.0");

			// Should create globber with both lock file patterns
			const createCallArg = vi.mocked(glob.create).mock.calls[0][0];
			expect(createCallArg).toContain("**/pnpm-lock.yaml");
			expect(createCallArg).toContain("**/bun.lock");
		});

		it("should use primary package manager for cache key", async () => {
			const globber = {
				glob: vi.fn().mockResolvedValue(["yarn.lock", "bun.lock"]),
				getSearchPaths: vi.fn().mockReturnValue([]),
				globGenerator: vi.fn(),
			};
			vi.mocked(glob.create).mockResolvedValue(globber as unknown as Globber);

			// Pass in specific order - primary is first (yarn)
			await restoreCache(["yarn", "bun"], { node: "24.11.0", bun: "1.3.3" }, "10.20.0");

			// Cache key should use the primary package manager (yarn, first in array)
			expect(cache.restoreCache).toHaveBeenCalledWith(expect.any(Array), "linux-multihash123-multihash123", [
				"linux-multihash123-",
			]);
		});

		it("should save all package managers to state", async () => {
			const globber = {
				glob: vi.fn().mockResolvedValue(["pnpm-lock.yaml", "deno.lock"]),
				getSearchPaths: vi.fn().mockReturnValue([]),
				globGenerator: vi.fn(),
			};
			vi.mocked(glob.create).mockResolvedValue(globber as unknown as Globber);

			vi.mocked(cache.restoreCache).mockResolvedValue("linux-abc123-multihash123");

			await restoreCache(["pnpm", "deno"], { node: "24.11.0", deno: "2.1.0" }, "10.20.0");

			// Should save package managers array to state
			expect(core.saveState).toHaveBeenCalledWith("PACKAGE_MANAGERS", JSON.stringify(["pnpm", "deno"]));
		});
	});

	describe("saveCache with multiple package managers", () => {
		it("should save cache with multiple package managers from state", async () => {
			vi.mocked(core.getState).mockImplementation((name: string) => {
				if (name === "CACHE_PRIMARY_KEY") return "linux-abc123-multihash123";
				if (name === "CACHE_PATHS")
					return JSON.stringify(["/home/user/.local/share/pnpm/store", "/home/user/.cache/deno", "**/node_modules"]);
				if (name === "PACKAGE_MANAGERS") return JSON.stringify(["pnpm", "deno"]);
				if (name === "CACHE_KEY") return "";
				return "";
			});

			await saveCache();

			expect(cache.saveCache).toHaveBeenCalledWith(
				["/home/user/.local/share/pnpm/store", "/home/user/.cache/deno", "**/node_modules"],
				"linux-abc123-multihash123",
			);
			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("pnpm, deno"));
		});

		it("should handle missing PACKAGE_MANAGERS state gracefully", async () => {
			vi.mocked(core.getState).mockImplementation((name: string) => {
				if (name === "CACHE_PRIMARY_KEY") return "linux-abc123-abc123";
				if (name === "CACHE_PATHS") return JSON.stringify(["~/.npm"]);
				if (name === "CACHE_KEY") return "";
				// PACKAGE_MANAGERS not set (backwards compatibility)
				return "";
			});

			await saveCache();

			// Should still save cache successfully
			expect(cache.saveCache).toHaveBeenCalledWith(["~/.npm"], "linux-abc123-abc123");
			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("unknown"));
		});
	});

	describe("backwards compatibility", () => {
		it("should accept single package manager string", async () => {
			const globber = {
				glob: vi.fn().mockResolvedValue(["pnpm-lock.yaml"]),
				getSearchPaths: vi.fn().mockReturnValue([]),
				globGenerator: vi.fn(),
			};
			vi.mocked(glob.create).mockResolvedValue(globber as unknown as Globber);

			// Single string (not array)
			await restoreCache("pnpm", { node: "24.11.0" }, "10.20.0");

			expect(cache.restoreCache).toHaveBeenCalledWith(expect.any(Array), "linux-multihash123-multihash123", [
				"linux-multihash123-",
			]);
		});
	});
});
