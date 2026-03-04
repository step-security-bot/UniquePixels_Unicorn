import type {
	ButtonInteraction,
	ChannelSelectMenuInteraction,
	Client,
	MentionableSelectMenuInteraction,
	ModalSubmitInteraction,
	RoleSelectMenuInteraction,
	StringSelectMenuInteraction,
	UserSelectMenuInteraction,
} from 'discord.js';
import type { Guard, GuardResult } from '@/core/guards';
import { processGuards, resolveGuards } from '@/core/guards';
import { attempt, isError } from '@/core/lib/attempt';
import type { ExtendedLogger } from '@/core/lib/logger';

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
 * Access client via `interaction.client`.
 */
export type ComponentAction<T> = (interaction: T) => void | Promise<void>;

/**
 * Options for defining a component spark.
 */
export interface ComponentOptions<
	TInput extends AnyComponentInteraction = ButtonInteraction,
	TGuarded extends TInput = TInput,
> {
	/**
	 * Pattern to match custom IDs against.
	 * - Exact string: `'confirm-button'`
	 * - Prefix (trailing dash): `'ban-'` — matches `ban-<suffix>`
	 * - Wildcard: `'ticket-close-*'`
	 * - Regex: `/^action-(\w+)-(\d+)$/`
	 */
	id: CustomIdPattern;
	/** Guards to run before the action (optional) */
	// biome-ignore lint/suspicious/noExplicitAny: Guard chains have heterogeneous input/output types; type safety is enforced by runGuards at runtime
	guards?: readonly Guard<any, any>[];
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
	execute(interaction: AnyComponentInteraction): Promise<GuardResult<unknown>>;

	/** Register this spark with the client */
	register(client: Client): void;
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
	// biome-ignore lint/suspicious/noExplicitAny: Guard chains have heterogeneous input/output types; type safety is enforced by runGuards at runtime
	readonly guards: readonly Guard<any, any>[];
	readonly action: ComponentAction<TGuarded>;

	/** Check if this spark handles the given custom ID */
	matches(customId: string): boolean;

	/** Execute the component handler (runs guards then action) */
	execute(interaction: TInput): Promise<GuardResult<TGuarded>>;

	/** Register this spark with the client */
	register(client: Client): void;
}

/**
 * Cache for compiled wildcard patterns to avoid re-compilation on every match.
 * Maps wildcard pattern strings to their compiled RegExp equivalents.
 */
const wildcardPatternCache: Map<string, RegExp> = new Map<string, RegExp>();

/**
 * Checks if a pattern is an exact match (not a regex, wildcard, or prefix).
 *
 * @example
 * ```ts
 * isExactPattern('confirm-action') // true
 * isExactPattern('ban-')           // false (prefix)
 * isExactPattern('ticket-*')       // false (wildcard)
 * isExactPattern(/^action-\w+$/)   // false (regex)
 * ```
 */
export function isExactPattern(pattern: CustomIdPattern): pattern is string {
	return (
		typeof pattern === 'string' &&
		!pattern.includes('*') &&
		!pattern.endsWith('-')
	);
}

/**
 * Checks if a pattern is a prefix match (trailing dash, no wildcards).
 * A prefix pattern like `'ban-'` matches any customId of the form `ban-<suffix>`.
 *
 * @example
 * ```ts
 * isPrefixPattern('ban-')           // true
 * isPrefixPattern('confirm-action') // false (exact)
 * isPrefixPattern('ticket-*')       // false (wildcard)
 * ```
 */
export function isPrefixPattern(pattern: CustomIdPattern): pattern is string {
	return (
		typeof pattern === 'string' &&
		pattern.endsWith('-') &&
		!pattern.includes('*')
	);
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

	// Check for prefix pattern (trailing dash)
	if (pattern.endsWith('-')) {
		const separatorIndex = customId.lastIndexOf('-');
		if (separatorIndex <= 0 || separatorIndex === customId.length - 1) {
			return { matched: false };
		}
		const customPrefix = customId.slice(0, separatorIndex);
		return { matched: `${customPrefix}-` === pattern };
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
 *   action: async (interaction) => {
 *     await interaction.reply('Confirmed!');
 *   },
 * });
 *
 * // Prefix match — trailing dash matches any single suffix segment
 * export const ban = defineComponent({
 *   id: 'ban-',
 *   action: async (interaction) => {
 *     const userId = interaction.customId.split('-').pop();
 *     await interaction.guild.members.ban(userId);
 *   },
 * });
 *
 * // Pattern match with wildcard
 * export const ticketClose = defineComponent({
 *   id: 'ticket-close-*',
 *   guards: [inCachedGuild],
 *   action: async (interaction) => {
 *     const ticketId = interaction.customId.split('-').pop();
 *     await closeTicket(ticketId);
 *   },
 * });
 *
 * // Regex pattern
 * export const dynamicAction = defineComponent({
 *   id: /^action-(?<type>\w+)-(?<id>\d+)$/,
 *   action: async (interaction) => {
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
	const { id, action } = options;
	const guards = resolveGuards(options.guards ?? [], 'component');
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

		async execute(interaction: TInput): Promise<GuardResult<TGuarded>> {
			const client = interaction.client;

			// Run guards with centralized error handling
			const guardResult = await processGuards(
				guards,
				interaction,
				client.logger,
				`component:${key}`,
			);

			if (!guardResult.ok) {
				return guardResult as GuardResult<TGuarded>;
			}

			// Execute action with error handling
			const actionResult = await attempt(() =>
				action(guardResult.value as TGuarded),
			);

			if (isError(actionResult)) {
				client.logger.error(
					{ err: actionResult.error, component: key },
					'Component action failed',
				);
			}

			return guardResult as GuardResult<TGuarded>;
		},

		register(client: Client): void {
			// Safe cast: ComponentSpark satisfies BaseComponentSpark structurally for storage.
			// Type narrowing happens at runtime via guards in execute().
			const baseSpark = spark as BaseComponentSpark;

			if (isExactPattern(id) || isPrefixPattern(id)) {
				// Exact and prefix matches — store in Map for O(1) lookup
				client.components.set(key, baseSpark);
				client.logger.debug(
					{ component: key, type: isPrefixPattern(id) ? 'prefix' : 'exact' },
					'Registered component',
				);
			} else {
				// Pattern (wildcard or regex) — store in array for linear search
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
 *
 * Lookup order:
 * 1. **Exact match** — O(1) lookup in the components Map.
 * 2. **Prefix match** — If the customId contains a `-`, the part before the
 *    last `-` is looked up as `prefix-` in the components Map (O(1)). This
 *    handles the common pattern of appending a dynamic suffix
 *    (e.g. `ban-123456789` matching `id: 'ban-'`).
 * 3. **Pattern match** — Linear scan over wildcard/regex patterns (O(n)).
 */
export function findComponentSpark(
	components: Map<string, BaseComponentSpark>,
	componentPatterns: BaseComponentSpark[],
	customId: string,
	logger?: ExtendedLogger,
): BaseComponentSpark | undefined {
	// 1. Exact match — O(1) lookup (skip prefix patterns matched by their literal key)
	const exact = components.get(customId);
	if (exact && !isPrefixPattern(exact.id)) {
		return exact;
	}

	// 2. Prefix match — split on last '-', look for 'prefix-' in Map — O(1) lookup
	const separatorIndex = customId.lastIndexOf('-');
	if (separatorIndex > 0 && separatorIndex < customId.length - 1) {
		const prefix = customId.slice(0, separatorIndex);
		const prefixKey = `${prefix}-`;
		const prefixMatch = components.get(prefixKey);
		if (prefixMatch) {
			logger?.debug(
				{ component: prefixKey, customId },
				'Component matched via prefix routing',
			);
			return prefixMatch;
		}
	}

	// 3. Pattern match — O(n) over wildcard/regex matchers
	return componentPatterns.find((spark) => spark.matches(customId));
}
