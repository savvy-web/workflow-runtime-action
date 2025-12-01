import { readdirSync } from "node:fs";
import { arch, platform } from "node:os";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installNode, setupNpm, setupPackageManager } from "../src/utils/install-node.js";

// Mock all modules
vi.mock("@actions/core");
vi.mock("@actions/exec");
vi.mock("@actions/tool-cache");
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
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("exact version installation", () => {
		it("should use cached Node.js when available", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node-20.11.0");

			await installNode({ version: "20.11.0" });

			expect(tc.find).toHaveBeenCalledWith("node", "20.11.0");
			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("🟢 Detected Node.js 20.11.0 in tool cache"));
			expect(tc.downloadTool).not.toHaveBeenCalled();
		});

		it("should download Node.js when not cached", async () => {
			vi.mocked(tc.find).mockReturnValue("");

			await installNode({ version: "20.11.0" });

			expect(tc.find).toHaveBeenCalledWith("node", "20.11.0");
			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("⚪ No Node.js 20.11.0 in cache"));
			expect(tc.downloadTool).toHaveBeenCalled();
			expect(tc.extractTar).toHaveBeenCalled();
			expect(tc.cacheDir).toHaveBeenCalled();
		});

		it("should add correct path on Linux", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");

			await installNode({ version: "20.11.0" });

			expect(core.addPath).toHaveBeenCalledWith("/cached/node/bin");
		});

		it("should add correct path on Windows", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(tc.find).mockReturnValue("/cached/node");

			await installNode({ version: "20.11.0" });

			expect(core.addPath).toHaveBeenCalledWith("/cached/node");
		});

		it("should verify installation", async () => {
			vi.mocked(tc.find).mockReturnValue("/cached/node");

			await installNode({ version: "20.11.0" });

			expect(exec.exec).toHaveBeenCalledWith("node", ["--version"]);
			expect(exec.exec).toHaveBeenCalledWith("npm", ["--version"]);
		});
	});

	describe("Windows extraction", () => {
		it("should use extractZip on Windows", async () => {
			vi.mocked(platform).mockReturnValue("win32");
			vi.mocked(tc.find).mockReturnValue("");
			vi.mocked(readdirSync).mockReturnValue(["node-v20.11.0-win32-x64"] as unknown as ReturnType<typeof readdirSync>);

			await installNode({ version: "20.11.0" });

			expect(tc.extractZip).toHaveBeenCalledWith("/tmp/download");
			expect(tc.extractTar).not.toHaveBeenCalled();
		});
	});

	describe("error handling", () => {
		it("should throw error on download failure", async () => {
			vi.mocked(tc.find).mockReturnValue("");
			vi.mocked(tc.downloadTool).mockRejectedValue(new Error("Network error"));

			await expect(installNode({ version: "20.11.0" })).rejects.toThrow("Failed to install Node.js");
		});

		it("should throw error on extraction failure", async () => {
			vi.mocked(tc.find).mockReturnValue("");
			vi.mocked(tc.extractTar).mockRejectedValue(new Error("Extraction failed"));

			await expect(installNode({ version: "20.11.0" })).rejects.toThrow("Failed to install Node.js");
		});

		it("should throw error when node directory not found in extraction", async () => {
			vi.mocked(tc.find).mockReturnValue("");
			vi.mocked(readdirSync).mockReturnValue(["some-other-file"] as unknown as ReturnType<typeof readdirSync>);

			await expect(installNode({ version: "20.11.0" })).rejects.toThrow("Failed to install Node.js");
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

	describe("Node.js version detection", () => {
		it("should install corepack globally when Node.js >= 25", async () => {
			// Mock node --version to return v25.0.0
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "node" && args?.[0] === "--version") {
					options?.listeners?.stdout?.(Buffer.from("v25.0.0\n"));
				}
				return 0;
			});

			await setupPackageManager("pnpm", "10.20.0");

			expect(core.info).toHaveBeenCalledWith("Node.js v25.0.0 detected - corepack not bundled, installing globally...");
			expect(exec.exec).toHaveBeenCalledWith("npm", ["install", "-g", "--force", "corepack@latest"]);
			expect(core.info).toHaveBeenCalledWith("✅ corepack installed successfully");
		});

		it("should install corepack globally when Node.js > 25", async () => {
			// Mock node --version to return v26.1.0
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "node" && args?.[0] === "--version") {
					options?.listeners?.stdout?.(Buffer.from("v26.1.0\n"));
				}
				return 0;
			});

			await setupPackageManager("pnpm", "10.20.0");

			expect(core.info).toHaveBeenCalledWith("Node.js v26.1.0 detected - corepack not bundled, installing globally...");
			expect(exec.exec).toHaveBeenCalledWith("npm", ["install", "-g", "--force", "corepack@latest"]);
		});

		it("should NOT install corepack globally when Node.js < 25", async () => {
			// Mock node --version to return v24.11.0
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "node" && args?.[0] === "--version") {
					options?.listeners?.stdout?.(Buffer.from("v24.11.0\n"));
				}
				return 0;
			});

			await setupPackageManager("pnpm", "10.20.0");

			// Should NOT install corepack
			expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("corepack not bundled"));
			expect(exec.exec).not.toHaveBeenCalledWith("npm", ["install", "-g", "--force", "corepack@latest"]);
		});

		it("should handle malformed Node.js version gracefully", async () => {
			// Mock node --version to return something unexpected
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "node" && args?.[0] === "--version") {
					options?.listeners?.stdout?.(Buffer.from("invalid-version\n"));
				}
				return 0;
			});

			// Should not throw, just skip corepack installation
			await setupPackageManager("pnpm", "10.20.0");

			expect(exec.exec).not.toHaveBeenCalledWith("npm", ["install", "-g", "--force", "corepack@latest"]);
		});
	});

	describe("pnpm setup", () => {
		it("should enable corepack and prepare package manager with explicit version", async () => {
			// Mock node --version to return v24.11.0
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "node" && args?.[0] === "--version") {
					options?.listeners?.stdout?.(Buffer.from("v24.11.0\n"));
				}
				return 0;
			});

			await setupPackageManager("pnpm", "10.20.0");

			expect(core.info).toHaveBeenCalledWith("Enabling corepack...");
			expect(exec.exec).toHaveBeenCalledWith("corepack", ["enable"]);
			expect(core.info).toHaveBeenCalledWith("Preparing package manager pnpm@10.20.0...");
			expect(exec.exec).toHaveBeenCalledWith("corepack", ["prepare", "pnpm@10.20.0", "--activate"]);
			expect(exec.exec).toHaveBeenCalledWith("pnpm", ["--version"]);
		});
	});

	describe("yarn setup", () => {
		it("should enable corepack and prepare package manager with explicit version", async () => {
			// Mock node --version to return v24.11.0
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "node" && args?.[0] === "--version") {
					options?.listeners?.stdout?.(Buffer.from("v24.11.0\n"));
				}
				return 0;
			});

			await setupPackageManager("yarn", "4.0.0");

			expect(core.info).toHaveBeenCalledWith("Enabling corepack...");
			expect(exec.exec).toHaveBeenCalledWith("corepack", ["enable"]);
			expect(core.info).toHaveBeenCalledWith("Preparing package manager yarn@4.0.0...");
			expect(exec.exec).toHaveBeenCalledWith("corepack", ["prepare", "yarn@4.0.0", "--activate"]);
			expect(exec.exec).toHaveBeenCalledWith("yarn", ["--version"]);
		});
	});

	describe("error handling", () => {
		it("should throw error when corepack enable fails", async () => {
			// Mock node --version to return v24.11.0
			let callCount = 0;
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "node" && args?.[0] === "--version") {
					options?.listeners?.stdout?.(Buffer.from("v24.11.0\n"));
					return 0;
				}
				callCount++;
				if (callCount === 1) {
					throw new Error("Corepack not found");
				}
				return 0;
			});

			await expect(setupPackageManager("pnpm", "10.20.0")).rejects.toThrow("Failed to setup package manager");
			expect(core.endGroup).toHaveBeenCalled();
		});

		it("should throw error when prepare fails", async () => {
			// Mock node --version to return v24.11.0
			let callCount = 0;
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "node" && args?.[0] === "--version") {
					options?.listeners?.stdout?.(Buffer.from("v24.11.0\n"));
					return 0;
				}
				callCount++;
				if (callCount === 2) {
					throw new Error("Network error");
				}
				return 0;
			});

			await expect(setupPackageManager("yarn", "4.0.0")).rejects.toThrow("Failed to setup package manager");
		});

		it("should throw error when verification fails", async () => {
			// Mock node --version to return v24.11.0
			let callCount = 0;
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "node" && args?.[0] === "--version") {
					options?.listeners?.stdout?.(Buffer.from("v24.11.0\n"));
					return 0;
				}
				callCount++;
				if (callCount === 3) {
					throw new Error("Command not found");
				}
				return 0;
			});

			await expect(setupPackageManager("pnpm", "10.20.0")).rejects.toThrow("Failed to setup package manager");
		});
	});
});

describe("setupNpm", () => {
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

	describe("npm version management", () => {
		it("should skip installation when npm version matches", async () => {
			// Mock npm --version to return 10.0.0
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "npm" && args?.[0] === "--version") {
					options?.listeners?.stdout?.(Buffer.from("10.0.0"));
				}
				return 0;
			});

			await setupNpm("10.0.0");

			expect(core.info).toHaveBeenCalledWith("Current npm version: 10.0.0");
			expect(core.info).toHaveBeenCalledWith("Required npm version: 10.0.0");
			expect(core.info).toHaveBeenCalledWith("✅ npm version 10.0.0 already matches required version");
			expect(exec.exec).not.toHaveBeenCalledWith("npm", ["install", "-g", expect.any(String)]);
		});

		it("should install npm when version does not match", async () => {
			// Mock platform to return linux (triggers sudo usage)
			vi.mocked(platform).mockReturnValue("linux");

			let versionCallCount = 0;
			// Mock npm --version to return 9.0.0 first, then 10.0.0 after install
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "npm" && args?.[0] === "--version") {
					versionCallCount++;
					const version = versionCallCount === 1 ? "9.0.0" : "10.0.0";
					options?.listeners?.stdout?.(Buffer.from(version));
				}
				return 0;
			});

			await setupNpm("10.0.0");

			expect(core.info).toHaveBeenCalledWith("Current npm version: 9.0.0");
			expect(core.info).toHaveBeenCalledWith("Required npm version: 10.0.0");
			expect(core.info).toHaveBeenCalledWith("Installing npm@10.0.0...");
			// On Linux/macOS, uses sudo
			expect(exec.exec).toHaveBeenCalledWith("sudo", ["npm", "install", "-g", "npm@10.0.0"]);
			expect(core.info).toHaveBeenCalledWith("✅ npm@10.0.0 installed successfully");
		});

		it("should verify installation after installing", async () => {
			let versionCallCount = 0;
			// Mock npm --version to return 9.0.0 first, then 10.0.0 after install
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "npm" && args?.[0] === "--version") {
					versionCallCount++;
					const version = versionCallCount === 1 ? "9.0.0" : "10.0.0";
					options?.listeners?.stdout?.(Buffer.from(version));
				}
				return 0;
			});

			await setupNpm("10.0.0");

			// Should call npm --version twice: once to check, once to verify
			expect(versionCallCount).toBe(2);
		});
	});

	describe("error handling", () => {
		it("should throw error when version check fails", async () => {
			vi.mocked(exec.exec).mockRejectedValueOnce(new Error("npm not found"));

			await expect(setupNpm("10.0.0")).rejects.toThrow("Failed to setup npm");
			expect(core.endGroup).toHaveBeenCalled();
		});

		it("should throw error when installation fails", async () => {
			let callCount = 0;
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				if (command === "npm" && args?.[0] === "--version") {
					options?.listeners?.stdout?.(Buffer.from("9.0.0"));
					return 0;
				}
				callCount++;
				if (callCount === 1) {
					throw new Error("Network error");
				}
				return 0;
			});

			await expect(setupNpm("10.0.0")).rejects.toThrow("Failed to setup npm");
		});

		it("should throw error when verification fails", async () => {
			let callCount = 0;
			vi.mocked(exec.exec).mockImplementation(async (command, args, options) => {
				callCount++;
				if (command === "npm" && args?.[0] === "--version") {
					if (callCount === 1) {
						options?.listeners?.stdout?.(Buffer.from("9.0.0"));
						return 0;
					}
					throw new Error("Verification failed");
				}
				return 0;
			});

			await expect(setupNpm("10.0.0")).rejects.toThrow("Failed to setup npm");
		});
	});
});
