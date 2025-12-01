import { describe, expect, it } from "vitest";
import { formatError, wrapError } from "../src/utils/error.js";

describe("error utilities", () => {
	describe("formatError", () => {
		it("should format Error with stack trace", () => {
			const error = new Error("Test error");
			const result = formatError(error);

			// Should include the error message
			expect(result).toContain("Test error");
			// Should include stack trace if available
			if (error.stack) {
				expect(result).toBe(error.stack);
			}
		});

		it("should format Error with message when no stack", () => {
			const error = new Error("Test error");
			// Remove stack to test fallback
			error.stack = undefined;

			const result = formatError(error);

			expect(result).toBe("Test error");
		});

		it("should format non-Error objects as string", () => {
			const result1 = formatError("string error");
			expect(result1).toBe("string error");

			const result2 = formatError(42);
			expect(result2).toBe("42");

			const result3 = formatError({ foo: "bar" });
			expect(result3).toBe("[object Object]");

			const result4 = formatError(null);
			expect(result4).toBe("null");

			const result5 = formatError(undefined);
			expect(result5).toBe("undefined");
		});
	});

	describe("wrapError", () => {
		it("should wrap Error with context message", () => {
			const originalError = new Error("Original error");
			const wrapped = wrapError("Failed to do something", originalError);

			expect(wrapped.message).toContain("Failed to do something");
			expect(wrapped.message).toContain("Original error");
		});

		it("should preserve original stack trace", () => {
			const originalError = new Error("Original error");
			const wrapped = wrapError("Context message", originalError);

			expect(wrapped.stack).toContain("Context message");
			expect(wrapped.stack).toContain("Caused by:");
			expect(wrapped.stack).toContain("Original error");
		});

		it("should handle non-Error objects", () => {
			const wrapped = wrapError("Failed operation", "string error");

			expect(wrapped.message).toBe("Failed operation: string error");
			expect(wrapped).toBeInstanceOf(Error);
		});

		it("should handle Error without stack", () => {
			const originalError = new Error("Test error");
			originalError.stack = undefined;

			const wrapped = wrapError("Context", originalError);

			expect(wrapped.message).toContain("Context");
			expect(wrapped.message).toContain("Test error");
		});
	});
});
