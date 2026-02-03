import { ActivityType, GatewayIntentBits, Partials } from 'discord.js';
import type { UnicornConfig } from '@/core/configuration';

// biome-ignore lint/nursery/useExplicitType: satisfies preserves literal types for type-safe ID access
export const appConfig = {
	discord: {
		// biome-ignore lint/security/noSecrets: app ids are not a secret
		appID: '1225958405542383747',
		apiToken: 'secret://apiKey',
		intents: [GatewayIntentBits.Guilds],
		enabledPartials: [Partials.Channel],
		enforceNonce: true,
		defaultPresence: {
			status: 'online',
			activities: [
				{ type: ActivityType.Watching, name: 'fabulous communities.' },
			],
		},
	},
	healthCheckPort: 3000,
	misc: {},
	ids: {
		role: {
			// biome-ignore lint/security/noSecrets: these are fake Discord snowflake IDs for testing
			test: ['12345678901234567', '23456789012345678'],
		},
		channel: {},
		emoji: {},
	},
} satisfies UnicornConfig;
