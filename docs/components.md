# Component Sparks

Components handle interactions from buttons, select menus, and modals. Each component is defined with `defineComponent()` and matched to incoming interactions by its `id`.

## Defining a Component

```ts
import { defineComponent } from '@/core/sparks';

export const myComponent = defineComponent({
  id: '...',       // how this component is matched (see below)
  guards: [],      // optional validation guards
  action: async (interaction, client) => {
    // handle the interaction
  },
});
```

## Custom ID Matching

The `id` field determines how a component is matched to an incoming interaction's `customId`. There are four matching strategies, evaluated in order:

### 1. Exact Match

The simplest option. The `customId` must be identical to the `id`.

```ts
export const confirm = defineComponent({
  id: 'confirm-action',
  action: async (interaction, client) => {
    await interaction.reply('Confirmed!');
  },
});
```

```ts
// Creating the button
new ButtonBuilder()
  .setCustomId('confirm-action')
  .setLabel('Confirm')
```

Exact matches are stored in a `Map` for O(1) lookup.

### 2. Prefix Match

Register a component with a trailing dash (`-`) to match any `customId` that shares the prefix plus one additional segment. This is the recommended approach for embedding a dynamic value (user ID, action name, etc.) in the `customId`.

```ts
export const ban = defineComponent({
  id: 'ban-',
  guards: [inCachedGuild],
  action: async (interaction, client) => {
    // interaction.customId is "ban-123456789012345678"
    const userId = interaction.customId.split('-').pop();

    await interaction.guild.members.ban(userId);
    await interaction.reply({ content: `Banned <@${userId}>.`, ephemeral: true });
  },
});
```

```ts
// Creating the button with a suffix
new ButtonBuilder()
  .setCustomId(`ban-${targetUser.id}`)
  .setLabel('Ban')
```

This matching is **explicit** — only components whose `id` ends with `-` will match suffixed custom IDs. A component with `id: 'ban'` (no trailing dash) will only match the exact string `'ban'`.

**Matching rules:**

- `ban-123` matches `id: 'ban-'` (single segment suffix)
- `ban-moderator` matches `id: 'ban-'` (any suffix, not just digits)
- `ban-` does NOT match `id: 'ban-'` (empty suffix rejected)
- `ban-foo-bar` does NOT match `id: 'ban-'` (multi-segment — use wildcard or regex instead)

Prefix matches are stored in the same `Map` as exact matches for O(1) lookup.

### 3. Wildcard

Use `*` in the `id` to match any substring. Wildcards are necessary when the dynamic part is in a non-trailing position or when you have multiple dynamic segments.

If the dynamic part is at the end, prefer a prefix match (`id: 'role-assign-'`) instead. Prefix matches use the same O(1) `Map` lookup as exact matches, while wildcards are compiled to a `RegExp` and checked via linear scan (O(n) over registered pattern components).

#### Trailing wildcard — works, but a prefix match (`'role-assign-'`) would be O(1) for single-segment suffixes

```ts
export const roleAssign = defineComponent({
  id: 'role-assign-*',
  action: async (interaction, client) => {
    const roleName = interaction.customId.split('-').pop();
    // roleName could be "moderator", "vip", "artist", etc.
  },
});
```

```ts
new ButtonBuilder()
  .setCustomId('role-assign-moderator')
  .setLabel('Assign Moderator')
```

#### Non-trailing wildcard

The dynamic segment is in the middle, so a prefix match can't work. This is where wildcards are necessary:

```ts
export const confirmDelete = defineComponent({
  id: 'confirm-*-delete',
  action: async (interaction, client) => {
    // interaction.customId is "confirm-123-delete"
    const itemId = interaction.customId.split('-')[1];
    // itemId = "123"
  },
});
```

```ts
new ButtonBuilder()
  .setCustomId(`confirm-${item.id}-delete`)
  .setLabel('Confirm Delete')
```

### 4. Regex

Use a `RegExp` for full control, including named capture groups. Best for complex `customId` formats with multiple dynamic segments.

```ts
export const pollVote = defineComponent({
  id: /^poll-vote-(?<pollId>\w+)-(?<option>\d+)$/,
  action: async (interaction, client) => {
    const match = interaction.customId.match(
      /^poll-vote-(?<pollId>\w+)-(?<option>\d+)$/,
    );
    const { pollId, option } = match!.groups!;
    // pollId = "abc123", option = "2"
  },
});
```

```ts
new ButtonBuilder()
  .setCustomId('poll-vote-abc123-2')
  .setLabel('Option 2')
```

Like wildcards, regex patterns are checked via linear scan — O(n).

## Lookup Order

When an interaction arrives, `findComponentSpark` resolves the handler in this order:

| Step | Strategy         | Performance | Example customId        | Matches component id |
| ---- | ---------------- | ----------- | ----------------------- | -------------------- |
| 1    | Exact match      | O(1)        | `confirm-action`        | `'confirm-action'`   |
| 2    | Prefix           | O(1)        | `ban-123456789`         | `'ban-'`             |
| 3    | Wildcard / Regex | O(n)        | `role-assign-moderator` | `'role-assign-*'`    |

The first match wins. If no match is found, the interaction receives a generic "no longer available" reply.

## Choosing a Strategy

| Scenario                                       | Strategy                     |
| ---------------------------------------------- | ---------------------------- |
| Static button, no dynamic data                 | Exact match                  |
| One dynamic segment (snowflake, string, etc.)  | Prefix match (`id: 'name-'`) |
| One dynamic segment in a non-trailing position | Wildcard (`id: 'a-*-b'`)     |
| Multiple dynamic segments or complex formats   | Regex                        |

## Guards

Components support the same guard system as commands. Guards run before the action and can narrow the interaction type.

```ts
import { inCachedGuild, hasPermission } from '@/guards';
import { PermissionFlagsBits } from 'discord.js';

export const kick = defineComponent({
  id: 'kick-',
  guards: [inCachedGuild, hasPermission(PermissionFlagsBits.KickMembers)],
  action: async (interaction, client) => {
    const userId = interaction.customId.split('-').pop();
    await interaction.guild.members.kick(userId);
  },
});

If a guard fails and the interaction hasn't been replied to, the failure reason is sent as an ephemeral reply.

## Modals

Modal submissions are routed through the same component system. Define a component whose `id` matches the modal's `customId`:

```ts
export const feedbackModal = defineComponent({
  id: 'feedback-modal',
  action: async (interaction, client) => {
    const response = interaction.fields.getTextInputValue('feedback-input');
    await interaction.reply({ content: 'Thanks for your feedback!', ephemeral: true });
  },
});
```
