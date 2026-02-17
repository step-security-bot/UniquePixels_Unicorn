# Unicorn

A Discord bot framework built on [Discord.js](https://discord.js.org/) and TypeScript, designed to run on [Bun](https://bun.sh/).

Unicorn provides a structured, type-safe approach to building Discord bots using a **Spark** system for modular command/event handling and composable **Guards** for validation.

## Features

- **Spark system** -- modular handlers for commands, components, gateway events, and scheduled tasks
- **Guard composition** -- chainable validation functions with TypeScript type narrowing
- **Type-safe configuration** -- Zod-validated config with secret resolution and environment mapping
- **Scheduled events** -- cron-based tasks with timezone support
- **Component pattern matching** -- exact, prefix, wildcard, and regex matching for button/select/modal handlers
- **Health check server** -- liveness and readiness probes for container orchestration
- **Structured logging** -- Pino with Sentry integration in production
- **Graceful shutdown** -- coordinated cleanup of jobs, servers, and the Discord client

## Requirements

- [Bun](https://bun.sh/)

## Quick Start

```bash
# Install dependencies
bun install

# Set up environment variables
# Bun loads .env automatically -- no dotenv needed
echo 'apiKey=your-bot-token-here' > .env

# Start the bot
bun start
```

## Project Structure

```text
src/
├── index.ts                    # Entry point and startup sequence
├── config.ts                   # Application configuration
├── sentry.ts                   # Sentry initialization (preloaded)
├── core/
│   ├── client/                 # UnicornClient interface and initialization
│   ├── configuration/          # Zod schemas, parseConfig(), type-safe IDs
│   ├── guards/                 # Guard infrastructure (runGuards, createGuard)
│   ├── logger/                 # Pino logger with Sentry transport
│   ├── sparks/                 # Spark definitions and loader
│   └── lib/                    # Shared utilities (attempt)
├── guards/
│   └── built-in/               # Built-in guard implementations
└── sparks/
    ├── built-in/               # Core event handlers (interaction routing, ready)
    └── ...                     # Your sparks go here
```

## Creating Sparks

### Commands

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';

export const ping = defineCommand({
  command: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),
  action: async (interaction, client) => {
    await interaction.reply(`Pong! ${client.ws.ping}ms`);
  },
});
```

### Components

```ts
import { defineComponent } from '@/core/sparks';

export const confirmButton = defineComponent({
  id: 'confirm-action',
  action: async (interaction, client) => {
    await interaction.reply('Confirmed!');
  },
});
```

### Gateway Events

```ts
import { Events } from 'discord.js';
import { defineGatewayEvent } from '@/core/sparks';

export const memberJoin = defineGatewayEvent({
  event: Events.GuildMemberAdd,
  action: async (member, client) => {
    client.logger.info({ userId: member.id }, 'New member joined');
  },
});
```

### Scheduled Events

```ts
import { defineScheduledEvent } from '@/core/sparks';

export const dailyCleanup = defineScheduledEvent({
  id: 'daily-cleanup',
  schedule: '0 0 * * *',
  action: async (ctx) => {
    ctx.client.logger.info('Running daily cleanup...');
  },
});
```

## Guards

Guards are composable validation functions that run before a spark's action:

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { inCachedGuild, hasPermission } from '@/guards/built-in';

export const kick = defineCommand({
  command: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member'),
  guards: [inCachedGuild, hasPermission(PermissionFlagsBits.KickMembers)],
  action: async (interaction, client) => {
    // interaction is typed with guild guaranteed
    await interaction.reply('Done.');
  },
});
```

See [docs/guards.md](docs/guards.md) for the full guard reference.

## Scripts

```bash
bun start          # Run with Sentry preload
bun lint           # Format + check + typecheck
bun lint:format    # Biome format
bun lint:code      # Biome check
bun lint:tsc       # TypeScript typecheck
bun test           # Run tests
```

## Documentation

- [Commands](docs/commands.md) -- slash commands, autocomplete, subcommand groups
- [Components](docs/components.md) -- buttons, select menus, modals, pattern matching
- [Guards](docs/guards.md) -- built-in guards, custom guards, composition
- [Gateway Events](docs/gateway-events.md) -- event listeners, once vs recurring
- [Scheduled Events](docs/scheduled-events.md) -- cron tasks, timezones, lifecycle
- [Configuration](docs/configuration.md) -- config schema, secrets, envMap, health checks

## License

[MIT](LICENSE)
