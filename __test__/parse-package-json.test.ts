import { readFile } from "node:fs/promises";
import * as core from "@actions/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePackageJson } from "../src/utils/parse-package-json.js";

vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(),
}));

vi.mock("@actions/core");

describe("parsePackageJson", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(core.info).mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("valid package.json parsing", () => {
		it("should parse single runtime object", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "pnpm", version: "10.20.0" },
						runtime: { name: "node", version: "24.11.0" },
					},
				}),
			);

			const result = await parsePackageJson("package.json");

			expect(result.packageManager).toEqual({ name: "pnpm", version: "10.20.0" });
			expect(result.runtimes).toEqual([{ name: "node", version: "24.11.0" }]);
		});

		it("should parse runtime array", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "bun", version: "1.3.3" },
						runtime: [
							{ name: "node", version: "24.11.0" },
							{ name: "bun", version: "1.3.3" },
						],
					},
				}),
			);

			const result = await parsePackageJson("package.json");

			expect(result.packageManager).toEqual({ name: "bun", version: "1.3.3" });
			expect(result.runtimes).toHaveLength(2);
			expect(result.runtimes[0]).toEqual({ name: "node", version: "24.11.0" });
			expect(result.runtimes[1]).toEqual({ name: "bun", version: "1.3.3" });
		});

		it("should parse package manager array (uses first)", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: [
							{ name: "pnpm", version: "10.20.0" },
							{ name: "yarn", version: "4.0.0" },
						],
						runtime: { name: "node", version: "24.11.0" },
					},
				}),
			);

			const result = await parsePackageJson("package.json");

			expect(result.packageManager).toEqual({ name: "pnpm", version: "10.20.0" });
		});

		it("should accept all valid runtime names", async () => {
			for (const name of ["node", "bun", "deno"]) {
				vi.mocked(readFile).mockResolvedValue(
					JSON.stringify({
						devEngines: {
							packageManager: { name: "npm", version: "10.0.0" },
							runtime: { name, version: "1.0.0" },
						},
					}),
				);

				const result = await parsePackageJson("package.json");
				expect(result.runtimes[0].name).toBe(name);
			}
		});

		it("should accept all valid package manager names", async () => {
			for (const name of ["npm", "pnpm", "yarn", "bun"]) {
				vi.mocked(readFile).mockResolvedValue(
					JSON.stringify({
						devEngines: {
							packageManager: { name, version: "1.0.0" },
							runtime: { name: "node", version: "24.0.0" },
						},
					}),
				);

				const result = await parsePackageJson("package.json");
				expect(result.packageManager.name).toBe(name);
			}
		});

		it("should accept versions with prerelease tags", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "pnpm", version: "10.0.0-beta.1" },
						runtime: { name: "node", version: "24.0.0-rc.1" },
					},
				}),
			);

			const result = await parsePackageJson("package.json");
			expect(result.packageManager.version).toBe("10.0.0-beta.1");
			expect(result.runtimes[0].version).toBe("24.0.0-rc.1");
		});

		it("should accept versions with build metadata", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "pnpm", version: "10.0.0+build.123" },
						runtime: { name: "node", version: "24.0.0+sha.abc" },
					},
				}),
			);

			const result = await parsePackageJson("package.json");
			expect(result.packageManager.version).toBe("10.0.0+build.123");
		});

		it("should log detected configuration", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "pnpm", version: "10.20.0" },
						runtime: { name: "node", version: "24.11.0" },
					},
				}),
			);

			await parsePackageJson("package.json");

			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("pnpm@10.20.0"));
			expect(core.info).toHaveBeenCalledWith(expect.stringContaining("node@24.11.0"));
		});
	});

	describe("missing fields", () => {
		it("should throw when devEngines is missing", async () => {
			vi.mocked(readFile).mockResolvedValue(JSON.stringify({}));

			await expect(parsePackageJson("package.json")).rejects.toThrow(
				"package.json must have a devEngines.packageManager property",
			);
		});

		it("should throw when devEngines.packageManager is missing", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: { runtime: { name: "node", version: "24.0.0" } },
				}),
			);

			await expect(parsePackageJson("package.json")).rejects.toThrow(
				"package.json must have a devEngines.packageManager property",
			);
		});

		it("should throw when devEngines.runtime is missing", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "pnpm", version: "10.0.0" },
					},
				}),
			);

			await expect(parsePackageJson("package.json")).rejects.toThrow(
				"package.json must have a devEngines.runtime property",
			);
		});

		it("should throw when packageManager array is empty", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: [],
						runtime: { name: "node", version: "24.0.0" },
					},
				}),
			);

			await expect(parsePackageJson("package.json")).rejects.toThrow(
				"devEngines.packageManager array must not be empty",
			);
		});

		it("should throw when runtime array is empty", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "pnpm", version: "10.0.0" },
						runtime: [],
					},
				}),
			);

			await expect(parsePackageJson("package.json")).rejects.toThrow("devEngines.runtime array must not be empty");
		});
	});

	describe("invalid runtime configuration", () => {
		it("should throw when runtime is not an object", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "pnpm", version: "10.0.0" },
						runtime: "node",
					},
				}),
			);

			await expect(parsePackageJson("package.json")).rejects.toThrow("devEngines.runtime[0] must be an object");
		});

		it("should throw when runtime name is invalid", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "pnpm", version: "10.0.0" },
						runtime: { name: "invalid", version: "1.0.0" },
					},
				}),
			);

			await expect(parsePackageJson("package.json")).rejects.toThrow(
				'devEngines.runtime[0].name must be one of: node, bun, deno (got: "invalid")',
			);
		});

		it("should throw when runtime name is missing", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "pnpm", version: "10.0.0" },
						runtime: { version: "1.0.0" },
					},
				}),
			);

			await expect(parsePackageJson("package.json")).rejects.toThrow("devEngines.runtime[0].name must be one of");
		});

		it("should throw when runtime version is missing", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "pnpm", version: "10.0.0" },
						runtime: { name: "node" },
					},
				}),
			);

			await expect(parsePackageJson("package.json")).rejects.toThrow("devEngines.runtime[0].version must be a string");
		});

		it("should throw when runtime version is a semver range", async () => {
			const ranges = ["^24.0.0", "~24.0.0", ">=24.0.0", "<24.0.0", "24.x", "*"];
			for (const version of ranges) {
				vi.mocked(readFile).mockResolvedValue(
					JSON.stringify({
						devEngines: {
							packageManager: { name: "pnpm", version: "10.0.0" },
							runtime: { name: "node", version },
						},
					}),
				);

				await expect(parsePackageJson("package.json")).rejects.toThrow(
					"devEngines.runtime[0].version must be an absolute version",
				);
			}
		});

		it("should throw for invalid runtime in array with correct index", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "pnpm", version: "10.0.0" },
						runtime: [
							{ name: "node", version: "24.0.0" },
							{ name: "invalid", version: "1.0.0" },
						],
					},
				}),
			);

			await expect(parsePackageJson("package.json")).rejects.toThrow("devEngines.runtime[1].name must be one of");
		});
	});

	describe("invalid package manager configuration", () => {
		it("should throw when packageManager is not an object", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: "pnpm",
						runtime: { name: "node", version: "24.0.0" },
					},
				}),
			);

			await expect(parsePackageJson("package.json")).rejects.toThrow("devEngines.packageManager[0] must be an object");
		});

		it("should throw when packageManager name is invalid", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "invalid", version: "1.0.0" },
						runtime: { name: "node", version: "24.0.0" },
					},
				}),
			);

			await expect(parsePackageJson("package.json")).rejects.toThrow(
				'devEngines.packageManager[0].name must be one of: npm, pnpm, yarn, bun (got: "invalid")',
			);
		});

		it("should throw when packageManager version is missing", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "pnpm" },
						runtime: { name: "node", version: "24.0.0" },
					},
				}),
			);

			await expect(parsePackageJson("package.json")).rejects.toThrow(
				"devEngines.packageManager[0].version must be a string",
			);
		});

		it("should throw when packageManager version is a semver range", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					devEngines: {
						packageManager: { name: "pnpm", version: "^10.0.0" },
						runtime: { name: "node", version: "24.0.0" },
					},
				}),
			);

			await expect(parsePackageJson("package.json")).rejects.toThrow(
				'devEngines.packageManager[0].version must be an absolute version (e.g., "10.20.0"), not a semver range',
			);
		});
	});

	describe("file system errors", () => {
		it("should throw when package.json is not found", async () => {
			const error = new Error("ENOENT") as NodeJS.ErrnoException;
			error.code = "ENOENT";
			vi.mocked(readFile).mockRejectedValue(error);

			await expect(parsePackageJson("package.json")).rejects.toThrow("package.json not found at package.json");
		});

		it("should throw on invalid JSON", async () => {
			vi.mocked(readFile).mockResolvedValue("not valid json");

			await expect(parsePackageJson("package.json")).rejects.toThrow("Failed to parse package.json: Invalid JSON");
		});

		it("should re-throw unknown errors", async () => {
			vi.mocked(readFile).mockRejectedValue(new Error("Permission denied"));

			await expect(parsePackageJson("package.json")).rejects.toThrow("Permission denied");
		});
	});
});
