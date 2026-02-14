import { describe, expect, mock, test } from 'bun:test';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import type { Logger } from 'pino';
import { type UnicornClient, initializeUnicornClient, isUnicornClient } from './index';

// ─── Test Helpers ────────────────────────────────────────────────

function createRealClient(): Client {
	return new Client({ intents: [GatewayIntentBits.Guilds] });
}

function createMockLogger(): Logger {
	return {
		debug: mock(() => {}),
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
	} as unknown as Logger;
}

function createMockConfig(): UnicornClient['config'] {
	return {
		discord: {
			appID: '123456789012345678',
			apiToken: 'mock-token',
			intents: [GatewayIntentBits.Guilds],
			enabledPartials: [],
			enforceNonce: false,
		},
		misc: {},
		ids: { role: {}, channel: {}, emoji: {} },
	} as unknown as UnicornClient['config'];
}

// ─── Tests ───────────────────────────────────────────────────────

describe('initializeUnicornClient', () => {
	test('attaches logger to client', () => {
		const client = createRealClient();
		const logger = createMockLogger();
		const config = createMockConfig();

		const result = initializeUnicornClient(client, logger, config);

		expect(result.logger).toBe(logger);
	});

	test('attaches parsed config to client', () => {
		const client = createRealClient();
		const logger = createMockLogger();
		const config = createMockConfig();

		const result = initializeUnicornClient(client, logger, config);

		expect(result.config).toBe(config);
	});

	test('creates empty commands Collection', () => {
		const client = createRealClient();
		const result = initializeUnicornClient(
			client,
			createMockLogger(),
			createMockConfig(),
		);

		expect(result.commands).toBeInstanceOf(Collection);
		expect(result.commands.size).toBe(0);
	});

	test('creates empty components Collection', () => {
		const client = createRealClient();
		const result = initializeUnicornClient(
			client,
			createMockLogger(),
			createMockConfig(),
		);

		expect(result.components).toBeInstanceOf(Collection);
		expect(result.components.size).toBe(0);
	});

	test('creates empty componentPatterns array', () => {
		const client = createRealClient();
		const result = initializeUnicornClient(
			client,
			createMockLogger(),
			createMockConfig(),
		);

		expect(Array.isArray(result.componentPatterns)).toBe(true);
		expect(result.componentPatterns).toHaveLength(0);
	});

	test('creates empty scheduledJobs Collection', () => {
		const client = createRealClient();
		const result = initializeUnicornClient(
			client,
			createMockLogger(),
			createMockConfig(),
		);

		expect(result.scheduledJobs).toBeInstanceOf(Collection);
		expect(result.scheduledJobs.size).toBe(0);
	});

	test('returns the same client reference (augmented)', () => {
		const client = createRealClient();
		const result = initializeUnicornClient(
			client,
			createMockLogger(),
			createMockConfig(),
		);

		// Cast both to unknown to compare identity without type mismatch
		expect(result as unknown).toBe(client as unknown);
	});
});

describe('isUnicornClient', () => {
	test('returns true for initialized UnicornClient', () => {
		const client = createRealClient();
		const unicorn = initializeUnicornClient(
			client,
			createMockLogger(),
			createMockConfig(),
		);

		expect(isUnicornClient(unicorn)).toBe(true);
	});

	test('returns false for plain Discord.js Client', () => {
		const client = createRealClient();

		expect(isUnicornClient(client)).toBe(false);
	});

	test('returns false for partially-augmented client (only logger)', () => {
		const client = createRealClient() as unknown as UnicornClient;
		// Only set logger — missing config, commands, componentPatterns
		(client as unknown as Record<string, unknown>)['logger'] =
			createMockLogger();

		expect(isUnicornClient(client)).toBe(false);
	});

	test('returns false for partially-augmented client (missing componentPatterns)', () => {
		const client = createRealClient() as unknown as UnicornClient;
		(client as unknown as Record<string, unknown>)['logger'] =
			createMockLogger();
		(client as unknown as Record<string, unknown>)['config'] =
			createMockConfig();
		(client as unknown as Record<string, unknown>)['commands'] =
			new Collection();

		expect(isUnicornClient(client)).toBe(false);
	});
});
