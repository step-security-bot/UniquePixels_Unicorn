# Commands

Commands in Unicorn are built using the Spark system. Every slash command is a `CommandSpark` created via a factory function and auto-registered through the loader.

There are three factory functions, each suited to a different level of complexity:

| Factory | Use case |
|---|---|
| `defineCommand` | Simple commands with no subcommands |
| `defineCommandWithAutocomplete` | Simple commands that need autocomplete |
| `defineCommandGroup` | Commands composed of subcommands and/or subcommand groups |

All three return a `CommandSpark` and register identically. The interaction router, loader, and client collections require no changes regardless of which factory you use.

## Simple Commands

Use `defineCommand` for standalone slash commands.

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';

export const ping = defineCommand({
  command: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),
  action: async (interaction, client) => {
    const start = Date.now();
    const reply = await interaction.reply({ content: 'Pinging...', fetchReply: true });
    const roundtrip = reply.createdTimestamp - start;
    await interaction.editReply(`Pong! Roundtrip: ${roundtrip}ms | WebSocket: ${client.ws.ping}ms`);
  },
});
```

### With Guards

Guards run before the action and can narrow the interaction type:

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { hasPermission, inCachedGuild } from '@/guards/built-in';

export const kick = defineCommand({
  command: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member')
    .addUserOption(opt => opt.setName('target').setDescription('Member to kick').setRequired(true)),
  guards: [inCachedGuild, hasPermission(PermissionFlagsBits.KickMembers)],
  action: async (interaction, client) => {
    // interaction.guild is guaranteed to exist after inCachedGuild
    const target = interaction.options.getUser('target', true);
    await interaction.guild.members.kick(target.id);
    await interaction.reply(`Kicked ${target.tag}`);
  },
});
```

### With Autocomplete

Use `defineCommandWithAutocomplete` when an option needs dynamic suggestions:

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommandWithAutocomplete } from '@/core/sparks';

export const search = defineCommandWithAutocomplete({
  command: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for something')
    .addStringOption(opt =>
      opt.setName('query').setDescription('Search query').setAutocomplete(true),
    ),
  autocomplete: async (interaction, client) => {
    const query = interaction.options.getFocused();
    const results = await searchDatabase(query);
    await interaction.respond(
      results.slice(0, 25).map(r => ({ name: r.title, value: r.id })),
    );
  },
  action: async (interaction, client) => {
    const query = interaction.options.getString('query', true);
    await interaction.reply(`You searched for: ${query}`);
  },
});
```

## Command Groups

Use `defineCommandGroup` when a slash command is composed of subcommands, subcommand groups, or both. This is the recommended pattern for any command with nesting.

### Why Not a Switch Statement?

A common approach is to put all subcommands in one `defineCommand` with a switch:

```ts
// Avoid this pattern
export const manage = defineCommand({
  command: builder,
  action: async (interaction, client) => {
    switch (interaction.options.getSubcommand()) {
      case 'add': return handleAdd(interaction, client);
      case 'remove': return handleRemove(interaction, client);
      case 'list': return handleList(interaction, client);
    }
  },
});
```

This has several drawbacks:
- No per-subcommand guards (all subcommands share one guard set)
- Manual routing that must be updated for every new subcommand
- No per-subcommand autocomplete routing
- The action function grows into a monolith

`defineCommandGroup` solves all of these.

### Direct Subcommands

For commands like `/manage list`, `/manage add`, `/manage remove`:

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommandGroup } from '@/core/sparks';
import { hasPermission, inCachedGuild } from '@/guards/built-in';

export const manage = defineCommandGroup({
  command: new SlashCommandBuilder()
    .setName('manage')
    .setDescription('Manage items')
    .addSubcommand(sub => sub.setName('list').setDescription('List all items'))
    .addSubcommand(sub => sub.setName('add').setDescription('Add an item'))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove an item')),

  // Top-level guards run before ANY subcommand
  guards: [inCachedGuild],

  subcommands: {
    list: {
      // No extra guards needed for viewing
      action: async (interaction, client) => {
        await interaction.reply('Here are the items...');
      },
    },
    add: {
      // Per-subcommand guard: only staff can add
      guards: [hasPermission(PermissionFlagsBits.ManageGuild)],
      action: async (interaction, client) => {
        await interaction.reply('Item added!');
      },
    },
    remove: {
      guards: [hasPermission(PermissionFlagsBits.ManageGuild)],
      action: async (interaction, client) => {
        await interaction.reply('Item removed!');
      },
    },
  },
});
```

### Subcommand Groups

For deeper nesting like `/settings roles add`, `/settings roles remove`, `/settings channels set`:

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommandGroup } from '@/core/sparks';
import { inCachedGuild } from '@/guards/built-in';

export const settings = defineCommandGroup({
  command: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Server settings')
    .addSubcommandGroup(group =>
      group
        .setName('roles')
        .setDescription('Role settings')
        .addSubcommand(sub => sub.setName('add').setDescription('Add a role'))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove a role')),
    )
    .addSubcommandGroup(group =>
      group
        .setName('channels')
        .setDescription('Channel settings')
        .addSubcommand(sub => sub.setName('set').setDescription('Set a channel')),
    ),

  guards: [inCachedGuild],

  groups: {
    roles: {
      add:    { action: async (interaction, client) => { /* ... */ } },
      remove: { action: async (interaction, client) => { /* ... */ } },
    },
    channels: {
      set:    { action: async (interaction, client) => { /* ... */ } },
    },
  },
});
```

### Mixing Subcommands and Groups

Discord allows both direct subcommands and subcommand groups on the same command:

```ts
export const config = defineCommandGroup({
  command: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Bot configuration')
    .addSubcommand(sub => sub.setName('view').setDescription('View current config'))
    .addSubcommandGroup(group =>
      group
        .setName('notifications')
        .setDescription('Notification settings')
        .addSubcommand(sub => sub.setName('enable').setDescription('Enable'))
        .addSubcommand(sub => sub.setName('disable').setDescription('Disable')),
    ),

  guards: [inCachedGuild],

  // /config view
  subcommands: {
    view: { action: async (interaction, client) => { /* ... */ } },
  },

  // /config notifications enable, /config notifications disable
  groups: {
    notifications: {
      enable:  { action: async (interaction, client) => { /* ... */ } },
      disable: { action: async (interaction, client) => { /* ... */ } },
    },
  },
});
```

### Per-Subcommand Autocomplete

Each subcommand handler can define its own autocomplete:

```ts
export const lookup = defineCommandGroup({
  command: new SlashCommandBuilder()
    .setName('lookup')
    .setDescription('Lookup commands')
    .addSubcommand(sub =>
      sub
        .setName('user')
        .setDescription('Lookup a user')
        .addStringOption(opt =>
          opt.setName('name').setDescription('Username').setAutocomplete(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('role')
        .setDescription('Lookup a role')
        .addStringOption(opt =>
          opt.setName('name').setDescription('Role name').setAutocomplete(true),
        ),
    ),

  subcommands: {
    user: {
      autocomplete: async (interaction, client) => {
        const query = interaction.options.getFocused();
        const users = await searchUsers(query);
        await interaction.respond(users.map(u => ({ name: u.tag, value: u.id })));
      },
      action: async (interaction, client) => {
        const name = interaction.options.getString('name', true);
        await interaction.reply(`User: ${name}`);
      },
    },
    role: {
      autocomplete: async (interaction, client) => {
        const query = interaction.options.getFocused();
        const roles = await searchRoles(query);
        await interaction.respond(roles.map(r => ({ name: r.name, value: r.id })));
      },
      action: async (interaction, client) => {
        const name = interaction.options.getString('name', true);
        await interaction.reply(`Role: ${name}`);
      },
    },
  },
});
```

## File Organization

For simple commands, a single file is fine:

```text
src/sparks/ping.ts
```

For command groups with substantial logic, split subcommand handlers into separate files:

```text
src/sparks/manage/
  command.ts              # defineCommandGroup + builder
  subcommands/
    list.ts               # { action } handler object
    add.ts                # { guards, action } handler object
    remove.ts             # { guards, action } handler object
```

Each subcommand file exports a plain handler object:

```ts
// src/sparks/manage/subcommands/add.ts
import type { SubcommandHandler } from '@/core/sparks';
import { hasPermission } from '@/guards/built-in';
import { PermissionFlagsBits } from 'discord.js';

export const add: SubcommandHandler = {
  guards: [hasPermission(PermissionFlagsBits.ManageGuild)],
  action: async (interaction, client) => {
    await interaction.reply('Item added!');
  },
};
```

Then compose them in the command file:

```ts
// src/sparks/manage/command.ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommandGroup } from '@/core/sparks';
import { inCachedGuild } from '@/guards/built-in';
import { add } from './subcommands/add';
import { list } from './subcommands/list';
import { remove } from './subcommands/remove';

export const manage = defineCommandGroup({
  command: new SlashCommandBuilder()
    .setName('manage')
    .setDescription('Manage items')
    .addSubcommand(sub => sub.setName('list').setDescription('List items'))
    .addSubcommand(sub => sub.setName('add').setDescription('Add an item'))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove an item')),
  guards: [inCachedGuild],
  subcommands: { list, add, remove },
});
```

## Execution Flow

Understanding how commands execute helps when debugging:

### Simple commands (`defineCommand`)

```text
Interaction arrives
  -> interaction-create routes by commandName
  -> spark.execute(interaction, client)
    -> runGuards(guards, interaction, client)
    -> if guards fail: return { ok: false, reason }
    -> action(narrowedInteraction, client)
    -> if action throws: log error (don't crash)
```

### Command groups (`defineCommandGroup`)

```text
Interaction arrives
  -> interaction-create routes by commandName
  -> spark.execute(interaction, client)
    -> runGuards(topLevelGuards, interaction, client)
    -> if top guards fail: return { ok: false, reason }
    -> resolve subcommand from interaction.options
    -> find handler in subcommands{} or groups{}
    -> if no handler: return { ok: false, reason }
    -> runGuards(subcommandGuards, narrowedInteraction, client)
    -> if sub guards fail: return { ok: false, reason }
    -> handler.action(narrowedInteraction, client)
    -> if action throws: log error (don't crash)
```

In both cases, if guards fail and the interaction hasn't been replied to, the interaction router sends an ephemeral error message with the guard's failure reason.

## Guard Composition

Guards are the primary mechanism for validation and type narrowing. They compose at two levels in command groups:

**Top-level guards** run for every subcommand. Use these for shared requirements:
- `inCachedGuild` - require the command to be used in a server
- `hasPermission(...)` - require a base permission level

**Per-subcommand guards** run after top-level guards. Use these for subcommand-specific checks:
- Additional permission requirements for destructive actions
- Rate limiting on specific subcommands
- Custom validation logic

```ts
defineCommandGroup({
  guards: [inCachedGuild],                    // All subcommands require a guild
  subcommands: {
    view: {
      action: viewHandler,                    // No extra guards needed
    },
    delete: {
      guards: [hasPermission(PermissionFlagsBits.ManageGuild)],  // Extra permission
      action: deleteHandler,
    },
  },
});
```

## API Reference

### `defineCommand<TGuarded>(options)`

Creates a simple command spark.

| Option | Type | Required | Description |
|---|---|---|---|
| `command` | `CommandBuilder` | Yes | The slash command builder |
| `guards` | `Guard[]` | No | Guards to run before the action |
| `action` | `CommandAction<TGuarded>` | Yes | Handler function |

### `defineCommandWithAutocomplete<TGuarded>(options)`

Creates a command spark with autocomplete support. Extends `defineCommand` options.

| Option | Type | Required | Description |
|---|---|---|---|
| `autocomplete` | `(interaction, client) => void` | Yes | Autocomplete handler |

### `defineCommandGroup<TGuarded>(options)`

Creates a command group spark that routes to subcommand handlers.

| Option | Type | Required | Description |
|---|---|---|---|
| `command` | `CommandBuilder` | Yes | The slash command builder (with subcommands) |
| `guards` | `Guard[]` | No | Top-level guards shared by all subcommands |
| `subcommands` | `Record<string, SubcommandHandler>` | No | Direct subcommand handlers |
| `groups` | `Record<string, Record<string, SubcommandHandler>>` | No | Grouped subcommand handlers |

At least one of `subcommands` or `groups` should be provided.

### `SubcommandHandler<TGuarded>`

A handler object for a single subcommand.

| Property | Type | Required | Description |
|---|---|---|---|
| `guards` | `Guard[]` | No | Guards specific to this subcommand |
| `action` | `CommandAction<TGuarded>` | Yes | Handler function |
| `autocomplete` | `(interaction, client) => void` | No | Autocomplete for this subcommand |
