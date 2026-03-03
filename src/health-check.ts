import type { Client } from 'discord.js';

/**
 * Creates the fetch handler for the health check server.
 * Extracted for testability without starting an actual server.
 */
export function createHealthCheckHandler(
	client: Client,
): (req: Request) => Response {
	return (req: Request): Response => {
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
	};
}
