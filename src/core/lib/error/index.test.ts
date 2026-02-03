import { describe, expect, test } from 'bun:test';
import { ensureError } from './index.ts';

describe('ensureError', () => {
	test('returns Error instances as-is', () => {
		const original = new Error('test error');
		const result = ensureError(original);

		expect(result).toBe(original);
	});

	test('preserves Error subclasses', () => {
		const original = new TypeError('type error');
		const result = ensureError(original);

		expect(result).toBe(original);
		expect(result).toBeInstanceOf(TypeError);
	});

	test('converts error-like objects to Error', () => {
		const errorLike = { message: 'error-like message', name: 'CustomError' };
		const result = ensureError(errorLike);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('error-like message');
		expect(result.name).toBe('CustomError');
		expect(result.cause).toBe(errorLike);
	});

	test('preserves stack from error-like objects', () => {
		const errorLike = {
			message: 'with stack',
			stack: 'custom stack trace',
		};
		const result = ensureError(errorLike);

		expect(result.stack).toBe('custom stack trace');
	});

	test('converts strings to Error with string as message', () => {
		const result = ensureError('string error');

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('string error');
		expect(result.cause).toBe('string error');
	});

	test('converts numbers to Error', () => {
		const result = ensureError(42);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('42');
		expect(result.cause).toBe(42);
	});

	test('converts null to Error', () => {
		const result = ensureError(null);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('null');
		expect(result.cause).toBe(null);
	});

	test('converts undefined to Error', () => {
		const result = ensureError(undefined);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('undefined');
		expect(result.cause).toBe(undefined);
	});

	test('converts objects to JSON string message', () => {
		const obj = { foo: 'bar', num: 123 };
		const result = ensureError(obj);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('{"foo":"bar","num":123}');
		expect(result.cause).toBe(obj);
	});

	test('handles circular objects gracefully', () => {
		const circular: Record<string, unknown> = { name: 'circular' };
		circular['self'] = circular;

		const result = ensureError(circular);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('[object Object]');
		expect(result.cause).toBe(circular);
	});

	test('converts booleans to Error', () => {
		const result = ensureError(false);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('false');
		expect(result.cause).toBe(false);
	});
});
