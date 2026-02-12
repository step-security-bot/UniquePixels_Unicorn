import type { Guild, GuildTextBasedChannel } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

/**
 * Input that has a guild property (interactions, events, messages, etc.)
 */
type WithGuild<T = unknown> = T & { guild: Guild };

/**
 * Creates a narrowed type that includes the specified special channel.
 */
type WithSpecialChannel<T extends WithGuild, K extends keyof Guild> = T & {
	guild: Guild & { [P in K]: NonNullable<Guild[K]> };
};

/**
 * Creates a guard that checks if a special guild channel is configured
 * and the bot has permission to send messages in it.
 */
function createSpecialChannelGuard<
	K extends
		| 'systemChannel'
		| 'publicUpdatesChannel'
		| 'rulesChannel'
		| 'safetyAlertsChannel',
>(
	channelKey: K,
	channelName: string,
): Guard<WithGuild, WithSpecialChannel<WithGuild, K>> {
	return createGuard((input, _client) => {
		const { guild } = input;
		const channel = guild[channelKey];

		if (!channel) {
			return guardFail(
				`This server does not have a ${channelName} configured.`,
			);
		}

		// Check if bot can send messages in the channel
		const botMember = guild.members.me;
		if (!botMember) {
			return guardFail('Unable to verify bot permissions.');
		}

		const channelPerms = botMember.permissionsIn(
			channel as GuildTextBasedChannel,
		);
		if (!channelPerms.has(PermissionFlagsBits.SendMessages)) {
			return guardFail(
				`I don't have permission to send messages in the ${channelName}.`,
			);
		}

		return guardPass(input as WithSpecialChannel<WithGuild, K>);
	});
}

/**
 * Guard that ensures the guild has a system channel configured and the bot
 * can send messages in it. The system channel is used for welcome messages,
 * boost notifications, and other system events.
 *
 * Must be used with input that has a guild property (e.g., after inCachedGuild).
 *
 * @example
 * ```ts
 * export const notifyCommand = defineCommand({
 *   command: builder,
 *   guards: [inCachedGuild, hasSystemChannel],
 *   action: async (interaction, client) => {
 *     // interaction.guild.systemChannel is guaranteed to exist
 *     await interaction.guild.systemChannel.send('Hello!');
 *   },
 * });
 * ```
 */
export const hasSystemChannel = createSpecialChannelGuard(
	'systemChannel',
	'system channel',
);

/**
 * Guard that ensures the guild has a public updates channel configured and
 * the bot can send messages in it. This channel is used for community server
 * announcements and updates.
 *
 * Must be used with input that has a guild property (e.g., after inCachedGuild).
 *
 * @example
 * ```ts
 * export const announceEvent = defineGatewayEvent({
 *   type: 'guildMemberAdd',
 *   guards: [hasPublicUpdatesChannel],
 *   action: async (member, client) => {
 *     // member.guild.publicUpdatesChannel is guaranteed to exist
 *     await member.guild.publicUpdatesChannel.send(`Welcome ${member}!`);
 *   },
 * });
 * ```
 */
export const hasPublicUpdatesChannel = createSpecialChannelGuard(
	'publicUpdatesChannel',
	'public updates channel',
);

/**
 * Guard that ensures the guild has a rules channel configured and the bot
 * can send messages in it. This channel displays server rules to members.
 *
 * Must be used with input that has a guild property (e.g., after inCachedGuild).
 *
 * @example
 * ```ts
 * export const updateRulesCommand = defineCommand({
 *   command: builder,
 *   guards: [inCachedGuild, hasRulesChannel],
 *   action: async (interaction, client) => {
 *     // interaction.guild.rulesChannel is guaranteed to exist
 *     await interaction.guild.rulesChannel.send('Updated rules...');
 *   },
 * });
 * ```
 */
export const hasRulesChannel = createSpecialChannelGuard(
	'rulesChannel',
	'rules channel',
);

/**
 * Guard that ensures the guild has a safety alerts channel configured and
 * the bot can send messages in it. This channel is used for Discord's safety
 * and moderation alerts.
 *
 * Must be used with input that has a guild property (e.g., after inCachedGuild).
 *
 * @example
 * ```ts
 * export const safetyAlert = defineGatewayEvent({
 *   type: 'autoModerationActionExecution',
 *   guards: [hasSafetyAlertsChannel],
 *   action: async (execution, client) => {
 *     // execution.guild.safetyAlertsChannel is guaranteed to exist
 *     await execution.guild.safetyAlertsChannel.send('Safety alert...');
 *   },
 * });
 * ```
 */
export const hasSafetyAlertsChannel = createSpecialChannelGuard(
	'safetyAlertsChannel',
	'safety alerts channel',
);
