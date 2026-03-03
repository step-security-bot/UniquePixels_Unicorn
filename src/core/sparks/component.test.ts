import { describe, expect, mock, test } from 'bun:test';
import {
	createMockClient,
	createMockComponentInteraction,
} from '@/core/lib/test-helpers';
import {
	type AnyComponentInteraction,
	type BaseComponentSpark,
	defineComponent,
	findComponentSpark,
	isExactPattern,
	isPrefixPattern,
	matchCustomId,
} from './component';

// ─── Test Helpers ────────────────────────────────────────────────

/** Cast a defineComponent result to the base type used by lookup collections. */
function asBase(spark: { key: string }): BaseComponentSpark {
	return spark as unknown as BaseComponentSpark;
}

/** Create empty lookup collections and a shorthand find function. */
function createLookupContext() {
	const components = new Map<string, BaseComponentSpark>();
	const patterns: BaseComponentSpark[] = [];
	const find = (customId: string) =>
		findComponentSpark(components, patterns, customId);
	return { components, patterns, find };
}

/** Register a prefix spark and return the lookup context + spark. */
function setupPrefix(id = 'ban-') {
	const ctx = createLookupContext();
	const spark = defineComponent({ id, action: async () => {} });
	ctx.components.set(id, asBase(spark));
	return { ...ctx, spark };
}

describe('matchCustomId', () => {
	describe('exact string matching', () => {
		test('matches exact string', () => {
			const result = matchCustomId('confirm-button', 'confirm-button');

			expect(result.matched).toBe(true);
		});

		test('does not match different string', () => {
			const result = matchCustomId('cancel-button', 'confirm-button');

			expect(result.matched).toBe(false);
		});

		test('is case sensitive', () => {
			const result = matchCustomId('Confirm-Button', 'confirm-button');

			expect(result.matched).toBe(false);
		});

		test('does not match partial strings', () => {
			const result = matchCustomId('confirm', 'confirm-button');

			expect(result.matched).toBe(false);
		});
	});

	describe('wildcard pattern matching', () => {
		test('matches single wildcard at end', () => {
			const result = matchCustomId('ticket-close-123', 'ticket-close-*');

			expect(result.matched).toBe(true);
		});

		test('matches single wildcard in middle', () => {
			const result = matchCustomId('action-delete-item', 'action-*-item');

			expect(result.matched).toBe(true);
		});

		test('matches single wildcard at start', () => {
			const result = matchCustomId('user-123-profile', '*-profile');

			expect(result.matched).toBe(true);
		});

		test('matches multiple wildcards', () => {
			const result = matchCustomId('a-foo-b-bar-c', 'a-*-b-*-c');

			expect(result.matched).toBe(true);
		});

		test('wildcard requires at least one character', () => {
			const result = matchCustomId('ticket-close-', 'ticket-close-*');

			expect(result.matched).toBe(false);
		});

		test('does not match when non-wildcard parts differ', () => {
			const result = matchCustomId('ticket-open-123', 'ticket-close-*');

			expect(result.matched).toBe(false);
		});

		test('escapes special regex characters', () => {
			const result = matchCustomId('test.action-123', 'test.action-*');

			expect(result.matched).toBe(true);
		});

		test('escapes square brackets', () => {
			const result = matchCustomId('array[0]-action', 'array[0]-*');

			expect(result.matched).toBe(true);
		});
	});

	describe('prefix pattern matching', () => {
		test('matches single-segment suffix', () => {
			const result = matchCustomId('ban-123', 'ban-');
			expect(result.matched).toBe(true);
		});

		test('matches non-digit suffix', () => {
			const result = matchCustomId('ban-moderator', 'ban-');
			expect(result.matched).toBe(true);
		});

		test('does not match empty suffix', () => {
			const result = matchCustomId('ban-', 'ban-');
			expect(result.matched).toBe(false);
		});

		test('does not match multi-segment suffix', () => {
			const result = matchCustomId('ban-foo-bar', 'ban-');
			expect(result.matched).toBe(false);
		});

		test('does not match when customId has no dash', () => {
			const result = matchCustomId('ban', 'ban-');
			expect(result.matched).toBe(false);
		});

		test('does not match when dash is at position 0', () => {
			const result = matchCustomId('-123', 'ban-');
			expect(result.matched).toBe(false);
		});

		test('matches multi-segment prefix', () => {
			const result = matchCustomId('ticket-close-123', 'ticket-close-');
			expect(result.matched).toBe(true);
		});

		test('does not match different prefix', () => {
			const result = matchCustomId('ticket-open-123', 'ticket-close-');
			expect(result.matched).toBe(false);
		});
	});

	describe('regex pattern matching', () => {
		test('matches regex pattern', () => {
			const result = matchCustomId('action-delete-123', /^action-\w+-\d+$/);

			expect(result.matched).toBe(true);
		});

		test('does not match when regex fails', () => {
			const result = matchCustomId('action-delete-abc', /^action-\w+-\d+$/);

			expect(result.matched).toBe(false);
		});

		test('captures named groups', () => {
			const result = matchCustomId(
				'action-delete-456',
				/^action-(?<type>\w+)-(?<id>\d+)$/,
			);

			expect(result.matched).toBe(true);
			expect(result.groups).toEqual({ type: 'delete', id: '456' });
		});

		test('returns empty groups object when no named groups', () => {
			const result = matchCustomId('test-123', /^test-(\d+)$/);

			expect(result.matched).toBe(true);
			expect(result.groups).toEqual({});
		});

		test('returns empty groups when pattern does not match', () => {
			const result = matchCustomId('nomatch', /^test-(?<id>\d+)$/);

			expect(result.matched).toBe(false);
			expect(result.groups).toBeUndefined();
		});
	});
});

describe('defineComponent', () => {
	test('creates component spark with exact string ID', () => {
		const spark = defineComponent({
			id: 'my-button',
			action: async () => {},
		});

		expect(spark.type).toBe('component');
		expect(spark.id).toBe('my-button');
		expect(spark.key).toBe('my-button');
	});

	test('creates component spark with wildcard pattern', () => {
		const spark = defineComponent({
			id: 'ticket-*-action',
			action: async () => {},
		});

		expect(spark.type).toBe('component');
		expect(spark.key).toBe('ticket-*-action');
	});

	test('creates component spark with prefix pattern', () => {
		const spark = defineComponent({
			id: 'ban-',
			action: async () => {},
		});

		expect(spark.type).toBe('component');
		expect(spark.id).toBe('ban-');
		expect(spark.key).toBe('ban-');
	});

	test('creates component spark with regex pattern', () => {
		const pattern = /^action-(?<type>\w+)-(?<id>\d+)$/;
		const spark = defineComponent({
			id: pattern,
			action: async () => {},
		});

		expect(spark.type).toBe('component');
		expect(spark.id).toBe(pattern);
		expect(spark.key).toBe(pattern.source);
	});

	test('defaults guards to empty array', () => {
		const spark = defineComponent({
			id: 'test',
			action: async () => {},
		});

		expect(spark.guards).toEqual([]);
	});

	test('preserves provided guards', () => {
		const mockGuard = (input: AnyComponentInteraction) => ({
			ok: true as const,
			value: input,
		});
		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			guards: [mockGuard],
			action: async () => {},
		});

		expect(spark.guards).toHaveLength(1);
	});
});

describe('ComponentSpark.matches', () => {
	test('matches exact ID', () => {
		const spark = defineComponent({
			id: 'confirm-button',
			action: async () => {},
		});

		expect(spark.matches('confirm-button')).toBe(true);
		expect(spark.matches('cancel-button')).toBe(false);
	});

	test('matches wildcard pattern', () => {
		const spark = defineComponent({
			id: 'ticket-close-*',
			action: async () => {},
		});

		expect(spark.matches('ticket-close-123')).toBe(true);
		expect(spark.matches('ticket-close-abc')).toBe(true);
		expect(spark.matches('ticket-open-123')).toBe(false);
	});

	test('matches prefix pattern', () => {
		const spark = defineComponent({
			id: 'ban-',
			action: async () => {},
		});

		expect(spark.matches('ban-123')).toBe(true);
		expect(spark.matches('ban-moderator')).toBe(true);
		expect(spark.matches('ban')).toBe(false);
		expect(spark.matches('ban-')).toBe(false);
		expect(spark.matches('ban-foo-bar')).toBe(false);
	});

	test('matches regex pattern', () => {
		const spark = defineComponent({
			id: /^user-\d+-profile$/,
			action: async () => {},
		});

		expect(spark.matches('user-123-profile')).toBe(true);
		expect(spark.matches('user-abc-profile')).toBe(false);
	});
});

describe('ComponentSpark.execute', () => {
	test('executes action when no guards', async () => {
		const actionMock = mock(async () => {});
		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			action: actionMock,
		});

		const interaction = createMockComponentInteraction('test');

		const result = await spark.execute(interaction);

		expect(result.ok).toBe(true);
		expect(actionMock).toHaveBeenCalledWith(interaction);
	});

	test('runs guards before action', async () => {
		const calls: string[] = [];

		const guard = (input: AnyComponentInteraction) => {
			calls.push('guard');
			return { ok: true as const, value: input };
		};

		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			guards: [guard],
			action: async () => {
				calls.push('action');
			},
		});

		const interaction = createMockComponentInteraction('test');

		await spark.execute(interaction);

		expect(calls).toEqual(['guard', 'action']);
	});

	test('does not run action when guard fails', async () => {
		const actionMock = mock(async () => {});

		const failingGuard = () => ({
			ok: false as const,
			reason: 'Guard failed',
		});

		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			guards: [failingGuard],
			action: actionMock,
		});

		const interaction = createMockComponentInteraction('test');

		const result = await spark.execute(interaction);

		expect(result.ok).toBe(false);
		expect(actionMock).not.toHaveBeenCalled();
	});

	test('returns guard failure reason', async () => {
		const failingGuard = () => ({
			ok: false as const,
			reason: 'Permission denied',
		});

		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			guards: [failingGuard],
			action: async () => {},
		});

		const interaction = createMockComponentInteraction('test');

		const result = await spark.execute(interaction);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(
			'Permission denied',
		);
	});

	test('logs error when action throws', async () => {
		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			action: async () => {
				throw new Error('Action error');
			},
		});

		const client = createMockClient();
		const interaction = createMockComponentInteraction('test', { client });

		const result = await spark.execute(interaction);

		expect(result.ok).toBe(true); // Guards passed
		expect(client.logger.error).toHaveBeenCalled();
	});

	test('logs debug when guard fails', async () => {
		const failingGuard = () => ({
			ok: false as const,
			reason: 'Test failure',
		});

		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			guards: [failingGuard],
			action: async () => {},
		});

		const client = createMockClient();
		const interaction = createMockComponentInteraction('test', { client });

		await spark.execute(interaction);

		expect(client.logger.debug).toHaveBeenCalled();
	});
});

describe('ComponentSpark.register', () => {
	test('adds exact match spark to client components collection', () => {
		const spark = defineComponent({
			id: 'register-test',
			action: async () => {},
		});

		const client = createMockClient();
		spark.register(client);

		expect(client.components.has('register-test')).toBe(true);
		expect(client.components.get('register-test')).toBe(spark);
		expect(client.componentPatterns).toHaveLength(0);
	});

	test('adds wildcard pattern spark to componentPatterns array', () => {
		const spark = defineComponent({
			id: 'ticket-close-*',
			action: async () => {},
		});

		const client = createMockClient();
		spark.register(client);

		expect(client.components.has('ticket-close-*')).toBe(false);
		expect(client.componentPatterns).toHaveLength(1);
		expect(client.componentPatterns[0]).toBe(spark);
	});

	test('adds regex pattern spark to componentPatterns array', () => {
		const pattern = /^test-(\d+)$/;
		const spark = defineComponent({
			id: pattern,
			action: async () => {},
		});

		const client = createMockClient();
		spark.register(client);

		expect(client.components.has(pattern.source)).toBe(false);
		expect(client.componentPatterns).toHaveLength(1);
		expect(client.componentPatterns[0]).toBe(spark);
	});

	test('adds prefix pattern spark to client components collection', () => {
		const spark = defineComponent({
			id: 'ban-',
			action: async () => {},
		});

		const client = createMockClient();
		spark.register(client);

		expect(client.components.has('ban-')).toBe(true);
		expect(client.components.get('ban-')).toBe(spark);
		expect(client.componentPatterns).toHaveLength(0);
	});

});

describe('findComponentSpark', () => {
	test('finds spark by exact match', () => {
		const { components, find } = createLookupContext();
		const spark = defineComponent({
			id: 'exact-match',
			action: async () => {},
		});
		components.set('exact-match', asBase(spark));

		expect(find('exact-match')).toBe(spark);
	});

	test('returns undefined when no match found', () => {
		const { find } = createLookupContext();

		expect(find('nonexistent')).toBeUndefined();
	});

	test('prefers exact match over pattern match', () => {
		const { components, patterns, find } = createLookupContext();

		const exactSpark = defineComponent({
			id: 'button-123',
			action: async () => {},
		});

		const patternSpark = defineComponent({
			id: 'button-*',
			action: async () => {},
		});

		components.set('button-123', asBase(exactSpark));
		patterns.push(asBase(patternSpark));

		expect(find('button-123')).toBe(exactSpark);
	});

	test('falls back to pattern matching', () => {
		const { patterns, find } = createLookupContext();

		const patternSpark = defineComponent({
			id: 'action-*-confirm',
			action: async () => {},
		});
		patterns.push(asBase(patternSpark));

		expect(find('action-delete-confirm')).toBe(patternSpark);
	});

	test('finds first matching pattern', () => {
		const { patterns, find } = createLookupContext();

		const spark1 = defineComponent({
			id: 'prefix-*',
			action: async () => {},
		});

		const spark2 = defineComponent({
			id: /^prefix-\d+$/,
			action: async () => {},
		});

		patterns.push(asBase(spark1), asBase(spark2));

		expect(find('prefix-123')).toBe(spark1);
	});

	test('handles regex patterns in search', () => {
		const { patterns, find } = createLookupContext();

		const regexSpark = defineComponent({
			id: /^modal-(?<type>\w+)-(?<id>\d+)$/,
			action: async () => {},
		});
		patterns.push(asBase(regexSpark));

		expect(find('modal-submit-456')).toBe(regexSpark);
	});

	test('handles empty components map and patterns array', () => {
		const { find } = createLookupContext();

		expect(find('anything')).toBeUndefined();
	});

	describe('prefix matching', () => {
		test('matches component by prefix pattern', () => {
			const { find, spark } = setupPrefix();

			expect(find('ban-123456789012345678')).toBe(spark);
		});

		test('matches multi-segment prefix', () => {
			const { find, spark } = setupPrefix('ticket-close-');

			expect(find('ticket-close-123456789012345678')).toBe(spark);
		});

		test('matches non-digit suffix', () => {
			const { find, spark } = setupPrefix('role-assign-');

			expect(find('role-assign-moderator')).toBe(spark);
		});

		test('does not match multi-segment suffix', () => {
			const { find } = setupPrefix();

			expect(find('ban-foo-bar')).toBeUndefined();
		});

		test('does not match empty suffix', () => {
			const { find } = setupPrefix();

			expect(find('ban-')).toBeUndefined();
		});

		test('does not match when prefix is not registered', () => {
			const { find } = createLookupContext();

			expect(find('unknown-123456789012345678')).toBeUndefined();
		});

		test('prefers exact match over prefix match', () => {
			const { components, find } = createLookupContext();

			const exactSpark = defineComponent({
				id: 'ban-123456789012345678',
				action: async () => {},
			});
			const prefixSpark = defineComponent({
				id: 'ban-',
				action: async () => {},
			});

			components.set('ban-123456789012345678', asBase(exactSpark));
			components.set('ban-', asBase(prefixSpark));

			expect(find('ban-123456789012345678')).toBe(exactSpark);
		});

		test('does not match when customId has no separator', () => {
			const { find } = setupPrefix();

			expect(find('ban123456789')).toBeUndefined();
		});

		test('does not match when separator is at position 0', () => {
			const { find } = createLookupContext();

			expect(find('-123456789012345678')).toBeUndefined();
		});

		test('falls through to pattern matching when prefix has no match', () => {
			const { patterns, find } = createLookupContext();

			const patternSpark = defineComponent({
				id: /^action-\d+$/,
				action: async () => {},
			});
			patterns.push(asBase(patternSpark));

			expect(find('action-123456789')).toBe(patternSpark);
		});
	});
});

describe('isExactPattern', () => {
	test('returns true for simple string without wildcards', () => {
		expect(isExactPattern('button-confirm')).toBe(true);
		expect(isExactPattern('my-component')).toBe(true);
		expect(isExactPattern('a')).toBe(true);
	});

	test('returns false for string with wildcard', () => {
		expect(isExactPattern('button-*')).toBe(false);
		expect(isExactPattern('*-suffix')).toBe(false);
		expect(isExactPattern('prefix-*-suffix')).toBe(false);
		expect(isExactPattern('*')).toBe(false);
	});

	test('returns false for prefix pattern (trailing dash)', () => {
		expect(isExactPattern('ban-')).toBe(false);
		expect(isExactPattern('ticket-close-')).toBe(false);
		expect(isExactPattern('-')).toBe(false);
	});

	test('returns false for regex pattern', () => {
		expect(isExactPattern(/^test-\d+$/)).toBe(false);
		expect(isExactPattern(/pattern/)).toBe(false);
	});

	test('returns true for empty string (edge case)', () => {
		// Empty string has no wildcards, so technically "exact"
		expect(isExactPattern('')).toBe(true);
	});
});

describe('isPrefixPattern', () => {
	test('returns true for string ending with dash', () => {
		expect(isPrefixPattern('ban-')).toBe(true);
		expect(isPrefixPattern('ticket-close-')).toBe(true);
	});

	test('returns false for string without trailing dash', () => {
		expect(isPrefixPattern('ban')).toBe(false);
		expect(isPrefixPattern('confirm-action')).toBe(false);
	});

	test('returns false for wildcard pattern even with trailing dash', () => {
		expect(isPrefixPattern('ban-*-')).toBe(false);
	});

	test('returns false for regex pattern', () => {
		expect(isPrefixPattern(/^ban-/)).toBe(false);
	});

	test('returns true for single dash', () => {
		expect(isPrefixPattern('-')).toBe(true);
	});

	test('single-dash prefix pattern never matches any valid customId', () => {
		// isPrefixPattern('-') is true, but matchCustomId requires the customId
		// to start with the prefix minus its trailing dash — which is an empty string.
		// Since matchCustomId rejects empty customIds, no real customId can match.
		expect(matchCustomId('a-b', '-').matched).toBe(false);
		expect(matchCustomId('-b', '-').matched).toBe(false);
	});

	test('returns false for empty string', () => {
		expect(isPrefixPattern('')).toBe(false);
	});
});

describe('edge cases', () => {
	test('handles empty customId', () => {
		const result = matchCustomId('', 'pattern');
		expect(result.matched).toBe(false);
	});

	test('handles empty pattern string', () => {
		const result = matchCustomId('customId', '');
		expect(result.matched).toBe(false);
	});

	test('handles special characters in customId', () => {
		const spark = defineComponent({
			id: 'button:action:123',
			action: async () => {},
		});

		expect(spark.matches('button:action:123')).toBe(true);
	});

	test('handles Unicode in customId', () => {
		const spark = defineComponent({
			id: 'button-✓-confirm',
			action: async () => {},
		});

		expect(spark.matches('button-✓-confirm')).toBe(true);
		expect(spark.matches('button-x-confirm')).toBe(false);
	});

	test('handles very long customId', () => {
		const longId = 'a'.repeat(100);
		const spark = defineComponent({
			id: longId,
			action: async () => {},
		});

		expect(spark.matches(longId)).toBe(true);
	});

	test('wildcard pattern with multiple consecutive wildcards', () => {
		// Pattern: a-*-*-b should match a-x-y-b
		const result = matchCustomId('a-x-y-b', 'a-*-*-b');

		// This should work - each * matches one segment
		expect(result.matched).toBe(true);
	});
});
