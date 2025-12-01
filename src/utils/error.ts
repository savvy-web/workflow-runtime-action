/**
 * Error handling utilities for better debugging
 */

/**
 * Formats an error with its message and stack trace
 *
 * @param error - The error to format
 * @returns Formatted error string with stack trace
 */
export function formatError(error: unknown): string {
	if (error instanceof Error) {
		// Include both message and stack trace
		return error.stack || error.message;
	}
	return String(error);
}

/**
 * Creates a new error with a context message while preserving the original stack
 *
 * @param message - Context message to prepend
 * @param originalError - The original error
 * @returns New error with context and original stack
 */
export function wrapError(message: string, originalError: unknown): Error {
	const formatted = formatError(originalError);
	const newError = new Error(`${message}: ${formatted}`);

	// Preserve original stack if available
	if (originalError instanceof Error && originalError.stack) {
		newError.stack = `${newError.message}\n\nCaused by:\n${originalError.stack}`;
	}

	return newError;
}
