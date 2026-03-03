/**
 * Result of a guard check - either success with the (possibly narrowed) value,
 * or failure with a reason string.
 */
export type GuardResult<T> =
	| { ok: true; value: T }
	| { ok: false; reason: string };

/**
 * A guard function that validates input and optionally narrows its type.
 *
 * Guards receive a single input value and return a result indicating success
 * or failure. Guards that need client access can use `input.client` when
 * the input is a Discord.js object (interaction, message, etc.).
 *
 * @example
 * ```ts
 * const inGuild: Guard<Interaction, Interaction & { guild: Guild }> = (interaction) => {
 *   if (!interaction.inCachedGuild()) {
 *     return { ok: false, reason: 'Command must be used in a server' };
 *   }
 *   return { ok: true, value: interaction };
 * };
 * ```
 */
export type Guard<TInput, TOutput extends TInput = TInput> = (
	input: TInput,
) => GuardResult<TOutput> | Promise<GuardResult<TOutput>>;

/**
 * Extracts the output type from a Guard.
 */
export type GuardOutput<G> =
	G extends Guard<unknown, infer TOutput> ? TOutput : never;

/**
 * Helper to create a guard with proper type inference.
 *
 * @example
 * ```ts
 * const myGuard = createGuard<Interaction, CommandInteraction>((input) => {
 *   if (!input.isCommand()) {
 *     return { ok: false, reason: 'Not a command interaction' };
 *   }
 *   return { ok: true, value: input };
 * });
 * ```
 */
export function createGuard<TInput, TOutput extends TInput = TInput>(
	guardFn: Guard<TInput, TOutput>,
): Guard<TInput, TOutput> {
	return guardFn;
}

/**
 * Creates a successful guard result.
 */
export function guardPass<T>(value: T): GuardResult<T> {
	return { ok: true, value };
}

/**
 * Creates a failed guard result.
 */
export function guardFail(reason: string): GuardResult<never> {
	return { ok: false, reason };
}

/**
 * Runs a single guard and returns the result.
 * Handles both sync and async guards.
 */
export function runGuard<TInput, TOutput extends TInput>(
	guard: Guard<TInput, TOutput>,
	input: TInput,
): GuardResult<TOutput> | Promise<GuardResult<TOutput>> {
	return guard(input);
}

/**
 * Type helper for composing guards - chains the output of one guard as input to the next.
 */
type ChainedGuardOutput<
	TInput,
	Guards extends readonly Guard<unknown, unknown>[],
> = Guards extends readonly []
	? TInput
	: Guards extends readonly [
				Guard<unknown, infer TOut>,
				...infer Rest extends readonly Guard<unknown, unknown>[],
			]
		? ChainedGuardOutput<TOut, Rest>
		: never;

/**
 * Runs multiple guards in sequence, passing the narrowed output of each guard
 * to the next. Short-circuits on the first failure.
 *
 * @param guards - Array of guards to run in sequence
 * @param input - Initial input value
 * @returns The final narrowed value if all guards pass, or failure result
 *
 * @example
 * ```ts
 * const result = await runGuards(
 *   [inGuildGuard, hasPermissionGuard(PermissionFlagsBits.ManageMessages)],
 *   interaction,
 * );
 *
 * if (!result.ok) {
 *   await interaction.reply({ content: result.reason, ephemeral: true });
 *   return;
 * }
 *
 * // result.value is now typed as the narrowed interaction
 * const guild = result.value.guild; // TypeScript knows guild exists
 * ```
 */
export async function runGuards<
	TInput,
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required due to contravariance in T
	const Guards extends readonly Guard<any, any>[],
>(
	guards: Guards,
	input: TInput,
): Promise<GuardResult<ChainedGuardOutput<TInput, Guards>>> {
	let currentValue: unknown = input;

	// Sequential execution is intentional: each guard's output feeds into the next,
	// and we short-circuit on first failure.
	for (const guard of guards) {
		// biome-ignore lint/performance/noAwaitInLoops: guards must run sequentially for type narrowing and short-circuit
		const result = await guard(currentValue);

		if (!result.ok) {
			return result;
		}

		currentValue = result.value;
	}

	return { ok: true, value: currentValue } as GuardResult<
		ChainedGuardOutput<TInput, Guards>
	>;
}

// Built-in guards are exported from @/guards/built-in
// import { inCachedGuild, hasPermission } from '@/guards/built-in';
