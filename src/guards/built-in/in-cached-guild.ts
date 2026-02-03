import type {
	Guild,
	GuildBasedChannel,
	GuildMember,
	Interaction,
	TextBasedChannel,
} from 'discord.js';
import { createGuard, guardFail, guardPass } from '@/core/guards';

/**
 * Interaction that is guaranteed to be in a cached guild.
 * Provides access to guild, member, and other guild-specific properties.
 */
export type GuildInteraction<T extends Interaction = Interaction> = T & {
	guild: Guild;
	guildId: string;
	member: GuildMember;
	channel: GuildBasedChannel & TextBasedChannel;
};

/**
 * Guard that ensures an interaction is in a cached guild.
 * Narrows the type to include guild, member, and guildId.
 *
 * @example
 * ```ts
 * class MyCommand extends CommandSpark {
 *   guards = [inCachedGuild];
 *   // action receives GuildInteraction<ChatInputCommandInteraction>
 * }
 * ```
 */
export const inCachedGuild = createGuard<Interaction, GuildInteraction>(
	(interaction, _client) => {
		if (!interaction.inCachedGuild()) {
			return guardFail('This command can only be used in a server.');
		}
		return guardPass(interaction as GuildInteraction);
	},
);
