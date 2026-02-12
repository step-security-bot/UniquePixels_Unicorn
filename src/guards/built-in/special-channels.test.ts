import { describe, expect, test } from 'bun:test';
import type { Guild, GuildTextBasedChannel } from 'discord.js';
import { PermissionsBitField } from 'discord.js';
import type { GuardResult } from '@/core/guards';
import { createMockClient } from '@/core/lib/test-helpers';
import {
	hasPublicUpdatesChannel,
	hasRulesChannel,
	hasSafetyAlertsChannel,
	hasSystemChannel,
} from './special-channels';

type SpecialChannelKey =
	| 'systemChannel'
	| 'publicUpdatesChannel'
	| 'rulesChannel'
	| 'safetyAlertsChannel';

// Helper to extract failure reason from guard result
function getFailureReason(result: GuardResult<unknown>): string {
	if (result.ok) {
		throw new Error('Expected failure result but got success');
	}
	return result.reason;
}

// Helper to create mock input with guild and special channels
function createMockGuildInput(
	channelKey: SpecialChannelKey,
	channelExists: boolean,
	botHasPermissions: boolean,
	botMemberAvailable: boolean,
) {
	const channel = channelExists
		? ({ id: '123' } as GuildTextBasedChannel)
		: null;

	const botMember = botMemberAvailable
		? {
				permissionsIn: () =>
					new PermissionsBitField(
						botHasPermissions ? [PermissionsBitField.Flags.SendMessages] : [],
					),
			}
		: null;

	return {
		guild: {
			[channelKey]: channel,
			members: { me: botMember },
		} as unknown as Guild,
	};
}

// Test cases for all special channel guards
const guardTestCases = [
	{
		name: 'hasSystemChannel',
		guard: hasSystemChannel,
		channelKey: 'systemChannel' as const,
		channelName: 'system channel',
	},
	{
		name: 'hasPublicUpdatesChannel',
		guard: hasPublicUpdatesChannel,
		channelKey: 'publicUpdatesChannel' as const,
		channelName: 'public updates channel',
	},
	{
		name: 'hasRulesChannel',
		guard: hasRulesChannel,
		channelKey: 'rulesChannel' as const,
		channelName: 'rules channel',
	},
	{
		name: 'hasSafetyAlertsChannel',
		guard: hasSafetyAlertsChannel,
		channelKey: 'safetyAlertsChannel' as const,
		channelName: 'safety alerts channel',
	},
] as const;

// Run the same test suite for each special channel guard
for (const { name, guard, channelKey, channelName } of guardTestCases) {
	describe(name, () => {
		test('passes when channel exists and bot has permission', async () => {
			const client = createMockClient();
			const input = createMockGuildInput(channelKey, true, true, true);

			const result = await guard(input, client);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.guild[channelKey]).toBeDefined();
			}
		});

		test('fails when channel is not configured', async () => {
			const client = createMockClient();
			const input = createMockGuildInput(channelKey, false, true, true);

			const result = await guard(input, client);

			expect(result.ok).toBe(false);
			const reason = getFailureReason(result);
			expect(reason).toContain(channelName);
			expect(reason).toContain('not have');
		});

		test('fails when bot lacks SendMessages permission', async () => {
			const client = createMockClient();
			const input = createMockGuildInput(channelKey, true, false, true);

			const result = await guard(input, client);

			expect(result.ok).toBe(false);
			const reason = getFailureReason(result);
			expect(reason).toContain('permission');
			expect(reason).toContain(channelName);
		});

		test('fails when bot member is not available', async () => {
			const client = createMockClient();
			const input = createMockGuildInput(channelKey, true, true, false);

			const result = await guard(input, client);

			expect(result.ok).toBe(false);
			expect(getFailureReason(result)).toContain('Unable to verify');
		});
	});
}

// Integration tests
describe('special channel guards with different input types', () => {
	test('works with interaction-like input', async () => {
		const client = createMockClient();
		const interaction = {
			guild: {
				systemChannel: { id: '123' } as GuildTextBasedChannel,
				members: {
					me: {
						permissionsIn: () =>
							new PermissionsBitField([PermissionsBitField.Flags.SendMessages]),
					},
				},
			} as unknown as Guild,
			member: {},
			channel: {},
		};

		const result = await hasSystemChannel(interaction, client);

		expect(result.ok).toBe(true);
	});

	test('works with gateway event input', async () => {
		const client = createMockClient();
		const event = {
			guild: {
				rulesChannel: { id: '789' } as GuildTextBasedChannel,
				members: {
					me: {
						permissionsIn: () =>
							new PermissionsBitField([PermissionsBitField.Flags.SendMessages]),
					},
				},
			} as unknown as Guild,
		};

		const result = await hasRulesChannel(event, client);

		expect(result.ok).toBe(true);
	});
});
