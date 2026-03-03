import type { CronJob } from 'cron';
import { type Client, Collection } from 'discord.js';
import type { ParsedConfig, UnicornConfig } from '@/core/configuration';
import type { ExtendedLogger } from '@/core/lib/logger';
import type { BaseCommandSpark } from '@/core/sparks/command';
import type { BaseComponentSpark } from '@/core/sparks/component';

/**
 * Registry interface for declaring the app's configuration type.
 *
 * Override this via module augmentation in your app to get type-safe config
 * access (e.g. `client.config.ids.role.admin`) across all sparks and guards:
 *
 * ```ts
 * // src/client.d.ts
 * import type { appConfig } from './config.ts';
 *
 * declare module '@/core/client' {
 *   interface UnicornClientRegistry {
 *     config: typeof appConfig;
 *   }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Designed to be extended via module augmentation
export interface UnicornClientRegistry {}

/** Merges the registry with the base config type so a fallback always exists. */
type RegistryWithFallback = UnicornClientRegistry & { config: UnicornConfig };

/** Resolves the registered config type, falling back to the base UnicornConfig. */
type RegisteredConfig = RegistryWithFallback['config'];

/**
 * Extended Discord.js Client with Unicorn-specific properties.
 *
 * This interface augments the base Client with:
 * - logger: Pino logger instance for structured logging
 * - config: Parsed and validated configuration with type-safe ID access
 * - commands: Collection of command sparks keyed by name
 * - components: Collection of exact/prefix-match component sparks (O(1) lookup)
 * - componentPatterns: Array of pattern-based component sparks (wildcard/regex)
 * - scheduledJobs: Collection of active cron jobs for scheduled sparks
 */
export interface UnicornClient extends Client {
	/** Extended pino logger with Sentry integration and debug source registration. */
	logger: ExtendedLogger;

	/** Parsed configuration with type-safe access to IDs */
	config: ParsedConfig<RegisteredConfig>;

	/** Collection of command sparks keyed by command name */
	commands: Collection<string, BaseCommandSpark>;

	/** Collection of exact-match component sparks keyed by custom ID (O(1) lookup) */
	components: Collection<string, BaseComponentSpark>;

	/** Array of pattern-based component sparks (wildcards, regex) for linear search */
	componentPatterns: BaseComponentSpark[];

	/** Collection of active cron jobs keyed by spark ID + schedule */
	scheduledJobs: Collection<string, CronJob>;
}

/**
 * Type guard to check if a client is a UnicornClient.
 */
export function isUnicornClient(client: Client): client is UnicornClient {
	if (
		!(
			'logger' in client &&
			'config' in client &&
			'commands' in client &&
			'components' in client &&
			'componentPatterns' in client &&
			'scheduledJobs' in client
		)
	) {
		return false;
	}

	// Validate the ExtendedLogger contract to avoid false positives
	const { logger } = client as { logger: unknown };
	if (typeof logger !== 'object' || logger === null) {
		return false;
	}
	const obj = logger as Record<string, unknown>;
	return (
		typeof obj['shutdown'] === 'function' &&
		typeof obj['registerDebugSource'] === 'function'
	);
}

/**
 * Creates the Unicorn-specific collections and attaches them to the client.
 * This should be called during client initialization before loading sparks.
 */
export function initializeUnicornClient(
	client: Client,
	logger: ExtendedLogger,
	config: UnicornClient['config'],
): UnicornClient {
	const unicornClient = client as UnicornClient;

	unicornClient.logger = logger;
	unicornClient.config = config;
	unicornClient.commands = new Collection();
	unicornClient.components = new Collection();
	unicornClient.componentPatterns = [];
	unicornClient.scheduledJobs = new Collection();

	return unicornClient;
}
