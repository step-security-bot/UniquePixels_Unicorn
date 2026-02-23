import {
	type AutocompleteInteraction,
	type CommandInteraction,
	Events,
	type Interaction,
	MessageFlags,
} from 'discord.js';
import type { UnicornClient } from '@/core/client';
import { attempt, isError } from '@/core/lib/attempt';
import {
	type AnyComponentInteraction,
	defineGatewayEvent,
	findComponentSpark,
	type GatewayEventSpark,
	hasAutocomplete,
} from '@/core/sparks';

/**
 * Routes slash command and context menu interactions to the appropriate CommandSpark.
 */
async function handleCommand(
	interaction: CommandInteraction,
	client: UnicornClient,
	label: string,
): Promise<void> {
	const spark = client.commands.get(interaction.commandName);

	if (!spark) {
		client.logger.warn(
			{ command: interaction.commandName, user: interaction.user.id },
			`Received interaction for unknown ${label}`,
		);

		await interaction.reply({
			content: 'This command is not available.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const result = await spark.execute(interaction, client);

	if (!(result.ok || interaction.replied || interaction.deferred)) {
		await interaction.reply({
			content: result.reason,
			flags: MessageFlags.Ephemeral,
		});
	}
}

/**
 * Routes autocomplete interactions to the appropriate CommandSpark.
 */
async function handleAutocomplete(
	interaction: AutocompleteInteraction,
	client: UnicornClient,
): Promise<void> {
	const spark = client.commands.get(interaction.commandName);

	if (!spark) {
		client.logger.debug(
			{ command: interaction.commandName },
			'Autocomplete for unknown command',
		);
		return;
	}

	if (!hasAutocomplete(spark)) {
		client.logger.debug(
			{ command: interaction.commandName },
			'Command does not support autocomplete',
		);
		return;
	}

	await spark.executeAutocomplete(interaction, client);
}

/**
 * Routes component (button/select) and modal submit interactions to ComponentSpark.
 */
async function handleComponent(
	interaction: AnyComponentInteraction,
	client: UnicornClient,
	label: string,
	notFoundMessage: string,
): Promise<void> {
	const spark = findComponentSpark(
		client.components,
		client.componentPatterns,
		interaction.customId,
		client.logger,
	);

	if (!spark) {
		client.logger.debug(
			{ customId: interaction.customId, user: interaction.user.id },
			`Received interaction for unknown ${label}`,
		);

		await interaction.reply({
			content: notFoundMessage,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const result = await spark.execute(interaction, client);

	if (!(result.ok || interaction.replied || interaction.deferred)) {
		await interaction.reply({
			content: result.reason,
			flags: MessageFlags.Ephemeral,
		});
	}
}

/**
 * Safely runs an async handler, logging any errors.
 */
async function safeHandle(
	handler: () => Promise<void>,
	context: string,
	client: UnicornClient,
): Promise<void> {
	const result = await attempt(handler);
	if (isError(result)) {
		client.logger.error(
			{ err: result.error, context },
			'Interaction handler failed',
		);
	}
}

/**
 * Built-in spark that routes interactions to the appropriate handler.
 *
 * This spark listens for the InteractionCreate event and dispatches
 * interactions to the registered CommandSpark or ComponentSpark based
 * on the interaction type and identifier.
 *
 * Routing logic:
 * - Chat commands → CommandSpark by command name
 * - Autocomplete → CommandSparkWithAutocomplete.autocomplete()
 * - Context menus → CommandSpark by command name (user/message commands)
 * - Buttons/Selects → ComponentSpark by customId (supports patterns)
 * - Modal submits → ComponentSpark by customId (supports patterns)
 */
export const interactionCreate: GatewayEventSpark<
	typeof Events.InteractionCreate
> = defineGatewayEvent({
	event: Events.InteractionCreate,
	once: false,
	action: async (interaction: Interaction, client: UnicornClient) => {
		// Route based on interaction type, wrapped in safe error handling
		if (interaction.isChatInputCommand()) {
			await safeHandle(
				() => handleCommand(interaction, client, 'command'),
				`command:${interaction.commandName}`,
				client,
			);
		} else if (interaction.isAutocomplete()) {
			await safeHandle(
				() => handleAutocomplete(interaction, client),
				`autocomplete:${interaction.commandName}`,
				client,
			);
		} else if (interaction.isContextMenuCommand()) {
			await safeHandle(
				() => handleCommand(interaction, client, 'context menu command'),
				`context-menu:${interaction.commandName}`,
				client,
			);
		} else if (interaction.isMessageComponent()) {
			await safeHandle(
				() =>
					handleComponent(
						interaction,
						client,
						'component',
						'This button/menu is no longer available.',
					),
				`component:${interaction.customId}`,
				client,
			);
		} else if (interaction.isModalSubmit()) {
			await safeHandle(
				() =>
					handleComponent(
						interaction,
						client,
						'modal',
						'This form is no longer available.',
					),
				`modal:${interaction.customId}`,
				client,
			);
		}
	},
});
