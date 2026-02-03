/**
 * Converts any value to a string representation for error messages.
 */
function stringifyValue(value: unknown): string {
	if (value === null) {
		return 'null';
	}
	if (value === undefined) {
		return 'undefined';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value !== 'object') {
		return String(value);
	}

	try {
		return JSON.stringify(value);
	} catch {
		return Object.prototype.toString.call(value);
	}
}

/**
 * Type guard to check if a value is error-like (has a message property).
 */
function isErrorLike(
	value: unknown,
): value is { message: string; name?: string; stack?: string } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'message' in value &&
		typeof value.message === 'string'
	);
}

/**
 * Converts any thrown value into a proper Error instance.
 *
 * Handles three cases:
 * - Error instances: returned as-is
 * - Error-like objects (with message property): converted to Error preserving name/stack
 * - Other values: stringified and wrapped in a new Error with original as cause
 *
 * @param value - The value to convert (typically from a catch block)
 * @returns A proper Error instance
 *
 * @example
 * ```ts
 * try {
 *   await riskyOperation();
 * } catch (e) {
 *   const error = ensureError(e);
 *   console.error(error.message);
 * }
 * ```
 */
export function ensureError(value: unknown): Error {
	if (value instanceof Error) {
		return value;
	}

	if (isErrorLike(value)) {
		const error = new Error(value.message, { cause: value });
		if (value.name) {
			error.name = value.name;
		}
		if (value.stack) {
			error.stack = value.stack;
		}
		return error;
	}

	return new Error(stringifyValue(value), { cause: value });
}
