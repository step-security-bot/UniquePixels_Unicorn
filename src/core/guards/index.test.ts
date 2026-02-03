import { describe, expect, mock, test } from 'bun:test';
import type { UnicornClient } from '@/core/client';
import {
	createGuard,
	guardFail,
	guardPass,
	runGuard,
	runGuards,
} from './index';

// Create a minimal mock UnicornClient for testing
function createMockClient(): UnicornClient {
	return {
		logger: {
			debug: mock(() => {}),
			info: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
		},
	} as unknown as UnicornClient;
}

describe('guardPass', () => {
	test('creates successful guard result', () => {
		const result = guardPass('test value');

		expect(result.ok).toBe(true);
		expect((result as { ok: true; value: string }).value).toBe('test value');
	});

	test('preserves complex object values', () => {
		const obj = { id: 1, name: 'test', nested: { deep: true } };
		const result = guardPass(obj);

		expect(result.ok).toBe(true);
		expect((result as { ok: true; value: typeof obj }).value).toEqual(obj);
	});

	test('works with null and undefined', () => {
		const nullResult = guardPass(null);
		const undefinedResult = guardPass(undefined);

		expect(nullResult.ok).toBe(true);
		expect((nullResult as { ok: true; value: null }).value).toBe(null);
		expect(undefinedResult.ok).toBe(true);
		expect((undefinedResult as { ok: true; value: undefined }).value).toBe(
			undefined,
		);
	});
});

describe('guardFail', () => {
	test('creates failed guard result', () => {
		const result = guardFail('Permission denied');

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(
			'Permission denied',
		);
	});

	test('preserves reason message', () => {
		const reason = 'User must have admin permissions to use this command';
		const result = guardFail(reason);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(reason);
	});

	test('handles empty string reason', () => {
		const result = guardFail('');

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe('');
	});
});

describe('createGuard', () => {
	test('creates a synchronous guard function', async () => {
		const isPositive = createGuard<number, number>((input, _client) => {
			if (input <= 0) {
				return guardFail('Number must be positive');
			}
			return guardPass(input);
		});

		const client = createMockClient();
		const passResult = await isPositive(5, client);
		const failResult = await isPositive(-1, client);

		expect(passResult.ok).toBe(true);
		expect(failResult.ok).toBe(false);
	});

	test('creates an async guard function', async () => {
		const asyncValidator = createGuard<string, string>(
			async (input, _client) => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				if (input.length < 3) {
					return guardFail('Input too short');
				}
				return guardPass(input);
			},
		);

		const client = createMockClient();
		const passResult = await asyncValidator('hello', client);
		const failResult = await asyncValidator('ab', client);

		expect(passResult.ok).toBe(true);
		expect(failResult.ok).toBe(false);
	});

	test('creates a type-narrowing guard', async () => {
		interface User {
			id: string;
			role?: 'admin' | 'user';
		}
		interface AdminUser extends User {
			role: 'admin';
		}

		const isAdmin = createGuard<User, AdminUser>((user, _client) => {
			if (user.role !== 'admin') {
				return guardFail('User is not an admin');
			}
			return guardPass(user as AdminUser);
		});

		const client = createMockClient();
		const adminResult = await isAdmin({ id: '1', role: 'admin' }, client);
		const userResult = await isAdmin({ id: '2', role: 'user' }, client);

		expect(adminResult.ok).toBe(true);
		expect(userResult.ok).toBe(false);
	});
});

describe('runGuard', () => {
	test('runs synchronous guard and returns result', async () => {
		const guard = createGuard<number, number>((n, _client) => {
			return n > 0 ? guardPass(n) : guardFail('Must be positive');
		});

		const client = createMockClient();
		const result = await runGuard(guard, 5, client);

		expect(result.ok).toBe(true);
	});

	test('runs async guard and returns promise', async () => {
		const asyncGuard = createGuard<string, string>(async (s, _client) => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			return s.length > 0 ? guardPass(s) : guardFail('Must not be empty');
		});

		const client = createMockClient();
		const result = await runGuard(asyncGuard, 'test', client);

		expect(result.ok).toBe(true);
	});
});

describe('runGuards', () => {
	test('runs empty guard array successfully', async () => {
		const client = createMockClient();
		const result = await runGuards([], 'input', client);

		expect(result.ok).toBe(true);
		expect((result as { ok: true; value: string }).value).toBe('input');
	});

	test('runs single guard successfully', async () => {
		const notEmpty = createGuard<string, string>((s, _client) => {
			return s.length > 0 ? guardPass(s) : guardFail('Empty');
		});

		const client = createMockClient();
		const result = await runGuards([notEmpty], 'hello', client);

		expect(result.ok).toBe(true);
		expect((result as { ok: true; value: string }).value).toBe('hello');
	});

	test('runs multiple guards in sequence', async () => {
		const calls: string[] = [];

		const guard1 = createGuard<number, number>((n, _client) => {
			calls.push('guard1');
			return guardPass(n);
		});

		const guard2 = createGuard<number, number>((n, _client) => {
			calls.push('guard2');
			return guardPass(n);
		});

		const guard3 = createGuard<number, number>((n, _client) => {
			calls.push('guard3');
			return guardPass(n);
		});

		const client = createMockClient();
		await runGuards([guard1, guard2, guard3], 42, client);

		expect(calls).toEqual(['guard1', 'guard2', 'guard3']);
	});

	test('short-circuits on first failure', async () => {
		const calls: string[] = [];

		const pass = createGuard<number, number>((n, _client) => {
			calls.push('pass');
			return guardPass(n);
		});

		const fail = createGuard<number, number>((_n, _client) => {
			calls.push('fail');
			return guardFail('Failure');
		});

		const shouldNotRun = createGuard<number, number>((n, _client) => {
			calls.push('shouldNotRun');
			return guardPass(n);
		});

		const client = createMockClient();
		const result = await runGuards([pass, fail, shouldNotRun], 1, client);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe('Failure');
		expect(calls).toEqual(['pass', 'fail']);
		expect(calls).not.toContain('shouldNotRun');
	});

	test('passes narrowed value between guards', async () => {
		interface Input {
			value: number;
		}
		interface Validated extends Input {
			validated: true;
		}
		interface Enriched extends Validated {
			enriched: true;
		}

		const validate = createGuard<Input, Validated>((input, _client) => {
			if (input.value < 0) {
				return guardFail('Invalid value');
			}
			return guardPass({ ...input, validated: true as const });
		});

		const enrich = createGuard<Validated, Enriched>((input, _client) => {
			return guardPass({ ...input, enriched: true as const });
		});

		const client = createMockClient();
		const result = await runGuards([validate, enrich], { value: 5 }, client);

		expect(result.ok).toBe(true);
		if (result.ok) {
			const value = result.value as Enriched;
			expect(value.validated).toBe(true);
			expect(value.enriched).toBe(true);
			expect(value.value).toBe(5);
		}
	});

	test('handles async guards in sequence', async () => {
		const asyncGuard1 = createGuard<number, number>(async (n, _client) => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return guardPass(n + 1);
		});

		const asyncGuard2 = createGuard<number, number>(async (n, _client) => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return guardPass(n * 2);
		});

		const client = createMockClient();
		const result = await runGuards([asyncGuard1, asyncGuard2], 5, client);

		expect(result.ok).toBe(true);
		// Input 5 -> guard1 adds 1 = 6 -> guard2 multiplies by 2 = 12
		expect((result as { ok: true; value: number }).value).toBe(12);
	});

	test('handles mixed sync and async guards', async () => {
		const syncGuard = createGuard<number, number>((n, _client) => {
			return guardPass(n + 1);
		});

		const asyncGuard = createGuard<number, number>(async (n, _client) => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			return guardPass(n * 2);
		});

		const client = createMockClient();
		const result = await runGuards([syncGuard, asyncGuard, syncGuard], 1, client);

		expect(result.ok).toBe(true);
		// Input 1 -> sync adds 1 = 2 -> async multiplies by 2 = 4 -> sync adds 1 = 5
		expect((result as { ok: true; value: number }).value).toBe(5);
	});

	test('client is passed to each guard', async () => {
		const receivedClients: UnicornClient[] = [];

		const captureClient = createGuard<unknown, unknown>((input, client) => {
			receivedClients.push(client);
			return guardPass(input);
		});

		const client = createMockClient();
		await runGuards([captureClient, captureClient], 'test', client);

		expect(receivedClients).toHaveLength(2);
		expect(receivedClients[0]).toBe(client);
		expect(receivedClients[1]).toBe(client);
	});

	test('handles guard that throws error', async () => {
		const throwingGuard = createGuard<unknown, unknown>((_input, _client) => {
			throw new Error('Guard threw an error');
		});

		const client = createMockClient();

		await expect(runGuards([throwingGuard], 'test', client)).rejects.toThrow(
			'Guard threw an error',
		);
	});

	test('handles async guard rejection', async () => {
		const rejectingGuard = createGuard<unknown, unknown>(
			async (_input, _client) => {
				throw new Error('Async guard rejected');
			},
		);

		const client = createMockClient();

		await expect(runGuards([rejectingGuard], 'test', client)).rejects.toThrow(
			'Async guard rejected',
		);
	});
});

describe('type narrowing scenarios', () => {
	test('narrows union types', async () => {
		type Shape =
			| { kind: 'circle'; radius: number }
			| { kind: 'rectangle'; width: number; height: number };
		type Circle = Extract<Shape, { kind: 'circle' }>;

		const isCircle = createGuard<Shape, Circle>((shape, _client) => {
			if (shape.kind !== 'circle') {
				return guardFail('Not a circle');
			}
			return guardPass(shape);
		});

		const client = createMockClient();

		const circleResult = await runGuards(
			[isCircle],
			{ kind: 'circle', radius: 5 },
			client,
		);
		const rectResult = await runGuards(
			[isCircle],
			{ kind: 'rectangle', width: 10, height: 20 },
			client,
		);

		expect(circleResult.ok).toBe(true);
		expect(rectResult.ok).toBe(false);
	});

	test('narrows nullable types', async () => {
		type MaybeString = string | null | undefined;

		const notNullish = createGuard<MaybeString, string>((value, _client) => {
			if (value == null) {
				return guardFail('Value is null or undefined');
			}
			return guardPass(value);
		});

		const client = createMockClient();

		const stringResult = await runGuards([notNullish], 'hello', client);
		const nullResult = await runGuards([notNullish], null, client);
		const undefinedResult = await runGuards([notNullish], undefined, client);

		expect(stringResult.ok).toBe(true);
		expect(nullResult.ok).toBe(false);
		expect(undefinedResult.ok).toBe(false);
	});
});
