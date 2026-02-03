import { ActivityType, GatewayIntentBits, Partials } from 'discord.js';
import type { UnicornConfig } from '@/core/configuration';

export const appConfig = {
	discord: {
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
	misc: {},
	ids: {
		role: {
			test: ['12345678901234567', '23456789012345678'],
		},
		channel: {},
		emoji: {},
	},
} satisfies UnicornConfig;
