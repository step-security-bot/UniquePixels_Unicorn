# Unicorn Claude Guidance

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Unicorn is a Discord bot framework built on Discord.js and TypeScript, designed to run on Bun. It provides a structured, type-safe approach to building Discord bots using a "Spark" system for modular command/event handling with composable Guards for validation.

**Key Dependencies:**
- `discord.js` v14 - Discord API library
- `zod` v4 - Schema validation
- `pino` - Structured logging
- `cron` - Scheduled task management
- `@sentry/bun` - Error monitoring (production)

## Designed for Bun

Unicorn is designed to run on Bun.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

### Bun APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.
- `Bun.Glob` for file pattern matching

### Testing

Use `bun test` to run tests.

```ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Architecture Overview

### UnicornClient

Extended Discord.js Client with Unicorn-specific properties:

```typescript
interface UnicornClient<T extends UnicornConfig> extends Client {
  logger: Logger;                                         // Pino logger
  config: ParsedConfig<T>;                               // Type-safe config
  commands: Collection<string, BaseCommandSpark>;        // Command sparks by name
  components: Collection<string, BaseComponentSpark>;    // Exact-match components (O(1))
  componentPatterns: BaseComponentSpark[];               // Pattern-match components (O(n))
  scheduledJobs: Collection<string, CronJob>;            // Active cron jobs
}
```

### Spark System

Sparks are the core building blocks - modular handlers that register themselves with the client.

**Spark Types:**
1. **CommandSpark** - Slash commands with optional autocomplete
2. **ComponentSpark** - Button/select menu/modal handlers with pattern matching
3. **GatewayEventSpark** - Discord gateway event handlers
4. **ScheduledEventSpark** - Cron-based scheduled tasks

All sparks share a common pattern:
- Created via `defineX()` factory functions
- Have a `type` discriminator field
- Have `guards` array for validation
- Have `action` function for execution
- Have `register(client)` method
- Have `execute()` that runs guards then action

### Guard System

Guards are composable validation functions that can narrow types:

```typescript
type Guard<TInput, TOutput extends TInput> = (
  input: TInput,
  client: UnicornClient,
) => GuardResult<TOutput> | Promise<GuardResult<TOutput>>;

type GuardResult<T> = { ok: true; value: T } | { ok: false; reason: string };
```

**Built-in Guards** (`@/guards/built-in`):
- `inCachedGuild` - Narrows to GuildInteraction (interaction has cached guild)
- `hasPermission(perms)` - Checks user has permissions
- `botHasPermission(perms)` - Checks bot has permissions
- `channelType(...types)` - Narrows to specific channel types
- `isUser(...userIds)` - Checks user ID is in list
- `notBot` - Filters out bot messages
- `messageInGuild` - Checks message is in guild
- `rateLimit({ limit, window })` - Rate limiting with LRU eviction

**Usage:**
```typescript
export const kick = defineCommand({
  command: new SlashCommandBuilder().setName('kick').setDescription('Kick'),
  guards: [inCachedGuild, hasPermission(PermissionFlagsBits.KickMembers)],
  action: async (interaction, client) => {
    // interaction is now typed with guild guaranteed to exist
    await interaction.guild.members.kick(targetId);
  },
});
```

## File Structure

```
src/
├── index.ts                    # Main entry point, startup sequence
├── config.ts                   # App configuration (satisfies UnicornConfig)
├── sentry.ts                   # Sentry initialization (preloaded)
├── core/
│   ├── client/index.ts         # UnicornClient interface & initialization
│   ├── configuration/          # Zod schemas, parseConfig(), type-safe IDs
│   ├── guards/index.ts         # Guard infrastructure (runGuards, createGuard)
│   ├── logger/index.ts         # Pino logger with Sentry transport
│   ├── sparks/
│   │   ├── command.ts          # defineCommand, defineCommandWithAutocomplete
│   │   ├── component.ts        # defineComponent, findComponentSpark, matchCustomId
│   │   ├── gateway-event.ts    # defineGatewayEvent
│   │   ├── scheduled-event.ts  # defineScheduledEvent, stopAllScheduledJobs
│   │   ├── loader.ts           # loadSparks(), collectCommandBuilders()
│   │   └── index.ts            # Barrel export
│   └── lib/
│       ├── attempt/            # Error handling utilities (attempt, isError)
│       └── error/              # Custom error types
├── guards/
│   ├── index.ts                # Re-exports core + built-in guards
│   └── built-in/               # Built-in guard implementations
├── sparks/
│   ├── built-in/
│   │   ├── interaction-create.ts  # Routes interactions to handlers
│   │   └── ready.ts               # Client ready event
│   └── [user sparks]           # User-defined sparks go here
```

## Creating Sparks

### Commands

```typescript
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { inCachedGuild } from '@/guards';

export const ping = defineCommand({
  command: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),
  guards: [],  // optional
  action: async (interaction, client) => {
    await interaction.reply(`Pong! ${client.ws.ping}ms`);
  },
});
```

### Components

```typescript
import { defineComponent } from '@/core/sparks';

// Exact match
export const confirmButton = defineComponent({
  id: 'confirm-action',
  action: async (interaction, client) => {
    await interaction.reply('Confirmed!');
  },
});

// Prefix match — trailing dash matches 'ban-<anything>' (one segment)
export const ban = defineComponent({
  id: 'ban-',
  guards: [inCachedGuild],
  action: async (interaction, client) => {
    const userId = interaction.customId.split('-').pop();
    await interaction.guild.members.ban(userId);
  },
});

// Wildcard pattern
export const ticketClose = defineComponent({
  id: 'ticket-close-*',
  action: async (interaction, client) => {
    const ticketId = interaction.customId.split('-').pop();
    // ...
  },
});

// Regex pattern
export const dynamicAction = defineComponent({
  id: /^action-(?<type>\w+)-(?<id>\d+)$/,
  action: async (interaction, client) => {
    // Parse customId
  },
});
```

### Gateway Events

```typescript
import { Events } from 'discord.js';
import { defineGatewayEvent } from '@/core/sparks';

export const ready = defineGatewayEvent({
  event: Events.ClientReady,
  once: true,
  action: (readyClient, client) => {
    client.logger.info(`Logged in as ${readyClient.user.tag}`);
  },
});
```

### Scheduled Events

```typescript
import { defineScheduledEvent } from '@/core/sparks';

export const dailyCleanup = defineScheduledEvent({
  id: 'daily-cleanup',
  schedule: '0 0 * * *',  // Midnight UTC
  timezone: 'UTC',        // optional, defaults to UTC
  action: async (ctx) => {
    ctx.client.logger.info('Running daily cleanup...');
  },
});
```

## Configuration System

Configuration is type-safe with Zod validation:

```typescript
// src/config.ts
export const appConfig = {
  discord: {
    appID: '1234567890',
    apiToken: 'secret://apiKey',  // Resolved from env var
    intents: [GatewayIntentBits.Guilds],
    enabledPartials: [Partials.Channel],
    enforceNonce: true,
    defaultPresence: {
      status: 'online',
      activities: [{ type: ActivityType.Watching, name: 'communities' }],
    },
  },
  misc: {},
  ids: {
    role: { admin: '123456789' },
    channel: { logs: '234567890' },
    emoji: {},
  },
} satisfies UnicornConfig;
```

**Secret resolution:** `secret://KEY` resolves to `process.env.KEY`

**Type-safe ID access:** `client.config.ids.role.admin` is typed as `Snowflake`

## Key Patterns

### Error Handling

- Startup errors THROW and terminate (config, loading, registration)
- Runtime errors are logged but don't terminate (event handlers, commands)
- Use `attempt()` wrapper for safe async execution

### Component Lookup

- Exact ID matches: `client.components` Map (O(1) lookup)
- Prefix matches (`id: 'ban-'`): `client.components` Map (O(1) lookup)
- Pattern matches (wildcard/regex): `client.componentPatterns` array (O(n) search)
- `findComponentSpark()` checks exact first, then prefix, then patterns

### Rate Limiting

- LRU eviction with bounded memory (100k max entries)
- `touchEntry()` moves to end on access for LRU tracking
- Periodic cleanup via `cleanupRateLimits()` every 5 minutes

### Health Check Server

Enabled via `HEALTH_CHECK_PORT` env var:
- `/health`, `/healthz` - Liveness probe (always 200)
- `/ready`, `/readyz` - Readiness probe (200 if `client.isReady()`)

### Graceful Shutdown

- 10-second timeout with force exit
- Clears cleanup interval
- Stops health check server
- Stops all scheduled jobs
- Destroys Discord client

## Import Aliases

The project uses TypeScript path aliases:
- `@/*` maps to `src/*`

Example: `import { UnicornClient } from '@/core/client';`

## Logging

Uses Pino with Sentry integration in production:
- `client.logger.info/debug/warn/error()`
- First arg can be object for structured data: `logger.info({ userId }, 'User joined')`
- `pino-pretty` is devDependency only

## Scripts

```bash
bun start          # Run with Sentry preload
bun lint           # Format + check + typecheck
bun lint:format    # Biome format
bun lint:code      # Biome check
bun lint:tsc       # TypeScript typecheck
bun test           # Run tests
```
