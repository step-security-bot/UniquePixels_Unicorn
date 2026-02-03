import type {
	ButtonInteraction,
	ChannelSelectMenuInteraction,
	MentionableSelectMenuInteraction,
	ModalSubmitInteraction,
	RoleSelectMenuInteraction,
	StringSelectMenuInteraction,
	UserSelectMenuInteraction,
} from 'discord.js';
import type { UnicornClient } from '@/core/client';
import type { Guard, GuardResult } from '@/core/guards';
import { runGuards } from '@/core/guards';
import { attempt, isError } from '@/core/lib/attempt';

/**
 * Union of all select menu interaction types.
 */
export type SelectMenuInteraction =
	| StringSelectMenuInteraction
	| UserSelectMenuInteraction
	| RoleSelectMenuInteraction
	| MentionableSelectMenuInteraction
	| ChannelSelectMenuInteraction;

/**
 * Union of all component interaction types (excluding modals).
 */
export type ComponentInteraction = ButtonInteraction | SelectMenuInteraction;

/**
 * All component types including modals.
 */
export type AnyComponentInteraction =
	| ComponentInteraction
	| ModalSubmitInteraction;

/**
 * Pattern matcher for component custom IDs.
 * Can be an exact string, a regex, or a glob-like pattern with wildcards.
 */
export type CustomIdPattern = string | RegExp;

/**
 * Action function for components.
 */
export type ComponentAction<T> = (
	interaction: T,
	client: UnicornClient,
) => void | Promise<void>;

/**
 * Options for defining a component spark.
 */
export interface ComponentOptions<
	TInput extends AnyComponentInteraction = ButtonInteraction,
	TGuarded extends TInput = TInput,
> {
	/**
	 * Pattern to match custom IDs against.
	 * - Exact string: 'confirm-button'
	 * - Wildcard: 'ticket-close-*'
	 * - Regex: /^action-(\w+)-(\d+)$/
	 */
	id: CustomIdPattern;
	/** Guards to run before the action (optional) */
	guards?: readonly Guard<TInput, TGuarded>[];
	/** The action to run when the component is interacted with */
	action: ComponentAction<TGuarded>;
}

/**
 * Base component spark interface used for storage in collections.
 * Uses `never` for input types to allow any ComponentSpark to be assigned to it.
 */
export interface BaseComponentSpark {
	readonly type: 'component';
	readonly id: CustomIdPattern;
	readonly key: string;

	/** Check if this spark handles the given custom ID */
	matches(customId: string): boolean;

	/** Execute the component handler (runs guards then action) */
	execute(
		interaction: AnyComponentInteraction,
		client: UnicornClient,
	): Promise<GuardResult<unknown>>;

	/** Register this spark with the client */
	register(client: UnicornClient): void;
}

/**
 * A component spark instance with typed guards and action.
 */
export interface ComponentSpark<
	TInput extends AnyComponentInteraction = ButtonInteraction,
	TGuarded extends TInput = TInput,
> {
	readonly type: 'component';
	readonly id: CustomIdPattern;
	readonly key: string;
	readonly guards: readonly Guard<TInput, TGuarded>[];
	readonly action: ComponentAction<TGuarded>;

	/** Check if this spark handles the given custom ID */
	matches(customId: string): boolean;

	/** Execute the component handler (runs guards then action) */
	execute(
		interaction: TInput,
		client: UnicornClient,
	): Promise<GuardResult<TGuarded>>;

	/** Register this spark with the client */
	register(client: UnicornClient): void;
}

/**
 * Cache for compiled wildcard patterns to avoid re-compilation on every match.
 * Maps wildcard pattern strings to their compiled RegExp equivalents.
 */
const wildcardPatternCache: Map<string, RegExp> = new Map<string, RegExp>();

/**
 * Checks if a pattern is an exact match (not a regex or wildcard).
 */
export function isExactPattern(pattern: CustomIdPattern): pattern is string {
	return typeof pattern === 'string' && !pattern.includes('*');
}

/**
 * Compiles a wildcard pattern to a RegExp, using cache for performance.
 */
function getWildcardRegex(pattern: string): RegExp {
	let regex = wildcardPatternCache.get(pattern);
	if (!regex) {
		const regexPattern = pattern
			.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)
			.replaceAll('*', '(.+)');
		regex = new RegExp(`^${regexPattern}$`);
		wildcardPatternCache.set(pattern, regex);
	}
	return regex;
}

/**
 * Checks if a custom ID matches a pattern.
 * Returns no match for empty customIds to prevent unexpected behavior.
 */
export function matchCustomId(
	customId: string,
	pattern: CustomIdPattern,
): { matched: boolean; groups?: Record<string, string> } {
	// Reject empty customIds - they should never match anything
	if (!customId) {
		return { matched: false };
	}

	if (pattern instanceof RegExp) {
		const match = pattern.exec(customId);
		if (!match) {
			return { matched: false };
		}

		return {
			matched: true,
			groups: match.groups ?? {},
		};
	}

	// Check for wildcard pattern
	if (pattern.includes('*')) {
		const regex = getWildcardRegex(pattern);
		const match = regex.exec(customId);

		return { matched: match !== null };
	}

	// Exact match
	return { matched: customId === pattern };
}

/**
 * Creates a component spark.
 *
 * @example
 * ```ts
 * // Exact match button
 * export const confirmButton = defineComponent({
 *   id: 'confirm-action',
 *   action: async (interaction, client) => {
 *     await interaction.reply('Confirmed!');
 *   },
 * });
 *
 * // Pattern match with wildcard
 * export const ticketClose = defineComponent({
 *   id: 'ticket-close-*',
 *   guards: [inCachedGuild],
 *   action: async (interaction, client) => {
 *     const ticketId = interaction.customId.split('-').pop();
 *     await closeTicket(ticketId);
 *   },
 * });
 *
 * // Regex pattern
 * export const dynamicAction = defineComponent({
 *   id: /^action-(?<type>\w+)-(?<id>\d+)$/,
 *   action: async (interaction, client) => {
 *     // Parse customId as needed
 *   },
 * });
 * ```
 */
export function defineComponent<
	TInput extends AnyComponentInteraction = ButtonInteraction,
	TGuarded extends TInput = TInput,
>(
	options: ComponentOptions<TInput, TGuarded>,
): ComponentSpark<TInput, TGuarded> {
	const { id, guards = [], action } = options;
	const key = id instanceof RegExp ? id.source : id;

	const spark: ComponentSpark<TInput, TGuarded> = {
		type: 'component',
		id,
		key,
		guards,
		action,

		matches(customId: string): boolean {
			return matchCustomId(customId, id).matched;
		},

		async execute(
			interaction: TInput,
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
					{ component: key, reason: guardResult.reason },
					'Component guard failed',
				);
				return guardResult as GuardResult<TGuarded>;
			}

			// Execute action with error handling
			const actionResult = await attempt(() =>
				action(guardResult.value as TGuarded, client),
			);

			if (isError(actionResult)) {
				client.logger.error(
					{ err: actionResult.error, component: key },
					'Component action failed',
				);
			}

			return guardResult as GuardResult<TGuarded>;
		},

		register(client: UnicornClient): void {
			// Safe cast: ComponentSpark satisfies BaseComponentSpark structurally for storage.
			// Type narrowing happens at runtime via guards in execute().
			const baseSpark = spark as BaseComponentSpark;

			if (isExactPattern(id)) {
				// Exact match - store in Map for O(1) lookup
				client.components.set(key, baseSpark);
				client.logger.debug(
					{ component: key, type: 'exact' },
					'Registered component',
				);
			} else {
				// Pattern (wildcard or regex) - store in array for linear search
				client.componentPatterns.push(baseSpark);
				client.logger.debug(
					{ component: key, type: 'pattern' },
					'Registered component',
				);
			}
		},
	};

	return spark;
}

/**
 * Finds a component spark that matches the given custom ID.
 * Checks exact matches first (O(1)), then patterns (O(n)).
 */
export function findComponentSpark(
	components: Map<string, BaseComponentSpark>,
	componentPatterns: BaseComponentSpark[],
	customId: string,
): BaseComponentSpark | undefined {
	// First try exact match - O(1) lookup
	const exact = components.get(customId);
	if (exact) {
		return exact;
	}

	// Then check patterns - O(n) but only over pattern matchers
	return componentPatterns.find((spark) => spark.matches(customId));
}
