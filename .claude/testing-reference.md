# Spark Testing Reference

Machine-readable reference for testing Unicorn sparks. Not for humans.

## Imports

```ts
import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test';
// Test helpers
import { createMockClient, createMockChatInputInteraction, createMockAutocompleteInteraction, createMockComponentInteraction, createMockBaseInteraction, createMockMessage, createMockReadyClient, passThroughGuard, failGuard } from '@/core/lib/test-helpers';
// Spark definitions (for direct instantiation in tests)
import { defineCommand, defineCommandWithAutocomplete, defineCommandGroup, defineComponent, defineGatewayEvent, defineScheduledEvent } from '@/core/sparks';
// Guard infrastructure (for guard tests)
import { createGuard, guardPass, guardFail, getGuardMeta, resolveGuards, processGuards, GUARD_META } from '@/core/guards';
import type { Guard, GuardMeta, SparkType } from '@/core/guards';
// Types as needed
import type { Client } from 'discord.js';
```

## Test Helper APIs

### createMockClient(overrides?)

```ts
createMockClient({
  commands?,        // Collection<string, BaseCommandSpark>
  components?,      // Collection<string, BaseComponentSpark>
  componentPatterns?, // BaseComponentSpark[]
  scheduledJobs?,   // Collection<string, CronJob>
  on?, once?,       // mock fns
  isReady?,         // boolean (default true)
  ws?,              // { ping: number } (default { ping: 0 })
  config?,          // Partial<Client['config']> (default: minimal mock config)
  logger?,          // Partial<{ debug, info, warn, error }> — all mock fns
}): Client
```

All logger methods are mocks. Also has `destroy: mock(() => {})`.

### createMockChatInputInteraction(overrides?)

```ts
createMockChatInputInteraction({
  commandName?,      // default 'test'
  userId?,           // default '123456789012345678'
  replied?,          // default false
  deferred?,         // default false
  options?,          // Record<string, unknown> — populates option getters
  createdTimestamp?, // default Date.now()
  reply?,            // mock
  editReply?,        // mock
  fetchReply?,       // mock
}): ChatInputCommandInteraction
```

Options record feeds: `getString(key)`, `getInteger(key)`, `getNumber(key)`, `getBoolean(key)`, `getUser(key)`, `getChannel(key)`, `getRole(key)`, `getMentionable(key)`, `getAttachment(key)`, `getSubcommand()` (reads `options.subcommand`), `getSubcommandGroup()` (reads `options.subcommandGroup`).

### createMockAutocompleteInteraction(overrides?)

```ts
createMockAutocompleteInteraction({
  commandName?,    // default 'test'
  focusedValue?,   // default ''
  userId?,         // default '123456789012345678'
}): AutocompleteInteraction
```

Has `options.getFocused()` and mock `respond`.

### createMockComponentInteraction(customId, overrides?)

```ts
createMockComponentInteraction(
  customId: string,  // required
  { userId?, replied?, deferred? }?,
): AnyComponentInteraction
```

Has mocks: `reply`, `deferUpdate`, `update`, `deferReply`, `editReply`.

### createMockBaseInteraction(overrides?)

```ts
createMockBaseInteraction(overrides?: Record<string, unknown>): Interaction
```

Defaults: all type guards (`isChatInputCommand`, `isAutocomplete`, `isContextMenuCommand`, `isMessageComponent`, `isModalSubmit`) return `false`. Override with `mock(() => true)` for routing tests.

### createMockMessage(overrides?)

```ts
createMockMessage({
  inGuild?,   // default true
  isBot?,     // default false
  authorId?,  // default '123456789012345678'
}): Message
```

Has `inGuild()`, `author.id`, `author.bot`, `guildId` (set when inGuild=true).

### createMockReadyClient(overrides?)

```ts
createMockReadyClient({
  userTag?,     // default 'TestBot#1234'
  guildCount?,  // default 0
}): ReadyClient
```

Has `user.tag`, `guilds.cache.size`.

### passThroughGuard() / failGuard(reason)

```ts
passThroughGuard(): Guard<any,any>  // mock, returns { ok:true, value:input }
failGuard(reason: string): Guard<any,any>  // mock, returns { ok:false, reason }
```

Both are `mock()` instances — support `.toHaveBeenCalled()` etc.

## Common Test Patterns

### Pattern: Command spark test

```ts
import { defineCommand } from '@/core/sparks';
import { createMockClient, createMockChatInputInteraction, passThroughGuard, failGuard } from '@/core/lib/test-helpers';

// File-local helper for mock command builders
function createMockCommand(name: string) {
  return { name } as unknown as SlashCommandBuilder;
}

describe('myCommand', () => {
  test('has correct metadata', () => {
    expect(myCommand.type).toBe('command');
    expect(myCommand.id).toBe('my-command');
  });

  test('executes action on success', async () => {
    const reply = mock(async () => {});
    const interaction = createMockChatInputInteraction({ commandName: 'my-command', reply });
    const result = await myCommand.execute(interaction);
    expect(result.ok).toBe(true);
    expect(reply).toHaveBeenCalled();
  });

  test('fails when guard rejects', async () => {
    const spark = defineCommand({
      command: createMockCommand('test'),
      guards: [failGuard('Denied')],
      action: mock(async () => {}),
    });
    const interaction = createMockChatInputInteraction();
    const result = await spark.execute(interaction);
    expect(result.ok).toBe(false);
  });
});
```

### Pattern: Command group test

```ts
const spark = defineCommandGroup({
  command: createMockCommand('manage'),
  guards: [passThroughGuard()],
  subcommands: {
    list: { action: listAction },
    add: { guards: [subGuard], action: addAction },
  },
});

// Test subcommand routing
const interaction = createMockChatInputInteraction({
  commandName: 'manage',
  options: { subcommand: 'list' },
});
const result = await spark.execute(interaction);
```

### Pattern: Component test

```ts
const spark = defineComponent({
  id: 'my-button',
  action: mock(async () => {}),
});
const interaction = createMockComponentInteraction('my-button');
const result = await spark.execute(interaction);
expect(result.ok).toBe(true);
```

### Pattern: Gateway event test

```ts
const spark = defineGatewayEvent({
  event: Events.MessageCreate,
  guards: [notBot],
  action: mock(async () => {}),
});
// Pass event args as array
const msg = createMockMessage({ isBot: false });
await spark.execute([msg], client);
```

### Pattern: Scheduled event test

```ts
function createMockContext(client: Client): ScheduledContext {
  return { client, job: {} as CronJob, fireDate: new Date() };
}

const spark = defineScheduledEvent({
  id: 'cleanup',
  schedule: '0 0 * * *',
  action: mock(async () => {}),
});
const ctx = createMockContext(client);
const result = await spark.execute(ctx);
```

### Pattern: Registration test

```ts
// Commands
spark.register(client);
expect(client.commands.has('ping')).toBe(true);

// Components (exact/prefix)
spark.register(client);
expect(client.components.has('my-button')).toBe(true);

// Components (wildcard/regex)
spark.register(client);
expect(client.componentPatterns).toHaveLength(1);

// Gateway events
spark.register(client);
expect(client.on).toHaveBeenCalledTimes(1);   // once: false
expect(client.once).toHaveBeenCalledTimes(1);  // once: true

// Scheduled events
spark.register(client);
expect(client.scheduledJobs.has('cleanup:0 0 * * *')).toBe(true);
```

### Pattern: Error handling test

```ts
// Action throws → result still ok, error logged
test('logs error when action throws', async () => {
  const spark = defineCommand({
    command: createMockCommand('test'),
    action: async () => { throw new Error('boom'); },
  });
  const interaction = createMockChatInputInteraction();
  const result = await spark.execute(interaction);
  expect(result.ok).toBe(true); // guards passed
  expect(interaction.client.logger.error).toHaveBeenCalledWith(
    expect.objectContaining({ command: 'test' }),
    'Command action failed',
  );
});
```

### Pattern: Logging assertions (processGuards)

```ts
// Access logger via interaction.client for command/component sparks
const { logger } = interaction.client;

// Guard failure — command/component (info level)
expect(logger.info).toHaveBeenCalledWith(
  { context: 'command:name', reason: 'msg' }, 'Guard check failed',
);

// Guard failure — gateway/scheduled (warn level, silent mode)
expect(logger.warn).toHaveBeenCalledWith(
  { context: 'gateway:messageCreate', reason: 'msg' }, 'Guard check failed',
);

// Guard exception (error level, all spark types)
expect(logger.error).toHaveBeenCalledWith(
  expect.objectContaining({ context: 'command:name' }), 'Guard exception',
);

// Action failure (error — unchanged)
expect(logger.error).toHaveBeenCalledWith(
  expect.objectContaining({ command: 'name' }), 'Command action failed',
);

// Autocomplete failure (warn — unchanged)
expect(logger.warn).toHaveBeenCalledWith(
  expect.objectContaining({ command: 'name' }), 'Autocomplete handler failed',
);
```

### Pattern: Guard metadata test

```ts
import { getGuardMeta, createGuard, guardPass } from '@/core/guards';

test('has correct metadata', () => {
  const meta = getGuardMeta(myGuard);
  expect(meta).toBeDefined();
  expect(meta!.name).toBe('myGuard');
  expect(meta!.incompatibleWith).toContain('scheduled-event');
  expect(meta!.requires).toHaveLength(1); // e.g. [inCachedGuild]
});

test('has channelResolver in metadata', () => {
  const meta = getGuardMeta(myChannelGuard);
  expect(meta!.channelResolver).toBeTypeOf('function');
  const resolved = meta!.channelResolver!(mockInput);
  expect(resolved === expectedChannel).toBe(true);
});
```

### Pattern: resolveGuards test

```ts
import { resolveGuards, createGuard, guardPass, getGuardMeta } from '@/core/guards';
import { AppError } from '@/core/lib/logger';

test('throws for incompatible guard', () => {
  const guard = createGuard((input: unknown) => guardPass(input), {
    name: 'test',
    incompatibleWith: ['scheduled-event'],
  });
  expect(() => resolveGuards([guard], 'scheduled-event')).toThrow(AppError);
});

test('auto-prepends deps for command sparks', () => {
  const dep = createGuard((input: unknown) => guardPass(input), { name: 'dep' });
  const guard = createGuard((input: unknown) => guardPass(input), {
    name: 'main',
    requires: [dep],
  });
  const resolved = resolveGuards([guard], 'command');
  expect(resolved).toEqual([dep, guard]);
});
```

### Pattern: processGuards test

```ts
import { processGuards, createGuard, guardPass, guardFail } from '@/core/guards';
import { createMockClient } from '@/core/lib/test-helpers';
import { AppError } from '@/core/lib/logger';

test('returns success when all guards pass', async () => {
  const client = createMockClient();
  const guard = createGuard((input: unknown) => guardPass(input));
  const result = await processGuards([guard], { value: 1 }, client.logger, 'test:ctx');
  expect(result.ok).toBe(true);
});

test('catches exceptions and returns failure', async () => {
  const client = createMockClient();
  const guard = createGuard(() => { throw new Error('bug'); });
  const result = await processGuards([guard], {}, client.logger, 'test:ctx');
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe('An internal error occurred.');
  expect(client.logger.error).toHaveBeenCalled();
});
```

### Pattern: Guard result assertion

```ts
// Success
expect(result.ok).toBe(true);
if (result.ok) expect(result.value).toBe(interaction);

// Failure (cast needed since expect doesn't narrow)
expect(result.ok).toBe(false);
if (!result.ok) expect(result.reason).toContain('server');
```

### Pattern: File-local test helpers (for DRY tests)

```ts
// Extract reusable mock factories and assertion helpers at top of test file
function createMockCommand(name: string) {
  return { name } as unknown as SlashCommandBuilder;
}
function expectEphemeralReply(interaction: Interaction, content: string) {
  expect(getReplyMock(interaction)).toHaveBeenCalledWith({
    content, flags: MessageFlags.Ephemeral,
  });
}
```

## Test Organization

1. Import test utilities from `@/core/lib/test-helpers`
2. Define file-local helpers at top for mocks specific to module under test
3. Group with nested `describe` blocks by feature (execute, register, guards, edge cases)
4. Each test creates fresh mocks — no shared mutable state between tests
5. Use `as unknown as Type` casts for minimal mocks satisfying type constraints
6. Bun test primitives only: `describe`, `test`, `expect`, `mock`, `spyOn`, `beforeEach`, `afterEach`
