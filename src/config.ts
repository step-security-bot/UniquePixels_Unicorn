import { ActivityType, GatewayIntentBits, Partials } from 'discord.js';
import type { UnicornConfig } from '@/core/configuration';

// biome-ignore lint/nursery/useExplicitType: satisfies preserves literal types for type-safe ID access
export const appConfig = {
	discord: {
		appID: '1225958405542383747', // Note: App IDs are not secrets.
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
		role: {},
		channel: {},
		emoji: {},
	},
} satisfies UnicornConfig;
