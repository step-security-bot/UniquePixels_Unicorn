import type {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	CommandInteraction,
} from 'discord.js';
import type { UnicornClient } from '@/core/client';
import type { Guard, GuardResult } from '@/core/guards';
import { runGuards } from '@/core/guards';
import { attempt, isError } from '@/core/lib/attempt';
import type {
	BaseCommandSpark,
	CommandAction,
	CommandBuilder,
	CommandSpark,
} from './command';

/**
 * Handler for a single subcommand within a command group.
 *
 * Each handler can define its own guards (run after top-level guards)
 * and an optional autocomplete handler.
 */
export interface SubcommandHandler<
	TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction,
> {
	/** Additional guards specific to this subcommand (run after top-level guards) */
	// biome-ignore lint/suspicious/noExplicitAny: Guard chains have heterogeneous input/output types; type safety is enforced by runGuards at runtime
	guards?: readonly Guard<any, any>[];
	/** The action to execute when this subcommand is invoked */
	action: CommandAction<TGuarded>;
	/** Optional autocomplete handler for this subcommand */
	autocomplete?: (
		interaction: AutocompleteInteraction,
		client: UnicornClient,
	) => void | Promise<void>;
}

/**
 * Options for defining a command group with subcommands and/or subcommand groups.
 */
export interface CommandGroupOptions<
	TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction,
> {
	/** The slash command builder (should include subcommands and/or groups) */
	command: CommandBuilder;
	/** Top-level guards shared by all subcommands (optional, defaults to []) */
	// biome-ignore lint/suspicious/noExplicitAny: Guard chains have heterogeneous input/output types; type safety is enforced by runGuards at runtime
	guards?: readonly Guard<any, any>[];
	/** Direct subcommands: name → handler */
	subcommands?: Record<string, SubcommandHandler<TGuarded>>;
	/** Subcommand groups: group name → subcommand name → handler */
	groups?: Record<string, Record<string, SubcommandHandler<TGuarded>>>;
}

/**
 * Looks up the subcommand handler based on the interaction's resolved subcommand/group.
 */
function findSubcommandHandler<TGuarded extends ChatInputCommandInteraction>(
	group: string | null,
	subcommand: string | null,
	subcommands: Record<string, SubcommandHandler<TGuarded>>,
	groups: Record<string, Record<string, SubcommandHandler<TGuarded>>>,
): SubcommandHandler<TGuarded> | undefined {
	if (group && subcommand) {
		return groups[group]?.[subcommand];
	}
	return subcommand ? subcommands[subcommand] : undefined;
}

/**
 * Creates a command group spark that routes to subcommand handlers.
 *
 * A command group is a single slash command composed of subcommands and/or
 * subcommand groups. Each subcommand has its own action and optional guards,
 * while top-level guards are shared across all subcommands.
 *
 * The returned spark is a standard `CommandSpark` — it registers and executes
 * identically to commands created with `defineCommand`. No changes to the
 * interaction router or loader are required.
 *
 * **Execution flow:**
 * 1. Top-level guards run (shared validation, e.g. `inCachedGuild`)
 * 2. Subcommand is resolved from the interaction
 * 3. Subcommand-specific guards run (e.g. permission checks)
 * 4. Subcommand action executes
 *
 * @example
 * ```ts
 * // Direct subcommands: /manage list, /manage add
 * export const manage = defineCommandGroup({
 *   command: new SlashCommandBuilder()
 *     .setName('manage')
 *     .setDescription('Management commands')
 *     .addSubcommand(sub => sub.setName('list').setDescription('List items'))
 *     .addSubcommand(sub => sub.setName('add').setDescription('Add an item')),
 *   guards: [inCachedGuild],
 *   subcommands: {
 *     list: {
 *       action: async (interaction, client) => {
 *         await interaction.reply('Here are the items...');
 *       },
 *     },
 *     add: {
 *       guards: [hasPermission(PermissionFlagsBits.ManageGuild)],
 *       action: async (interaction, client) => {
 *         await interaction.reply('Item added!');
 *       },
 *     },
 *   },
 * });
 * ```
 *
 * @example
 * ```ts
 * // With subcommand groups: /settings roles add, /settings roles remove
 * export const settings = defineCommandGroup({
 *   command: builder,
 *   guards: [inCachedGuild],
 *   subcommands: {
 *     view: { action: async (i) => { ... } },
 *   },
 *   groups: {
 *     roles: {
 *       add:    { action: async (i) => { ... } },
 *       remove: { action: async (i) => { ... } },
 *     },
 *   },
 * });
 * ```
 */
export function defineCommandGroup<
	TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction,
>(options: CommandGroupOptions<TGuarded>): CommandSpark<TGuarded> {
	const { command, guards = [], subcommands = {}, groups = {} } = options;

	// Validate that at least one subcommand or group is defined
	const hasSubcommands = Object.keys(subcommands).length > 0;
	const hasGroups = Object.keys(groups).length > 0;
	if (!(hasSubcommands || hasGroups)) {
		throw new Error(
			`defineCommandGroup("${command.name}"): at least one subcommand or group must be provided`,
		);
	}

	// Determine if any subcommand provides autocomplete
	const allHandlers = [
		...Object.values(subcommands),
		...Object.values(groups).flatMap((g) => Object.values(g)),
	];
	const hasAnyAutocomplete = allHandlers.some(
		(h) => h.autocomplete !== undefined,
	);

	/** Runs subcommand-specific guards then executes the action. */
	async function runSubcommand(
		handler: SubcommandHandler<TGuarded>,
		narrowed: TGuarded,
		client: UnicornClient,
		routeKey: string,
	): Promise<GuardResult<TGuarded>> {
		let finalNarrowed = narrowed;

		if (handler.guards && handler.guards.length > 0) {
			const subGuardResult = await runGuards(
				handler.guards as readonly Guard<unknown, unknown>[],
				narrowed,
				client,
			);

			if (!subGuardResult.ok) {
				client.logger.debug(
					{ command: routeKey, reason: subGuardResult.reason },
					'Subcommand guard failed',
				);
				return subGuardResult as GuardResult<TGuarded>;
			}

			finalNarrowed = subGuardResult.value as TGuarded;
		}

		const actionResult = await attempt(() =>
			handler.action(finalNarrowed, client),
		);

		if (isError(actionResult)) {
			client.logger.error(
				{ err: actionResult.error, command: routeKey },
				'Subcommand action failed',
			);
		}

		return { ok: true, value: finalNarrowed };
	}

	async function resolveAndRunAutocomplete(
		interaction: AutocompleteInteraction,
		client: UnicornClient,
	): Promise<void> {
		const group = interaction.options.getSubcommandGroup(false);
		const sub = interaction.options.getSubcommand(false);
		const handler = findSubcommandHandler(group, sub, subcommands, groups);
		const { autocomplete } = handler ?? {};

		if (!autocomplete) {
			client.logger.debug(
				{ command: command.name, subcommand: sub, group },
				'No autocomplete handler for subcommand',
			);
			return;
		}

		const result = await attempt(() => autocomplete(interaction, client));

		if (isError(result)) {
			client.logger.warn(
				{
					err: result.error,
					command: command.name,
					subcommand: sub,
					group,
				},
				'Subcommand autocomplete failed',
			);
		}
	}

	const spark: CommandSpark<TGuarded> = {
		type: 'command',
		id: command.name,
		command,
		guards,

		// Routing is handled entirely in execute(); action is a no-op for interface compliance.
		action: (() => {
			/* noop */
		}) as CommandAction<TGuarded>,

		// Gate autocomplete routing — hasAutocomplete() checks this property.
		...(hasAnyAutocomplete
			? {
					autocomplete: resolveAndRunAutocomplete,
				}
			: {}),

		async execute(
			interaction: CommandInteraction,
			client: UnicornClient,
		): Promise<GuardResult<TGuarded>> {
			// Command groups only support slash commands (subcommands don't exist for context menus)
			if (!interaction.isChatInputCommand()) {
				return {
					ok: false,
					reason: 'Command groups only support slash commands.',
				} as GuardResult<TGuarded>;
			}

			// 1. Run top-level guards
			const guardResult = await runGuards(
				guards as readonly Guard<unknown, unknown>[],
				interaction,
				client,
			);

			if (!guardResult.ok) {
				client.logger.debug(
					{ command: command.name, reason: guardResult.reason },
					'Command group guard failed',
				);
				return guardResult as GuardResult<TGuarded>;
			}

			const narrowed = guardResult.value as TGuarded;

			// 2. Resolve the subcommand handler
			const group = interaction.options.getSubcommandGroup(false);
			const subcommand = interaction.options.getSubcommand(false);
			const handler = findSubcommandHandler(
				group,
				subcommand,
				subcommands,
				groups,
			);

			if (!handler) {
				client.logger.warn(
					{ command: command.name, subcommand, group },
					'No handler for subcommand',
				);
				return {
					ok: false,
					reason: 'This subcommand is not available.',
				} as GuardResult<TGuarded>;
			}

			const routeKey = group
				? `${command.name} ${group} ${subcommand}`
				: `${command.name} ${subcommand}`;

			// 3. Run subcommand guards + action
			const subResult = await runSubcommand(
				handler,
				narrowed,
				client,
				routeKey,
			);

			return subResult;
		},

		async executeAutocomplete(
			interaction: AutocompleteInteraction,
			client: UnicornClient,
		): Promise<void> {
			await resolveAndRunAutocomplete(interaction, client);
		},

		register(client: UnicornClient): void {
			// Safe cast: CommandGroupSpark satisfies BaseCommandSpark structurally for storage.
			// Type narrowing happens at runtime via guards in execute().
			client.commands.set(command.name, spark as BaseCommandSpark);
			client.logger.debug(
				{
					command: command.name,
					subcommands: Object.keys(subcommands),
					groups: Object.keys(groups),
				},
				'Registered command group',
			);
		},
	};

	return spark;
}
