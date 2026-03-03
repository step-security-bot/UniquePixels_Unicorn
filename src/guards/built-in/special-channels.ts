import type { Guild, GuildTextBasedChannel } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

/**
 * Narrowed type that includes a guaranteed non-null special channel.
 */
type WithSpecialChannel<T, K extends keyof Guild> = T & {
	guild: Guild & { [P in K]: NonNullable<Guild[K]> };
};

/**
 * Creates a zero-arg factory that returns a typed guard for a special guild
 * channel. The factory pattern enables TypeScript to infer the correct narrowed
 * type at the call site, preserving the input type through intersection.
 */
function createSpecialChannelGuard<
	K extends
		| 'systemChannel'
		| 'publicUpdatesChannel'
		| 'rulesChannel'
		| 'safetyAlertsChannel',
>(channelKey: K, channelName: string) {
	return function factory<T extends { guild: Guild }>(): Guard<
		T,
		WithSpecialChannel<T, K>
	> {
		return createGuard((input: T) => {
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

			return guardPass(input as WithSpecialChannel<T, K>);
		});
	};
}

/**
 * Guard factory that ensures the guild has a system channel configured and the
 * bot can send messages in it. The system channel is used for welcome messages,
 * boost notifications, and other system events.
 *
 * Must be used with input that has a guild property (e.g., after inCachedGuild).
 *
 * @example
 * ```ts
 * export const notifyCommand = defineCommand({
 *   command: builder,
 *   guards: [inCachedGuild, hasSystemChannel()],
 *   action: async (interaction) => {
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
 * Guard factory that ensures the guild has a public updates channel configured
 * and the bot can send messages in it. This channel is used for community
 * server announcements and updates.
 *
 * Must be used with input that has a guild property (e.g., after inCachedGuild).
 *
 * @example
 * ```ts
 * export const announceEvent = defineGatewayEvent({
 *   event: Events.GuildMemberAdd,
 *   guards: [hasPublicUpdatesChannel()],
 *   action: async (member) => {
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
 * Guard factory that ensures the guild has a rules channel configured and the
 * bot can send messages in it. This channel displays server rules to members.
 *
 * Must be used with input that has a guild property (e.g., after inCachedGuild).
 *
 * @example
 * ```ts
 * export const updateRulesCommand = defineCommand({
 *   command: builder,
 *   guards: [inCachedGuild, hasRulesChannel()],
 *   action: async (interaction) => {
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
 * Guard factory that ensures the guild has a safety alerts channel configured
 * and the bot can send messages in it. This channel is used for Discord's
 * safety and moderation alerts.
 *
 * Must be used with input that has a guild property (e.g., after inCachedGuild).
 *
 * @example
 * ```ts
 * export const safetyAlert = defineGatewayEvent({
 *   event: Events.AutoModerationActionExecution,
 *   guards: [hasSafetyAlertsChannel()],
 *   action: async (execution) => {
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
