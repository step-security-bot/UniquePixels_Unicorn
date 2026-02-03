import type * as z from 'zod';
import { UnicornConfigSchema } from './schema.ts';
import type { Snowflake } from './schema-helpers.ts';

/**
 * The input type for Unicorn configuration before parsing.
 */
export type UnicornConfig = z.input<typeof UnicornConfigSchema>;

/**
 * Transforms a record's values to Snowflake while preserving literal keys.
 */
type TransformIdRecord<T> = {
	[K in keyof T]: Snowflake;
};

/**
 * Transforms the ids section to preserve literal keys from input config.
 */
type ParsedIds<T extends { role: object; channel: object; emoji: object }> = {
	role: TransformIdRecord<T['role']>;
	channel: TransformIdRecord<T['channel']>;
	emoji: TransformIdRecord<T['emoji']>;
};

/**
 * The parsed config type that preserves literal keys from the input ids section.
 */
export type ParsedConfig<T extends UnicornConfig> = Omit<
	z.output<typeof UnicornConfigSchema>,
	'ids'
> & {
	ids: ParsedIds<T['ids']>;
};

/**
 * Parses and validates a Unicorn configuration object.
 *
 * Validates the configuration against the schema, resolves environment-specific
 * values via `envMap`, and resolves secrets from environment variables.
 *
 * @param config - The raw configuration object
 * @returns The validated and transformed configuration with preserved id keys
 * @throws {ZodError} If validation fails
 *
 * @example
 * ```ts
 * const config = parseConfig({
 *   discord: { appID: '123...', apiToken: 'secret://TOKEN', ... },
 *   ids: { role: { admin: '456...' }, channel: {}, emoji: {} },
 *   misc: {},
 * });
 * // config.ids.role.admin is typed as Snowflake
 * ```
 */
export function parseConfig<const T extends UnicornConfig>(
	config: T,
): ParsedConfig<T> {
	return UnicornConfigSchema.parse(config) as ParsedConfig<T>;
}
