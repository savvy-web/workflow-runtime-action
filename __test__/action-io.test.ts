import * as core from "@actions/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getInput, setOutput } from "../src/utils/action-io.js";

// Mock @actions/core
vi.mock("@actions/core");

describe("action-io", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("getInput", () => {
		it("should get valid input", () => {
			vi.mocked(core.getInput).mockReturnValue("test-value");

			const result = getInput("node-version");

			expect(core.getInput).toHaveBeenCalledWith("node-version");
			expect(result).toBe("test-value");
		});

		it("should return empty string when input is not set", () => {
			vi.mocked(core.getInput).mockReturnValue("");

			const result = getInput("bun-version");

			expect(result).toBe("");
		});

		it("should throw error for invalid input key", () => {
			expect(() => {
				// @ts-expect-error Testing invalid input
				getInput("invalid-input");
			}).toThrow('Invalid input key: "invalid-input"');
		});

		it("should list valid inputs in error message", () => {
			expect(() => {
				// @ts-expect-error Testing invalid input
				getInput("foo");
			}).toThrow(/Valid inputs are:/);
		});
	});

	describe("setOutput", () => {
		it("should set valid output with string value", () => {
			setOutput("node-version", "24.11.0");

			expect(core.setOutput).toHaveBeenCalledWith("node-version", "24.11.0");
		});

		it("should set valid output with boolean value", () => {
			setOutput("node-enabled", true);

			expect(core.setOutput).toHaveBeenCalledWith("node-enabled", "true");
		});

		it("should convert boolean false to string", () => {
			setOutput("bun-enabled", false);

			expect(core.setOutput).toHaveBeenCalledWith("bun-enabled", "false");
		});

		it("should throw error for invalid output key", () => {
			expect(() => {
				// @ts-expect-error Testing invalid output
				setOutput("invalid-output", "value");
			}).toThrow('Invalid output key: "invalid-output"');
		});

		it("should list valid outputs in error message", () => {
			expect(() => {
				// @ts-expect-error Testing invalid output
				setOutput("bar", "baz");
			}).toThrow(/Valid outputs are:/);
		});
	});
});
