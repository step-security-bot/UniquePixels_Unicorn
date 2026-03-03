import { describe, expect, mock, test } from 'bun:test';
import { type Client, type Interaction, Events, MessageFlags } from 'discord.js';
import type { BaseCommandSpark } from '@/core/sparks/command';
import type { BaseComponentSpark } from '@/core/sparks/component';
import { createMockBaseInteraction, createMockClient } from '@/core/lib/test-helpers';
import { interactionCreate } from './interaction-create';

// ─── Test Helpers ────────────────────────────────────────────────

/** Creates a mock command spark with optional overrides. */
function createMockCommandSpark(
	overrides: Partial<BaseCommandSpark> = {},
): BaseCommandSpark {
	return {
		type: 'command',
		id: 'test',
		command: { name: 'test' },
		execute: mock(async () => ({ ok: true, value: {} })),
		register: mock(() => {}),
		...overrides,
	} as unknown as BaseCommandSpark;
}

/** Creates a mock component spark with the given ID and optional overrides. */
function createMockComponentSpark(
	id: string,
	overrides: Partial<BaseComponentSpark> = {},
): BaseComponentSpark {
	return {
		type: 'component',
		id,
		key: id,
		matches: mock((customId: string) => customId === id),
		execute: mock(async () => ({ ok: true, value: {} })),
		register: mock(() => {}),
		...overrides,
	} as unknown as BaseComponentSpark;
}

/** Creates a mock chat input command interaction with the given client. */
function createChatInputInteraction(
	commandName: string,
	client: Client,
	overrides: Record<string, unknown> = {},
): Interaction {
	return createMockBaseInteraction({
		isChatInputCommand: mock(() => true),
		commandName,
		client,
		...overrides,
	});
}

/** Creates a mock autocomplete interaction with the given client. */
function createAutocompleteInteraction(
	commandName: string,
	client: Client,
): Interaction {
	return createMockBaseInteraction({
		isAutocomplete: mock(() => true),
		commandName,
		client,
	});
}

/** Creates a mock message component (button/select) interaction with the given client. */
function createComponentInteraction(
	customId: string,
	client: Client,
	overrides: Record<string, unknown> = {},
): Interaction {
	return createMockBaseInteraction({
		isMessageComponent: mock(() => true),
		customId,
		client,
		...overrides,
	});
}

/** Creates a mock modal submit interaction with the given client. */
function createModalInteraction(
	customId: string,
	client: Client,
	overrides: Record<string, unknown> = {},
): Interaction {
	return createMockBaseInteraction({
		isModalSubmit: mock(() => true),
		customId,
		client,
		...overrides,
	});
}

/** Creates a mock context menu command interaction with the given client. */
function createContextMenuInteraction(
	commandName: string,
	client: Client,
	overrides: Record<string, unknown> = {},
): Interaction {
	return createMockBaseInteraction({
		isContextMenuCommand: mock(() => true),
		commandName,
		client,
		...overrides,
	});
}

/** Extracts the reply mock from an interaction. */
function getReplyMock(interaction: Interaction) {
	return (interaction as unknown as { reply: ReturnType<typeof mock> })
		.reply;
}

/** Asserts the interaction received an ephemeral reply with the given content. */
function expectEphemeralReply(interaction: Interaction, content: string) {
	expect(getReplyMock(interaction)).toHaveBeenCalledWith({
		content,
		flags: MessageFlags.Ephemeral,
	});
}

/** Creates a mock execute that returns a guard failure with the given reason. */
function failingExecute(reason: string) {
	return mock(async () => ({ ok: false as const, reason }));
}

// ─── Tests ───────────────────────────────────────────────────────

describe('interactionCreate', () => {
	test('has correct type and event', () => {
		expect(interactionCreate.type).toBe('gateway-event');
		expect(interactionCreate.event).toBe(Events.InteractionCreate);
		expect(interactionCreate.once).toBe(false);
	});

	describe('command routing', () => {
		test('routes chat input command to matching command spark', async () => {
			const client = createMockClient();
			const spark = createMockCommandSpark();
			client.commands.set('ping', spark);

			const interaction = createChatInputInteraction('ping', client);
			await interactionCreate.execute([interaction], client);

			expect(spark.execute).toHaveBeenCalledTimes(1);
		});

		test('replies with "not available" for unknown commands', async () => {
			const client = createMockClient();
			const interaction = createChatInputInteraction('unknown', client);
			await interactionCreate.execute([interaction], client);

			expectEphemeralReply(interaction, 'This command is not available.');
		});

		test('logs warning for unknown commands', async () => {
			const client = createMockClient();
			const interaction = createChatInputInteraction('unknown', client);
			await interactionCreate.execute([interaction], client);

			expect(client.logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ command: 'unknown' }),
				'Received interaction for unknown command',
			);
		});

		test('auto-replies guard failure reason when not yet replied', async () => {
			const client = createMockClient();
			const spark = createMockCommandSpark({
				execute: failingExecute('Missing permissions'),
			});
			client.commands.set('kick', spark);

			const interaction = createChatInputInteraction('kick', client);
			await interactionCreate.execute([interaction], client);

			expectEphemeralReply(interaction, 'Missing permissions');
		});

		test('does NOT auto-reply guard failure when already replied', async () => {
			const client = createMockClient();
			const spark = createMockCommandSpark({
				execute: failingExecute('Denied'),
			});
			client.commands.set('kick', spark);

			const interaction = createChatInputInteraction('kick', client, {
				replied: true,
			});
			await interactionCreate.execute([interaction], client);

			expect(getReplyMock(interaction)).not.toHaveBeenCalled();
		});

		test('does NOT auto-reply guard failure when already deferred', async () => {
			const client = createMockClient();
			const spark = createMockCommandSpark({
				execute: failingExecute('Denied'),
			});
			client.commands.set('kick', spark);

			const interaction = createChatInputInteraction('kick', client, {
				deferred: true,
			});
			await interactionCreate.execute([interaction], client);

			expect(getReplyMock(interaction)).not.toHaveBeenCalled();
		});

		test('logs error when handler throws', async () => {
			const client = createMockClient();
			const spark = createMockCommandSpark({
				execute: mock(async () => {
					throw new Error('handler broke');
				}),
			});
			client.commands.set('ping', spark);

			const interaction = createChatInputInteraction('ping', client);
			await interactionCreate.execute([interaction], client);

			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ context: 'command:ping' }),
				'Interaction handler failed',
			);
		});
	});

	describe('autocomplete routing', () => {
		test('routes autocomplete to command with executeAutocomplete', async () => {
			const client = createMockClient();
			const executeAutocomplete = mock(async () => {});
			const spark = createMockCommandSpark({
				autocomplete: mock(async () => {}),
				executeAutocomplete,
			});
			client.commands.set('search', spark);

			const interaction = createAutocompleteInteraction('search', client);
			await interactionCreate.execute([interaction], client);

			expect(executeAutocomplete).toHaveBeenCalledTimes(1);
		});

		test('silently skips unknown commands (debug log only)', async () => {
			const client = createMockClient();
			const interaction = createAutocompleteInteraction('unknown', client);
			await interactionCreate.execute([interaction], client);

			expect(client.logger.debug).toHaveBeenCalledWith(
				expect.objectContaining({ command: 'unknown' }),
				'Autocomplete for unknown command',
			);
			// Should not reply or error
			expect(getReplyMock(interaction)).not.toHaveBeenCalled();
		});

		test('silently skips commands without autocomplete', async () => {
			const client = createMockClient();
			const spark = createMockCommandSpark();
			// No autocomplete property
			client.commands.set('ping', spark);

			const interaction = createAutocompleteInteraction('ping', client);
			await interactionCreate.execute([interaction], client);

			expect(client.logger.debug).toHaveBeenCalledWith(
				expect.objectContaining({ command: 'ping' }),
				'Command does not support autocomplete',
			);
		});
	});

	describe('component routing', () => {
		test('routes button/select to matching component spark', async () => {
			const client = createMockClient();
			const spark = createMockComponentSpark('confirm-btn');
			client.components.set('confirm-btn', spark);

			const interaction = createComponentInteraction('confirm-btn', client);
			await interactionCreate.execute([interaction], client);

			expect(spark.execute).toHaveBeenCalledTimes(1);
		});

		test('replies "no longer available" for unknown components', async () => {
			const client = createMockClient();
			const interaction = createComponentInteraction('unknown-btn', client);
			await interactionCreate.execute([interaction], client);

			expectEphemeralReply(
				interaction,
				'This button/menu is no longer available.',
			);
		});

		test('auto-replies guard failure reason when not yet replied', async () => {
			const client = createMockClient();
			const spark = createMockComponentSpark('admin-btn', {
				execute: failingExecute('Admins only'),
			});
			client.components.set('admin-btn', spark);

			const interaction = createComponentInteraction('admin-btn', client);
			await interactionCreate.execute([interaction], client);

			expectEphemeralReply(interaction, 'Admins only');
		});

		test('does NOT auto-reply guard failure when already replied', async () => {
			const client = createMockClient();
			const spark = createMockComponentSpark('admin-btn', {
				execute: failingExecute('Admins only'),
			});
			client.components.set('admin-btn', spark);

			const interaction = createComponentInteraction('admin-btn', client, {
				replied: true,
			});
			await interactionCreate.execute([interaction], client);

			expect(getReplyMock(interaction)).not.toHaveBeenCalled();
		});
	});

	describe('modal routing', () => {
		test('routes modal submit to matching component spark', async () => {
			const client = createMockClient();
			const spark = createMockComponentSpark('feedback-modal');
			client.components.set('feedback-modal', spark);

			const interaction = createModalInteraction('feedback-modal', client);
			await interactionCreate.execute([interaction], client);

			expect(spark.execute).toHaveBeenCalledTimes(1);
		});

		test('replies "no longer available" for unknown modals', async () => {
			const client = createMockClient();
			const interaction = createModalInteraction('unknown-modal', client);
			await interactionCreate.execute([interaction], client);

			expectEphemeralReply(
				interaction,
				'This form is no longer available.',
			);
		});

		test('auto-replies guard failure reason when not yet replied', async () => {
			const client = createMockClient();
			const spark = createMockComponentSpark('admin-modal', {
				execute: failingExecute('Not authorized'),
			});
			client.components.set('admin-modal', spark);

			const interaction = createModalInteraction('admin-modal', client);
			await interactionCreate.execute([interaction], client);

			expectEphemeralReply(interaction, 'Not authorized');
		});

		test('does NOT auto-reply guard failure when already deferred', async () => {
			const client = createMockClient();
			const spark = createMockComponentSpark('admin-modal', {
				execute: failingExecute('Not authorized'),
			});
			client.components.set('admin-modal', spark);

			const interaction = createModalInteraction('admin-modal', client, {
				deferred: true,
			});
			await interactionCreate.execute([interaction], client);

			expect(getReplyMock(interaction)).not.toHaveBeenCalled();
		});
	});

	describe('context menu routing', () => {
		test('routes context menu command to matching command spark', async () => {
			const client = createMockClient();
			const spark = createMockCommandSpark();
			client.commands.set('Report Message', spark);

			const interaction = createContextMenuInteraction('Report Message', client);
			await interactionCreate.execute([interaction], client);

			expect(spark.execute).toHaveBeenCalledTimes(1);
		});

		test('replies with "not available" for unknown context menu commands', async () => {
			const client = createMockClient();
			const interaction = createContextMenuInteraction('Unknown', client);
			await interactionCreate.execute([interaction], client);

			expectEphemeralReply(interaction, 'This command is not available.');
		});

		test('logs warning for unknown context menu commands', async () => {
			const client = createMockClient();
			const interaction = createContextMenuInteraction('Unknown', client);
			await interactionCreate.execute([interaction], client);

			expect(client.logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ command: 'Unknown' }),
				'Received interaction for unknown context menu command',
			);
		});

		test('auto-replies guard failure reason when not yet replied', async () => {
			const client = createMockClient();
			const spark = createMockCommandSpark({
				execute: failingExecute('Missing permissions'),
			});
			client.commands.set('Ban User', spark);

			const interaction = createContextMenuInteraction('Ban User', client);
			await interactionCreate.execute([interaction], client);

			expectEphemeralReply(interaction, 'Missing permissions');
		});

		test('does NOT auto-reply guard failure when already replied', async () => {
			const client = createMockClient();
			const spark = createMockCommandSpark({
				execute: failingExecute('Denied'),
			});
			client.commands.set('Ban User', spark);

			const interaction = createContextMenuInteraction('Ban User', client, {
				replied: true,
			});
			await interactionCreate.execute([interaction], client);

			expect(getReplyMock(interaction)).not.toHaveBeenCalled();
		});

		test('does NOT auto-reply guard failure when already deferred', async () => {
			const client = createMockClient();
			const spark = createMockCommandSpark({
				execute: failingExecute('Denied'),
			});
			client.commands.set('Ban User', spark);

			const interaction = createContextMenuInteraction('Ban User', client, {
				deferred: true,
			});
			await interactionCreate.execute([interaction], client);

			expect(getReplyMock(interaction)).not.toHaveBeenCalled();
		});

		test('logs error when handler throws', async () => {
			const client = createMockClient();
			const spark = createMockCommandSpark({
				execute: mock(async () => {
					throw new Error('handler broke');
				}),
			});
			client.commands.set('Report Message', spark);

			const interaction = createContextMenuInteraction('Report Message', client);
			await interactionCreate.execute([interaction], client);

			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ context: 'context-menu:Report Message' }),
				'Interaction handler failed',
			);
		});
	});

	describe('routing dispatch', () => {
		test('does not route non-matching interaction types', async () => {
			const client = createMockClient();
			// All type guards return false by default
			const interaction = createMockBaseInteraction({ client });
			await interactionCreate.execute([interaction], client);

			// No commands or components should be invoked, no replies
			expect(getReplyMock(interaction)).not.toHaveBeenCalled();
		});
	});
});
