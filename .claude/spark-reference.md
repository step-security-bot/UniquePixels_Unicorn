# Spark Composition Reference

Machine-readable reference for composing Unicorn sparks. Not for humans.

## Imports

```ts
// Spark definitions
import { defineCommand, defineCommandWithAutocomplete, defineCommandGroup, defineComponent, defineGatewayEvent, defineScheduledEvent } from '@/core/sparks';
// Key types (CommandBuilder = SlashCommandBuilder | ContextMenuCommandBuilder | variants)
import type { CommandSpark, CommandBuilder, SubcommandHandler, ComponentSpark, CustomIdPattern, ReadyClient, ScheduledContext, AnySpark } from '@/core/sparks';
// Guards
import { createGuard, guardPass, guardFail, getGuardMeta, resolveGuards, processGuards } from '@/core/guards';
import type { Guard, GuardResult, GuardMeta, ProcessGuardsOptions } from '@/core/guards';
// Built-in guards
import { inCachedGuild, hasPermission, botHasPermission, hasPermissionIn, botHasPermissionIn, hasChannel, channelType, isUser, notBot, messageInGuild, rateLimit, hasSystemChannel, hasPublicUpdatesChannel, hasRulesChannel, hasSafetyAlertsChannel } from '@/guards/built-in';
import type { GuildInteraction, ChannelTypedInteraction } from '@/guards/built-in';
// Error handling
import { attempt, isError, unwrap, unwrapOr } from '@/core/lib/attempt';
import type { Result } from '@/core/lib/attempt';
// Logger & errors
import { AppError } from '@/core/lib/logger';
import type { ExtendedLogger } from '@/core/lib/logger';
// Discord.js (Client is augmented with logger, config, commands, components, componentPatterns, scheduledJobs)
import { SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, Events, MessageFlags, PermissionFlagsBits, ChannelType as DChannelType, type Client, type ChatInputCommandInteraction, type CommandInteraction, type AutocompleteInteraction, type ButtonInteraction, type StringSelectMenuInteraction, type ModalSubmitInteraction, type Message, type ClientEvents } from 'discord.js';
```

## 1. defineCommand

```ts
defineCommand<TGuarded extends CommandInteraction = ChatInputCommandInteraction>({
  command: CommandBuilder,           // SlashCommandBuilder | ContextMenuCommandBuilder | variants
  guards?: readonly Guard<any,any>[], // default []
  action: (interaction: TGuarded) => void | Promise<void>,
}): CommandSpark<TGuarded>
```

**Spark shape:** `{ type:'command', id:command.name, command, guards, action, execute(), register() }`
**Define-time:** `resolveGuards(guards, 'command')` — validates compatibility, auto-resolves deps
**execute(interaction: CommandInteraction):** processGuards → if fail: return fail → action wrapped in attempt() → log error on throw → return GuardResult
**register():** `client.commands.set(command.name, spark)`

```ts
// Slash command (default TGuarded = ChatInputCommandInteraction)
export const ping = defineCommand({
  command: new SlashCommandBuilder().setName('ping').setDescription('Pong'),
  action: async (interaction) => {
    await interaction.reply('Pong!');
  },
});

// Context menu command (explicit generic for proper target access)
export const report = defineCommand<MessageContextMenuCommandInteraction>({
  command: new ContextMenuCommandBuilder().setName('Report').setType(ApplicationCommandType.Message),
  action: async (interaction) => {
    const message = interaction.targetMessage;
    await interaction.reply({ content: `Reported ${message.id}`, flags: MessageFlags.Ephemeral });
  },
});
```

## 2. defineCommandWithAutocomplete

```ts
defineCommandWithAutocomplete<TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction>({
  command: CommandBuilder,
  guards?: readonly Guard<any,any>[],
  action: (interaction: TGuarded) => void | Promise<void>,
  autocomplete: (interaction: AutocompleteInteraction) => void | Promise<void>,
}): CommandSpark<TGuarded>
```

**Adds:** `autocomplete` prop, `executeAutocomplete()` method (wraps in attempt, logs warn on fail)

```ts
export const search = defineCommandWithAutocomplete({
  command: new SlashCommandBuilder().setName('search').setDescription('Search'),
  action: async (interaction) => { /* ... */ },
  autocomplete: async (interaction) => {
    const value = interaction.options.getFocused();
    await interaction.respond([{ name: value, value }]);
  },
});
```

## 3. defineCommandGroup

```ts
defineCommandGroup<TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction>({
  command: CommandBuilder,
  guards?: readonly Guard<any,any>[],     // top-level, run first
  subcommands?: Record<string, SubcommandHandler<TGuarded>>,
  groups?: Record<string, Record<string, SubcommandHandler<TGuarded>>>,
}): CommandSpark<TGuarded>

// SubcommandHandler:
{ guards?: readonly Guard<any,any>[], action: CommandAction<TGuarded>, autocomplete?: AutocompleteFn }
```

**Validation:** Throws if neither subcommands nor groups has entries.
**Define-time:** `resolveGuards(guards, 'command')` for top-level; subcommand guards resolved in `runSubcommand`
**execute(interaction: CommandInteraction):** Rejects non-slash (context-menu) interactions immediately with `{ ok: false, reason: 'Command groups only support slash commands.' }` → processGuards (top-level) → resolve subcommand via getSubcommandGroup(false)/getSubcommand(false) → if no handler: warn + return fail → subcommand processGuards + action → returns subcommand GuardResult
**Autocomplete:** Auto-detected if any handler has `autocomplete`. Routes to correct handler.
**register():** `client.commands.set(command.name, spark)` (same as command)

```ts
export const manage = defineCommandGroup({
  command: new SlashCommandBuilder().setName('manage').setDescription('Manage'),
  guards: [inCachedGuild],
  subcommands: {
    list: { action: async (interaction) => { /* ... */ } },
    add: {
      guards: [hasPermission(PermissionFlagsBits.ManageRoles)],
      action: async (interaction) => { /* ... */ },
    },
  },
  groups: {
    roles: {
      add: { action: async (interaction) => { /* ... */ } },
      remove: {
        autocomplete: async (interaction) => { /* ... */ },
        action: async (interaction) => { /* ... */ },
      },
    },
  },
});
```

## 4. defineComponent

```ts
defineComponent<TInput extends AnyComponentInteraction = ButtonInteraction, TGuarded extends TInput = TInput>({
  id: CustomIdPattern,                    // string | RegExp
  guards?: readonly Guard<any,any>[],
  action: (interaction: TGuarded) => void | Promise<void>,
}): ComponentSpark<TInput,TGuarded>
```

**CustomIdPattern matching:**

| Pattern | Example | Stored in | Lookup |
|---|---|---|---|
| Exact string | `'confirm'` | `client.components` | O(1) |
| Prefix (ends `-`) | `'ban-'` | `client.components` | O(1) |
| Wildcard (has `*`) | `'ticket-*-close'` | `client.componentPatterns` | O(n) |
| RegExp | `/^role-(\d+)$/` | `client.componentPatterns` | O(n) |

**Spark shape:** `{ type:'component', id, key:(id instanceof RegExp ? id.source : id), guards, action, matches(), execute(), register() }`
**Define-time:** `resolveGuards(guards, 'component')` — validates compatibility, auto-resolves deps
**matches():** delegates to matchCustomId(customId, id).matched
**execute():** processGuards → action pattern (same as commands)

```ts
// Exact match button
export const confirm = defineComponent({
  id: 'confirm-action',
  action: async (interaction) => {
    await interaction.reply({ content: 'Confirmed!' });
  },
});

// Prefix match (matches 'ban-123', 'ban-456', etc.)
export const ban = defineComponent<ButtonInteraction>({
  id: 'ban-',
  action: async (interaction) => {
    const userId = interaction.customId.split('-')[1];
    // ...
  },
});

// Modal handler
export const feedback = defineComponent<ModalSubmitInteraction>({
  id: 'feedback-modal',
  action: async (interaction) => {
    const text = interaction.fields.getTextInputValue('feedback');
    // ...
  },
});

// Select menu with guard
export const roleSelect = defineComponent<StringSelectMenuInteraction, GuildInteraction<StringSelectMenuInteraction>>({
  id: 'role-select',
  guards: [inCachedGuild],
  action: async (interaction) => {
    // interaction.guild guaranteed non-null
  },
});
```

**findComponentSpark(components, componentPatterns, customId, logger?):** 3-tier: exact→prefix→pattern

## 5. defineGatewayEvent

```ts
defineGatewayEvent<E extends keyof ClientEvents, TGuarded extends ClientEvents[E][0] = ClientEvents[E][0]>({
  event: E,
  once?: boolean,                              // default false
  guards?: readonly Guard<any,any>[],
  action: (...args: [TGuarded, ...Tail<ClientEvents[E]>, Client]) => void | Promise<void>,
}): GatewayEventSpark<E,TGuarded>
```

**Spark shape:** `{ type:'gateway-event', event, once, guards, action, execute(), register() }`
**Define-time:** `resolveGuards(guards, 'gateway-event')` — validates compatibility, skips dep resolution
**execute():** processGuards (silent mode) on eventArgs[0] → action(guardedFirst, ...restArgs, client)
**register():** `client.on(event, handler)` or `client.once(event, handler)`

```ts
// Ready event (once)
export const ready = defineGatewayEvent({
  event: Events.ClientReady,
  once: true,
  action: (readyClient, client) => {
    client.logger.info({ user: readyClient.user.tag }, 'Bot is ready');
  },
});

// Message event with guard
export const messageLog = defineGatewayEvent({
  event: Events.MessageCreate,
  guards: [notBot, messageInGuild],
  action: (message, client) => {
    // message is Message<true> (guild message, non-bot)
    client.logger.debug({ guild: message.guildId }, 'Message received');
  },
});
```

**ReadyClient type:** `ClientEvents[typeof Events.ClientReady][0]` — re-exported from sparks index.

## 6. defineScheduledEvent

```ts
defineScheduledEvent({
  id: string,
  schedule: string | string[],        // cron expression(s)
  timezone?: string,                   // IANA tz, default 'UTC'
  guards?: readonly Guard<any,any>[],
  action: (ctx: ScheduledContext) => void | Promise<void>,
}): ScheduledEventSpark

// ScheduledContext = { client: Client, job: CronJob, fireDate: Date }
```

**Spark shape:** `{ type:'scheduled-event', id, schedule, timezone, guards, action, execute(), register(), stop() }`
**Define-time:** `resolveGuards(guards, 'scheduled-event')` — validates compatibility, skips dep resolution
**register():** Creates CronJob(s) via `CronJob.from()`, stores in `client.scheduledJobs` keyed `"id:cronExpr"`, starts immediately
**stop():** Stops and removes jobs for this spark
**stopAllScheduledJobs(client):** Stops all registered jobs (for shutdown)

```ts
export const cleanup = defineScheduledEvent({
  id: 'daily-cleanup',
  schedule: '0 0 * * *',
  timezone: 'America/New_York',
  action: async ({ client, fireDate }) => {
    client.logger.info({ fireDate }, 'Running cleanup');
  },
});
```

## Guards

### GuardResult & Guard types

```ts
type GuardResult<T> = { ok: true; value: T } | { ok: false; reason: string };
type Guard<TInput, TOutput extends TInput = TInput> = (input: TInput) => GuardResult<TOutput> | Promise<GuardResult<TOutput>>;
```

### Guard metadata

```ts
const GUARD_META: unique symbol;  // Symbol for attaching metadata

interface GuardMeta {
  name: string;                                  // Human-readable guard name
  requires?: readonly Guard<any, any>[];         // Guards that must run before this one
  incompatibleWith?: readonly SparkType[];       // Spark types this guard can't be used with
  channelResolver?: (input: unknown) => GuildBasedChannel | null;  // Target channel resolver
}

type SparkType = 'command' | 'component' | 'gateway-event' | 'scheduled-event';
```

### Guard utilities

```ts
createGuard(fn, meta?)      // wraps guard fn, optionally attaches GuardMeta
guardPass(value)             // { ok: true, value }
guardFail(reason)            // { ok: false, reason }
runGuard(guard, input)       // single guard
runGuards(guards, input)     // sequential chain, short-circuits on fail, type narrows
getGuardMeta(guard)          // reads GuardMeta from guard, or undefined
resolveGuards(guards, sparkType) // define-time: validates compatibility, auto-resolves deps
processGuards(guards, input, logger, context, options?) // execute-time: runs guards with error handling
```

### processGuards behavior

```ts
processGuards(guards, input, logger, context, { silent?: boolean })
```

- **Intentional failure** (`{ ok: false }`): logged at `info` (user-facing) or `warn` (silent)
- **Guard exception** (throw): caught, wrapped in `AppError('ERR_GUARD_EXCEPTION')`, logged at `error`, returns `{ ok: false, reason: 'An internal error occurred.' }`
- **Silent mode**: Used by gateway-event and scheduled-event sparks (no user to notify)

### resolveGuards behavior

```ts
resolveGuards(guards, sparkType)
```

- Validates each guard's `incompatibleWith` against spark type → throws `AppError('ERR_GUARD_INCOMPATIBLE')`
- For `command`/`component`: auto-prepends missing `requires` deps, deduplicates by reference, corrects mis-ordered deps
- For `gateway-event`/`scheduled-event`: deduplicates guards by reference while skipping dep resolution
- Validates transitive dependency compatibility too
- Order only matters for guards without a `requires` relationship — connected guards are auto-ordered

### Creating custom guards

```ts
// Simple constant guard (with metadata)
export const myGuard = createGuard<InputType, OutputType>((input) => {
  if (condition) return guardPass(input as OutputType);
  return guardFail('Reason');
}, {
  name: 'myGuard',
  requires: [inCachedGuild],
  incompatibleWith: ['scheduled-event'],
});

// Factory guard (parameterized, with metadata)
export function myGuard<T extends SomeConstraint>(param: ParamType): Guard<T, T> {
  return createGuard((input) => {
    if (check(input, param)) return guardPass(input);
    return guardFail('Reason');
  }, {
    name: 'myGuard',
    incompatibleWith: ['scheduled-event'],
  });
}
```

### Built-in guards reference

| Guard | Type | Input→Output | Usage |
|---|---|---|---|
| `inCachedGuild` | constant | `Interaction` → `GuildInteraction` | Narrows: adds guild, guildId, member, channel |
| `hasPermission(perms, msg?)` | factory | `{member:GuildMember}` → same | Checks member.permissions.has(perms) |
| `botHasPermission(perms, msg?)` | factory | `{guild:Guild}` → same | Checks bot perms at guild level |
| `hasPermissionIn(perms, channelGuard?, msg?)` | factory | `{member:GuildMember, channel:GuildBasedChannel}` → same | Checks user perms in channel |
| `botHasPermissionIn(perms, channelGuard?, msg?)` | factory | `{guild:Guild, channel:GuildBasedChannel}` → same | Checks bot perms in channel |
| `hasChannel(idOrFn)` | factory | `{guild:Guild}` → same | Checks channel exists in guild cache |
| `channelType(...types)` | factory | `Interaction` → `ChannelTypedInteraction<T,C>` | Narrows channel type |
| `isUser(userIds, msg?)` | factory | `Interaction` → same | Checks interaction.user.id in set |
| `notBot` | constant | `Message` → `Message` | Checks !message.author.bot |
| `messageInGuild` | constant | `Message` → `Message<true>` | Narrows to guild message |
| `rateLimit({limit,window,keyFn?,message?})` | factory | `Interaction` → same | In-memory rate limit, per-user default |
| `hasSystemChannel` | constant | `{guild:Guild}` → narrowed | Checks guild.systemChannel exists |
| `hasPublicUpdatesChannel` | constant | `{guild:Guild}` → narrowed | Checks guild.publicUpdatesChannel exists |
| `hasRulesChannel` | constant | `{guild:Guild}` → narrowed | Checks guild.rulesChannel exists |
| `hasSafetyAlertsChannel` | constant | `{guild:Guild}` → narrowed | Checks guild.safetyAlertsChannel exists |

**Guard chaining:** Guards compose left-to-right. Output of guard N is input to guard N+1. Dependencies like `inCachedGuild` are auto-resolved for command/component sparks.

**Channel guards + permission guards:** Special channel guards and `hasChannel` carry `channelResolver` metadata. Pass them to `hasPermissionIn`/`botHasPermissionIn` to check perms in that channel:

```ts
guards: [botHasPermissionIn(PermissionFlagsBits.SendMessages, hasSystemChannel)]
// Auto-resolves to: [inCachedGuild, hasSystemChannel, botHasPermissionIn(SendMessages, hasSystemChannel)]
```

## Error Handling (attempt)

```ts
type Result<T, E=Error> = { success:true, data:T, error?:never } | { success:false, data?:never, error:E };
attempt(fn) → Promise<Result<T,Error>>  // wraps sync/async, catches throws
isResolved(result) / isError(result)     // type guards
unwrap(result) → T                       // throws on error
unwrapOr(result, default) → T           // default on error
mapResult(result, fn) / mapError(result, fn)
```

**In sparks:** All async calls and fallible operations should use `attempt()`. Errors are logged, not thrown.

## Interaction Routing (built-in)

`interaction-create.ts` routes each interaction type to a dedicated handler:

- `isChatInputCommand()` → `handleCommand()` → `client.commands.get(name)` → `spark.execute()`
- `isContextMenuCommand()` → `handleCommand()` → `client.commands.get(name)` → `spark.execute()`
- `isAutocomplete()` → `handleAutocomplete()` → `client.commands.get(name)` → `spark.executeAutocomplete()`
- `isMessageComponent()` → `handleComponent()` → `findComponentSpark()` → `spark.execute()`
- `isModalSubmit()` → `handleComponent()` → `findComponentSpark()` → `spark.execute()`

**Auto-reply on guard failure:** If `!interaction.replied && !interaction.deferred`, replies ephemeral with guard failure reason.

## Logging Convention

```ts
// processGuards handles guard logging automatically:
// - Intentional failures: info (user-facing) or warn (silent/gateway/scheduled)
// - Guard exceptions: error with AppError wrapping

// Spark action/autocomplete logging (unchanged):
client.logger.error({ err, command: name }, 'Command action failed');   // use 'err' key for errors
client.logger.warn({ err, command: name }, 'Autocomplete handler failed');
client.logger.info({ key: val }, 'Descriptive message');
// Pattern: logger.level(metadata_object, message_string)
// IMPORTANT: always use { err } key (not { error }) — triggers serializer
```

## Error Classes

Use `AppError` for domain errors — adds structured `code`, `metadata`, `isOperational` for Sentry:

```ts
throw new AppError('Queue full', { code: 'ERR_QUEUE_FULL', metadata: { size: 100 } });
// In catch: wrap with cause chain
throw new AppError('Failed to process', { code: 'ERR_PROCESS', cause: originalError });
```

See `docs/errors.md` for full hierarchy (HttpError, ValidationError, DatabaseError) and best practices.

## File Export Convention

Each spark file exports named const(s). The loader discovers sparks by checking all named exports for `type` ∈ {'command','component','gateway-event','scheduled-event'} + `register` function. Multiple sparks per file are supported.
