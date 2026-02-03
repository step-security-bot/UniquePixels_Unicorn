import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ActivityType, GatewayIntentBits, Partials } from 'discord.js';
import { parseConfig } from './index.ts';

describe('parseConfig', () => {
	const originalEnv = { ...Bun.env };

	beforeEach(() => {
		Bun.env['DISCORD_TOKEN'] = 'test_token_value';
	});

	afterEach(() => {
		for (const key of Object.keys(Bun.env)) {
			if (!(key in originalEnv)) {
				delete Bun.env[key];
			}
		}
	});

	const validConfig = {
		discord: {
			appID: '12345678901234567',
			apiToken: 'secret://DISCORD_TOKEN' as const,
			intents: [GatewayIntentBits.Guilds],
			enabledPartials: [Partials.Channel],
			enforceNonce: true,
			defaultPresence: {
				status: 'online' as const,
				activities: [{ type: ActivityType.Playing, name: 'Test' }],
			},
		},
		misc: {},
		ids: {
			role: {
				admin: '11111111111111111',
				moderator: '22222222222222222',
			},
			channel: {
				general: '33333333333333333',
			},
			emoji: {},
		},
	};

	test('parses valid configuration', () => {
		const result = parseConfig(validConfig);

		expect(result.discord.appID).toBe('12345678901234567');
		expect(result.discord.apiToken).toBe('test_token_value');
		expect(result.discord.enforceNonce).toBe(true);
	});

	test('preserves literal keys in ids.role', () => {
		const result = parseConfig(validConfig);

		// These should be accessible with literal keys
		expect(result.ids.role['admin']).toBe('11111111111111111');
		expect(result.ids.role['moderator']).toBe('22222222222222222');
	});

	test('preserves literal keys in ids.channel', () => {
		const result = parseConfig(validConfig);

		expect(result.ids.channel['general']).toBe('33333333333333333');
	});

	test('handles envMap with tuple values', () => {
		const configWithTuple = {
			...validConfig,
			discord: {
				...validConfig.discord,
				appID: ['12345678901234567', '98765432109876543'] as [string, string],
			},
		};

		const result = parseConfig(configWithTuple);

		// Should select based on NODE_ENV (prod or dev value)
		expect(typeof result.discord.appID).toBe('string');
		expect(result.discord.appID.length).toBeGreaterThanOrEqual(17);
	});

	test('throws ZodError for invalid snowflake', () => {
		const invalidConfig = {
			...validConfig,
			discord: {
				...validConfig.discord,
				appID: 'invalid',
			},
		};

		expect(() => parseConfig(invalidConfig)).toThrow();
	});

	test('throws ZodError for missing required fields', () => {
		const incompleteConfig = {
			discord: {
				appID: '12345678901234567',
			},
			misc: {},
			ids: { role: {}, channel: {}, emoji: {} },
		};

		expect(() => parseConfig(incompleteConfig as never)).toThrow();
	});

	test('throws when secret environment variable is missing', () => {
		delete Bun.env['DISCORD_TOKEN'];

		expect(() => parseConfig(validConfig)).toThrow();
	});

	test('allows optional oAuth2 to be omitted', () => {
		const result = parseConfig(validConfig);

		expect(result.discord.oAuth2).toBeUndefined();
	});

	test('parses oAuth2 when provided', () => {
		Bun.env['OAUTH_TOKEN'] = 'oauth_secret';

		const configWithOAuth = {
			...validConfig,
			discord: {
				...validConfig.discord,
				oAuth2: {
					apiToken: 'secret://OAUTH_TOKEN' as const,
					url: 'https://example.com/oauth',
				},
			},
		};

		const result = parseConfig(configWithOAuth);

		expect(result.discord.oAuth2?.apiToken).toBe('oauth_secret');
		expect(result.discord.oAuth2?.url).toBe('https://example.com/oauth');
	});

	test('allows arbitrary misc data', () => {
		const configWithMisc = {
			...validConfig,
			misc: {
				customKey: 'customValue',
				nested: { deep: true },
				number: 42,
			},
		};

		const result = parseConfig(configWithMisc);

		expect(result.misc['customKey']).toBe('customValue');
		expect(result.misc['nested']).toEqual({ deep: true });
	});
});
