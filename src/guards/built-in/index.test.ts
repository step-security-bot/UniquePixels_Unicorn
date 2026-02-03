import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from 'bun:test';
import {
	ChannelType,
	type Guild,
	type GuildBasedChannel,
	type GuildMember,
	type Interaction,
	type Message,
	PermissionsBitField,
} from 'discord.js';
import type { UnicornClient } from '@/core/client';
import {
	_rateLimitTesting,
	botHasPermission,
	channelType,
	cleanupRateLimits,
	hasPermission,
	inCachedGuild,
	isUser,
	messageInGuild,
	notBot,
	rateLimit,
} from './index';

// Create a minimal mock UnicornClient for testing
function createMockClient(): UnicornClient {
	return {
		logger: {
			debug: mock(() => {}),
			info: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
		},
	} as unknown as UnicornClient;
}

// Helper to create mock interaction
function createMockInteraction(options: {
	inCachedGuild?: boolean;
	userId?: string;
	guildId?: string | null;
	channelType?: ChannelType;
	memberPermissions?: bigint;
}) {
	const {
		inCachedGuild: isInCachedGuild = true,
		userId = '123456789012345678',
		guildId = '987654321098765432',
		channelType: chType = ChannelType.GuildText,
		memberPermissions = 0n,
	} = options;

	return {
		inCachedGuild: () => isInCachedGuild,
		user: { id: userId },
		guildId,
		guild: isInCachedGuild ? { id: guildId, members: { me: null } } : null,
		member: isInCachedGuild
			? {
					permissions: new PermissionsBitField(memberPermissions),
				}
			: null,
		channel: {
			type: chType,
		},
	} as unknown as Interaction;
}

// Helper to create mock message
function createMockMessage(options: {
	inGuild?: boolean;
	isBot?: boolean;
	authorId?: string;
}) {
	const { inGuild = true, isBot = false, authorId = '123456789012345678' } = options;

	return {
		inGuild: () => inGuild,
		author: {
			id: authorId,
			bot: isBot,
		},
		guildId: inGuild ? '987654321098765432' : null,
	} as unknown as Message;
}

describe('inCachedGuild', () => {
	test('passes for interaction in cached guild', async () => {
		const client = createMockClient();
		const interaction = createMockInteraction({ inCachedGuild: true });

		const result = await inCachedGuild(interaction, client);

		expect(result.ok).toBe(true);
	});

	test('fails for interaction not in cached guild', async () => {
		const client = createMockClient();
		const interaction = createMockInteraction({ inCachedGuild: false });

		const result = await inCachedGuild(interaction, client);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toContain(
			'server',
		);
	});

	test('fails for DM interaction', async () => {
		const client = createMockClient();
		const interaction = createMockInteraction({
			inCachedGuild: false,
			guildId: null,
		});

		const result = await inCachedGuild(interaction, client);

		expect(result.ok).toBe(false);
	});
});

describe('hasPermission', () => {
	test('passes when user has required permission', async () => {
		const client = createMockClient();
		const guard = hasPermission(PermissionsBitField.Flags.SendMessages);

		const input = {
			member: {
				permissions: new PermissionsBitField([
					PermissionsBitField.Flags.SendMessages,
				]),
			} as GuildMember,
		};

		const result = await guard(input, client);

		expect(result.ok).toBe(true);
	});

	test('fails when user lacks required permission', async () => {
		const client = createMockClient();
		const guard = hasPermission(PermissionsBitField.Flags.Administrator);

		const input = {
			member: {
				permissions: new PermissionsBitField([
					PermissionsBitField.Flags.SendMessages,
				]),
			} as GuildMember,
		};

		const result = await guard(input, client);

		expect(result.ok).toBe(false);
	});

	test('passes when user has all required permissions', async () => {
		const client = createMockClient();
		const guard = hasPermission([
			PermissionsBitField.Flags.SendMessages,
			PermissionsBitField.Flags.EmbedLinks,
		]);

		const input = {
			member: {
				permissions: new PermissionsBitField([
					PermissionsBitField.Flags.SendMessages,
					PermissionsBitField.Flags.EmbedLinks,
					PermissionsBitField.Flags.AttachFiles,
				]),
			} as GuildMember,
		};

		const result = await guard(input, client);

		expect(result.ok).toBe(true);
	});

	test('fails when user is missing one required permission', async () => {
		const client = createMockClient();
		const guard = hasPermission([
			PermissionsBitField.Flags.SendMessages,
			PermissionsBitField.Flags.ManageMessages,
		]);

		const input = {
			member: {
				permissions: new PermissionsBitField([
					PermissionsBitField.Flags.SendMessages,
				]),
			} as GuildMember,
		};

		const result = await guard(input, client);

		expect(result.ok).toBe(false);
	});

	test('uses custom error message when provided', async () => {
		const client = createMockClient();
		const customMessage = 'You need to be a moderator';
		const guard = hasPermission(
			PermissionsBitField.Flags.ManageMessages,
			customMessage,
		);

		const input = {
			member: {
				permissions: new PermissionsBitField([]),
			} as GuildMember,
		};

		const result = await guard(input, client);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(customMessage);
	});
});

describe('botHasPermission', () => {
	test('passes when bot has required permission in channel', async () => {
		const client = createMockClient();
		const guard = botHasPermission(PermissionsBitField.Flags.SendMessages);

		const botMember = {
			permissionsIn: () =>
				new PermissionsBitField([PermissionsBitField.Flags.SendMessages]),
		};

		const input = {
			guild: { members: { me: botMember } } as unknown as Guild,
			channel: {} as GuildBasedChannel,
		};

		const result = await guard(input, client);

		expect(result.ok).toBe(true);
	});

	test('fails when bot lacks required permission in channel', async () => {
		const client = createMockClient();
		const guard = botHasPermission(PermissionsBitField.Flags.ManageMessages);

		const botMember = {
			permissionsIn: () =>
				new PermissionsBitField([PermissionsBitField.Flags.SendMessages]),
		};

		const input = {
			guild: { members: { me: botMember } } as unknown as Guild,
			channel: {} as GuildBasedChannel,
		};

		const result = await guard(input, client);

		expect(result.ok).toBe(false);
	});

	test('fails when bot member is not available', async () => {
		const client = createMockClient();
		const guard = botHasPermission(PermissionsBitField.Flags.SendMessages);

		const input = {
			guild: { members: { me: null } } as unknown as Guild,
			channel: {} as GuildBasedChannel,
		};

		const result = await guard(input, client);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toContain(
			'Unable to verify',
		);
	});

	test('uses custom error message when provided', async () => {
		const client = createMockClient();
		const customMessage = 'Bot needs embed permissions';
		const guard = botHasPermission(
			PermissionsBitField.Flags.EmbedLinks,
			customMessage,
		);

		const botMember = {
			permissionsIn: () => new PermissionsBitField([]),
		};

		const input = {
			guild: { members: { me: botMember } } as unknown as Guild,
			channel: {} as GuildBasedChannel,
		};

		const result = await guard(input, client);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(customMessage);
	});
});

describe('isUser', () => {
	test('passes for user in allowed list', async () => {
		const client = createMockClient();
		const guard = isUser(['123456789012345678', '234567890123456789']);
		const interaction = createMockInteraction({ userId: '123456789012345678' });

		const result = await guard(interaction, client);

		expect(result.ok).toBe(true);
	});

	test('fails for user not in allowed list', async () => {
		const client = createMockClient();
		const guard = isUser(['123456789012345678']);
		const interaction = createMockInteraction({ userId: '999999999999999999' });

		const result = await guard(interaction, client);

		expect(result.ok).toBe(false);
	});

	test('uses custom error message when provided', async () => {
		const client = createMockClient();
		const customMessage = 'Only bot owners can use this';
		const guard = isUser(['123456789012345678'], customMessage);
		const interaction = createMockInteraction({ userId: '999999999999999999' });

		const result = await guard(interaction, client);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(customMessage);
	});

	test('handles empty allowed list', async () => {
		const client = createMockClient();
		const guard = isUser([]);
		const interaction = createMockInteraction({ userId: '123456789012345678' });

		const result = await guard(interaction, client);

		expect(result.ok).toBe(false);
	});
});

describe('channelType', () => {
	test('passes for matching channel type', async () => {
		const client = createMockClient();
		const guard = channelType(ChannelType.GuildText);
		const interaction = createMockInteraction({
			channelType: ChannelType.GuildText,
		});

		const result = await guard(interaction, client);

		expect(result.ok).toBe(true);
	});

	test('fails for non-matching channel type', async () => {
		const client = createMockClient();
		const guard = channelType(ChannelType.GuildVoice);
		const interaction = createMockInteraction({
			channelType: ChannelType.GuildText,
		});

		const result = await guard(interaction, client);

		expect(result.ok).toBe(false);
	});

	test('passes when channel matches one of multiple types', async () => {
		const client = createMockClient();
		const guard = channelType(ChannelType.GuildText, ChannelType.GuildVoice);
		const interaction = createMockInteraction({
			channelType: ChannelType.GuildVoice,
		});

		const result = await guard(interaction, client);

		expect(result.ok).toBe(true);
	});

	test('includes channel type names in error message', async () => {
		const client = createMockClient();
		const guard = channelType(ChannelType.PublicThread, ChannelType.PrivateThread);
		const interaction = createMockInteraction({
			channelType: ChannelType.GuildText,
		});

		const result = await guard(interaction, client);

		expect(result.ok).toBe(false);
		const reason = (result as { ok: false; reason: string }).reason;
		expect(reason).toContain('PublicThread');
		expect(reason).toContain('PrivateThread');
	});
});

describe('rateLimit', () => {
	beforeEach(() => {
		// Clean up any existing rate limits before each test
		cleanupRateLimits();
	});

	afterEach(() => {
		cleanupRateLimits();
	});

	test('allows first request', async () => {
		const client = createMockClient();
		const guard = rateLimit({ limit: 5, window: 60000 });
		const interaction = createMockInteraction({ userId: 'rate-test-1' });

		const result = await guard(interaction, client);

		expect(result.ok).toBe(true);
	});

	test('allows requests up to limit', async () => {
		const client = createMockClient();
		const guard = rateLimit({ limit: 3, window: 60000 });
		const interaction = createMockInteraction({ userId: 'rate-test-2' });

		expect((await guard(interaction, client)).ok).toBe(true);
		expect((await guard(interaction, client)).ok).toBe(true);
		expect((await guard(interaction, client)).ok).toBe(true);
	});

	test('blocks requests after limit exceeded', async () => {
		const client = createMockClient();
		const guard = rateLimit({ limit: 2, window: 60000 });
		const interaction = createMockInteraction({ userId: 'rate-test-3' });

		await guard(interaction, client);
		await guard(interaction, client);
		const result = await guard(interaction, client);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toContain(
			'Rate limited',
		);
	});

	test('rate limits are per-user by default', async () => {
		const client = createMockClient();
		const guard = rateLimit({ limit: 1, window: 60000 });

		const user1 = createMockInteraction({ userId: 'user-1' });
		const user2 = createMockInteraction({ userId: 'user-2' });

		expect((await guard(user1, client)).ok).toBe(true);
		expect((await guard(user2, client)).ok).toBe(true);

		// User1's second request should be blocked
		expect((await guard(user1, client)).ok).toBe(false);
		// User2's second request should also be blocked
		expect((await guard(user2, client)).ok).toBe(false);
	});

	test('uses custom keyFn for rate limiting', async () => {
		const client = createMockClient();
		const guard = rateLimit({
			limit: 1,
			window: 60000,
			keyFn: (i) => i.guildId ?? 'dm',
		});

		const guild1User1 = createMockInteraction({
			userId: 'user-1',
			guildId: 'guild-1',
		});
		const guild1User2 = createMockInteraction({
			userId: 'user-2',
			guildId: 'guild-1',
		});
		const guild2User1 = createMockInteraction({
			userId: 'user-1',
			guildId: 'guild-2',
		});

		expect((await guard(guild1User1, client)).ok).toBe(true);
		// Different user, same guild - should be blocked
		expect((await guard(guild1User2, client)).ok).toBe(false);
		// Same user, different guild - should pass
		expect((await guard(guild2User1, client)).ok).toBe(true);
	});

	test('uses custom error message', async () => {
		const client = createMockClient();
		const customMessage = 'Slow down!';
		const guard = rateLimit({ limit: 1, window: 60000, message: customMessage });
		const interaction = createMockInteraction({ userId: 'rate-custom' });

		await guard(interaction, client);
		const result = await guard(interaction, client);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(customMessage);
	});

	test('resets after window expires', async () => {
		const client = createMockClient();
		const guard = rateLimit({ limit: 1, window: 50 }); // 50ms window
		const interaction = createMockInteraction({ userId: 'rate-expire' });

		await guard(interaction, client);
		expect((await guard(interaction, client)).ok).toBe(false);

		// Wait for window to expire
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect((await guard(interaction, client)).ok).toBe(true);
	});
});

describe('cleanupRateLimits', () => {
	beforeEach(() => {
		cleanupRateLimits();
	});

	test('returns 0 when no rate limits exist', () => {
		const cleared = cleanupRateLimits();
		expect(cleared).toBe(0);
	});

	test('clears expired rate limits', async () => {
		const client = createMockClient();
		const guard = rateLimit({ limit: 1, window: 20 });
		const interaction = createMockInteraction({ userId: 'cleanup-test' });

		await guard(interaction, client);

		// Wait for expiration
		await new Promise((resolve) => setTimeout(resolve, 30));

		const cleared = cleanupRateLimits();
		expect(cleared).toBe(1);
	});

	test('does not clear unexpired rate limits', async () => {
		const client = createMockClient();
		const guard = rateLimit({ limit: 1, window: 60000 });
		const interaction = createMockInteraction({ userId: 'cleanup-test-2' });

		await guard(interaction, client);

		const cleared = cleanupRateLimits();
		expect(cleared).toBe(0);
	});
});

describe('messageInGuild', () => {
	test('passes for message in guild', async () => {
		const client = createMockClient();
		const message = createMockMessage({ inGuild: true });

		const result = await messageInGuild(message, client);

		expect(result.ok).toBe(true);
	});

	test('fails for DM message', async () => {
		const client = createMockClient();
		const message = createMockMessage({ inGuild: false });

		const result = await messageInGuild(message, client);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toContain('server');
	});
});

describe('notBot', () => {
	test('passes for human user message', async () => {
		const client = createMockClient();
		const message = createMockMessage({ isBot: false });

		const result = await notBot(message, client);

		expect(result.ok).toBe(true);
	});

	test('fails for bot message', async () => {
		const client = createMockClient();
		const message = createMockMessage({ isBot: true });

		const result = await notBot(message, client);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toContain('Bots');
	});
});

describe('rateLimit LRU eviction', () => {
	beforeEach(() => {
		_rateLimitTesting.clearStore();
		_rateLimitTesting.resetConfig();
	});

	afterEach(() => {
		_rateLimitTesting.clearStore();
		_rateLimitTesting.resetConfig();
	});

	test('evicts oldest entries when store exceeds max capacity', async () => {
		const client = createMockClient();
		// Set low threshold for testing
		_rateLimitTesting.setMaxEntries(5);
		_rateLimitTesting.setEvictionBatchSize(2);

		const guard = rateLimit({ limit: 10, window: 60000 });

		// Add 6 entries (exceeds max of 5)
		for (let i = 0; i < 6; i++) {
			const interaction = createMockInteraction({ userId: `evict-user-${i}` });
			await guard(interaction, client);
		}

		const store = _rateLimitTesting.getStore();

		// Should have evicted oldest entries (excess + batch = 1 + 2 = 3 evicted)
		// 6 entries - 3 evicted = 3 remaining
		expect(store.size).toBe(3);

		// Oldest entries should be gone
		expect(store.has('evict-user-0')).toBe(false);
		expect(store.has('evict-user-1')).toBe(false);
		expect(store.has('evict-user-2')).toBe(false);

		// Newest entries should remain
		expect(store.has('evict-user-3')).toBe(true);
		expect(store.has('evict-user-4')).toBe(true);
		expect(store.has('evict-user-5')).toBe(true);
	});

	test('does not evict when under capacity', async () => {
		const client = createMockClient();
		_rateLimitTesting.setMaxEntries(10);

		const guard = rateLimit({ limit: 10, window: 60000 });

		// Add 5 entries (under max of 10)
		for (let i = 0; i < 5; i++) {
			const interaction = createMockInteraction({ userId: `no-evict-user-${i}` });
			await guard(interaction, client);
		}

		const store = _rateLimitTesting.getStore();
		expect(store.size).toBe(5);
	});

	test('eviction respects LRU order - recently accessed entries are preserved', async () => {
		const client = createMockClient();
		_rateLimitTesting.setMaxEntries(3);
		_rateLimitTesting.setEvictionBatchSize(0); // Only evict exact excess

		const guard = rateLimit({ limit: 10, window: 60000 });

		// Add initial entries: order is user0, user1, user2
		const user0 = createMockInteraction({ userId: 'lru-user-0' });
		const user1 = createMockInteraction({ userId: 'lru-user-1' });
		const user2 = createMockInteraction({ userId: 'lru-user-2' });

		await guard(user0, client);
		await guard(user1, client);
		await guard(user2, client);

		// Access user0 again to move it to end (most recently used)
		// Order is now: user1, user2, user0
		await guard(user0, client);

		// Add new entry to trigger eviction (4 entries, max 3, evict 1)
		// user1 is oldest and should be evicted
		const user3 = createMockInteraction({ userId: 'lru-user-3' });
		await guard(user3, client);

		const store = _rateLimitTesting.getStore();

		// user1 should be evicted (was oldest after user0 was touched)
		expect(store.has('lru-user-1')).toBe(false);

		// user0, user2, user3 should remain
		expect(store.has('lru-user-0')).toBe(true);
		expect(store.has('lru-user-2')).toBe(true);
		expect(store.has('lru-user-3')).toBe(true);
	});
});
