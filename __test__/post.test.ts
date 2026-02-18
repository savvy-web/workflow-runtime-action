import * as core from "@actions/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as cacheUtils from "../src/utils/cache-utils.js";

vi.mock("@actions/core");
vi.mock("../src/utils/cache-utils.js", () => ({
	saveCache: vi.fn(),
}));

describe("post action", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.resetAllMocks();
		vi.mocked(cacheUtils.saveCache).mockResolvedValue(undefined);
	});

	it("should save cache successfully", async () => {
		await import("../src/post.js");

		expect(core.startGroup).toHaveBeenCalledWith(expect.stringContaining("Post-action"));
		expect(cacheUtils.saveCache).toHaveBeenCalled();
		expect(core.endGroup).toHaveBeenCalled();
		expect(core.warning).not.toHaveBeenCalled();
	});

	it("should warn on cache save error without failing", async () => {
		vi.mocked(cacheUtils.saveCache).mockRejectedValue(new Error("Cache save failed"));

		await import("../src/post.js");

		expect(core.endGroup).toHaveBeenCalled();
		expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Cache save failed"));
	});

	it("should handle non-Error rejection", async () => {
		vi.mocked(cacheUtils.saveCache).mockRejectedValue("string error");

		await import("../src/post.js");

		expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("string error"));
	});
});
