import { describe, expect, mock, test } from 'bun:test';
import {
	ApplicationCommandType,
	type ChatInputCommandInteraction,
	type ContextMenuCommandInteraction,
	type SlashCommandBuilder,
} from 'discord.js';
import type { Guard } from '@/core/guards';
import {
	createMockAutocompleteInteraction,
	createMockChatInputInteraction,
	createMockClient,
	failGuard,
	passThroughGuard,
} from '@/core/lib/test-helpers';
import {
	defineCommand,
	defineCommandWithAutocomplete,
	hasAutocomplete,
} from './command';

// ─── Test Helpers ────────────────────────────────────────────────

function createMockCommand(name: string) {
	return { name } as unknown as SlashCommandBuilder;
}

/** Creates a mock ContextMenuCommandBuilder (has `type` property). */
function createMockContextMenuCommand(name: string) {
	return { name, type: ApplicationCommandType.Message } as unknown as SlashCommandBuilder;
}

/** Creates a mock context menu interaction with targetMessage. */
function createMockContextMenuInteraction(mockClient?: ReturnType<typeof createMockClient>) {
	return {
		commandName: 'Report Message',
		user: { id: '123456789012345678' },
		replied: false,
		deferred: false,
		reply: mock(async () => {}),
		isContextMenuCommand: () => true,
		targetId: '999888777666555444',
		targetMessage: { id: '999888777666555444', content: 'test' },
		client: mockClient ?? createMockClient(),
	} as unknown as ContextMenuCommandInteraction;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('defineCommand', () => {
	test('creates spark with correct type', () => {
		const spark = defineCommand({
			command: createMockCommand('ping'),
			action: async () => {},
		});

		expect(spark.type).toBe('command');
	});

	test('derives id from command builder name', () => {
		const spark = defineCommand({
			command: createMockCommand('ping'),
			action: async () => {},
		});

		expect(spark.id).toBe('ping');
	});

	test('stores command builder reference', () => {
		const builder = createMockCommand('ping');
		const spark = defineCommand({
			command: builder,
			action: async () => {},
		});

		expect(spark.command).toBe(builder);
	});

	test('defaults guards to empty array when omitted', () => {
		const spark = defineCommand({
			command: createMockCommand('ping'),
			action: async () => {},
		});

		expect(spark.guards).toEqual([]);
	});

	test('preserves provided guards', () => {
		const guard = passThroughGuard();
		const spark = defineCommand({
			command: createMockCommand('ping'),
			guards: [guard],
			action: async () => {},
		});

		expect(spark.guards).toHaveLength(1);
		expect(spark.guards[0]).toBe(guard);
	});

	test('stores action reference', () => {
		const action = mock(async () => {});
		const spark = defineCommand({
			command: createMockCommand('ping'),
			action,
		});

		expect(spark.action).toBe(action);
	});

	describe('execute', () => {
		test('calls action when no guards are defined', async () => {
			const action = mock(async () => {});
			const spark = defineCommand({
				command: createMockCommand('ping'),
				action,
			});

			const interaction = createMockChatInputInteraction();
			const result = await spark.execute(interaction);

			expect(result.ok).toBe(true);
			expect(action).toHaveBeenCalledTimes(1);
			expect(action).toHaveBeenCalledWith(interaction);
		});

		test('runs guards and calls action on success', async () => {
			const guard = passThroughGuard();
			const action = mock(async () => {});
			const spark = defineCommand({
				command: createMockCommand('ping'),
				guards: [guard],
				action,
			});

			const interaction = createMockChatInputInteraction();
			const result = await spark.execute(interaction);

			expect(result.ok).toBe(true);
			expect(guard).toHaveBeenCalledTimes(1);
			expect(action).toHaveBeenCalledTimes(1);
		});

		test('returns guard failure and does NOT call action', async () => {
			const guard = failGuard('Not allowed');
			const action = mock(async () => {});
			const spark = defineCommand({
				command: createMockCommand('ping'),
				guards: [guard],
				action,
			});

			const interaction = createMockChatInputInteraction();
			const result = await spark.execute(interaction);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe('Not allowed');
			}
			expect(action).not.toHaveBeenCalled();
		});

		test('logs debug on guard failure', async () => {
			const guard = failGuard('Denied');
			const spark = defineCommand({
				command: createMockCommand('ping'),
				guards: [guard],
				action: async () => {},
			});

			const client = createMockClient();
			const interaction = createMockChatInputInteraction({ client });
			await spark.execute(interaction);

			expect(client.logger.debug).toHaveBeenCalledWith(
				{ command: 'ping', reason: 'Denied' },
				'Command guard failed',
			);
		});

		test('logs error when action throws', async () => {
			const spark = defineCommand({
				command: createMockCommand('ping'),
				action: async () => {
					throw new Error('Action broke');
				},
			});

			const client = createMockClient();
			await spark.execute(createMockChatInputInteraction({ client }));

			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ command: 'ping' }),
				'Command action failed',
			);
		});

		test('returns ok result even when action throws', async () => {
			const spark = defineCommand({
				command: createMockCommand('ping'),
				action: async () => {
					throw new Error('boom');
				},
			});

			const result = await spark.execute(createMockChatInputInteraction());

			// Guard passed, so result is ok even though action failed
			expect(result.ok).toBe(true);
		});

		test('short-circuits on first guard failure with multiple guards', async () => {
			const guard1 = failGuard('First failed');
			const guard2 = passThroughGuard();
			const action = mock(async () => {});
			const spark = defineCommand({
				command: createMockCommand('ping'),
				guards: [guard1, guard2],
				action,
			});

			await spark.execute(createMockChatInputInteraction());

			expect(guard1).toHaveBeenCalledTimes(1);
			expect(guard2).not.toHaveBeenCalled();
			expect(action).not.toHaveBeenCalled();
		});

		test('passes narrowed value through guard chain', async () => {
			// Use the guard as unknown to bypass strict typing for test purposes
			const guard1 = mock(
				(input: ChatInputCommandInteraction) =>
					({
						ok: true as const,
						value: Object.assign(Object.create(input), {
							extra: 'data',
						}),
					}) as const,
			) as unknown as Guard<
				ChatInputCommandInteraction,
				ChatInputCommandInteraction
			>;
			const guard2 = mock(
				(input: ChatInputCommandInteraction) =>
					({ ok: true as const, value: input }) as const,
			) as unknown as Guard<
				ChatInputCommandInteraction,
				ChatInputCommandInteraction
			>;
			const action = mock(async () => {});
			const spark = defineCommand({
				command: createMockCommand('ping'),
				guards: [guard1, guard2],
				action,
			});

			await spark.execute(createMockChatInputInteraction());

			// guard2 should receive the output of guard1
			const guard2Calls = (guard2 as ReturnType<typeof mock>).mock.calls;
			expect(guard2Calls).toHaveLength(1);
			const guard2Input = guard2Calls[0]?.[0] as Record<
				string,
				unknown
			>;
			expect(guard2Input).toHaveProperty('extra', 'data');
		});

		test('handles async guards', async () => {
			const guard = mock(
				async (input: ChatInputCommandInteraction) =>
					({ ok: true as const, value: input }) as const,
			) as unknown as Guard<
				ChatInputCommandInteraction,
				ChatInputCommandInteraction
			>;
			const action = mock(async () => {});
			const spark = defineCommand({
				command: createMockCommand('ping'),
				guards: [guard],
				action,
			});

			const result = await spark.execute(createMockChatInputInteraction());

			expect(result.ok).toBe(true);
			expect(action).toHaveBeenCalledTimes(1);
		});
	});

	describe('context menu commands', () => {
		test('execute accepts a context menu interaction', async () => {
			const action = mock(async () => {});
			const spark = defineCommand({
				command: createMockContextMenuCommand('Report Message'),
				action,
			});

			const interaction = createMockContextMenuInteraction();
			const result = await spark.execute(interaction);

			expect(result.ok).toBe(true);
			expect(action).toHaveBeenCalledTimes(1);
			expect(action).toHaveBeenCalledWith(interaction);
		});

		test('runs guards on context menu interaction', async () => {
			const guard = passThroughGuard();
			const action = mock(async () => {});
			const spark = defineCommand({
				command: createMockContextMenuCommand('Report Message'),
				guards: [guard],
				action,
			});

			const interaction = createMockContextMenuInteraction();
			const result = await spark.execute(interaction);

			expect(result.ok).toBe(true);
			expect(guard).toHaveBeenCalledTimes(1);
			expect(action).toHaveBeenCalledTimes(1);
		});

		test('rejects mismatched interaction type (context menu builder + slash interaction)', async () => {
			const action = mock(async () => {});
			const spark = defineCommand({
				command: createMockContextMenuCommand('Report Message'),
				action,
			});

			const client = createMockClient();
			// Chat input interaction with isContextMenuCommand returning false
			const interaction = createMockChatInputInteraction({
				commandName: 'Report Message',
				client,
			});
			Object.assign(interaction, { isContextMenuCommand: () => false });
			const result = await spark.execute(interaction);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe('Interaction type mismatch.');
			}
			expect(action).not.toHaveBeenCalled();
			expect(client.logger.warn).toHaveBeenCalledWith(
				{ command: 'Report Message' },
				'Interaction type does not match command registration',
			);
		});

		test('rejects mismatched interaction type (slash builder + context menu interaction)', async () => {
			const action = mock(async () => {});
			const spark = defineCommand({
				command: createMockCommand('Report Message'),
				action,
			});

			const client = createMockClient();
			const interaction = createMockContextMenuInteraction(client);
			const result = await spark.execute(interaction);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe('Interaction type mismatch.');
			}
			expect(action).not.toHaveBeenCalled();
			expect(client.logger.warn).toHaveBeenCalledWith(
				{ command: 'Report Message' },
				'Interaction type does not match command registration',
			);
		});

		test('returns guard failure and does NOT call action for context menu', async () => {
			const guard = failGuard('Not allowed');
			const action = mock(async () => {});
			const spark = defineCommand({
				command: createMockContextMenuCommand('Report Message'),
				guards: [guard],
				action,
			});

			const interaction = createMockContextMenuInteraction();
			const result = await spark.execute(interaction);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe('Not allowed');
			}
			expect(action).not.toHaveBeenCalled();
		});
	});

	describe('register', () => {
		test('adds spark to client.commands collection', () => {
			const spark = defineCommand({
				command: createMockCommand('ping'),
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			expect(client.commands.has('ping')).toBe(true);
			expect(client.commands.get('ping')).toBeDefined();
		});

	});
});

describe('defineCommandWithAutocomplete', () => {
	test('creates spark with correct type and id', () => {
		const spark = defineCommandWithAutocomplete({
			command: createMockCommand('search'),
			autocomplete: async () => {},
			action: async () => {},
		});

		expect(spark.type).toBe('command');
		expect(spark.id).toBe('search');
	});

	test('attaches autocomplete handler', () => {
		const autocomplete = mock(async () => {});
		const spark = defineCommandWithAutocomplete({
			command: createMockCommand('search'),
			autocomplete,
			action: async () => {},
		});

		expect(spark.autocomplete).toBe(autocomplete);
	});

	test('preserves guards from options', () => {
		const guard = passThroughGuard();
		const spark = defineCommandWithAutocomplete({
			command: createMockCommand('search'),
			guards: [guard],
			autocomplete: async () => {},
			action: async () => {},
		});

		expect(spark.guards).toHaveLength(1);
	});

	test('execute runs guards and action like defineCommand', async () => {
		const action = mock(async () => {});
		const spark = defineCommandWithAutocomplete({
			command: createMockCommand('search'),
			autocomplete: async () => {},
			action,
		});

		const result = await spark.execute(createMockChatInputInteraction());

		expect(result.ok).toBe(true);
		expect(action).toHaveBeenCalledTimes(1);
	});

	describe('executeAutocomplete', () => {
		test('calls the autocomplete handler', async () => {
			const autocomplete = mock(async () => {});
			const spark = defineCommandWithAutocomplete({
				command: createMockCommand('search'),
				autocomplete,
				action: async () => {},
			});

			const acInteraction = createMockAutocompleteInteraction();
			await spark.executeAutocomplete!(acInteraction);

			expect(autocomplete).toHaveBeenCalledTimes(1);
			expect(autocomplete).toHaveBeenCalledWith(acInteraction);
		});

		test('logs warn when autocomplete handler throws', async () => {
			const spark = defineCommandWithAutocomplete({
				command: createMockCommand('search'),
				autocomplete: async () => {
					throw new Error('autocomplete broke');
				},
				action: async () => {},
			});

			const client = createMockClient();
			await spark.executeAutocomplete!(
				createMockAutocompleteInteraction({ client }),
			);

			expect(client.logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ command: 'search' }),
				'Autocomplete handler failed',
			);
		});

		test('does not throw when autocomplete handler throws', async () => {
			const spark = defineCommandWithAutocomplete({
				command: createMockCommand('search'),
				autocomplete: async () => {
					throw new Error('boom');
				},
				action: async () => {},
			});

			// Should not throw
			await spark.executeAutocomplete!(
				createMockAutocompleteInteraction(),
			);
		});
	});

	describe('register', () => {
		test('adds spark to client.commands', () => {
			const spark = defineCommandWithAutocomplete({
				command: createMockCommand('search'),
				autocomplete: async () => {},
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			expect(client.commands.has('search')).toBe(true);
		});

	});
});

describe('hasAutocomplete', () => {
	test('returns true for sparks with autocomplete', () => {
		const spark = defineCommandWithAutocomplete({
			command: createMockCommand('search'),
			autocomplete: async () => {},
			action: async () => {},
		});

		expect(hasAutocomplete(spark)).toBe(true);
	});

	test('returns false for sparks without autocomplete', () => {
		const spark = defineCommand({
			command: createMockCommand('ping'),
			action: async () => {},
		});

		expect(hasAutocomplete(spark)).toBe(false);
	});
});
