import process from 'node:process';
import { Writable } from 'node:stream';
import * as Sentry from '@sentry/bun';
import { type Client, Events } from 'discord.js';
import pino, { type Logger } from 'pino';

const isDev: boolean = Bun.env.NODE_ENV === 'development';

type PinoLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type PinoLevelNumber = 10 | 20 | 30 | 40 | 50 | 60;

interface PinoLogRecord {
	level: PinoLevelNumber;
	time: number;
	pid: number;
	hostname: string;
	msg?: string;
	err?: { type: string; message: string; stack?: string };
	[key: string]: unknown;
}

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

export const PINO_LEVEL_NAME: Record<PinoLevelNumber, PinoLevel> = {
	10: 'trace',
	20: 'debug',
	30: 'info',
	40: 'warn',
	50: 'error',
	60: 'fatal',
};

export const ERROR_LEVELS: Set<PinoLevel> = new Set<PinoLevel>([
	'warn',
	'error',
	'fatal',
]);
export const LOG_LEVELS: Set<PinoLevel> = new Set<PinoLevel>([
	'info',
	'warn',
	'error',
	'fatal',
]);

export interface SentryClient {
	captureException: typeof Sentry.captureException;
	captureMessage: typeof Sentry.captureMessage;
}

/**
 * Processes a log record and sends it to Sentry.
 * Extracted to enable async/deferred execution.
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
		level: _level,
		time: _time,
		pid: _pid,
		hostname: _hostname,
		...extra
	} = record;

	// Capture errors/warnings as exceptions (prioritize over message)
	if (ERROR_LEVELS.has(pinoLevel) && err) {
		const error = new Error(err.message);
		error.name = err.type;
		if (err.stack) {
			error.stack = err.stack;
		}
		sentryClient.captureException(error, {
			level: sentryLevel,
			extra: { ...extra, originalMessage: msg },
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
				} catch {
					// Silently ignore Sentry errors to avoid log loops
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
 * In production, logs are sent to Sentry asynchronously via setImmediate,
 * preventing Sentry API calls from blocking the main event loop.
 * In development, pino-pretty outputs colorized logs to console.
 */
export function createLogger(): Logger {
	if (isDev) {
		return pino({
			level: 'debug',
			transport: {
				target: 'pino-pretty',
				options: { colorize: true },
			},
		});
	}

	// Prod: Async stream - Sentry calls are deferred via setImmediate
	return pino({ level: 'info' }, createSentryStream());
}

export const logger: Logger = createLogger();

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
		log.error(error);
	});
}
