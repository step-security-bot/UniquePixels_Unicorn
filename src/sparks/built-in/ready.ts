import { Events } from 'discord.js';
import type { UnicornClient } from '@/core/client';
import {
	defineGatewayEvent,
	type GatewayEventSpark,
	type ReadyClient,
} from '@/core/sparks';

/**
 * Built-in spark that handles the ClientReady event.
 *
 * This spark fires once when the bot successfully logs in to Discord.
 * It logs the bot's username and performs any necessary post-login setup.
 */
export const ready: GatewayEventSpark<typeof Events.ClientReady> =
	defineGatewayEvent({
		event: Events.ClientReady,
		once: true,
		action: (readyClient: ReadyClient, client: UnicornClient) => {
			client.logger.info(
				{ user: readyClient.user.tag, guilds: readyClient.guilds.cache.size },
				'Bot is ready',
			);
		},
	});
