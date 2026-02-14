// Core guard infrastructure
export {
	createGuard,
	type Guard,
	type GuardOutput,
	type GuardResult,
	guardFail,
	guardPass,
	runGuard,
	runGuards,
} from '@/core/guards';

// Built-in guards
export {
	botHasPermission,
	type ChannelTypedInteraction,
	channelType,
	cleanupRateLimits,
	type GuildInteraction,
	hasPermission,
	inCachedGuild,
	isUser,
	messageInGuild,
	notBot,
	rateLimit,
} from './built-in';
