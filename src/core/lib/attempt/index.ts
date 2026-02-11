/**
 * Result type representing either success or failure
 */
export type Result<T, E = Error> =
	| { success: true; data: T; error?: never }
	| { success: false; data?: never; error: E };

/**
 * Utility type for functions that can be sync or async
 */
type Awaitable<T> = T | Promise<T>;

/**
 * Executes a function (sync or async) and returns a Result
 *
 * Built on Promise.try, this function provides unified error handling for
 * both synchronous and asynchronous operations.
 *
 * @param fn - Function to execute (can be sync or async)
 * @returns Promise resolving to Result<T, Error>
 *
 * @example
 * ```ts
 * // Early return pattern with type guard
 * const result = await attempt(() => fetchData());
 * if (isError(result)) {
 *   console.error('Failed:', result.error.message);
 *   return;
 * }
 * // TypeScript knows result.data is safe here
 * processData(result.data);
 *
 * // Using isResolved for positive checks
 * const parsed = await attempt(() => JSON.parse(input));
 * if (isResolved(parsed)) {
 *   return parsed.data;
 * }
 *
 * // Batch operations with filtering
 * const results = await Promise.all(
 *   items.map(item => attempt(() => processItem(item)))
 * );
 * const succeeded = results.filter(isResolved);
 * const failed = results.filter(isError);
 * ```
 */
export function attempt<T>(fn: () => Awaitable<T>): Promise<Result<T, Error>> {
	return Promise.try(fn)
		.then((data) => ({ success: true as const, data }))
		.catch((err): Result<T, Error> => {
			// Preserve Error instances to keep stack traces
			if (err instanceof Error) {
				return { success: false, error: err };
			}

			// For non-Error values, create a descriptive Error with the original value
			const error = new Error(
				`Attempt error: ${
					typeof err === 'object' && err !== null
						? JSON.stringify(err)
						: String(err)
				}`,
				{ cause: err },
			);

			return { success: false, error };
		});
}

/**
 * Type guard to check if a Result is resolved (successful)
 *
 * @example
 * ```ts
 * const result = await attempt(() => fetchData());
 * if (isResolved(result)) {
 *   console.log(result.data); // TypeScript knows this is safe
 * }
 * ```
 */
export function isResolved<T, E>(
	result: Result<T, E>,
): result is Extract<Result<T, E>, { success: true }> {
	return result.success === true;
}

/**
 * Type guard to check if a Result is an error
 *
 * @example
 * ```ts
 * const result = await attempt(() => fetchData());
 * if (isError(result)) {
 *   console.error('Operation failed:', result.error);
 *   return;
 * }
 * // Continue with result.data
 * ```
 */
export function isError<T, E>(
	result: Result<T, E>,
): result is Extract<Result<T, E>, { success: false }> {
	return result.success === false;
}

/**
 * Unwraps a successful Result or throws the error
 *
 * @example
 * ```ts
 * const result = await attempt(() => fetchData());
 * // Throws if result is a failure, returns data if success
 * const data = unwrap(result);
 * ```
 */
export function unwrap<T, E>(result: Result<T, E>): T {
	if (result.success) {
		return result.data;
	}
	throw result.error;
}

/**
 * Unwraps a successful Result or returns a default value
 *
 * @example
 * ```ts
 * const result = await attempt(() => fetchUserEmail());
 * const email = unwrapOr(result, 'unknown@example.com');
 * // Always returns a value, never throws
 * ```
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
	return result.success ? result.data : defaultValue;
}

/**
 * Maps the data of a successful Result
 *
 * @example
 * ```ts
 * const userResult = await attempt(() => fetchUser());
 * // Transform successful result to just the email
 * const emailResult = mapResult(userResult, (user) => user.email);
 * ```
 */
export function mapResult<T, U, E>(
	result: Result<T, E>,
	fn: (data: T) => U,
): Result<U, E> {
	if (result.success) {
		return { success: true, data: fn(result.data) };
	}
	return result;
}

/**
 * Maps the error of a failed Result
 *
 * @example
 * ```ts
 * const result = await attempt(() => fetchData());
 * // Transform error to custom message
 * const customResult = mapError(result, (err) => `API Error: ${err.message}`);
 *
 * if (!customResult.success) {
 *   console.error(customResult.error); // "API Error: ..."
 *   return;
 * }
 * ```
 */
export function mapError<T, E, F>(
	result: Result<T, E>,
	fn: (error: E) => F,
): Result<T, F> {
	if (result.success) {
		return result;
	}
	return { success: false, error: fn(result.error) };
}
