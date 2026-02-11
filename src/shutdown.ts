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

	let forceExitTimeout: ReturnType<typeof globalThis.setTimeout> | undefined;

	return async (signal: string): Promise<void> => {
		logger.info({ signal }, 'Received shutdown signal');

		// Force exit if graceful shutdown hangs
		const setTimeoutFn = deps.setTimeout ?? globalThis.setTimeout;
		const clearIntervalFn = deps.clearInterval ?? globalThis.clearInterval;
		const clearTimeoutFn = deps.clearTimeout ?? globalThis.clearTimeout;

		forceExitTimeout = setTimeoutFn(() => {
			logger.error('Graceful shutdown timed out, forcing exit');
			exit(1);
		}, timeoutMs);

		// Ensure the timeout doesn't keep the process alive if shutdown completes
		// Note: unref() may not exist on mocked timeouts, so we check first
		if (typeof forceExitTimeout === 'object' && 'unref' in forceExitTimeout) {
			forceExitTimeout.unref();
		}

		// Each step is wrapped individually so one failure doesn't skip the rest
		const clearResult = await attempt(() => clearIntervalFn(cleanupIntervalId));
		if (isError(clearResult)) {
			logger.warn(
				{ err: clearResult.error },
				'Failed to clear cleanup interval',
			);
		}

		const healthResult = await attempt(() => {
			if (healthCheckServer) {
				healthCheckServer.stop();
			}
		});
		if (isError(healthResult)) {
			logger.warn(
				{ err: healthResult.error },
				'Failed to stop health check server',
			);
		}

		const jobsResult = await attempt(() => stopAllScheduledJobs(client));
		if (isError(jobsResult)) {
			logger.warn({ err: jobsResult.error }, 'Failed to stop scheduled jobs');
		}

		const destroyResult = await attempt(() => client.destroy());
		if (isError(destroyResult)) {
			logger.warn(
				{ err: destroyResult.error },
				'Failed to destroy Discord client',
			);
		}

		logger.info('Shutdown complete');

		// Clear the force exit timeout before exiting successfully
		if (forceExitTimeout !== undefined) {
			clearTimeoutFn(forceExitTimeout);
		}

		exit(0);
	};
}
