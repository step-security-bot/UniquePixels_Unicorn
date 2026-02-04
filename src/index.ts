import { join } from 'node:path';
import process from 'node:process';
import { Client, REST, Routes } from 'discord.js';
import type { Logger } from 'pino';
import { initializeUnicornClient, type UnicornClient } from '@/core/client';
import { type ParsedConfig, parseConfig } from '@/core/configuration';
import { createLogger, registerDiscordLogging } from '@/core/logger';
import {
	collectCommandBuilders,
	type LoadSparksResult,
	loadSparks,
	stopAllScheduledJobs,
} from '@/core/sparks';
import { cleanupRateLimits } from '@/guards/built-in';
import { appConfig } from './config.ts';

/**
 * Main entry point for the Unicorn Discord bot.
 *
 * Startup sequence:
 * 1. Create logger
 * 2. Parse and validate configuration
 * 3. Initialize Discord.js Client with intents and partials
 * 4. Attach logger, config, and collections to client (UnicornClient)
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

const logger: Logger = createLogger();

logger.info('Starting Unicorn...');

// Parse and validate configuration
// THROWS on validation failure - app cannot function without valid config
const config: ParsedConfig<typeof appConfig> = parseConfig(appConfig);
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

// Initialize UnicornClient - attaches logger, config, and collections
const client: UnicornClient<typeof appConfig> = initializeUnicornClient(
	discordClient,
	logger,
	config,
);

// Register Discord.js logging hooks
registerDiscordLogging(client, logger);

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

// Set up graceful shutdown
const SHUTDOWN_TIMEOUT_MS = 10_000;

// Health check server reference (set later if enabled)
let healthCheckServer: ReturnType<typeof Bun.serve> | undefined;

const shutdown = (signal: string): never => {
	logger.info({ signal }, 'Received shutdown signal');

	// Force exit if graceful shutdown hangs
	const forceExitTimeout = setTimeout(() => {
		logger.error('Graceful shutdown timed out, forcing exit');
		process.exit(1);
	}, SHUTDOWN_TIMEOUT_MS);

	// Ensure the timeout doesn't keep the process alive if shutdown completes
	forceExitTimeout.unref();

	// Clear cleanup interval
	clearInterval(cleanupIntervalId);

	// Stop health check server
	if (healthCheckServer) {
		healthCheckServer.stop();
	}

	// Stop scheduled jobs
	stopAllScheduledJobs(client);

	// Destroy Discord client
	client.destroy();

	logger.info('Shutdown complete');
	process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start health check server if port is configured
if (config.healthCheckPort) {
	healthCheckServer = Bun.serve({
		port: config.healthCheckPort,
		fetch(req: Request): Response {
			const url = new URL(req.url);

			// Liveness probe - is the process running?
			if (url.pathname === '/health' || url.pathname === '/healthz') {
				return new Response('OK', { status: 200 });
			}

			// Readiness probe - is the bot connected to Discord?
			if (url.pathname === '/ready' || url.pathname === '/readyz') {
				const isReady = client.isReady();
				return new Response(isReady ? 'Ready' : 'Not Ready', {
					status: isReady ? 200 : 503,
				});
			}

			return new Response('Not Found', { status: 404 });
		},
	});

	logger.info({ port: config.healthCheckPort }, 'Health check server started');
}

// Login to Discord
// THROWS on login failure - app cannot function without connection
logger.info('Connecting to Discord...');
await client.login(config.discord.apiToken);
