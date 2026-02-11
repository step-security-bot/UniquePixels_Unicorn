import type { CronJob } from 'cron';
import { type Client, Collection } from 'discord.js';
import type { Logger } from 'pino';
import type { ParsedConfig, UnicornConfig } from '@/core/configuration';
import type { BaseCommandSpark } from '@/core/sparks/command';
import type { BaseComponentSpark } from '@/core/sparks/component';

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
export interface UnicornClient<T extends UnicornConfig = UnicornConfig>
	extends Client {
	/** Pino logger instance with Sentry integration in production */
	logger: Logger;

	/** Parsed configuration with type-safe access to IDs */
	config: ParsedConfig<T>;

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
	return (
		'logger' in client &&
		'config' in client &&
		'commands' in client &&
		'components' in client &&
		'componentPatterns' in client &&
		'scheduledJobs' in client
	);
}

/**
 * Creates the Unicorn-specific collections and attaches them to the client.
 * This should be called during client initialization before loading sparks.
 */
export function initializeUnicornClient<T extends UnicornConfig>(
	client: Client,
	logger: Logger,
	config: ParsedConfig<T>,
): UnicornClient<T> {
	const unicornClient = client as UnicornClient<T>;

	unicornClient.logger = logger;
	unicornClient.config = config;
	unicornClient.commands = new Collection();
	unicornClient.components = new Collection();
	unicornClient.componentPatterns = [];
	unicornClient.scheduledJobs = new Collection();

	return unicornClient;
}
