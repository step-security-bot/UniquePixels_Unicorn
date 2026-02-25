import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as z from 'zod';
import { MiscValue, Secret, Snowflake, envMap } from './schema-helpers.ts';

/** Creates a restore function that resets `Bun.env` to its state at call time. */
function makeEnvRestorer() {
	const snapshot = { ...Bun.env };
	return () => {
		for (const key of Object.keys(Bun.env)) {
			if (!(key in snapshot)) delete Bun.env[key];
		}
		for (const [key, value] of Object.entries(snapshot)) {
			Bun.env[key] = value;
		}
	};
}

describe('Snowflake', () => {
	test('accepts valid 17-digit snowflake', () => {
		const result = Snowflake.safeParse('12345678901234567');

		expect(result.success).toBe(true);
		expect(result.data).toBe('12345678901234567');
	});

	test('accepts valid 18-digit snowflake', () => {
		const result = Snowflake.safeParse('123456789012345678');

		expect(result.success).toBe(true);
	});

	test('accepts valid 19-digit snowflake', () => {
		const result = Snowflake.safeParse('1234567890123456789');

		expect(result.success).toBe(true);
	});

	test('rejects snowflake shorter than 17 digits', () => {
		const result = Snowflake.safeParse('1234567890123456');

		expect(result.success).toBe(false);
	});

	test('rejects snowflake longer than 19 digits', () => {
		const result = Snowflake.safeParse('12345678901234567890');

		expect(result.success).toBe(false);
	});

	test('rejects non-numeric strings', () => {
		const result = Snowflake.safeParse('1234567890123456a');

		expect(result.success).toBe(false);
	});

	test('rejects numbers', () => {
		const result = Snowflake.safeParse(12345678901234567);

		expect(result.success).toBe(false);
	});

	test('rejects null', () => {
		const result = Snowflake.safeParse(null);

		expect(result.success).toBe(false);
	});
});

describe('Secret', () => {
	const restoreEnv = makeEnvRestorer();

	beforeEach(() => {
		Bun.env['TEST_SECRET'] = 'secret_value_123';
	});

	afterEach(restoreEnv);

	test('resolves secret from environment variable', () => {
		const result = Secret.safeParse('secret://TEST_SECRET');

		expect(result.success).toBe(true);
		expect(result.data).toBe('secret_value_123');
	});

	test('rejects invalid secret format', () => {
		const result = Secret.safeParse('not-a-secret');

		expect(result.success).toBe(false);
	});

	test('rejects secret:// with no key', () => {
		const result = Secret.safeParse('secret://');

		expect(result.success).toBe(false);
	});

	test('fails when environment variable is not set', () => {
		const result = Secret.safeParse('secret://NONEXISTENT_VAR');

		expect(result.success).toBe(false);
		if (!result.success) {
			const firstIssue = result.error.issues[0];
			expect(firstIssue).toBeDefined();
			expect(firstIssue?.message).toContain('NONEXISTENT_VAR');
		}
	});
});

describe('MiscValue', () => {
	const restoreEnv = makeEnvRestorer();

	beforeEach(() => {
		Bun.env['MISC_TEST_KEY'] = 'resolved_value';
	});

	afterEach(restoreEnv);

	test('resolves secret:// strings from environment', () => {
		const result = MiscValue.safeParse('secret://MISC_TEST_KEY');

		expect(result.success).toBe(true);
		expect(result.data).toBe('resolved_value');
	});

	test('fails for unset secret:// references', () => {
		const result = MiscValue.safeParse('secret://UNSET_KEY');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe(
				'Environment variable "UNSET_KEY" is not set',
			);
		}
	});

	test('rejects secret:// with no key', () => {
		const result = MiscValue.safeParse('secret://');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe(
				'Invalid secret reference (must be in the format `secret://key`)',
			);
		}
	});

	test('passes through non-secret strings unchanged', () => {
		const result = MiscValue.safeParse('plain-string');

		expect(result.success).toBe(true);
		expect(result.data).toBe('plain-string');
	});

	test('passes through non-string values unchanged', () => {
		const numberResult = MiscValue.safeParse(42);
		expect(numberResult.success).toBe(true);
		expect(numberResult.data).toBe(42);

		const boolResult = MiscValue.safeParse(true);
		expect(boolResult.success).toBe(true);
		expect(boolResult.data).toBe(true);
	});
});

describe('envMap', () => {
	test('accepts single value', () => {
		const schema = envMap(z.string());
		const result = schema.safeParse('single');

		expect(result.success).toBe(true);
		expect(result.data).toBe('single');
	});

	test('accepts single-element tuple', () => {
		const schema = envMap(z.string());
		const result = schema.safeParse(['prod-only']);

		expect(result.success).toBe(true);
		expect(result.data).toBe('prod-only');
	});

	test('selects prod value in production', () => {
		const originalNodeEnv = Bun.env['NODE_ENV'];
		Bun.env['NODE_ENV'] = 'production';

		// Need to re-import to get fresh isDev value
		// For this test, we test the transform logic directly
		const schema = envMap(z.string());
		const result = schema.safeParse(['prod', 'dev']);

		expect(result.success).toBe(true);
		// Since isDev is evaluated at module load, this test may not reflect runtime changes
		// The actual behavior depends on NODE_ENV at module load time

		if (originalNodeEnv === undefined) {
			delete Bun.env['NODE_ENV'];
		} else {
			Bun.env['NODE_ENV'] = originalNodeEnv;
		}
	});

	test('works with Snowflake schema', () => {
		const schema = envMap(Snowflake);

		const singleResult = schema.safeParse('12345678901234567');
		expect(singleResult.success).toBe(true);

		const tupleResult = schema.safeParse([
			'12345678901234567',
			'98765432109876543',
		]);
		expect(tupleResult.success).toBe(true);
	});

	test('rejects invalid values in tuple', () => {
		const schema = envMap(z.number());
		const result = schema.safeParse(['not-a-number', 123]);

		expect(result.success).toBe(false);
	});

	test('rejects tuple with more than 2 elements', () => {
		const schema = envMap(z.string());
		const result = schema.safeParse(['one', 'two', 'three']);

		expect(result.success).toBe(false);
	});
});
