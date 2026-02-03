import { describe, expect, test } from 'bun:test';
import {
	attempt,
	isError,
	isResolved,
	mapError,
	mapResult,
	unwrap,
	unwrapOr,
} from './index.ts';

describe('attempt', () => {
	test('returns success result for sync function', async () => {
		const result = await attempt(() => 'hello');

		expect(result.success).toBe(true);
		expect(result.data).toBe('hello');
	});

	test('returns success result for async function', async () => {
		const result = await attempt(async () => 'async hello');

		expect(result.success).toBe(true);
		expect(result.data).toBe('async hello');
	});

	test('returns error result for sync throw', async () => {
		const result = await attempt(() => {
			throw new Error('sync error');
		});

		expect(result.success).toBe(false);
		expect(result.error).toBeInstanceOf(Error);
		expect(result.error?.message).toBe('sync error');
	});

	test('returns error result for async rejection', async () => {
		const result = await attempt(async () => {
			throw new Error('async error');
		});

		expect(result.success).toBe(false);
		expect(result.error?.message).toBe('async error');
	});

	test('wraps non-Error throws in Error', async () => {
		const result = await attempt(() => {
			throw 'string error';
		});

		expect(result.success).toBe(false);
		expect(result.error).toBeInstanceOf(Error);
		expect(result.error?.message).toContain('string error');
		expect((result.error as Error & { cause?: unknown })?.cause).toBe(
			'string error',
		);
	});

	test('wraps object throws in Error with JSON', async () => {
		const result = await attempt(() => {
			throw { code: 404, reason: 'not found' };
		});

		expect(result.success).toBe(false);
		expect(result.error?.message).toContain('404');
		expect(result.error?.message).toContain('not found');
	});
});

describe('isResolved', () => {
	test('returns true for success result', async () => {
		const result = await attempt(() => 'data');

		expect(isResolved(result)).toBe(true);
	});

	test('returns false for error result', async () => {
		const result = await attempt(() => {
			throw new Error('fail');
		});

		expect(isResolved(result)).toBe(false);
	});

	test('narrows type correctly', async () => {
		const result = await attempt(() => ({ value: 42 }));

		if (isResolved(result)) {
			// TypeScript should know result.data exists here
			expect(result.data.value).toBe(42);
		}
	});
});

describe('isError', () => {
	test('returns false for success result', async () => {
		const result = await attempt(() => 'data');

		expect(isError(result)).toBe(false);
	});

	test('returns true for error result', async () => {
		const result = await attempt(() => {
			throw new Error('fail');
		});

		expect(isError(result)).toBe(true);
	});

	test('narrows type correctly', async () => {
		const result = await attempt(() => {
			throw new Error('test error');
		});

		if (isError(result)) {
			// TypeScript should know result.error exists here
			expect(result.error.message).toBe('test error');
		}
	});
});

describe('unwrap', () => {
	test('returns data for success result', async () => {
		const result = await attempt(() => 'unwrapped');

		expect(unwrap(result)).toBe('unwrapped');
	});

	test('throws error for error result', async () => {
		const result = await attempt(() => {
			throw new Error('should throw');
		});

		expect(() => unwrap(result)).toThrow('should throw');
	});
});

describe('unwrapOr', () => {
	test('returns data for success result', async () => {
		const result = await attempt(() => 'actual');

		expect(unwrapOr(result, 'default')).toBe('actual');
	});

	test('returns default for error result', async () => {
		const result = await attempt<string>(() => {
			throw new Error('fail');
		});

		expect(unwrapOr(result, 'default')).toBe('default');
	});
});

describe('mapResult', () => {
	test('transforms data for success result', async () => {
		const result = await attempt(() => 5);
		const mapped = mapResult(result, (n) => n * 2);

		expect(mapped.success).toBe(true);
		expect(mapped.data).toBe(10);
	});

	test('passes through error result unchanged', async () => {
		const result = await attempt<number>(() => {
			throw new Error('original');
		});
		const mapped = mapResult(result, (n) => n * 2);

		expect(mapped.success).toBe(false);
		expect(mapped.error?.message).toBe('original');
	});
});

describe('mapError', () => {
	test('passes through success result unchanged', async () => {
		const result = await attempt(() => 'data');
		const mapped = mapError(result, (e) => `Wrapped: ${e.message}`);

		expect(mapped.success).toBe(true);
		expect(mapped.data).toBe('data');
	});

	test('transforms error for error result', async () => {
		const result = await attempt(() => {
			throw new Error('original');
		});
		const mapped = mapError(result, (e) => `Wrapped: ${e.message}`);

		expect(mapped.success).toBe(false);
		expect(mapped.error).toBe('Wrapped: original');
	});
});

describe('filtering with type guards', () => {
	test('can filter array of results', async () => {
		const results = await Promise.all([
			attempt(() => 1),
			attempt(() => {
				throw new Error('fail');
			}),
			attempt(() => 3),
		]);

		const succeeded = results.filter(isResolved);
		const failed = results.filter(isError);

		expect(succeeded).toHaveLength(2);
		expect(failed).toHaveLength(1);
		expect(succeeded.map((r) => r.data)).toEqual([1, 3]);
	});
});
