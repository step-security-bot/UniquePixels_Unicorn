import type { Message } from 'discord.js';
import { createGuard, guardFail, guardPass } from '@/core/guards';

/**
 * Creates a guard that ensures a message is not from a bot.
 * For use with message-based sparks.
 */
export const notBot = createGuard<Message, Message>((message, _client) => {
	if (message.author.bot) {
		return guardFail('Bots cannot use this.');
	}
	return guardPass(message);
});
