import type { Message } from 'discord.js';
import { createGuard, guardFail, guardPass } from '@/core/guards';

/**
 * Creates a guard that ensures a message is from a guild (not DM).
 * For use with message-based sparks.
 */
export const messageInGuild = createGuard<Message, Message<true>>(
	(message, _client) => {
		if (!message.inGuild()) {
			return guardFail('This can only be used in a server.');
		}
		return guardPass(message);
	},
);
