import { Events } from 'discord.js';
import type { UnicornClient } from '@/core/client';
import { attempt } from '@/core/lib/attempt';
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
		action: async (readyClient: ReadyClient, client: UnicornClient) => {
			// Fetch all app emojis to cache them, so name lookup works
			const emojiResult = await attempt(() =>
				readyClient.application.emojis.fetch(),
			);
			if (!emojiResult.success) {
				client.logger.error(
					{ error: emojiResult.error },
					'Failed to fetch emojis on ready',
				);
			}

			client.logger.info(
				{ user: readyClient.user.tag, guilds: readyClient.guilds.cache.size },
				'Bot is ready',
			);
		},
	});
