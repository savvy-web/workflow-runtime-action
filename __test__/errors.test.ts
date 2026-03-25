import { describe, expect, it } from "vitest";
import {
	CacheError,
	ConfigError,
	DependencyInstallError,
	PackageManagerSetupError,
	RuntimeInstallError,
} from "../src/errors.js";

describe("ConfigError", () => {
	it("has correct _tag", () => {
		const err = new ConfigError({ reason: "Missing devEngines" });
		expect(err._tag).toBe("ConfigError");
	});

	it("carries required reason field", () => {
		const err = new ConfigError({ reason: "Missing devEngines" });
		expect(err.reason).toBe("Missing devEngines");
	});

	it("carries optional file field", () => {
		const err = new ConfigError({ reason: "Not found", file: "package.json" });
		expect(err.file).toBe("package.json");
	});

	it("carries optional cause field", () => {
		const cause = new Error("original");
		const err = new ConfigError({ reason: "Wrapped", cause });
		expect(err.cause).toBe(cause);
	});

	it("is an instance of Error", () => {
		const err = new ConfigError({ reason: "test" });
		expect(err).toBeInstanceOf(Error);
	});
});

describe("RuntimeInstallError", () => {
	it("has correct _tag", () => {
		const err = new RuntimeInstallError({ runtime: "node", version: "24.11.0", reason: "Download failed" });
		expect(err._tag).toBe("RuntimeInstallError");
	});

	it("carries runtime, version, and reason fields", () => {
		const err = new RuntimeInstallError({ runtime: "bun", version: "1.3.3", reason: "Network timeout" });
		expect(err.runtime).toBe("bun");
		expect(err.version).toBe("1.3.3");
		expect(err.reason).toBe("Network timeout");
	});

	it("carries optional cause field", () => {
		const cause = new Error("ECONNREFUSED");
		const err = new RuntimeInstallError({ runtime: "deno", version: "2.5.6", reason: "Failed", cause });
		expect(err.cause).toBe(cause);
	});

	it("is an instance of Error", () => {
		const err = new RuntimeInstallError({ runtime: "node", version: "24.11.0", reason: "test" });
		expect(err).toBeInstanceOf(Error);
	});
});

describe("PackageManagerSetupError", () => {
	it("has correct _tag", () => {
		const err = new PackageManagerSetupError({ packageManager: "pnpm", version: "10.20.0", reason: "Corepack failed" });
		expect(err._tag).toBe("PackageManagerSetupError");
	});

	it("carries packageManager, version, and reason fields", () => {
		const err = new PackageManagerSetupError({ packageManager: "yarn", version: "4.0.0", reason: "Enable failed" });
		expect(err.packageManager).toBe("yarn");
		expect(err.version).toBe("4.0.0");
		expect(err.reason).toBe("Enable failed");
	});

	it("carries optional cause field", () => {
		const cause = new Error("exit code 1");
		const err = new PackageManagerSetupError({ packageManager: "pnpm", version: "10.20.0", reason: "Failed", cause });
		expect(err.cause).toBe(cause);
	});

	it("is an instance of Error", () => {
		const err = new PackageManagerSetupError({ packageManager: "pnpm", version: "10.20.0", reason: "test" });
		expect(err).toBeInstanceOf(Error);
	});
});

describe("DependencyInstallError", () => {
	it("has correct _tag", () => {
		const err = new DependencyInstallError({ packageManager: "pnpm", reason: "Install failed" });
		expect(err._tag).toBe("DependencyInstallError");
	});

	it("carries packageManager and reason fields", () => {
		const err = new DependencyInstallError({ packageManager: "npm", reason: "ENOENT" });
		expect(err.packageManager).toBe("npm");
		expect(err.reason).toBe("ENOENT");
	});

	it("carries optional cause field", () => {
		const cause = new Error("non-zero exit");
		const err = new DependencyInstallError({ packageManager: "bun", reason: "Failed", cause });
		expect(err.cause).toBe(cause);
	});

	it("is an instance of Error", () => {
		const err = new DependencyInstallError({ packageManager: "pnpm", reason: "test" });
		expect(err).toBeInstanceOf(Error);
	});
});

describe("CacheError", () => {
	it("has correct _tag", () => {
		const err = new CacheError({ operation: "save", reason: "Disk full" });
		expect(err._tag).toBe("CacheError");
	});

	it("accepts save operation", () => {
		const err = new CacheError({ operation: "save", reason: "Failed to save" });
		expect(err.operation).toBe("save");
		expect(err.reason).toBe("Failed to save");
	});

	it("accepts restore operation", () => {
		const err = new CacheError({ operation: "restore", reason: "Cache miss" });
		expect(err.operation).toBe("restore");
	});

	it("accepts key-generation operation", () => {
		const err = new CacheError({ operation: "key-generation", reason: "Lockfile not found" });
		expect(err.operation).toBe("key-generation");
	});

	it("carries optional cause field", () => {
		const cause = new Error("S3 error");
		const err = new CacheError({ operation: "save", reason: "Upload failed", cause });
		expect(err.cause).toBe(cause);
	});

	it("is an instance of Error", () => {
		const err = new CacheError({ operation: "restore", reason: "test" });
		expect(err).toBeInstanceOf(Error);
	});
});
