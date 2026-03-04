import { SlashCommandBuilder } from 'discord.js';
import { attempt, isError } from '@/core/lib/attempt';
import { defineCommand } from '@/core/sparks';

/**
 * Sample /ping command that demonstrates basic command usage.
 *
 * This command shows:
 * - How to define a command with SlashCommandBuilder
 * - How to use no guards (no restrictions)
 * - How to reply to an interaction
 *
 * @example
 * User: /ping
 * Bot: Pong! Roundtrip: 42ms | WebSocket: 38ms
 */
export const ping = defineCommand({
	command: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Check bot latency and responsiveness'),

	action: async (interaction) => {
		const replyResult = await attempt(() =>
			interaction.reply({ content: 'Pinging...' }),
		);
		if (isError(replyResult)) {
			interaction.client.logger.error(
				{ err: replyResult.error },
				'Ping reply failed',
			);
			return;
		}

		const fetchResult = await attempt(() => interaction.fetchReply());
		if (isError(fetchResult)) {
			interaction.client.logger.error(
				{ err: fetchResult.error },
				'Ping fetchReply failed',
			);
			return;
		}

		const roundTrip =
			fetchResult.data.createdTimestamp - interaction.createdTimestamp;
		const wsLatency = interaction.client.ws.ping;

		const editResult = await attempt(() =>
			interaction.editReply(
				`Pong! Roundtrip: ${roundTrip}ms | WebSocket: ${wsLatency}ms`,
			),
		);
		if (isError(editResult)) {
			interaction.client.logger.error(
				{ err: editResult.error },
				'Ping editReply failed',
			);
		}
	},
});
