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

	test('logs error when reply fails', async () => {
		const client = createMockClient();
		const interaction = createMockChatInputInteraction({
			commandName: 'ping',
			reply: mock(async () => {
				throw new Error('Discord API error');
			}),
			client,
		});

		await ping.execute(interaction);

		expect(client.logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ err: expect.any(Error) }),
			'Ping reply failed',
		);
	});

	test('logs error when fetchReply fails', async () => {
		const client = createMockClient();
		const interaction = createMockChatInputInteraction({
			commandName: 'ping',
			reply: mock(async () => {}),
			fetchReply: mock(async () => {
				throw new Error('Discord API error');
			}),
			client,
		});

		await ping.execute(interaction);

		expect(client.logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ err: expect.any(Error) }),
			'Ping fetchReply failed',
		);
	});

	test('logs error when editReply fails', async () => {
		const client = createMockClient();
		const interaction = createMockChatInputInteraction({
			commandName: 'ping',
			createdTimestamp: 1000000,
			reply: mock(async () => {}),
			fetchReply: mock(async () => ({ createdTimestamp: 1000042 })),
			editReply: mock(async () => {
				throw new Error('Discord API error');
			}),
			client,
		});

		await ping.execute(interaction);

		expect(client.logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ err: expect.any(Error) }),
			'Ping editReply failed',
		);
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
			client,
		});

		const result = await ping.execute(interaction);

		expect(result.ok).toBe(true);
		expect(reply).toHaveBeenCalledWith({ content: 'Pinging...' });
		expect(editReply).toHaveBeenCalledWith(
			'Pong! Roundtrip: 42ms | WebSocket: 38ms',
		);
	});
});
