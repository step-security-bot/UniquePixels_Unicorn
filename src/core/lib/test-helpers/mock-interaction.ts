/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: Test mocking */
import { mock } from 'bun:test';
import type {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	Interaction,
	Message,
} from 'discord.js';
import type { AnyComponentInteraction } from '@/core/sparks/component';
import type { ReadyClient } from '@/core/sparks/gateway-event';

export function createMockChatInputInteraction(
	overrides: {
		commandName?: string;
		userId?: string;
		replied?: boolean;
		deferred?: boolean;
		options?: Record<string, unknown>;
		createdTimestamp?: number;
		reply?: ReturnType<typeof mock>;
		editReply?: ReturnType<typeof mock>;
		fetchReply?: ReturnType<typeof mock>;
	} = {},
): ChatInputCommandInteraction {
	const optionsData = overrides.options ?? {};

	return {
		commandName: overrides.commandName ?? 'test',
		user: { id: overrides.userId ?? '123456789012345678' },
		replied: overrides.replied ?? false,
		deferred: overrides.deferred ?? false,
		createdTimestamp: overrides.createdTimestamp ?? Date.now(),
		reply: overrides.reply ?? mock(async () => {}),
		editReply: overrides.editReply ?? mock(async () => {}),
		fetchReply: overrides.fetchReply ?? mock(async () => ({})),
		options: {
			getString: mock((name: string) => optionsData[name] ?? null),
			getInteger: mock((name: string) => optionsData[name] ?? null),
			getNumber: mock((name: string) => optionsData[name] ?? null),
			getBoolean: mock((name: string) => optionsData[name] ?? null),
			getUser: mock((name: string) => optionsData[name] ?? null),
			getChannel: mock((name: string) => optionsData[name] ?? null),
			getRole: mock((name: string) => optionsData[name] ?? null),
			getMentionable: mock((name: string) => optionsData[name] ?? null),
			getAttachment: mock((name: string) => optionsData[name] ?? null),
			getSubcommand: mock(() => optionsData['subcommand'] ?? null),
			getSubcommandGroup: mock(() => optionsData['subcommandGroup'] ?? null),
		},
	} as unknown as ChatInputCommandInteraction;
}

export function createMockAutocompleteInteraction(
	overrides: {
		commandName?: string;
		focusedValue?: string;
		userId?: string;
	} = {},
): AutocompleteInteraction {
	return {
		commandName: overrides.commandName ?? 'test',
		user: { id: overrides.userId ?? '123456789012345678' },
		options: {
			getFocused: mock(() => overrides.focusedValue ?? ''),
		},
		respond: mock(async () => {}),
	} as unknown as AutocompleteInteraction;
}

export function createMockComponentInteraction(
	customId: string,
	overrides: {
		userId?: string;
		replied?: boolean;
		deferred?: boolean;
	} = {},
): AnyComponentInteraction {
	return {
		customId,
		user: { id: overrides.userId ?? '123456789012345678' },
		replied: overrides.replied ?? false,
		deferred: overrides.deferred ?? false,
		reply: mock(async () => {}),
		deferUpdate: mock(async () => {}),
		update: mock(async () => {}),
		deferReply: mock(async () => {}),
		editReply: mock(async () => {}),
	} as unknown as AnyComponentInteraction;
}

export function createMockBaseInteraction(
	overrides: Record<string, unknown> = {},
): Interaction {
	return {
		...overrides,
		isChatInputCommand: overrides['isChatInputCommand'] ?? mock(() => false),
		isAutocomplete: overrides['isAutocomplete'] ?? mock(() => false),
		isMessageComponent: overrides['isMessageComponent'] ?? mock(() => false),
		isModalSubmit: overrides['isModalSubmit'] ?? mock(() => false),
		user: overrides['user'] ?? { id: '123456789012345678' },
		replied: overrides['replied'] ?? false,
		deferred: overrides['deferred'] ?? false,
		reply: overrides['reply'] ?? mock(async () => {}),
	} as unknown as Interaction;
}

export function createMockMessage(
	overrides: { inGuild?: boolean; isBot?: boolean; authorId?: string } = {},
): Message {
	const inGuild = overrides.inGuild ?? true;
	return {
		inGuild: () => inGuild,
		author: {
			id: overrides.authorId ?? '123456789012345678',
			bot: overrides.isBot ?? false,
		},
		guildId: inGuild ? '987654321098765432' : null,
	} as unknown as Message;
}

export function createMockReadyClient(
	overrides: { userTag?: string; guildCount?: number } = {},
): ReadyClient {
	return {
		user: { tag: overrides.userTag ?? 'TestBot#1234' },
		guilds: { cache: { size: overrides.guildCount ?? 0 } },
	} as unknown as ReadyClient;
}
