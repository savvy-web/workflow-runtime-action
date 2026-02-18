import { describe, expect, it } from "vitest";
import {
	OPERATION,
	PACKAGE_MANAGER,
	RUNTIME,
	STATE,
	STATUS,
	formatCache,
	formatDetection,
	formatFailure,
	formatInstallation,
	formatPackageManager,
	formatRuntime,
	formatSetup,
	formatSuccess,
	formatWarning,
	getPackageManagerEmoji,
	getRuntimeEmoji,
} from "../src/utils/emoji.js";

describe("emoji utilities", () => {
	describe("getRuntimeEmoji", () => {
		it("should return correct emoji for each runtime", () => {
			expect(getRuntimeEmoji("node")).toBe(RUNTIME.node);
			expect(getRuntimeEmoji("bun")).toBe(RUNTIME.bun);
			expect(getRuntimeEmoji("deno")).toBe(RUNTIME.deno);
		});
	});

	describe("getPackageManagerEmoji", () => {
		it("should return correct emoji for each package manager", () => {
			expect(getPackageManagerEmoji("npm")).toBe(PACKAGE_MANAGER.npm);
			expect(getPackageManagerEmoji("pnpm")).toBe(PACKAGE_MANAGER.pnpm);
			expect(getPackageManagerEmoji("yarn")).toBe(PACKAGE_MANAGER.yarn);
			expect(getPackageManagerEmoji("bun")).toBe(PACKAGE_MANAGER.bun);
			expect(getPackageManagerEmoji("deno")).toBe(PACKAGE_MANAGER.deno);
		});
	});

	describe("formatRuntime", () => {
		it("should format runtime with emoji and capitalized name", () => {
			expect(formatRuntime("node")).toBe(`${RUNTIME.node} Node`);
			expect(formatRuntime("bun")).toBe(`${RUNTIME.bun} Bun`);
			expect(formatRuntime("deno")).toBe(`${RUNTIME.deno} Deno`);
		});
	});

	describe("formatPackageManager", () => {
		it("should format package manager with emoji and capitalized name", () => {
			expect(formatPackageManager("pnpm")).toBe(`${PACKAGE_MANAGER.pnpm} Pnpm`);
			expect(formatPackageManager("yarn")).toBe(`${PACKAGE_MANAGER.yarn} Yarn`);
			expect(formatPackageManager("bun")).toBe(`${PACKAGE_MANAGER.bun} Bun`);
			expect(formatPackageManager("deno")).toBe(`${PACKAGE_MANAGER.deno} Deno`);
		});

		it("should keep npm lowercase", () => {
			expect(formatPackageManager("npm")).toBe(`${PACKAGE_MANAGER.npm} npm`);
		});
	});

	describe("formatDetection", () => {
		it("should format found item", () => {
			expect(formatDetection("Turbo", true)).toBe(`${STATE.good} Detected Turbo`);
		});

		it("should format not found item", () => {
			expect(formatDetection("Turbo", false)).toBe(`${STATE.neutral} No Turbo`);
		});
	});

	describe("formatSetup", () => {
		it("should format setup message", () => {
			expect(formatSetup("Node.js")).toBe(`${OPERATION.setup} Setting up Node.js`);
		});
	});

	describe("formatCache", () => {
		it("should format restoring cache message", () => {
			expect(formatCache("Restoring", "pnpm")).toBe(`${OPERATION.cache} Restoring cache for: pnpm`);
		});

		it("should format saving cache message", () => {
			expect(formatCache("Saving", "npm")).toBe(`${OPERATION.cache} Saving cache for: npm`);
		});
	});

	describe("formatInstallation", () => {
		it("should format installation message", () => {
			expect(formatInstallation("dependencies")).toBe(`${OPERATION.installation} Installing dependencies`);
		});
	});

	describe("formatSuccess", () => {
		it("should format success message", () => {
			expect(formatSuccess("Done")).toBe(`${STATUS.pass} Done`);
		});
	});

	describe("formatWarning", () => {
		it("should format warning message", () => {
			expect(formatWarning("Caution")).toBe(`${STATUS.warning} Caution`);
		});
	});

	describe("formatFailure", () => {
		it("should format failure message", () => {
			expect(formatFailure("Error")).toBe(`${STATUS.fail} Error`);
		});
	});
});
