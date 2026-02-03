import type {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	ContextMenuCommandBuilder,
	SlashCommandBuilder,
	SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { UnicornClient } from '@/core/client';
import type { Guard, GuardResult } from '@/core/guards';
import { runGuards } from '@/core/guards';
import { attempt, isError } from '@/core/lib/attempt';

/**
 * Union of all command builder types.
 */
export type CommandBuilder =
	| SlashCommandBuilder
	| SlashCommandSubcommandsOnlyBuilder
	| Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>
	| ContextMenuCommandBuilder;

/**
 * Action function for commands.
 * Receives the (possibly narrowed) interaction and the client.
 */
export type CommandAction<T = ChatInputCommandInteraction> = (
	interaction: T,
	client: UnicornClient,
) => void | Promise<void>;

/**
 * Options for defining a command spark.
 */
export interface CommandOptions<
	TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction,
> {
	/** The slash command builder */
	command: CommandBuilder;
	/** Guards to run before the action (optional, defaults to []) */
	guards?: readonly Guard<ChatInputCommandInteraction, TGuarded>[];
	/** The action to run when the command is invoked */
	action: CommandAction<TGuarded>;
}

/**
 * Options for a command with autocomplete support.
 */
export interface CommandWithAutocompleteOptions<
	TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction,
> extends CommandOptions<TGuarded> {
	/** Handler for autocomplete interactions */
	autocomplete: (
		interaction: AutocompleteInteraction,
		client: UnicornClient,
	) => void | Promise<void>;
}

/**
 * Base command spark interface used for storage in collections.
 * Omits variance-sensitive properties to allow storing any CommandSpark.
 */
export interface BaseCommandSpark {
	readonly type: 'command';
	readonly id: string;
	readonly command: CommandBuilder;
	readonly autocomplete?: (
		interaction: AutocompleteInteraction,
		client: UnicornClient,
	) => void | Promise<void>;

	/** Execute the command (runs guards then action) */
	execute(
		interaction: ChatInputCommandInteraction,
		client: UnicornClient,
	): Promise<GuardResult<unknown>>;

	/** Execute autocomplete handler */
	executeAutocomplete?(
		interaction: AutocompleteInteraction,
		client: UnicornClient,
	): Promise<void>;

	/** Register this spark with the client */
	register(client: UnicornClient): void;
}

/**
 * A command spark instance with typed guards and action.
 */
export interface CommandSpark<
	TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction,
> {
	readonly type: 'command';
	readonly id: string;
	readonly command: CommandBuilder;
	readonly guards: readonly Guard<ChatInputCommandInteraction, TGuarded>[];
	readonly action: CommandAction<TGuarded>;
	readonly autocomplete?: (
		interaction: AutocompleteInteraction,
		client: UnicornClient,
	) => void | Promise<void>;

	/** Execute the command (runs guards then action) */
	execute(
		interaction: ChatInputCommandInteraction,
		client: UnicornClient,
	): Promise<GuardResult<TGuarded>>;

	/** Execute autocomplete handler */
	executeAutocomplete?(
		interaction: AutocompleteInteraction,
		client: UnicornClient,
	): Promise<void>;

	/** Register this spark with the client */
	register(client: UnicornClient): void;
}

/**
 * Creates a command spark.
 *
 * @example
 * ```ts
 * // Simple command
 * export const ping = defineCommand({
 *   command: new SlashCommandBuilder()
 *     .setName('ping')
 *     .setDescription('Check latency'),
 *   action: async (interaction, client) => {
 *     await interaction.reply(`Pong! ${client.ws.ping}ms`);
 *   },
 * });
 *
 * // Command with guards - interaction type is narrowed
 * export const kick = defineCommand({
 *   command: new SlashCommandBuilder()
 *     .setName('kick')
 *     .setDescription('Kick a member'),
 *   guards: [inCachedGuild, hasPermission(PermissionFlagsBits.KickMembers)],
 *   action: async (interaction, client) => {
 *     // interaction.guild is guaranteed to exist
 *     await interaction.guild.members.kick(targetId);
 *   },
 * });
 * ```
 */
export function defineCommand<
	TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction,
>(options: CommandOptions<TGuarded>): CommandSpark<TGuarded> {
	const { command, guards = [], action } = options;

	const spark: CommandSpark<TGuarded> = {
		type: 'command',
		id: command.name,
		command,
		guards,
		action,

		async execute(
			interaction: ChatInputCommandInteraction,
			client: UnicornClient,
		): Promise<GuardResult<TGuarded>> {
			// Run guards
			const guardResult = await runGuards(
				guards as readonly Guard<unknown, unknown>[],
				interaction,
				client,
			);

			if (!guardResult.ok) {
				client.logger.debug(
					{ command: command.name, reason: guardResult.reason },
					'Command guard failed',
				);
				return guardResult as GuardResult<TGuarded>;
			}

			// Execute action with error handling
			const actionResult = await attempt(() =>
				action(guardResult.value as TGuarded, client),
			);

			if (isError(actionResult)) {
				client.logger.error(
					{ err: actionResult.error, command: command.name },
					'Command action failed',
				);
			}

			return guardResult as GuardResult<TGuarded>;
		},

		register(client: UnicornClient): void {
			// Safe cast: CommandSpark satisfies BaseCommandSpark structurally for storage.
			// Type narrowing happens at runtime via guards in execute().
			client.commands.set(command.name, spark as BaseCommandSpark);
			client.logger.debug({ command: command.name }, 'Registered command');
		},
	};

	return spark;
}

/**
 * Creates a command spark with autocomplete support.
 *
 * @example
 * ```ts
 * export const search = defineCommandWithAutocomplete({
 *   command: new SlashCommandBuilder()
 *     .setName('search')
 *     .setDescription('Search for something')
 *     .addStringOption(opt =>
 *       opt.setName('query').setDescription('Search query').setAutocomplete(true)
 *     ),
 *   autocomplete: async (interaction, client) => {
 *     const query = interaction.options.getFocused();
 *     const results = await searchDatabase(query);
 *     await interaction.respond(results.slice(0, 25));
 *   },
 *   action: async (interaction, client) => {
 *     const query = interaction.options.getString('query', true);
 *     // Handle the search
 *   },
 * });
 * ```
 */
export function defineCommandWithAutocomplete<
	TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction,
>(options: CommandWithAutocompleteOptions<TGuarded>): CommandSpark<TGuarded> {
	const base = defineCommand(options);

	return {
		...base,
		autocomplete: options.autocomplete,

		async executeAutocomplete(
			interaction: AutocompleteInteraction,
			client: UnicornClient,
		): Promise<void> {
			const result = await attempt(() =>
				options.autocomplete(interaction, client),
			);

			if (isError(result)) {
				client.logger.warn(
					{ err: result.error, command: base.id },
					'Autocomplete handler failed',
				);
			}
		},
	};
}

/**
 * Type guard to check if a command spark has autocomplete.
 */
export function hasAutocomplete(
	spark: BaseCommandSpark,
): spark is BaseCommandSpark & {
	autocomplete: NonNullable<BaseCommandSpark['autocomplete']>;
	executeAutocomplete: NonNullable<BaseCommandSpark['executeAutocomplete']>;
} {
	return spark.autocomplete !== undefined;
}
