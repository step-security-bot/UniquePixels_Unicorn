import type {
	Guild,
	GuildBasedChannel,
	PermissionResolvable,
} from 'discord.js';
import { PermissionsBitField } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

/**
 * Creates a guard that checks if the bot has the specified permissions in the channel.
 * Must be used after inCachedGuild to ensure guild and channel are available.
 *
 * @param permissions - Permission(s) to check for
 * @param message - Optional custom error message
 *
 * @example
 * ```ts
 * import { PermissionFlagsBits } from 'discord.js';
 * import { defineCommand } from '@/core/sparks/command';
 * import { inCachedGuild } from '@/guards/built-in/in-cached-guild';
 *
 * export const embedCommand = defineCommand({
 *   command: builder,
 *   guards: [inCachedGuild, botHasPermission(PermissionFlagsBits.EmbedLinks)],
 *   action: async (interaction, client) => { // ...
 *   },
 * });
 * ```
 */
export function botHasPermission<
	T extends { guild: Guild; channel: GuildBasedChannel },
>(permissions: PermissionResolvable, message?: string): Guard<T, T> {
	const permBits = new PermissionsBitField(permissions);
	const permNames = permBits.toArray().join(', ');

	return createGuard((input, _client) => {
		const { guild, channel } = input;
		const botMember = guild.members.me;

		if (!botMember) {
			return guardFail('Unable to verify bot permissions.');
		}

		const channelPerms = botMember.permissionsIn(channel);

		if (!channelPerms.has(permissions)) {
			return guardFail(
				message ?? `I need the following permission(s): ${permNames}`,
			);
		}

		return guardPass(input);
	});
}
