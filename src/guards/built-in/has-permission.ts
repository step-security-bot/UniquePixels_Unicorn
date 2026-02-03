import type { GuildMember, PermissionResolvable } from 'discord.js';
import { PermissionsBitField } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

/**
 * Creates a guard that checks if the user has the specified permissions.
 * Must be used after inCachedGuild to ensure member is available.
 *
 * @param permissions - Permission(s) to check for
 * @param message - Optional custom error message
 *
 * @example
 * ```ts
 * class ModCommand extends CommandSpark {
 *   guards = [inCachedGuild, hasPermission(PermissionFlagsBits.ManageMessages)];
 * }
 * ```
 */
export function hasPermission<T extends { member: GuildMember }>(
	permissions: PermissionResolvable,
	message?: string,
): Guard<T, T> {
	const permBits = new PermissionsBitField(permissions);
	const permNames = permBits.toArray().join(', ');

	return createGuard((input, _client) => {
		const { member } = input;

		if (!member.permissions.has(permissions)) {
			return guardFail(
				message ?? `You need the following permission(s): ${permNames}`,
			);
		}

		return guardPass(input);
	});
}
