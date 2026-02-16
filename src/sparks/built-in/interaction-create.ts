import {
	type AutocompleteInteraction,
	type ChatInputCommandInteraction,
	Events,
	type Interaction,
	type MessageComponentInteraction,
	MessageFlags,
	type ModalSubmitInteraction,
} from 'discord.js';
import type { UnicornClient } from '@/core/client';
import { attempt, isError } from '@/core/lib/attempt';
import {
	defineGatewayEvent,
	findComponentSpark,
	type GatewayEventSpark,
	hasAutocomplete,
} from '@/core/sparks';

/**
 * Routes slash command interactions to the appropriate CommandSpark.
 */
async function handleCommand(
	interaction: ChatInputCommandInteraction,
	client: UnicornClient,
): Promise<void> {
	const spark = client.commands.get(interaction.commandName);

	if (!spark) {
		client.logger.warn(
			{ command: interaction.commandName, user: interaction.user.id },
			'Received interaction for unknown command',
		);

		await interaction.reply({
			content: 'This command is not available.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Execute the spark (guards + action)
	const result = await spark.execute(interaction, client);

	// If guards failed and interaction hasn't been replied to, send error
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
 * Routes message component interactions (buttons, selects) to ComponentSpark.
 */
async function handleComponent(
	interaction: MessageComponentInteraction,
	client: UnicornClient,
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
			'Received interaction for unknown component',
		);

		await interaction.reply({
			content: 'This button/menu is no longer available.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Execute the spark with the component interaction
	// MessageComponentInteraction needs cast to the specific union type expected by execute()
	const result = await spark.execute(
		interaction as Parameters<typeof spark.execute>[0],
		client,
	);

	if (!(result.ok || interaction.replied || interaction.deferred)) {
		await interaction.reply({
			content: result.reason,
			flags: MessageFlags.Ephemeral,
		});
	}
}

/**
 * Routes modal submit interactions to ComponentSpark.
 */
async function handleModal(
	interaction: ModalSubmitInteraction,
	client: UnicornClient,
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
			'Received modal submit for unknown component',
		);

		await interaction.reply({
			content: 'This form is no longer available.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Execute the spark with the modal interaction
	// Note: BaseComponentSpark.execute accepts AnyComponentInteraction which includes ModalSubmitInteraction
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
				() => handleCommand(interaction, client),
				`command:${interaction.commandName}`,
				client,
			);
		} else if (interaction.isAutocomplete()) {
			await safeHandle(
				() => handleAutocomplete(interaction, client),
				`autocomplete:${interaction.commandName}`,
				client,
			);
		} else if (interaction.isMessageComponent()) {
			await safeHandle(
				() => handleComponent(interaction, client),
				`component:${interaction.customId}`,
				client,
			);
		} else if (interaction.isModalSubmit()) {
			await safeHandle(
				() => handleModal(interaction, client),
				`modal:${interaction.customId}`,
				client,
			);
		}
	},
});
