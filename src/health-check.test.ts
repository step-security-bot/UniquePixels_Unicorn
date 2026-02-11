import { describe, expect, test } from 'bun:test';
import { createMockClient } from '@/core/lib/test-helpers';
import { createHealthCheckHandler } from './health-check';

// ─── Test Helpers ────────────────────────────────────────────────

function makeRequest(path: string): Request {
	return new Request(`http://localhost${path}`);
}

// ─── Tests ───────────────────────────────────────────────────────

describe('createHealthCheckHandler', () => {
	test.each(['/health', '/healthz'])(
		'%s returns 200 (liveness probe)',
		async (path) => {
			const client = createMockClient();
			const handler = createHealthCheckHandler(client);

			const response = handler(makeRequest(path));

			expect(response.status).toBe(200);
			expect(await response.text()).toBe('OK');
		},
	);

	test.each(['/ready', '/readyz'])(
		'%s returns 200 when client is ready',
		async (path) => {
			const client = createMockClient({ isReady: true });
			const handler = createHealthCheckHandler(client);

			const response = handler(makeRequest(path));

			expect(response.status).toBe(200);
			expect(await response.text()).toBe('Ready');
		},
	);

	test.each(['/ready', '/readyz'])(
		'%s returns 503 when client is not ready',
		async (path) => {
			const client = createMockClient({ isReady: false });
			const handler = createHealthCheckHandler(client);

			const response = handler(makeRequest(path));

			expect(response.status).toBe(503);
			expect(await response.text()).toBe('Not Ready');
		},
	);

	test('unknown paths return 404', async () => {
		const client = createMockClient();
		const handler = createHealthCheckHandler(client);

		const response = handler(makeRequest('/unknown'));

		expect(response.status).toBe(404);
		expect(await response.text()).toBe('Not Found');
	});
});
