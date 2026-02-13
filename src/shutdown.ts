import type { Logger } from 'pino';
import type { UnicornClient } from '@/core/client';
import { attempt, isError } from '@/core/lib/attempt';
import { stopAllScheduledJobs } from '@/core/sparks';
export interface ShutdownDeps {
	client: UnicornClient;
	logger: Logger;
	cleanupIntervalId: Timer;
	healthCheckServer?: { stop(): void };
	exit: (code: number) => never;
	timeoutMs?: number;
	setTimeout?: typeof globalThis.setTimeout;
	clearInterval?: typeof globalThis.clearInterval;
	clearTimeout?: typeof globalThis.clearTimeout;
}

/** Runs a cleanup step, logging a warning on failure without throwing. */
async function safeCleanup(
	logger: Logger,
	message: string,
	fn: () => void | Promise<void>,
): Promise<void> {
	const result = await attempt(fn);
	if (isError(result)) {
		logger.warn({ err: result.error }, message);
	}
}

/**
 * Creates a shutdown handler that performs graceful cleanup.
 * Extracted for testability without needing to send real signals.
 */
export function createShutdownHandler(
	deps: ShutdownDeps,
): (signal: string) => Promise<void> {
	const {
		client,
		logger,
		cleanupIntervalId,
		healthCheckServer,
		exit,
		timeoutMs = 10_000,
	} = deps;

	const setTimeoutFn = deps.setTimeout ?? globalThis.setTimeout;
	const clearIntervalFn = deps.clearInterval ?? globalThis.clearInterval;
	const clearTimeoutFn = deps.clearTimeout ?? globalThis.clearTimeout;

	return async (signal: string): Promise<void> => {
		logger.info({ signal }, 'Received shutdown signal');

		// Force exit if graceful shutdown hangs
		const forceExitTimeout = setTimeoutFn(() => {
			logger.error('Graceful shutdown timed out, forcing exit');
			exit(1);
		}, timeoutMs);

		// Ensure the timeout doesn't keep the process alive if shutdown completes
		// Note: unref() may not exist on mocked timeouts, so we check first
		if (typeof forceExitTimeout === 'object' && 'unref' in forceExitTimeout) {
			forceExitTimeout.unref();
		}

		// Each step is wrapped individually so one failure doesn't skip the rest
		await safeCleanup(logger, 'Failed to clear cleanup interval', () =>
			clearIntervalFn(cleanupIntervalId),
		);
		if (healthCheckServer) {
			await safeCleanup(logger, 'Failed to stop health check server', () =>
				healthCheckServer.stop(),
			);
		}
		await safeCleanup(logger, 'Failed to stop scheduled jobs', () =>
			stopAllScheduledJobs(client),
		);
		await safeCleanup(logger, 'Failed to destroy Discord client', () =>
			client.destroy(),
		);

		logger.info('Shutdown complete');
		clearTimeoutFn(forceExitTimeout);
		exit(0);
	};
}
