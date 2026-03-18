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
} from "../src/emoji.js";

describe("emoji constants", () => {
	it("RUNTIME has entries for node, bun, deno", () => {
		expect(RUNTIME.node).toBeDefined();
		expect(RUNTIME.bun).toBeDefined();
		expect(RUNTIME.deno).toBeDefined();
	});

	it("PACKAGE_MANAGER has entries for all PMs", () => {
		expect(PACKAGE_MANAGER.npm).toBeDefined();
		expect(PACKAGE_MANAGER.pnpm).toBeDefined();
		expect(PACKAGE_MANAGER.yarn).toBeDefined();
		expect(PACKAGE_MANAGER.bun).toBeDefined();
		expect(PACKAGE_MANAGER.deno).toBeDefined();
	});

	it("STATE has good/neutral/warning/issue", () => {
		expect(STATE.good).toBeDefined();
		expect(STATE.neutral).toBeDefined();
		expect(STATE.warning).toBeDefined();
		expect(STATE.issue).toBeDefined();
	});

	it("OPERATION has detection/setup/cache/installation", () => {
		expect(OPERATION.detection).toBeDefined();
		expect(OPERATION.setup).toBeDefined();
		expect(OPERATION.cache).toBeDefined();
		expect(OPERATION.installation).toBeDefined();
	});

	it("STATUS has pass/neutral/fail/warning", () => {
		expect(STATUS.pass).toBeDefined();
		expect(STATUS.neutral).toBeDefined();
		expect(STATUS.fail).toBeDefined();
		expect(STATUS.warning).toBeDefined();
	});
});

describe("getRuntimeEmoji", () => {
	it("returns correct emoji for each runtime", () => {
		expect(getRuntimeEmoji("node")).toBe(RUNTIME.node);
		expect(getRuntimeEmoji("bun")).toBe(RUNTIME.bun);
		expect(getRuntimeEmoji("deno")).toBe(RUNTIME.deno);
	});
});

describe("getPackageManagerEmoji", () => {
	it("returns correct emoji for each PM", () => {
		expect(getPackageManagerEmoji("npm")).toBe(PACKAGE_MANAGER.npm);
		expect(getPackageManagerEmoji("pnpm")).toBe(PACKAGE_MANAGER.pnpm);
		expect(getPackageManagerEmoji("yarn")).toBe(PACKAGE_MANAGER.yarn);
		expect(getPackageManagerEmoji("bun")).toBe(PACKAGE_MANAGER.bun);
		expect(getPackageManagerEmoji("deno")).toBe(PACKAGE_MANAGER.deno);
	});
});

describe("formatRuntime", () => {
	it("formats with emoji and capitalized name", () => {
		expect(formatRuntime("node")).toContain("Node");
		expect(formatRuntime("bun")).toContain("Bun");
		expect(formatRuntime("deno")).toContain("Deno");
	});
});

describe("formatPackageManager", () => {
	it("keeps npm lowercase", () => {
		expect(formatPackageManager("npm")).toContain("npm");
	});
	it("capitalizes other PMs", () => {
		expect(formatPackageManager("pnpm")).toContain("Pnpm");
		expect(formatPackageManager("yarn")).toContain("Yarn");
	});
});

describe("formatDetection", () => {
	it("uses good state for found items", () => {
		const result = formatDetection("item", true);
		expect(result).toContain("Detected");
		expect(result).toContain(STATE.good);
	});
	it("uses neutral state for not-found items", () => {
		const result = formatDetection("item", false);
		expect(result).toContain("No");
		expect(result).toContain(STATE.neutral);
	});
});

describe("formatSetup", () => {
	it("formats setup message", () => {
		expect(formatSetup("pnpm")).toContain("Setting up pnpm");
	});
});

describe("formatCache", () => {
	it("formats restoring message", () => {
		expect(formatCache("Restoring", "pnpm")).toContain("Restoring cache for: pnpm");
	});
	it("formats saving message", () => {
		expect(formatCache("Saving", "npm")).toContain("Saving cache for: npm");
	});
});

describe("formatInstallation", () => {
	it("formats installation message", () => {
		expect(formatInstallation("runtimes")).toContain("Installing runtimes");
	});
});

describe("formatSuccess", () => {
	it("includes pass status", () => {
		expect(formatSuccess("done")).toContain(STATUS.pass);
		expect(formatSuccess("done")).toContain("done");
	});
});

describe("formatWarning", () => {
	it("includes warning status", () => {
		expect(formatWarning("caution")).toContain(STATUS.warning);
	});
});

describe("formatFailure", () => {
	it("includes fail status", () => {
		expect(formatFailure("error")).toContain(STATUS.fail);
	});
});
