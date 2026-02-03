import { Events } from 'discord.js';
import { defineGatewayEvent, type ReadyClient } from '@/core/sparks';

/**
 * Built-in spark that handles the ClientReady event.
 *
 * This spark fires once when the bot successfully logs in to Discord.
 * It logs the bot's username and performs any necessary post-login setup.
 */
export const ready = defineGatewayEvent({
	event: Events.ClientReady,
	once: true,
	action: (readyClient: ReadyClient, client) => {
		client.logger.info(
			{ user: readyClient.user.tag, guilds: readyClient.guilds.cache.size },
			'Bot is ready',
		);
	},
});
