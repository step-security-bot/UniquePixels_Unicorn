import { SlashCommandBuilder } from 'discord.js';
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
		await interaction.reply({ content: 'Pinging...' });
		const sent = await interaction.fetchReply();

		const roundTrip = sent.createdTimestamp - interaction.createdTimestamp;
		const wsLatency = interaction.client.ws.ping;

		await interaction.editReply(
			`Pong! Roundtrip: ${roundTrip}ms | WebSocket: ${wsLatency}ms`,
		);
	},
});
