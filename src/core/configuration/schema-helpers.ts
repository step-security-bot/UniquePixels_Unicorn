import * as z from 'zod';

/**
 * Whether the current environment is development.
 */
const isDev: boolean = Bun.env.NODE_ENV === 'development';

/**
 * A schema that accepts either a single value or a tuple of [prod, dev?].
 * Transforms to the appropriate value based on NODE_ENV.
 *
 * @example
 * ```ts
 * const GuildId = envMap(Snowflake);
 * GuildId.parse("123456789012345678"); // single value - used everywhere
 * GuildId.parse(["123456789012345678"]); // prod only - used everywhere
 * GuildId.parse(["123456789012345678", "987654321098765432"]); // [prod, dev]
 * ```
 */

export function envMap<T extends z.ZodTypeAny>(schema: T) {
	return z
		.union([schema, z.tuple([schema]), z.tuple([schema, schema])])
		.transform((input): z.output<T> => {
			if (!Array.isArray(input)) {
				return input;
			}
			const tuple = input as [z.output<T>] | [z.output<T>, z.output<T>];
			if (tuple.length === 1) {
				return tuple[0];
			}
			return isDev ? tuple[1] : tuple[0];
		});
}

/**
 * A Discord Snowflake ID.
 *
 * A unique 64-bit identifier represented as a 17-19 digit numeric string.
 * @see https://discord.com/developers/docs/reference#snowflakes
 */
export type Snowflake = string & {};

export const Snowflake = z.custom<Snowflake>((val): val is Snowflake => {
	if (typeof val !== 'string') {
		return false;
	}
	if (val.length < 17 || val.length > 19) {
		return false;
	}
	try {
		BigInt(val);
		return true;
	} catch {
		return false;
	}
}, 'Invalid Snowflake ID (must be a 17-19 digit numeric string)');

/**
 * A secret reference in the format `secret://key`.
 * During parsing, this will be resolved to the actual secret value.
 */
export type Secret = `secret://${string}` & {};

const SECRET_PREFIX = 'secret://';

export const Secret = z
	.custom<Secret>((value): value is Secret => {
		if (typeof value !== 'string') {
			return false;
		}
		return (
			value.startsWith(SECRET_PREFIX) && value.length > SECRET_PREFIX.length
		);
	}, 'Invalid secret reference (must be in the format `secret://key`)')
	.transform((value, ctx): string => resolveSecret(value, ctx));

/** Resolves a `secret://` key to its environment variable value. */
function resolveSecret(value: string, ctx: z.RefinementCtx): string {
	const key = value.substring(SECRET_PREFIX.length);
	const secret = Bun.env[key];
	if (secret === undefined) {
		ctx.addIssue({
			code: 'custom',
			message: `Environment variable "${key}" is not set`,
		});
		return z.NEVER;
	}
	return secret;
}

/**
 * A flexible value for the `misc` config bag.
 * Strings matching `secret://key` are resolved from environment variables.
 * All other values pass through unchanged.
 */
export const MiscValue = z.unknown().transform((value, ctx) => {
	if (typeof value === 'string' && value.startsWith(SECRET_PREFIX)) {
		if (value.length <= SECRET_PREFIX.length) {
			ctx.addIssue({
				code: 'custom',
				message:
					'Invalid secret reference (must be in the format `secret://key`)',
			});
			return z.NEVER;
		}
		return resolveSecret(value, ctx);
	}
	return value;
});
