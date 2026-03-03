import { join } from 'node:path';
import process from 'node:process';
import { Client, REST, Routes } from 'discord.js';
import { initializeClient } from '@/core/client';
import { parseConfig } from '@/core/configuration';
import { createLogger, type ExtendedLogger } from '@/core/lib/logger';
import {
	collectCommandBuilders,
	type LoadSparksResult,
	loadSparks,
} from '@/core/sparks';
import { cleanupRateLimits } from '@/guards/built-in';
import { appConfig } from './config.ts';
import { createHealthCheckHandler } from './health-check';
import { createShutdownHandler } from './shutdown';

/**
 * Main entry point for the Unicorn Discord bot.
 *
 * Startup sequence:
 * 1. Create logger
 * 2. Parse and validate configuration
 * 3. Initialize Discord.js Client with intents and partials
 * 4. Attach logger, config, and collections to client
 * 5. Load all sparks from src/sparks directory
 * 6. Register slash commands with Discord API
 * 7. Login to Discord
 *
 * Error handling:
 * - Startup errors (config, loading, registration) THROW and terminate the process
 * - Runtime errors (event handlers, commands) are logged but don't terminate
 *
 * @throws Error if startup fails at any step
 */

const logger: ExtendedLogger = createLogger();

logger.info('Starting Unicorn...');

// Parse and validate configuration
// THROWS on validation failure - app cannot function without valid config
const config = parseConfig(appConfig);
logger.debug('Configuration parsed successfully');
logger.debug({ config }, 'Effective configuration:');

// Create Discord.js Client with configured intents and partials
const discordClient: Client = new Client({
	intents: config.discord.intents,
	partials: config.discord.enabledPartials,
	presence: {
		status: config.discord.defaultPresence.status,
		activities: config.discord.defaultPresence.activities,
	},
	enforceNonce: config.discord.enforceNonce,
});

// Initialize client - attaches logger, config, and collections
const client = initializeClient(discordClient, logger, config);

// Register Discord.js debug/warn/error events through the logger with token redaction
logger.registerDebugSource({
	name: 'discord.js',
	emitter: client,
	eventMap: { debug: 'debug', warn: 'warn', error: 'error' },
	redactPatterns: [/Bot\s+[\w+/=-]+\.[\w+/=-]+\.[\w+/=-]+/g],
});

// Load all sparks from the sparks directory
// THROWS on load failure - app cannot function with broken sparks
const sparksDir: string = join(import.meta.dir, 'sparks');
const loadResult: LoadSparksResult = await loadSparks(client, sparksDir);

logger.info({ sparks: loadResult.total }, 'Sparks loaded successfully');

// Register commands with Discord API
// THROWS on registration failure - users can't use commands without registration
if (loadResult.commands > 0) {
	const rest = new REST({ version: '10' }).setToken(config.discord.apiToken);
	const commands = collectCommandBuilders(client);
	const commandData = commands.map((cmd) => cmd.toJSON());

	logger.info(
		{ commands: commands.map((c) => c.name) },
		'Registering commands with Discord...',
	);

	await rest.put(Routes.applicationCommands(config.discord.appID), {
		body: commandData,
	});

	logger.info('Commands registered successfully');
}

// Set up periodic rate limit cleanup (every 5 minutes)
const CLEANUP_INTERVAL_MS: number = 5 * 60 * 1000;
const cleanupIntervalId: Timer = setInterval(() => {
	const cleared = cleanupRateLimits();
	if (cleared > 0) {
		logger.debug({ cleared }, 'Cleaned up rate limit entries');
	}
}, CLEANUP_INTERVAL_MS);

// Health check server reference (set later if enabled)
let healthCheckServer: ReturnType<typeof Bun.serve> | undefined;

// Start health check server if port is configured
if (config.healthCheckPort) {
	healthCheckServer = Bun.serve({
		port: config.healthCheckPort,
		fetch: createHealthCheckHandler(client),
	});

	logger.info({ port: config.healthCheckPort }, 'Health check server started');
}

// Set up graceful shutdown (after health check server is initialized)
const shutdown = createShutdownHandler({
	client,
	logger,
	cleanupIntervalId,
	...(healthCheckServer && { healthCheckServer }),
	exit: process.exit,
});

process.on('SIGINT', () => {
	shutdown('SIGINT').catch(() => process.exit(1));
});
process.on('SIGTERM', () => {
	shutdown('SIGTERM').catch(() => process.exit(1));
});

// Login to Discord
// THROWS on login failure - app cannot function without connection
logger.info('Connecting to Discord...');
await client.login(config.discord.apiToken);
