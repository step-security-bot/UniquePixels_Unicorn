import { type Client, Events } from 'discord.js';
import pino, { type Logger } from 'pino';

const isDev: boolean = Bun.env.NODE_ENV === 'development';

/** Shared no-op destination — pinoIntegration captures logs via diagnostics_channel. */
const noOpStream = pino.destination('/dev/null');

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

/** Options for `createLogger`. */
export interface CreateLoggerOptions {
	/** Override environment detection (defaults to `NODE_ENV === 'development'`). */
	dev?: boolean;
}

/**
 * Creates a pino logger configured for the current environment.
 *
 * Both `err` and `error` keys are serialized with full context including
 * AggregateError.errors, Error.cause chains, and custom properties.
 *
 * In production, Sentry's `pinoIntegration` captures logs via
 * `diagnostics_channel` before they reach the destination. Output is
 * suppressed (no-op destination) to match prior behaviour.
 * In development, pino-pretty outputs colorized logs to console.
 */
export function createLogger(options?: CreateLoggerOptions): Logger {
	const serializers = { err: serializeError, error: serializeError };

	if (options?.dev ?? isDev) {
		return pino({
			level: 'debug',
			serializers,
			transport: {
				target: 'pino-pretty',
				options: { colorize: true },
			},
		});
	}

	return pino({ level: 'info', serializers }, noOpStream);
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
