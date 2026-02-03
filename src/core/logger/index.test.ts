import { describe, expect, test, mock, beforeEach } from 'bun:test';
import pino from 'pino';
import { Events } from 'discord.js';
import {
	createLogger,
	createSentryStream,
	registerDiscordLogging,
	PINO_TO_SENTRY_LEVEL,
	PINO_LEVEL_NAME,
	ERROR_LEVELS,
	LOG_LEVELS,
	type SentryClient,
} from './index.ts';

// Create mock Sentry client for dependency injection
const mockCaptureException = mock(() => 'event-id');
const mockCaptureMessage = mock(() => 'event-id');

const mockSentry: SentryClient = {
	captureException: mockCaptureException,
	captureMessage: mockCaptureMessage,
};

// Types for test assertions
type CaptureMessageCall = [string, { level: string; extra?: Record<string, unknown> }];
type CaptureExceptionCall = [Error, { level: string; extra?: Record<string, unknown> }];

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
});

describe('Sentry stream integration', () => {
	beforeEach(() => {
		mockCaptureException.mockClear();
		mockCaptureMessage.mockClear();
	});

	test('calls captureMessage for info level logs', async () => {
		const stream = createSentryStream(mockSentry);
		const logger = pino({ level: 'info' }, stream);
		logger.info('test info message');

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(mockCaptureMessage).toHaveBeenCalled();
		const [message, options] = mockCaptureMessage.mock.calls[0] as unknown as CaptureMessageCall;
		expect(message).toBe('test info message');
		expect(options.level).toBe('info');
	});

	test('calls captureMessage for warn level logs without error', async () => {
		const stream = createSentryStream(mockSentry);
		const logger = pino({ level: 'info' }, stream);
		logger.warn('test warning message');

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(mockCaptureMessage).toHaveBeenCalled();
		const [message, options] = mockCaptureMessage.mock.calls[0] as unknown as CaptureMessageCall;
		expect(message).toBe('test warning message');
		expect(options.level).toBe('warning');
	});

	test('calls captureException for error level logs with Error object', async () => {
		const stream = createSentryStream(mockSentry);
		const logger = pino({ level: 'info' }, stream);
		const testError = new Error('test error');
		logger.error(testError);

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(mockCaptureException).toHaveBeenCalled();
		const [error, options] = mockCaptureException.mock.calls[0] as unknown as CaptureExceptionCall;
		expect(error.message).toBe('test error');
		expect(options.level).toBe('error');
	});

	test('calls captureException for fatal level logs with Error object', async () => {
		const stream = createSentryStream(mockSentry);
		const logger = pino({ level: 'info' }, stream);
		const testError = new Error('fatal error');
		logger.fatal(testError);

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(mockCaptureException).toHaveBeenCalled();
		const [error, options] = mockCaptureException.mock.calls[0] as unknown as CaptureExceptionCall;
		expect(error.message).toBe('fatal error');
		expect(options.level).toBe('fatal');
	});

	test('includes extra fields in Sentry context', async () => {
		const stream = createSentryStream(mockSentry);
		const logger = pino({ level: 'info' }, stream);
		logger.info({ userId: 123, action: 'login' }, 'user logged in');

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(mockCaptureMessage).toHaveBeenCalled();
		const [, options] = mockCaptureMessage.mock.calls[0] as unknown as CaptureMessageCall;
		expect(options.extra?.['userId']).toBe(123);
		expect(options.extra?.['action']).toBe('login');
	});

	test('does not call Sentry for debug level logs', async () => {
		const stream = createSentryStream(mockSentry);
		const logger = pino({ level: 'debug' }, stream);
		logger.debug('debug message');

		await new Promise((resolve) => setTimeout(resolve, 50));

		// Debug is not in LOG_LEVELS, so captureMessage should not be called
		expect(mockCaptureMessage).not.toHaveBeenCalled();
		expect(mockCaptureException).not.toHaveBeenCalled();
	});

	test('does not call Sentry for trace level logs', async () => {
		const stream = createSentryStream(mockSentry);
		const logger = pino({ level: 'trace' }, stream);
		logger.trace('trace message');

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(mockCaptureMessage).not.toHaveBeenCalled();
		expect(mockCaptureException).not.toHaveBeenCalled();
	});
});

describe('level mappings', () => {
	beforeEach(() => {
		mockCaptureException.mockClear();
		mockCaptureMessage.mockClear();
	});

	test('maps pino warn (40) to Sentry warning', async () => {
		const stream = createSentryStream(mockSentry);
		const logger = pino({ level: 'info' }, stream);
		logger.warn('warning test');

		await new Promise((resolve) => setTimeout(resolve, 50));

		const [, options] = mockCaptureMessage.mock.calls[0] as unknown as CaptureMessageCall;
		expect(options.level).toBe('warning');
	});

	test('maps pino error (50) to Sentry error', async () => {
		const stream = createSentryStream(mockSentry);
		const logger = pino({ level: 'info' }, stream);
		logger.error('error test');

		await new Promise((resolve) => setTimeout(resolve, 50));

		const [, options] = mockCaptureMessage.mock.calls[0] as unknown as CaptureMessageCall;
		expect(options.level).toBe('error');
	});

	test('maps pino fatal (60) to Sentry fatal', async () => {
		const stream = createSentryStream(mockSentry);
		const logger = pino({ level: 'info' }, stream);
		logger.fatal('fatal test');

		await new Promise((resolve) => setTimeout(resolve, 50));

		const [, options] = mockCaptureMessage.mock.calls[0] as unknown as CaptureMessageCall;
		expect(options.level).toBe('fatal');
	});

	test('PINO_TO_SENTRY_LEVEL has correct mappings', () => {
		expect(PINO_TO_SENTRY_LEVEL[10]).toBe('debug');
		expect(PINO_TO_SENTRY_LEVEL[20]).toBe('debug');
		expect(PINO_TO_SENTRY_LEVEL[30]).toBe('info');
		expect(PINO_TO_SENTRY_LEVEL[40]).toBe('warning');
		expect(PINO_TO_SENTRY_LEVEL[50]).toBe('error');
		expect(PINO_TO_SENTRY_LEVEL[60]).toBe('fatal');
	});

	test('PINO_LEVEL_NAME has correct mappings', () => {
		expect(PINO_LEVEL_NAME[10]).toBe('trace');
		expect(PINO_LEVEL_NAME[20]).toBe('debug');
		expect(PINO_LEVEL_NAME[30]).toBe('info');
		expect(PINO_LEVEL_NAME[40]).toBe('warn');
		expect(PINO_LEVEL_NAME[50]).toBe('error');
		expect(PINO_LEVEL_NAME[60]).toBe('fatal');
	});

	test('ERROR_LEVELS contains correct levels', () => {
		expect(ERROR_LEVELS.has('warn')).toBe(true);
		expect(ERROR_LEVELS.has('error')).toBe(true);
		expect(ERROR_LEVELS.has('fatal')).toBe(true);
		expect(ERROR_LEVELS.has('info')).toBe(false);
		expect(ERROR_LEVELS.has('debug')).toBe(false);
	});

	test('LOG_LEVELS contains correct levels', () => {
		expect(LOG_LEVELS.has('info')).toBe(true);
		expect(LOG_LEVELS.has('warn')).toBe(true);
		expect(LOG_LEVELS.has('error')).toBe(true);
		expect(LOG_LEVELS.has('fatal')).toBe(true);
		expect(LOG_LEVELS.has('debug')).toBe(false);
		expect(LOG_LEVELS.has('trace')).toBe(false);
	});
});

describe('stream edge cases', () => {
	beforeEach(() => {
		mockCaptureException.mockClear();
		mockCaptureMessage.mockClear();
	});

	test('handles empty lines gracefully', async () => {
		const stream = createSentryStream(mockSentry);
		const mockStdoutWrite = mock(() => true);
		const originalWrite = process.stdout.write;
		process.stdout.write = mockStdoutWrite as typeof process.stdout.write;

		try {
			// Write empty/whitespace content
			await new Promise<void>((resolve, reject) => {
				stream.write('\n', (err) => (err ? reject(err) : resolve()));
			});
			await new Promise<void>((resolve, reject) => {
				stream.write('   \n', (err) => (err ? reject(err) : resolve()));
			});
			await new Promise<void>((resolve, reject) => {
				stream.write('', (err) => (err ? reject(err) : resolve()));
			});

			await new Promise((resolve) => setTimeout(resolve, 50));

			// Should not call Sentry for empty lines
			expect(mockCaptureMessage).not.toHaveBeenCalled();
			expect(mockCaptureException).not.toHaveBeenCalled();
		} finally {
			process.stdout.write = originalWrite;
		}
	});

	test('handles malformed JSON gracefully', async () => {
		const stream = createSentryStream(mockSentry);
		const mockStdoutWrite = mock(() => true);
		const originalWrite = process.stdout.write;
		process.stdout.write = mockStdoutWrite as typeof process.stdout.write;

		try {
			// Write invalid JSON
			await new Promise<void>((resolve, reject) => {
				stream.write('not valid json\n', (err) => (err ? reject(err) : resolve()));
			});

			await new Promise((resolve) => setTimeout(resolve, 50));

			// Should not throw and should write to stdout as fallback
			expect(mockCaptureMessage).not.toHaveBeenCalled();
			expect(mockCaptureException).not.toHaveBeenCalled();
			expect(mockStdoutWrite).toHaveBeenCalled();
		} finally {
			process.stdout.write = originalWrite;
		}
	});

	test('handles error without stack trace', async () => {
		const stream = createSentryStream(mockSentry);
		const mockStdoutWrite = mock(() => true);
		const originalWrite = process.stdout.write;
		process.stdout.write = mockStdoutWrite as typeof process.stdout.write;

		try {
			const record = {
				level: 50,
				time: Date.now(),
				pid: 1,
				hostname: 'test',
				msg: 'error without stack',
				err: { type: 'Error', message: 'no stack error' }, // no stack property
			};

			await new Promise<void>((resolve, reject) => {
				stream.write(JSON.stringify(record) + '\n', (err) => (err ? reject(err) : resolve()));
			});

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(mockCaptureException).toHaveBeenCalled();
			const [error] = mockCaptureException.mock.calls[0] as unknown as CaptureExceptionCall;
			expect(error.message).toBe('no stack error');
			expect(error.name).toBe('Error');
		} finally {
			process.stdout.write = originalWrite;
		}
	});

	test('uses fallback message when msg is undefined', async () => {
		const stream = createSentryStream(mockSentry);
		const mockStdoutWrite = mock(() => true);
		const originalWrite = process.stdout.write;
		process.stdout.write = mockStdoutWrite as typeof process.stdout.write;

		try {
			const record = {
				level: 30, // info
				time: Date.now(),
				pid: 1,
				hostname: 'test',
				// no msg property
			};

			await new Promise<void>((resolve, reject) => {
				stream.write(JSON.stringify(record) + '\n', (err) => (err ? reject(err) : resolve()));
			});

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(mockCaptureMessage).toHaveBeenCalled();
			const [message] = mockCaptureMessage.mock.calls[0] as unknown as CaptureMessageCall;
			expect(message).toBe('Log message');
		} finally {
			process.stdout.write = originalWrite;
		}
	});

	test('handles unknown level numbers with fallback', async () => {
		const stream = createSentryStream(mockSentry);
		const mockStdoutWrite = mock(() => true);
		const originalWrite = process.stdout.write;
		process.stdout.write = mockStdoutWrite as typeof process.stdout.write;

		try {
			const record = {
				level: 99, // unknown level
				time: Date.now(),
				pid: 1,
				hostname: 'test',
				msg: 'unknown level message',
			};

			await new Promise<void>((resolve, reject) => {
				stream.write(JSON.stringify(record) + '\n', (err) => (err ? reject(err) : resolve()));
			});

			await new Promise((resolve) => setTimeout(resolve, 50));

			// Unknown level defaults to 'info' which is in LOG_LEVELS
			expect(mockCaptureMessage).toHaveBeenCalled();
			const [, options] = mockCaptureMessage.mock.calls[0] as unknown as CaptureMessageCall;
			expect(options.level).toBe('info');
		} finally {
			process.stdout.write = originalWrite;
		}
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

	test('error handler forwards errors to logger.error', () => {
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

		expect(mockError).toHaveBeenCalledWith(testError);
	});
});
