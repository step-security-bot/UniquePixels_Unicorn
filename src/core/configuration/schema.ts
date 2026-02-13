import { ActivityType, GatewayIntentBits, Partials } from 'discord.js';
import * as z from 'zod';
import * as u from './schema-helpers.ts';

/**
 * Zod schema for validating Unicorn bot configuration.
 *
 * Defines the structure for Discord client settings, presence configuration,
 * OAuth2 options, and environment-specific ID mappings for roles, channels, and emoji.
 */
export const UnicornConfigSchema = z.object({
	discord: z.object({
		appID: u.envMap(u.Snowflake),
		apiToken: u.envMap(u.Secret),
		intents: z.array(z.enum(GatewayIntentBits)),
		enabledPartials: z.array(z.enum(Partials)),
		enforceNonce: z.boolean(),
		defaultPresence: z.object({
			status: z.enum(['online', 'idle', 'dnd', 'invisible']),
			activities: z.array(
				z.object({
					name: z.string(),
					type: z.enum(ActivityType),
				}),
			),
		}),
		oAuth2: z
			.object({
				apiToken: u.envMap(u.Secret),
				url: u.envMap(z.url()),
			})
			.optional(),
	}),
	healthCheckPort: z.number().int().min(1).max(65_535).optional(),
	misc: z.record(z.string(), z.any()),
	ids: z.object({
		role: z.record(z.string(), u.envMap(u.Snowflake)),
		channel: z.record(z.string(), u.envMap(u.Snowflake)),
		emoji: z.record(z.string(), u.envMap(u.Snowflake)),
	}),
});
