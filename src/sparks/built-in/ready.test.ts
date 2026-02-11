import { describe, expect, test } from 'bun:test';
import { Events } from 'discord.js';
import { createMockClient, createMockReadyClient } from '@/core/lib/test-helpers';
import { ready } from './ready';

describe('ready spark', () => {
	test('has correct type, event, and once flag', () => {
		expect(ready.type).toBe('gateway-event');
		expect(ready.event).toBe(Events.ClientReady);
		expect(ready.once).toBe(true);
	});

	test('logs bot tag and guild count on ready', async () => {
		const client = createMockClient();
		const readyClient = createMockReadyClient({ guildCount: 5 });

		await ready.execute(readyClient, client);

		expect(client.logger.info).toHaveBeenCalledWith(
			{ user: 'TestBot#1234', guilds: 5 },
			'Bot is ready',
		);
	});

	test('logs correctly when bot is in zero guilds', async () => {
		const client = createMockClient();
		const readyClient = createMockReadyClient({ guildCount: 0 });

		await ready.execute(readyClient, client);

		expect(client.logger.info).toHaveBeenCalledWith(
			{ user: 'TestBot#1234', guilds: 0 },
			'Bot is ready',
		);
	});
});
