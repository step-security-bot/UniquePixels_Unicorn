import type { Message } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

/**
 * Creates a guard that ensures a message is not from a bot.
 * For use with message-based sparks.
 */
export const notBot: Guard<Message, Message> = createGuard<Message, Message>(
	(message, _client) => {
		if (message.author.bot) {
			return guardFail('Bots cannot use this.');
		}
		return guardPass(message);
	},
);
