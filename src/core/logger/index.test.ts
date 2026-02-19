import { describe, expect, test, mock } from 'bun:test';
import { Events } from 'discord.js';
import {
	createLogger,
	registerDiscordLogging,
	serializeError,
	MAX_SERIALIZE_DEPTH,
	type SerializedError,
} from './index.ts';

describe('createLogger', () => {
	test('returns a pino Logger instance', () => {
		const logger = createLogger();

		expect(logger).toBeDefined();
		expect(typeof logger.info).toBe('function');
		expect(typeof logger.error).toBe('function');
		expect(typeof logger.warn).toBe('function');
		expect(typeof logger.debug).toBe('function');
	});

	test('logger has correct log methods', () => {
		const logger = createLogger();

		expect(typeof logger.trace).toBe('function');
		expect(typeof logger.debug).toBe('function');
		expect(typeof logger.info).toBe('function');
		expect(typeof logger.warn).toBe('function');
		expect(typeof logger.error).toBe('function');
		expect(typeof logger.fatal).toBe('function');
	});

	test('logger writes to no-op destination without errors', () => {
		const logger = createLogger();

		expect(() => {
			logger.info('test info');
			logger.warn('test warn');
			logger.error(new Error('test error'));
			logger.flush();
		}).not.toThrow();
	});

	test('creates dev logger with pino-pretty transport', () => {
		const logger = createLogger({ dev: true });

		expect(logger).toBeDefined();
		expect(logger.level).toBe('debug');
		expect(typeof logger.info).toBe('function');
	});
});

describe('serializeError', () => {
	test('returns undefined for non-Error values', () => {
		expect(serializeError('not an error')).toBeUndefined();
		expect(serializeError(42)).toBeUndefined();
		expect(serializeError(null)).toBeUndefined();
		expect(serializeError(undefined)).toBeUndefined();
		expect(serializeError({ message: 'fake' })).toBeUndefined();
	});

	test('serializes a basic Error', () => {
		const error = new Error('something broke');
		const result = serializeError(error) as SerializedError;

		expect(result.type).toBe('Error');
		expect(result.message).toBe('something broke');
		expect(result.stack).toBeDefined();
		expect(result.cause).toBeUndefined();
		expect(result.errors).toBeUndefined();
	});

	test('serializes Error.cause chain', () => {
		const root = new Error('root cause');
		const wrapper = new Error('wrapper', { cause: root });
		const result = serializeError(wrapper) as SerializedError;

		expect(result.message).toBe('wrapper');
		expect(result.cause).toBeDefined();
		const cause = result.cause as SerializedError;
		expect(cause.type).toBe('Error');
		expect(cause.message).toBe('root cause');
	});

	test('serializes non-Error cause values as-is', () => {
		const error = new Error('bad response', { cause: { status: 404 } });
		const result = serializeError(error) as SerializedError;

		expect(result.cause).toEqual({ status: 404 });
	});

	test('serializes AggregateError with nested errors', () => {
		const inner1 = new Error('first');
		const inner2 = new Error('second');
		const aggregate = new AggregateError([inner1, inner2], 'multiple failures');
		const result = serializeError(aggregate) as SerializedError;

		expect(result.type).toBe('AggregateError');
		expect(result.message).toBe('multiple failures');
		expect(result.errors).toHaveLength(2);
		const errors = result.errors as SerializedError[];
		expect(errors[0]?.message).toBe('first');
		expect(errors[1]?.message).toBe('second');
	});

	test('captures custom enumerable properties', () => {
		const error = new Error('discord error');
		Object.assign(error, { code: 50013, status: 403, method: 'PATCH' });
		const result = serializeError(error) as SerializedError;

		expect(result['code']).toBe(50013);
		expect(result['status']).toBe(403);
		expect(result['method']).toBe('PATCH');
	});

	test('redacts sensitive enumerable properties', () => {
		const error = new Error('auth failure');
		Object.assign(error, {
			token: 'secret-token-123',
			apiKey: 'key-456',
			password: 'hunter2',
			Authorization: 'Bearer xyz',
			code: 401,
		});
		const result = serializeError(error) as SerializedError;

		expect(result['token']).toBe('[REDACTED]');
		expect(result['apiKey']).toBe('[REDACTED]');
		expect(result['password']).toBe('[REDACTED]');
		expect(result['Authorization']).toBe('[REDACTED]');
		// Non-sensitive keys still pass through
		expect(result['code']).toBe(401);
	});

	test('redacts keys with separator variants (hyphens, underscores)', () => {
		const error = new Error('leak check');
		Object.assign(error, {
			api_key: 'key-1',
			'api-key': 'key-2',
			access_token: 'tok-1',
			'set-cookie': 'session=abc',
			'Set_Cookie': 'session=def',
		});
		const result = serializeError(error) as SerializedError;

		expect(result['api_key']).toBe('[REDACTED]');
		expect(result['api-key']).toBe('[REDACTED]');
		expect(result['access_token']).toBe('[REDACTED]');
		expect(result['set-cookie']).toBe('[REDACTED]');
		expect(result['Set_Cookie']).toBe('[REDACTED]');
	});

	test('respects max depth to prevent infinite recursion', () => {
		// Build a cause chain deeper than MAX_SERIALIZE_DEPTH (5)
		let error: Error = new Error('deepest');
		for (let i = 0; i < 7; i++) {
			error = new Error(`level-${i}`, { cause: error });
		}
		const result = serializeError(error) as SerializedError;

		// Walk down the chain — should truncate at depth 5
		let current: SerializedError | undefined = result;
		let depth = 0;
		while (current?.cause && typeof current.cause === 'object' && 'type' in current.cause) {
			current = current.cause as SerializedError;
			depth++;
		}
		// At max depth the cause chain stops being recursively expanded
		expect(depth).toBeLessThanOrEqual(MAX_SERIALIZE_DEPTH);
		expect(current).toBeDefined();
	});

	test('serializes AggregateError with mixed Error and non-Error items', () => {
		const inner = new Error('real error');
		const aggregate = new AggregateError(
			[inner, 'string failure', 42],
			'mixed errors',
		);
		const result = serializeError(aggregate) as SerializedError;

		expect(result.errors).toHaveLength(3);
		const errors = result.errors as unknown[];
		expect((errors[0] as SerializedError).message).toBe('real error');
		expect(errors[1]).toBe('string failure');
		expect(errors[2]).toBe(42);
	});

	test('preserves named error types', () => {
		const error = new TypeError('not a function');
		const result = serializeError(error) as SerializedError;

		expect(result.type).toBe('TypeError');
		expect(result.message).toBe('not a function');
	});

	test('does not let a custom "type" property overwrite serialized.type', () => {
		const error = new TypeError('bad input');
		Object.assign(error, { type: 'SpoofedType', code: 42 });
		const result = serializeError(error) as SerializedError;

		expect(result.type).toBe('TypeError');
		expect(result['code']).toBe(42);
	});
});

describe('registerDiscordLogging', () => {
	test('registers handlers for Debug, Warn, and Error events', () => {
		const mockOn = mock(() => {});
		const mockClient = { on: mockOn } as never;
		const mockLogger = {
			debug: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
		} as never;

		registerDiscordLogging(mockClient, mockLogger);

		expect(mockOn).toHaveBeenCalledTimes(3);
		expect(mockOn).toHaveBeenCalledWith(Events.Debug, expect.any(Function));
		expect(mockOn).toHaveBeenCalledWith(Events.Warn, expect.any(Function));
		expect(mockOn).toHaveBeenCalledWith(Events.Error, expect.any(Function));
	});

	test('debug handler forwards messages to logger.debug', () => {
		const handlers: Record<string, (arg: unknown) => void> = {};
		const mockOn = mock((event: string, handler: (arg: unknown) => void) => {
			handlers[event] = handler;
		});
		const mockClient = { on: mockOn } as never;
		const mockDebug = mock(() => {});
		const mockLogger = {
			debug: mockDebug,
			warn: mock(() => {}),
			error: mock(() => {}),
		} as never;

		registerDiscordLogging(mockClient, mockLogger);

		// Invoke the debug handler
		const debugHandler = handlers[Events.Debug];
		expect(debugHandler).toBeDefined();
		debugHandler?.('debug message');

		expect(mockDebug).toHaveBeenCalledWith('debug message');
	});

	test('warn handler forwards messages to logger.warn', () => {
		const handlers: Record<string, (arg: unknown) => void> = {};
		const mockOn = mock((event: string, handler: (arg: unknown) => void) => {
			handlers[event] = handler;
		});
		const mockClient = { on: mockOn } as never;
		const mockWarn = mock(() => {});
		const mockLogger = {
			debug: mock(() => {}),
			warn: mockWarn,
			error: mock(() => {}),
		} as never;

		registerDiscordLogging(mockClient, mockLogger);

		// Invoke the warn handler
		const warnHandler = handlers[Events.Warn];
		expect(warnHandler).toBeDefined();
		warnHandler?.('warning message');

		expect(mockWarn).toHaveBeenCalledWith('warning message');
	});

	test('error handler forwards errors to logger.error with err key', () => {
		const handlers: Record<string, (arg: unknown) => void> = {};
		const mockOn = mock((event: string, handler: (arg: unknown) => void) => {
			handlers[event] = handler;
		});
		const mockClient = { on: mockOn } as never;
		const mockError = mock(() => {});
		const mockLogger = {
			debug: mock(() => {}),
			warn: mock(() => {}),
			error: mockError,
		} as never;

		registerDiscordLogging(mockClient, mockLogger);

		// Invoke the error handler
		const errorHandler = handlers[Events.Error];
		expect(errorHandler).toBeDefined();
		const testError = new Error('test error');
		errorHandler?.(testError);

		expect(mockError).toHaveBeenCalledWith({ err: testError }, 'test error');
	});
});
