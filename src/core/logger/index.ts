import process from 'node:process';
import { Writable } from 'node:stream';
import * as Sentry from '@sentry/bun';
import { type Client, Events } from 'discord.js';
import pino, { type Logger } from 'pino';

const isDev: boolean = Bun.env.NODE_ENV === 'development';

type PinoLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type PinoLevelNumber = 10 | 20 | 30 | 40 | 50 | 60;

/** Serialized error shape written to log records. */
export interface SerializedError {
	type: string;
	message: string;
	stack?: string | undefined;
	cause?: unknown;
	errors?: unknown[];
	[key: string]: unknown;
}

/** Keys excluded from custom-property capture (already handled explicitly). */
const KNOWN_ERROR_KEYS = new Set([
	'name',
	'type',
	'message',
	'stack',
	'cause',
	'errors',
]);

/** Normalizes a key by lowercasing and stripping separators for canonical comparison. */
function normalizeKey(key: string): string {
	return key.toLowerCase().replaceAll(/[-_]/g, '');
}

/** Keys whose values are redacted to prevent leaking secrets into logs. */
export const SENSITIVE_ERROR_KEYS = new Set([
	'token',
	'accesstoken',
	'authorization',
	'cookie',
	'setcookie',
	'headers',
	'password',
	'secret',
	'apikey',
	'config',
]);

export const MAX_SERIALIZE_DEPTH = 5;

/**
 * Recursively serializes an Error into a plain object suitable for JSON logging.
 *
 * Handles `AggregateError.errors`, `Error.cause` chains, and any custom
 * enumerable properties (e.g. Discord.js `code`, `status`, `method`).
 */
export function serializeError(
	error: unknown,
	depth = 0,
): SerializedError | undefined {
	if (!(error instanceof Error)) {
		return;
	}
	if (depth >= MAX_SERIALIZE_DEPTH) {
		return { type: error.name, message: error.message };
	}

	const serialized: SerializedError = {
		type: error.name,
		message: error.message,
		stack: error.stack,
	};

	if (error.cause !== undefined) {
		serialized.cause =
			error.cause instanceof Error
				? serializeError(error.cause, depth + 1)
				: error.cause;
	}

	if (error instanceof AggregateError && error.errors.length > 0) {
		serialized.errors = error.errors.map((nested) =>
			nested instanceof Error
				? (serializeError(nested, depth + 1) ?? nested)
				: nested,
		);
	}

	// Capture extra enumerable properties, redacting sensitive keys
	for (const key of Object.keys(error)) {
		const normalized = normalizeKey(key);
		if (!KNOWN_ERROR_KEYS.has(normalized)) {
			serialized[key] = SENSITIVE_ERROR_KEYS.has(normalized)
				? '[REDACTED]'
				: (error as unknown as Record<string, unknown>)[key];
		}
	}

	return serialized;
}

interface PinoLogRecord {
	level: PinoLevelNumber;
	time: number;
	pid: number;
	hostname: string;
	msg?: string;
	err?: SerializedError;
	error?: SerializedError;
	[key: string]: unknown;
}

/** Maps Pino numeric log levels to Sentry severity levels. */
export const PINO_TO_SENTRY_LEVEL: Record<
	PinoLevelNumber,
	Sentry.SeverityLevel
> = {
	10: 'debug',
	20: 'debug',
	30: 'info',
	40: 'warning',
	50: 'error',
	60: 'fatal',
};

/** Maps Pino numeric log levels to their string names. */
export const PINO_LEVEL_NAME: Record<PinoLevelNumber, PinoLevel> = {
	10: 'trace',
	20: 'debug',
	30: 'info',
	40: 'warn',
	50: 'error',
	60: 'fatal',
};

/** Pino levels that should be captured as Sentry exceptions. */
export const ERROR_LEVELS: Set<PinoLevel> = new Set<PinoLevel>([
	'warn',
	'error',
	'fatal',
]);
/** Pino levels that should be captured as Sentry messages. */
export const LOG_LEVELS: Set<PinoLevel> = new Set<PinoLevel>([
	'info',
	'warn',
	'error',
	'fatal',
]);

/** Minimal Sentry client interface for dependency injection in tests. */
export interface SentryClient {
	captureException: typeof Sentry.captureException;
	captureMessage: typeof Sentry.captureMessage;
}

/**
 * Processes a Pino log record and sends it to Sentry.
 *
 * Checks both `err` and `error` keys for serialized errors, forwarding
 * cause chains and nested errors as Sentry extra context.
 *
 * @param record - The Pino log record to process
 * @param sentryClient - The Sentry client instance (injectable for testing)
 */
function processSentryLog(
	record: PinoLogRecord,
	sentryClient: SentryClient,
): void {
	const sentryLevel = PINO_TO_SENTRY_LEVEL[record.level] ?? 'info';
	const pinoLevel = PINO_LEVEL_NAME[record.level] ?? 'info';
	const {
		msg,
		err,
		error: errorField,
		level: _level,
		time: _time,
		pid: _pid,
		hostname: _hostname,
		...extra
	} = record;

	// Check both `err` (pino convention) and `error` (common usage) keys
	const serializedError = err ?? errorField;

	// Capture errors/warnings as exceptions (prioritize over message)
	if (ERROR_LEVELS.has(pinoLevel) && serializedError) {
		const error = new Error(serializedError.message);
		error.name = serializedError.type;
		if (serializedError.stack) {
			error.stack = serializedError.stack;
		}
		const {
			type: _type,
			message: _message,
			stack: _stack,
			cause,
			errors,
			...customFields
		} = serializedError;
		sentryClient.captureException(error, {
			level: sentryLevel,
			extra: {
				...extra,
				...customFields,
				originalMessage: msg,
				...(cause ? { cause } : {}),
				...(errors ? { errors } : {}),
			},
		});
	} else if (LOG_LEVELS.has(pinoLevel)) {
		// Capture as Sentry message
		sentryClient.captureMessage(msg ?? 'Log message', {
			level: sentryLevel,
			extra,
		});
	}
}

/**
 * Creates a Writable stream that sends logs to Sentry asynchronously.
 * Uses setImmediate to defer Sentry calls to the next event loop iteration,
 * preventing log processing from blocking the main thread.
 */
export function createSentryStream(
	sentryClient: SentryClient = Sentry,
): Writable {
	return new Writable({
		write(
			chunk: Buffer,
			_encoding: BufferEncoding,
			callback: (error?: Error | null) => void,
		): void {
			const line = chunk.toString().trim();
			if (!line) {
				callback();
				return;
			}

			// Parse synchronously (fast), but defer Sentry calls
			let record: PinoLogRecord;
			try {
				record = JSON.parse(line);
			} catch {
				// If parsing fails, just write to stdout and continue
				process.stdout.write(chunk);
				callback();
				return;
			}

			// Defer Sentry processing to next event loop iteration
			// This prevents blocking the main thread on Sentry API calls
			setImmediate(() => {
				try {
					processSentryLog(record, sentryClient);
				} catch (error) {
					// Surface Sentry errors in dev for debugging; silent in prod to avoid log loops
					if (isDev) {
						// biome-ignore lint/suspicious/noConsole: cannot use logger inside its own transport
						console.error('[sentry-stream]', error);
					}
				}
			});

			// Return immediately - don't wait for Sentry
			callback();
		},
	});
}

/**
 * Creates a pino logger configured for the current environment.
 *
 * Both `err` and `error` keys are serialized with full context including
 * AggregateError.errors, Error.cause chains, and custom properties.
 *
 * In production, logs are sent to Sentry asynchronously via setImmediate,
 * preventing Sentry API calls from blocking the main event loop.
 * In development, pino-pretty outputs colorized logs to console.
 */
export function createLogger(): Logger {
	const serializers = { err: serializeError, error: serializeError };

	if (isDev) {
		return pino({
			level: 'debug',
			serializers,
			transport: {
				target: 'pino-pretty',
				options: { colorize: true },
			},
		});
	}

	// Prod: Async stream - Sentry calls are deferred via setImmediate
	return pino({ level: 'info', serializers }, createSentryStream());
}

/**
 * Registers Discord.js debug, warn, and error events to forward to the logger.
 * Call this after the client is created but before login.
 */
export function registerDiscordLogging(client: Client, log: Logger): void {
	client.on(Events.Debug, (message) => {
		log.debug(message);
	});
	client.on(Events.Warn, (message) => {
		log.warn(message);
	});
	client.on(Events.Error, (error) => {
		log.error({ err: error }, error.message);
	});
}
