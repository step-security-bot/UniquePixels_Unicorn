import { describe, expect, test } from 'bun:test';
import {
	createGuard,
	guardFail,
	guardPass,
	runGuard,
	runGuards,
} from './index';

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
		const isPositive = createGuard<number, number>((input) => {
			if (input <= 0) {
				return guardFail('Number must be positive');
			}
			return guardPass(input);
		});

		const passResult = await isPositive(5);
		const failResult = await isPositive(-1);

		expect(passResult.ok).toBe(true);
		expect(failResult.ok).toBe(false);
	});

	test('creates an async guard function', async () => {
		const asyncValidator = createGuard<string, string>(
			async (input) => {
				await Promise.resolve();
				if (input.length < 3) {
					return guardFail('Input too short');
				}
				return guardPass(input);
			},
		);

		const passResult = await asyncValidator('hello');
		const failResult = await asyncValidator('ab');

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

		const isAdmin = createGuard<User, AdminUser>((user) => {
			if (user.role !== 'admin') {
				return guardFail('User is not an admin');
			}
			return guardPass(user as AdminUser);
		});

		const adminResult = await isAdmin({ id: '1', role: 'admin' });
		const userResult = await isAdmin({ id: '2', role: 'user' });

		expect(adminResult.ok).toBe(true);
		expect(userResult.ok).toBe(false);
	});
});

describe('runGuard', () => {
	test('runs synchronous guard and returns result', async () => {
		const guard = createGuard<number, number>((n) => {
			return n > 0 ? guardPass(n) : guardFail('Must be positive');
		});

		const result = await runGuard(guard, 5);

		expect(result.ok).toBe(true);
	});

	test('runs async guard and returns promise', async () => {
		const asyncGuard = createGuard<string, string>(async (s) => {
			await Promise.resolve();
			return s.length > 0 ? guardPass(s) : guardFail('Must not be empty');
		});

		const result = await runGuard(asyncGuard, 'test');

		expect(result.ok).toBe(true);
	});
});

describe('runGuards', () => {
	test('runs empty guard array successfully', async () => {
		const result = await runGuards([], 'input');

		expect(result.ok).toBe(true);
		expect((result as { ok: true; value: string }).value).toBe('input');
	});

	test('runs single guard successfully', async () => {
		const notEmpty = createGuard<string, string>((s) => {
			return s.length > 0 ? guardPass(s) : guardFail('Empty');
		});

		const result = await runGuards([notEmpty], 'hello');

		expect(result.ok).toBe(true);
		expect((result as { ok: true; value: string }).value).toBe('hello');
	});

	test('runs multiple guards in sequence', async () => {
		const calls: string[] = [];

		const guard1 = createGuard<number, number>((n) => {
			calls.push('guard1');
			return guardPass(n);
		});

		const guard2 = createGuard<number, number>((n) => {
			calls.push('guard2');
			return guardPass(n);
		});

		const guard3 = createGuard<number, number>((n) => {
			calls.push('guard3');
			return guardPass(n);
		});

		await runGuards([guard1, guard2, guard3], 42);

		expect(calls).toEqual(['guard1', 'guard2', 'guard3']);
	});

	test('short-circuits on first failure', async () => {
		const calls: string[] = [];

		const pass = createGuard<number, number>((n) => {
			calls.push('pass');
			return guardPass(n);
		});

		const fail = createGuard<number, number>((_n) => {
			calls.push('fail');
			return guardFail('Failure');
		});

		const shouldNotRun = createGuard<number, number>((n) => {
			calls.push('shouldNotRun');
			return guardPass(n);
		});

		const result = await runGuards([pass, fail, shouldNotRun], 1);

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

		const validate = createGuard<Input, Validated>((input) => {
			if (input.value < 0) {
				return guardFail('Invalid value');
			}
			return guardPass({ ...input, validated: true as const });
		});

		const enrich = createGuard<Validated, Enriched>((input) => {
			return guardPass({ ...input, enriched: true as const });
		});

		const result = await runGuards([validate, enrich], { value: 5 });

		expect(result.ok).toBe(true);
		if (result.ok) {
			const value = result.value as Enriched;
			expect(value.validated).toBe(true);
			expect(value.enriched).toBe(true);
			expect(value.value).toBe(5);
		}
	});

	test('handles async guards in sequence', async () => {
		const asyncGuard1 = createGuard<number, number>(async (n) => {
			await Promise.resolve();
			return guardPass(n + 1);
		});

		const asyncGuard2 = createGuard<number, number>(async (n) => {
			await Promise.resolve();
			return guardPass(n * 2);
		});

		const result = await runGuards([asyncGuard1, asyncGuard2], 5);

		expect(result.ok).toBe(true);
		// Input 5 -> guard1 adds 1 = 6 -> guard2 multiplies by 2 = 12
		expect((result as { ok: true; value: number }).value).toBe(12);
	});

	test('handles mixed sync and async guards', async () => {
		const syncGuard = createGuard<number, number>((n) => {
			return guardPass(n + 1);
		});

		const asyncGuard = createGuard<number, number>(async (n) => {
			await Promise.resolve();
			return guardPass(n * 2);
		});

		const result = await runGuards([syncGuard, asyncGuard, syncGuard], 1);

		expect(result.ok).toBe(true);
		// Input 1 -> sync adds 1 = 2 -> async multiplies by 2 = 4 -> sync adds 1 = 5
		expect((result as { ok: true; value: number }).value).toBe(5);
	});

	test('handles guard that throws error', async () => {
		const throwingGuard = createGuard<unknown, unknown>((_input) => {
			throw new Error('Guard threw an error');
		});

		await expect(runGuards([throwingGuard], 'test')).rejects.toThrow(
			'Guard threw an error',
		);
	});

	test('handles async guard rejection', async () => {
		const rejectingGuard = createGuard<unknown, unknown>(
			async (_input) => {
				throw new Error('Async guard rejected');
			},
		);

		await expect(runGuards([rejectingGuard], 'test')).rejects.toThrow(
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

		const isCircle = createGuard<Shape, Circle>((shape) => {
			if (shape.kind !== 'circle') {
				return guardFail('Not a circle');
			}
			return guardPass(shape);
		});

		const circleResult = await runGuards(
			[isCircle],
			{ kind: 'circle', radius: 5 },
		);
		const rectResult = await runGuards(
			[isCircle],
			{ kind: 'rectangle', width: 10, height: 20 },
		);

		expect(circleResult.ok).toBe(true);
		expect(rectResult.ok).toBe(false);
	});

	test('narrows nullable types', async () => {
		type MaybeString = string | null | undefined;

		const notNullish = createGuard<MaybeString, string>((value) => {
			if (value == null) {
				return guardFail('Value is null or undefined');
			}
			return guardPass(value);
		});

		const stringResult = await runGuards([notNullish], 'hello');
		const nullResult = await runGuards([notNullish], null);
		const undefinedResult = await runGuards([notNullish], undefined);

		expect(stringResult.ok).toBe(true);
		expect(nullResult.ok).toBe(false);
		expect(undefinedResult.ok).toBe(false);
	});
});
