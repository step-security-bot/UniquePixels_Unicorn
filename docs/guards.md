# Guards

Guards are composable validation functions that run before a spark's action. They can validate conditions, check permissions, enforce rate limits, and narrow TypeScript types so your action receives a more specific type than the raw input.

Every guard receives `(input, client)` and returns one of:

- `{ ok: true, value }` -- validation passed; `value` is the (possibly narrowed) input
- `{ ok: false, reason }` -- validation failed; `reason` is a human-readable explanation

Guards are used with commands, components, and gateway event sparks.

## Built-in Guards

Unicorn ships with a set of guards covering the most common validation needs. Import them from `@/guards/built-in`:

```ts
import {
  inCachedGuild,
  hasPermission,
  botHasPermission,
  channelType,
  isUser,
  notBot,
  messageInGuild,
  rateLimit,
  hasSystemChannel,
  hasPublicUpdatesChannel,
  hasRulesChannel,
  hasSafetyAlertsChannel,
} from '@/guards/built-in';
```

### `inCachedGuild`

Ensures the interaction is in a cached guild. Narrows the interaction type to `GuildInteraction`, which guarantees `guild`, `guildId`, `member`, and `channel` are present and typed.

This is the most commonly used guard and should come first in any guard chain that needs guild data.

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { inCachedGuild } from '@/guards/built-in';

export const serverInfo = defineCommand({
  command: new SlashCommandBuilder()
    .setName('server-info')
    .setDescription('Show server information'),
  guards: [inCachedGuild],
  action: async (interaction, client) => {
    // interaction.guild, interaction.member, interaction.guildId are all guaranteed
    await interaction.reply(`Server: ${interaction.guild.name} (${interaction.guild.memberCount} members)`);
  },
});
```

**Failure message:** "This command can only be used in a server."

### `hasPermission(permissions, message?)`

Checks that the invoking user has the specified permission(s). The input must already have a `member` property (i.e., place `inCachedGuild` before this guard in the chain).

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { hasPermission, inCachedGuild } from '@/guards/built-in';

export const purge = defineCommand({
  command: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete messages in bulk')
    .addIntegerOption(opt => opt.setName('count').setDescription('Number of messages').setRequired(true)),
  guards: [inCachedGuild, hasPermission(PermissionFlagsBits.ManageMessages)],
  action: async (interaction, client) => {
    const count = interaction.options.getInteger('count', true);
    await interaction.channel.bulkDelete(count);
    await interaction.reply({ content: `Deleted ${count} messages.`, ephemeral: true });
  },
});
```

You can check multiple permissions at once:

```ts
guards: [inCachedGuild, hasPermission(PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageChannels)]
```

An optional second argument overrides the default failure message:

```ts
hasPermission(PermissionFlagsBits.Administrator, 'This command is restricted to administrators.')
```

**Default failure message:** "You need the following permission(s): ManageMessages" (lists the resolved permission names).

### `botHasPermission(permissions, message?)`

Checks that the **bot** has the specified permission(s) in the current channel. Like `hasPermission`, this requires `guild` and `channel` to already be present, so place `inCachedGuild` before it.

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { botHasPermission, inCachedGuild } from '@/guards/built-in';

export const embed = defineCommand({
  command: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Send a rich embed'),
  guards: [inCachedGuild, botHasPermission(PermissionFlagsBits.EmbedLinks)],
  action: async (interaction, client) => {
    await interaction.reply({ embeds: [/* ... */] });
  },
});
```

**Default failure message:** "I need the following permission(s): EmbedLinks"

### `channelType(...types)`

Ensures the interaction is in a channel of the specified type(s). Narrows the interaction's `channel` property to the matching type.

```ts
import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { channelType } from '@/guards/built-in';

export const threadOnly = defineCommand({
  command: new SlashCommandBuilder()
    .setName('thread-only')
    .setDescription('Only works in threads'),
  guards: [channelType(ChannelType.PublicThread, ChannelType.PrivateThread)],
  action: async (interaction, client) => {
    await interaction.reply('This is a thread!');
  },
});
```

**Failure message:** "This command can only be used in: PublicThread, PrivateThread" (lists the allowed channel type names).

### `isUser(userIds, message?)`

Restricts usage to a whitelist of user IDs. Useful for owner-only or admin-only commands.

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { isUser } from '@/guards/built-in';

export const deploy = defineCommand({
  command: new SlashCommandBuilder()
    .setName('deploy')
    .setDescription('Deploy slash commands'),
  guards: [isUser(['123456789012345678', '987654321098765432'])],
  action: async (interaction, client) => {
    await interaction.reply({ content: 'Deploying commands...', ephemeral: true });
  },
});
```

**Default failure message:** "You do not have permission to use this command."

### `notBot`

Filters out messages from bots. This guard operates on `Message`, not `Interaction`, and is intended for use with message-based gateway event sparks.

```ts
import { Events } from 'discord.js';
import { defineGatewayEvent } from '@/core/sparks';
import { notBot } from '@/guards/built-in';

export const messageLogger = defineGatewayEvent({
  event: Events.MessageCreate,
  guards: [notBot],
  action: (message, client) => {
    client.logger.info({ content: message.content }, 'New message from a human');
  },
});
```

**Failure message:** "Bots cannot use this."

### `messageInGuild`

Ensures a message was sent in a guild (not a DM). Like `notBot`, this guard operates on `Message` and narrows it to `Message<true>`.

```ts
import { Events } from 'discord.js';
import { defineGatewayEvent } from '@/core/sparks';
import { messageInGuild, notBot } from '@/guards/built-in';

export const guildMessages = defineGatewayEvent({
  event: Events.MessageCreate,
  guards: [notBot, messageInGuild],
  action: (message, client) => {
    // message is narrowed to Message<true> — guild properties guaranteed
    client.logger.info({ guild: message.guildId }, 'Guild message received');
  },
});
```

**Failure message:** "This can only be used in a server."

### `rateLimit({ limit, window, keyFn?, message? })`

Limits how many times a user (or other key) can trigger an action within a time window. Uses an in-memory store with LRU eviction (bounded to 100k entries) to prevent unbounded memory growth.

| Option | Type | Required | Description |
|---|---|---|---|
| `limit` | `number` | Yes | Maximum number of uses within the window |
| `window` | `number` | Yes | Time window in milliseconds |
| `keyFn` | `(input) => string` | No | Custom key function (default: user ID) |
| `message` | `string` | No | Custom failure message |

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { rateLimit } from '@/guards/built-in';

// 3 uses per 30 seconds per user
export const generate = defineCommand({
  command: new SlashCommandBuilder()
    .setName('generate')
    .setDescription('Generate something expensive'),
  guards: [rateLimit({ limit: 3, window: 30_000 })],
  action: async (interaction, client) => {
    await interaction.reply('Generating...');
  },
});
```

With a custom key function for per-guild rate limiting:

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { inCachedGuild, rateLimit } from '@/guards/built-in';

export const announce = defineCommand({
  command: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Make an announcement'),
  guards: [
    inCachedGuild,
    rateLimit({
      limit: 10,
      window: 60_000,
      keyFn: (interaction) => `${interaction.guildId}:${interaction.user.id}`,
    }),
  ],
  action: async (interaction, client) => {
    await interaction.reply('Announcement sent!');
  },
});
```

Expired entries are cleaned up automatically via `cleanupRateLimits()`, which runs on a periodic interval.

**Default failure message:** "Rate limited. Try again in N seconds."

### Special Channel Guards

The special channel guards are **factory functions** that check if Discord's special guild channels are configured and whether the bot has permission to send messages in them. They work with **any input that has a `guild` property**, including interactions (after `inCachedGuild`), gateway events with `GuildMember` objects, `Message` objects in guilds, and `Guild` objects directly.

The factory pattern (`hasSystemChannel()` instead of `hasSystemChannel`) enables TypeScript to infer the correct narrowed type at the call site. To get full type narrowing in your action, pass the input type explicitly: `hasSystemChannel<GuildMember>()`.

#### `hasSystemChannel()`

Ensures the guild has a system channel configured and the bot can send messages in it. The system channel is used for welcome messages, boost notifications, and other system events.

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { hasSystemChannel, inCachedGuild } from '@/guards/built-in';

export const announce = defineCommand({
  command: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post an announcement to the system channel'),
  guards: [inCachedGuild, hasSystemChannel()],
  action: async (interaction, client) => {
    // interaction.guild.systemChannel is guaranteed to exist
    await interaction.guild.systemChannel.send('Important announcement!');
    await interaction.reply({ content: 'Announcement posted!', ephemeral: true });
  },
});
```

Works with gateway events (pass the event arg type for full narrowing):

```ts
import { type GuildMember, Events } from 'discord.js';
import { defineGatewayEvent } from '@/core/sparks';
import { hasSystemChannel } from '@/guards/built-in';

export const memberLeave = defineGatewayEvent({
  event: Events.GuildMemberRemove,
  guards: [hasSystemChannel<GuildMember>()],
  action: async (member, client) => {
    // member.guild.systemChannel is guaranteed to exist and non-null
    await member.guild.systemChannel.send(`${member.user.tag} has left the server.`);
  },
});
```

**Failure messages:**

- "This server does not have a system channel configured."
- "I don't have permission to send messages in the system channel."

#### `hasPublicUpdatesChannel()`

Ensures the guild has a public updates channel configured and the bot can send messages in it. This channel is used for community server announcements and updates.

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { hasPublicUpdatesChannel, inCachedGuild } from '@/guards/built-in';

export const communityUpdate = defineCommand({
  command: new SlashCommandBuilder()
    .setName('community-update')
    .setDescription('Post to the public updates channel'),
  guards: [inCachedGuild, hasPublicUpdatesChannel()],
  action: async (interaction, client) => {
    await interaction.guild.publicUpdatesChannel.send('New community update!');
    await interaction.reply({ content: 'Update posted!', ephemeral: true });
  },
});
```

Works with gateway events:

```ts
import { type GuildMember, Events } from 'discord.js';
import { defineGatewayEvent } from '@/core/sparks';
import { hasPublicUpdatesChannel } from '@/guards/built-in';

export const memberWelcome = defineGatewayEvent({
  event: Events.GuildMemberAdd,
  guards: [hasPublicUpdatesChannel<GuildMember>()],
  action: async (member, client) => {
    await member.guild.publicUpdatesChannel.send(`Welcome to the server, ${member}!`);
  },
});
```

**Failure messages:**

- "This server does not have a public updates channel configured."
- "I don't have permission to send messages in the public updates channel."

#### `hasRulesChannel()`

Ensures the guild has a rules channel configured and the bot can send messages in it. This channel displays server rules to members.

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { hasRulesChannel, inCachedGuild } from '@/guards/built-in';

export const updateRules = defineCommand({
  command: new SlashCommandBuilder()
    .setName('update-rules')
    .setDescription('Post updated rules'),
  guards: [inCachedGuild, hasRulesChannel()],
  action: async (interaction, client) => {
    await interaction.guild.rulesChannel.send('Rules have been updated!');
    await interaction.reply({ content: 'Rules updated!', ephemeral: true });
  },
});
```

**Failure messages:**

- "This server does not have a rules channel configured."
- "I don't have permission to send messages in the rules channel."

#### `hasSafetyAlertsChannel()`

Ensures the guild has a safety alerts channel configured and the bot can send messages in it. This channel is used for Discord's safety and moderation alerts.

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { hasSafetyAlertsChannel, inCachedGuild } from '@/guards/built-in';

export const safetyAlert = defineCommand({
  command: new SlashCommandBuilder()
    .setName('safety-alert')
    .setDescription('Post a safety alert'),
  guards: [inCachedGuild, hasSafetyAlertsChannel()],
  action: async (interaction, client) => {
    await interaction.guild.safetyAlertsChannel.send('Safety alert posted.');
    await interaction.reply({ content: 'Alert sent!', ephemeral: true });
  },
});
```

**Failure messages:**

- "This server does not have a safety alerts channel configured."
- "I don't have permission to send messages in the safety alerts channel."

## Guard Composition

Guards execute sequentially. Each guard receives the output of the previous guard as its input. This means guards can progressively narrow the type:

```ts
guards: [inCachedGuild, hasPermission(PermissionFlagsBits.KickMembers)]
//        ^                ^
//        Narrows to        Receives GuildInteraction (member guaranteed),
//        GuildInteraction  checks permissions on the member
```

If any guard fails, the chain short-circuits and the remaining guards do not run.

### Top-level and Per-subcommand Guards

With `defineCommandGroup`, guards compose at two levels:

1. **Top-level guards** run for every subcommand. Use these for shared requirements like requiring a guild context.
2. **Per-subcommand guards** run after the top-level guards pass. Use these for subcommand-specific validation like additional permission checks.

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommandGroup } from '@/core/sparks';
import { hasPermission, inCachedGuild, rateLimit } from '@/guards/built-in';

export const channel = defineCommandGroup({
  command: new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Channel management')
    .addSubcommand(sub => sub.setName('info').setDescription('View channel info'))
    .addSubcommand(sub => sub.setName('lock').setDescription('Lock a channel'))
    .addSubcommand(sub => sub.setName('nuke').setDescription('Delete and recreate a channel')),

  // Runs for ALL subcommands
  guards: [inCachedGuild],

  subcommands: {
    info: {
      // No extra guards — anyone in the guild can view info
      action: async (interaction, client) => {
        await interaction.reply(`Channel: ${interaction.channel.name}`);
      },
    },
    lock: {
      // Only moderators can lock
      guards: [hasPermission(PermissionFlagsBits.ManageChannels)],
      action: async (interaction, client) => {
        await interaction.reply('Channel locked.');
      },
    },
    nuke: {
      // Admins only, with rate limiting
      guards: [
        hasPermission(PermissionFlagsBits.Administrator),
        rateLimit({ limit: 1, window: 300_000 }),
      ],
      action: async (interaction, client) => {
        await interaction.reply('Channel will be recreated.');
      },
    },
  },
});
```

The execution order for `/channel nuke` would be:

```text
inCachedGuild (top-level)
  -> hasPermission(Administrator) (per-subcommand)
    -> rateLimit (per-subcommand)
      -> action
```

If any guard in the chain fails, the action never runs.

## Receiving Narrowed Types in Actions

Guards narrow types at runtime, but TypeScript needs you to declare the expected narrowed type via a generic parameter. All spark definition functions (`defineCommand`, `defineCommandGroup`) and `SubcommandHandler` accept a `TGuarded` generic that defaults to `ChatInputCommandInteraction`. Without it, `action` receives the base type — so `interaction.guild` stays nullable even if `inCachedGuild` is in your guard chain.

Pass the narrowed type explicitly to get type safety:

```ts
import { type ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { type GuildInteraction, hasPermission, inCachedGuild } from '@/guards/built-in';

export const kick = defineCommand<GuildInteraction<ChatInputCommandInteraction>>({
  command: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member'),
  guards: [inCachedGuild, hasPermission(PermissionFlagsBits.KickMembers)],
  action: async (interaction, client) => {
    // interaction.guild, interaction.member, etc. are all non-null
    await interaction.guild.members.kick(interaction.options.getUser('target', true));
  },
});
```

The same applies to `SubcommandHandler` when defining subcommands for `defineCommandGroup`:

```ts
import type { ChatInputCommandInteraction } from 'discord.js';
import type { SubcommandHandler } from '@/core/sparks';
import { type GuildInteraction, inCachedGuild } from '@/guards/built-in';

const mySubcommand: SubcommandHandler<GuildInteraction<ChatInputCommandInteraction>> = {
  guards: [inCachedGuild],
  action: async (interaction, client) => {
    // interaction.guild guaranteed non-null
  },
};
```

> **Important:** The generic is a type-level assertion — TypeScript does not verify that your guards actually produce the declared narrowing. If you pass `GuildInteraction<ChatInputCommandInteraction>` but omit the `inCachedGuild` guard, TypeScript won't complain, but `interaction.guild` could be `null` at runtime. Always keep your generic in sync with your guard chain.

## Creating Custom Guards

Custom guards are built using `createGuard`, `guardPass`, and `guardFail` from `@/core/guards`.

### Simple Validation Guard

A guard that doesn't narrow the type -- it just validates a condition:

```ts
import type { Interaction } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

export const duringBusinessHours: Guard<Interaction, Interaction> = createGuard(
  (interaction, _client) => {
    const hour = new Date().getUTCHours();
    if (hour < 9 || hour >= 17) {
      return guardFail('This command is only available during business hours (09:00-17:00 UTC).');
    }
    return guardPass(interaction);
  },
);
```

### Type-Narrowing Guard

A guard that narrows the input type, similar to `inCachedGuild`:

```ts
import type { ChatInputCommandInteraction, GuildMember, Interaction } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

type InteractionWithBoostedMember = Interaction & {
  member: GuildMember & { premiumSince: Date };
};

export const isServerBooster: Guard<
  Interaction & { member: GuildMember },
  InteractionWithBoostedMember
> = createGuard((interaction, _client) => {
  if (!interaction.member.premiumSince) {
    return guardFail('This command is only available to server boosters.');
  }
  return guardPass(interaction as InteractionWithBoostedMember);
});
```

Use it after `inCachedGuild` to guarantee `member` is available:

```ts
export const boosterPerk = defineCommand({
  command: new SlashCommandBuilder()
    .setName('booster-perk')
    .setDescription('A perk for server boosters'),
  guards: [inCachedGuild, isServerBooster],
  action: async (interaction, client) => {
    await interaction.reply(`Boosting since ${interaction.member.premiumSince.toDateString()}!`);
  },
});
```

### Parameterized Guard Factory

For guards that take configuration, return a guard from a factory function:

```ts
import type { Interaction } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

export function requireOption(name: string): Guard<Interaction, Interaction> {
  return createGuard((interaction, _client) => {
    if (!interaction.isChatInputCommand()) {
      return guardFail('Not a command interaction.');
    }
    const value = interaction.options.get(name);
    if (!value) {
      return guardFail(`The "${name}" option is required.`);
    }
    return guardPass(interaction);
  });
}
```

## Guard Failure Behavior

When a guard fails, the spark's `execute()` method returns `{ ok: false, reason }` without running the action. The interaction router then checks whether the interaction has already been replied to or deferred:

- If **not replied to and not deferred**, the router sends an **ephemeral reply** with the guard's `reason` string as the message content.
- If **already replied to or deferred** (e.g., by a guard that sends its own response), no additional reply is sent.

This means guard failure reasons should be user-facing messages. Write them as clear, concise sentences that explain why the action was blocked.

```text
Interaction arrives
  -> spark.execute(interaction, client)
    -> runGuards(guards, interaction, client)
    -> Guard returns { ok: false, reason: "You need the following permission(s): ManageMessages" }
  -> result.ok is false
  -> interaction has not been replied to
  -> Router sends ephemeral reply: "You need the following permission(s): ManageMessages"
```

## API Reference

### Core Types

| Type | Description |
|---|---|
| `Guard<TInput, TOutput>` | A guard function `(input, client) => GuardResult<TOutput>` |
| `GuardResult<T>` | `{ ok: true, value: T }` or `{ ok: false, reason: string }` |
| `GuardOutput<G>` | Extracts the output type from a `Guard` type |
| `GuildInteraction<T>` | Interaction with `guild`, `guildId`, `member`, and `channel` guaranteed |
| `ChannelTypedInteraction<T, C>` | Interaction with `channel` narrowed to a specific `ChannelType` |

### Core Functions

| Function | Description |
|---|---|
| `createGuard(fn)` | Wraps a guard function with proper type inference |
| `guardPass(value)` | Creates a successful `GuardResult` |
| `guardFail(reason)` | Creates a failed `GuardResult` |
| `runGuard(guard, input, client)` | Runs a single guard |
| `runGuards(guards, input, client)` | Runs guards sequentially, short-circuiting on failure |
| `cleanupRateLimits()` | Clears expired rate limit entries from the in-memory store |

### Built-in Guards

| Guard | Input | Output | Description |
|---|---|---|---|
| `inCachedGuild` | `Interaction` | `GuildInteraction` | Narrows to guild interaction |
| `hasPermission(perms, msg?)` | `{ member: GuildMember }` | Same | Checks user permissions |
| `botHasPermission(perms, msg?)` | `{ guild, channel }` | Same | Checks bot permissions in channel |
| `channelType(...types)` | `Interaction` | `ChannelTypedInteraction` | Narrows to channel type |
| `isUser(ids, msg?)` | `Interaction` | Same | Whitelist by user ID |
| `notBot` | `Message` | `Message` | Filters bot messages |
| `messageInGuild` | `Message` | `Message<true>` | Ensures message is in a guild |
| `rateLimit(opts)` | `Interaction` | Same | Rate limits by key |
| `hasSystemChannel()` | `{ guild: Guild }` | Same + narrowed channel | Ensures system channel exists and bot can post |
| `hasPublicUpdatesChannel()` | `{ guild: Guild }` | Same + narrowed channel | Ensures public updates channel exists and bot can post |
| `hasRulesChannel()` | `{ guild: Guild }` | Same + narrowed channel | Ensures rules channel exists and bot can post |
| `hasSafetyAlertsChannel()` | `{ guild: Guild }` | Same + narrowed channel | Ensures safety alerts channel exists and bot can post |
