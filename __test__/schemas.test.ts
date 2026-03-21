import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { AbsoluteVersion, CacheStateSchema, DevEngineEntry, DevEngines } from "../src/schemas.js";

const decodeAbsoluteVersion = Schema.decodeUnknownEither(AbsoluteVersion);
const decodeDevEngineEntry = Schema.decodeUnknownEither(DevEngineEntry);
const decodeDevEngines = Schema.decodeUnknownEither(DevEngines);
const decodeCacheState = Schema.decodeUnknownEither(CacheStateSchema);

describe("AbsoluteVersion", () => {
	describe("valid versions", () => {
		it("accepts a plain semver version", () => {
			expect(Either.isRight(decodeAbsoluteVersion("24.11.0"))).toBe(true);
		});

		it("accepts a minimal semver version", () => {
			expect(Either.isRight(decodeAbsoluteVersion("1.0.0"))).toBe(true);
		});

		it("accepts a prerelease version", () => {
			expect(Either.isRight(decodeAbsoluteVersion("1.0.0-beta.1"))).toBe(true);
		});

		it("accepts a version with prerelease and build metadata", () => {
			expect(Either.isRight(decodeAbsoluteVersion("1.0.0-beta.1+build.123"))).toBe(true);
		});
	});

	describe("invalid versions", () => {
		it("rejects caret ranges", () => {
			expect(Either.isLeft(decodeAbsoluteVersion("^24.0.0"))).toBe(true);
		});

		it("rejects tilde ranges", () => {
			expect(Either.isLeft(decodeAbsoluteVersion("~24.0.0"))).toBe(true);
		});

		it("rejects gte ranges", () => {
			expect(Either.isLeft(decodeAbsoluteVersion(">=24.0.0"))).toBe(true);
		});

		it("rejects wildcard *", () => {
			expect(Either.isLeft(decodeAbsoluteVersion("*"))).toBe(true);
		});

		it("rejects x wildcard in major", () => {
			expect(Either.isLeft(decodeAbsoluteVersion("24.x"))).toBe(true);
		});

		it("rejects x wildcard in patch", () => {
			expect(Either.isLeft(decodeAbsoluteVersion("24.0.x"))).toBe(true);
		});
	});
});

describe("DevEngineEntry", () => {
	describe("valid entries", () => {
		it("accepts minimal entry with name and version", () => {
			const result = decodeDevEngineEntry({ name: "node", version: "24.11.0" });
			expect(Either.isRight(result)).toBe(true);
		});

		it("accepts entry with optional onFail field", () => {
			const result = decodeDevEngineEntry({ name: "node", version: "24.11.0", onFail: "error" });
			expect(Either.isRight(result)).toBe(true);
		});

		it("accepts pnpm package manager entry", () => {
			const result = decodeDevEngineEntry({ name: "pnpm", version: "10.20.0", onFail: "error" });
			expect(Either.isRight(result)).toBe(true);
		});
	});

	describe("invalid entries", () => {
		it("rejects entry with semver range version", () => {
			const result = decodeDevEngineEntry({ name: "node", version: "^24.0.0" });
			expect(Either.isLeft(result)).toBe(true);
		});

		it("rejects entry missing name", () => {
			const result = decodeDevEngineEntry({ version: "24.11.0" });
			expect(Either.isLeft(result)).toBe(true);
		});

		it("rejects entry missing version", () => {
			const result = decodeDevEngineEntry({ name: "node" });
			expect(Either.isLeft(result)).toBe(true);
		});

		it("rejects non-object input", () => {
			const result = decodeDevEngineEntry("not-an-object");
			expect(Either.isLeft(result)).toBe(true);
		});
	});
});

describe("DevEngines", () => {
	describe("valid devEngines", () => {
		it("accepts single runtime object", () => {
			const result = decodeDevEngines({
				runtime: { name: "node", version: "24.11.0" },
				packageManager: { name: "pnpm", version: "10.20.0" },
			});
			expect(Either.isRight(result)).toBe(true);
		});

		it("accepts array of runtimes", () => {
			const result = decodeDevEngines({
				runtime: [
					{ name: "node", version: "24.11.0" },
					{ name: "bun", version: "1.3.3" },
				],
				packageManager: { name: "bun", version: "1.3.3" },
			});
			expect(Either.isRight(result)).toBe(true);
		});

		it("accepts entries with onFail field", () => {
			const result = decodeDevEngines({
				runtime: { name: "node", version: "24.11.0", onFail: "error" },
				packageManager: { name: "pnpm", version: "10.20.0", onFail: "error" },
			});
			expect(Either.isRight(result)).toBe(true);
		});
	});

	describe("invalid devEngines", () => {
		it("rejects missing packageManager", () => {
			const result = decodeDevEngines({
				runtime: { name: "node", version: "24.11.0" },
			});
			expect(Either.isLeft(result)).toBe(true);
		});

		it("rejects missing runtime", () => {
			const result = decodeDevEngines({
				packageManager: { name: "pnpm", version: "10.20.0" },
			});
			expect(Either.isLeft(result)).toBe(true);
		});

		it("rejects invalid version in packageManager", () => {
			const result = decodeDevEngines({
				runtime: { name: "node", version: "24.11.0" },
				packageManager: { name: "pnpm", version: "^10.0.0" },
			});
			expect(Either.isLeft(result)).toBe(true);
		});

		it("rejects invalid version in runtime", () => {
			const result = decodeDevEngines({
				runtime: { name: "node", version: "~24.0.0" },
				packageManager: { name: "pnpm", version: "10.20.0" },
			});
			expect(Either.isLeft(result)).toBe(true);
		});
	});
});

describe("CacheStateSchema", () => {
	describe("valid cache states", () => {
		it("accepts exact hit", () => {
			const result = decodeCacheState({ hit: "exact" });
			expect(Either.isRight(result)).toBe(true);
			if (Either.isRight(result)) {
				expect(result.right.hit).toBe("exact");
			}
		});

		it("accepts partial hit", () => {
			const result = decodeCacheState({ hit: "partial" });
			expect(Either.isRight(result)).toBe(true);
			if (Either.isRight(result)) {
				expect(result.right.hit).toBe("partial");
			}
		});

		it("accepts none hit", () => {
			const result = decodeCacheState({ hit: "none" });
			expect(Either.isRight(result)).toBe(true);
			if (Either.isRight(result)) {
				expect(result.right.hit).toBe("none");
			}
		});

		it("round-trips with key and paths", () => {
			const input = {
				hit: "exact" as const,
				key: "pnpm-linux-x64-abc123",
				paths: ["/home/runner/.local/share/pnpm/store", "**/node_modules"],
			};
			const result = decodeCacheState(input);
			expect(Either.isRight(result)).toBe(true);
			if (Either.isRight(result)) {
				expect(result.right.hit).toBe("exact");
				expect(result.right.key).toBe("pnpm-linux-x64-abc123");
				expect(result.right.paths).toEqual(["/home/runner/.local/share/pnpm/store", "**/node_modules"]);
			}
		});
	});

	describe("invalid cache states", () => {
		it("rejects invalid hit value", () => {
			const result = decodeCacheState({ hit: "miss" });
			expect(Either.isLeft(result)).toBe(true);
		});

		it("rejects missing hit field", () => {
			const result = decodeCacheState({});
			expect(Either.isLeft(result)).toBe(true);
		});
	});
});
