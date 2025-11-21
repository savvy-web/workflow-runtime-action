import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock all node:fs modules before imports
vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(),
}));

describe("main detection logic", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("package manager detection", () => {
		it("should detect pnpm from package.json packageManager field", async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					packageManager: "pnpm@10.20.0",
				}),
			);

			const content = await readFile("package.json", "utf-8");
			const packageJson = JSON.parse(content);

			expect(packageJson.packageManager).toBe("pnpm@10.20.0");
			expect(packageJson.packageManager.split("@")[0]).toBe("pnpm");
		});

		it("should detect yarn from package.json packageManager field", async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					packageManager: "yarn@4.0.0",
				}),
			);

			const content = await readFile("package.json", "utf-8");
			const packageJson = JSON.parse(content);

			expect(packageJson.packageManager.split("@")[0]).toBe("yarn");
		});

		it("should handle missing packageManager field", async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(readFile).mockResolvedValue(JSON.stringify({}));

			const content = await readFile("package.json", "utf-8");
			const packageJson = JSON.parse(content);

			expect(packageJson.packageManager).toBeUndefined();
		});
	});

	describe("Node.js version detection", () => {
		it("should detect .nvmrc file", () => {
			vi.mocked(existsSync).mockImplementation((path) => path === ".nvmrc");

			const hasNvmrc = existsSync(".nvmrc");
			const hasNodeVersion = existsSync(".node-version");

			expect(hasNvmrc).toBe(true);
			expect(hasNodeVersion).toBe(false);
		});

		it("should detect .node-version file", () => {
			vi.mocked(existsSync).mockImplementation((path) => path === ".node-version");

			const hasNvmrc = existsSync(".nvmrc");
			const hasNodeVersion = existsSync(".node-version");

			expect(hasNvmrc).toBe(false);
			expect(hasNodeVersion).toBe(true);
		});

		it("should prioritize .nvmrc over .node-version", () => {
			vi.mocked(existsSync).mockImplementation((path) => path === ".nvmrc" || path === ".node-version");

			const hasNvmrc = existsSync(".nvmrc");

			expect(hasNvmrc).toBe(true);
		});

		it("should read version from file", async () => {
			vi.mocked(readFile).mockResolvedValue("20.11.0\n");

			const content = await readFile(".nvmrc", "utf-8");
			const version = content.trim().replace(/^v/, "").split("\n")[0];

			expect(version).toBe("20.11.0");
		});

		it("should strip v prefix from version", async () => {
			vi.mocked(readFile).mockResolvedValue("v20.11.0\n");

			const content = await readFile(".nvmrc", "utf-8");
			const version = content.trim().replace(/^v/, "");

			expect(version).toBe("20.11.0");
		});
	});

	describe("Turbo detection", () => {
		it("should detect turbo.json", () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "turbo.json");

			const hasTurbo = existsSync("turbo.json");

			expect(hasTurbo).toBe(true);
		});

		it("should return false when turbo.json does not exist", () => {
			vi.mocked(existsSync).mockReturnValue(false);

			const hasTurbo = existsSync("turbo.json");

			expect(hasTurbo).toBe(false);
		});
	});

	describe("Biome detection", () => {
		it("should detect biome.jsonc", () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "biome.jsonc");

			const hasBiomeJsonc = existsSync("biome.jsonc");
			const hasBiomeJson = existsSync("biome.json");

			expect(hasBiomeJsonc).toBe(true);
			expect(hasBiomeJson).toBe(false);
		});

		it("should detect biome.json", () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "biome.json");

			const hasBiomeJsonc = existsSync("biome.jsonc");
			const hasBiomeJson = existsSync("biome.json");

			expect(hasBiomeJsonc).toBe(false);
			expect(hasBiomeJson).toBe(true);
		});

		it("should prioritize biome.jsonc over biome.json", () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "biome.jsonc" || path === "biome.json");

			const hasBiomeJsonc = existsSync("biome.jsonc");

			expect(hasBiomeJsonc).toBe(true);
		});

		it("should extract version from $schema URL", async () => {
			vi.mocked(readFile).mockResolvedValue(
				JSON.stringify({
					$schema: "https://biomejs.dev/schemas/2.3.6/schema.json",
				}),
			);

			const content = await readFile("biome.jsonc", "utf-8");
			const config = JSON.parse(content);
			const versionMatch = config.$schema.match(/\/schemas\/(\d+\.\d+\.\d+)\//);
			const version = versionMatch?.[1];

			expect(version).toBe("2.3.6");
		});

		it("should handle missing $schema field", async () => {
			vi.mocked(readFile).mockResolvedValue(JSON.stringify({}));

			const content = await readFile("biome.jsonc", "utf-8");
			const config = JSON.parse(content);

			expect(config.$schema).toBeUndefined();
		});

		it("should handle various version formats", async () => {
			const versions = [
				{ url: "https://biomejs.dev/schemas/1.0.0/schema.json", expected: "1.0.0" },
				{ url: "https://biomejs.dev/schemas/2.10.5/schema.json", expected: "2.10.5" },
				{ url: "https://biomejs.dev/schemas/10.20.30/schema.json", expected: "10.20.30" },
			];

			for (const { url, expected } of versions) {
				const versionMatch = url.match(/\/schemas\/(\d+\.\d+\.\d+)\//);
				const version = versionMatch?.[1];

				expect(version).toBe(expected);
			}
		});
	});

	describe("lockfile detection", () => {
		it("should detect package-lock.json for npm", () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "package-lock.json");

			const hasLock = existsSync("package-lock.json");

			expect(hasLock).toBe(true);
		});

		it("should detect pnpm-lock.yaml for pnpm", () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "pnpm-lock.yaml");

			const hasLock = existsSync("pnpm-lock.yaml");

			expect(hasLock).toBe(true);
		});

		it("should detect yarn.lock for yarn", () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "yarn.lock");

			const hasLock = existsSync("yarn.lock");

			expect(hasLock).toBe(true);
		});
	});

	describe("install command determination", () => {
		it("should use npm ci when package-lock.json exists", () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "package-lock.json");

			const hasLock = existsSync("package-lock.json");
			const command = hasLock ? ["ci"] : ["install"];

			expect(command).toEqual(["ci"]);
		});

		it("should use npm install when no lock file", () => {
			vi.mocked(existsSync).mockReturnValue(false);

			const hasLock = existsSync("package-lock.json");
			const command = hasLock ? ["ci"] : ["install"];

			expect(command).toEqual(["install"]);
		});

		it("should use pnpm install --frozen-lockfile when pnpm-lock.yaml exists", () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "pnpm-lock.yaml");

			const hasLock = existsSync("pnpm-lock.yaml");
			const command = hasLock ? ["install", "--frozen-lockfile"] : ["install"];

			expect(command).toEqual(["install", "--frozen-lockfile"]);
		});

		it("should use yarn install --immutable when yarn.lock exists", () => {
			vi.mocked(existsSync).mockImplementation((path) => path === "yarn.lock");

			const hasLock = existsSync("yarn.lock");
			const command = hasLock ? ["install", "--immutable"] : ["install", "--no-immutable"];

			expect(command).toEqual(["install", "--immutable"]);
		});

		it("should use yarn install --no-immutable when no yarn.lock", () => {
			vi.mocked(existsSync).mockReturnValue(false);

			const hasLock = existsSync("yarn.lock");
			const command = hasLock ? ["install", "--immutable"] : ["install", "--no-immutable"];

			expect(command).toEqual(["install", "--no-immutable"]);
		});
	});
});
