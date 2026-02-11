import { describe, expect, mock, test } from 'bun:test';
import {
	createMockChatInputInteraction,
	createMockClient,
} from '@/core/lib/test-helpers';
import { ping } from './ping';

describe('ping spark', () => {
	test('has correct type and command name', () => {
		expect(ping.type).toBe('command');
		expect(ping.id).toBe('ping');
	});

	test('has no guards', () => {
		expect(ping.guards).toEqual([]);
	});

	test('replies with latency calculation', async () => {
		const client = createMockClient({ ws: { ping: 38 } });

		const reply = mock(async () => {});
		const editReply = mock(async () => {});
		const interaction = createMockChatInputInteraction({
			commandName: 'ping',
			createdTimestamp: 1000000,
			reply,
			fetchReply: mock(async () => ({ createdTimestamp: 1000042 })),
			editReply,
		});

		const result = await ping.execute(interaction, client);

		expect(result.ok).toBe(true);
		expect(reply).toHaveBeenCalledWith({ content: 'Pinging...' });
		expect(editReply).toHaveBeenCalledWith(
			'Pong! Roundtrip: 42ms | WebSocket: 38ms',
		);
	});
});
