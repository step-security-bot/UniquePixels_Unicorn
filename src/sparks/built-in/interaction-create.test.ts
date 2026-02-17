import { describe, expect, mock, test } from 'bun:test';
import { type Interaction, Events, MessageFlags } from 'discord.js';
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

/** Creates a mock chat input command interaction. */
function createChatInputInteraction(
	commandName: string,
	overrides: Record<string, unknown> = {},
): Interaction {
	return createMockBaseInteraction({
		isChatInputCommand: mock(() => true),
		commandName,
		...overrides,
	});
}

/** Creates a mock autocomplete interaction. */
function createAutocompleteInteraction(
	commandName: string,
): Interaction {
	return createMockBaseInteraction({
		isAutocomplete: mock(() => true),
		commandName,
	});
}

/** Creates a mock message component (button/select) interaction. */
function createComponentInteraction(
	customId: string,
	overrides: Record<string, unknown> = {},
): Interaction {
	return createMockBaseInteraction({
		isMessageComponent: mock(() => true),
		customId,
		...overrides,
	});
}

/** Creates a mock modal submit interaction. */
function createModalInteraction(
	customId: string,
	overrides: Record<string, unknown> = {},
): Interaction {
	return createMockBaseInteraction({
		isModalSubmit: mock(() => true),
		customId,
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

			const interaction = createChatInputInteraction('ping');
			await interactionCreate.execute([interaction], client);

			expect(spark.execute).toHaveBeenCalledTimes(1);
		});

		test('replies with "not available" for unknown commands', async () => {
			const client = createMockClient();
			const interaction = createChatInputInteraction('unknown');
			await interactionCreate.execute([interaction], client);

			expectEphemeralReply(interaction, 'This command is not available.');
		});

		test('logs warning for unknown commands', async () => {
			const client = createMockClient();
			const interaction = createChatInputInteraction('unknown');
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

			const interaction = createChatInputInteraction('kick');
			await interactionCreate.execute([interaction], client);

			expectEphemeralReply(interaction, 'Missing permissions');
		});

		test('does NOT auto-reply guard failure when already replied', async () => {
			const client = createMockClient();
			const spark = createMockCommandSpark({
				execute: failingExecute('Denied'),
			});
			client.commands.set('kick', spark);

			const interaction = createChatInputInteraction('kick', {
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

			const interaction = createChatInputInteraction('kick', {
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

			const interaction = createChatInputInteraction('ping');
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

			const interaction = createAutocompleteInteraction('search');
			await interactionCreate.execute([interaction], client);

			expect(executeAutocomplete).toHaveBeenCalledTimes(1);
		});

		test('silently skips unknown commands (debug log only)', async () => {
			const client = createMockClient();
			const interaction = createAutocompleteInteraction('unknown');
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

			const interaction = createAutocompleteInteraction('ping');
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

			const interaction = createComponentInteraction('confirm-btn');
			await interactionCreate.execute([interaction], client);

			expect(spark.execute).toHaveBeenCalledTimes(1);
		});

		test('replies "no longer available" for unknown components', async () => {
			const client = createMockClient();
			const interaction = createComponentInteraction('unknown-btn');
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

			const interaction = createComponentInteraction('admin-btn');
			await interactionCreate.execute([interaction], client);

			expectEphemeralReply(interaction, 'Admins only');
		});

		test('does NOT auto-reply guard failure when already replied', async () => {
			const client = createMockClient();
			const spark = createMockComponentSpark('admin-btn', {
				execute: failingExecute('Admins only'),
			});
			client.components.set('admin-btn', spark);

			const interaction = createComponentInteraction('admin-btn', {
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

			const interaction = createModalInteraction('feedback-modal');
			await interactionCreate.execute([interaction], client);

			expect(spark.execute).toHaveBeenCalledTimes(1);
		});

		test('replies "no longer available" for unknown modals', async () => {
			const client = createMockClient();
			const interaction = createModalInteraction('unknown-modal');
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

			const interaction = createModalInteraction('admin-modal');
			await interactionCreate.execute([interaction], client);

			expectEphemeralReply(interaction, 'Not authorized');
		});

		test('does NOT auto-reply guard failure when already deferred', async () => {
			const client = createMockClient();
			const spark = createMockComponentSpark('admin-modal', {
				execute: failingExecute('Not authorized'),
			});
			client.components.set('admin-modal', spark);

			const interaction = createModalInteraction('admin-modal', {
				deferred: true,
			});
			await interactionCreate.execute([interaction], client);

			expect(getReplyMock(interaction)).not.toHaveBeenCalled();
		});
	});

	describe('routing dispatch', () => {
		test('does not route non-matching interaction types', async () => {
			const client = createMockClient();
			// All type guards return false by default
			const interaction = createMockBaseInteraction();
			await interactionCreate.execute([interaction], client);

			// No commands or components should be invoked, no replies
			expect(getReplyMock(interaction)).not.toHaveBeenCalled();
		});
	});
});
