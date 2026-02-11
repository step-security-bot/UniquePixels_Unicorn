# Configuration

Unicorn uses a type-safe configuration system built on Zod v4. Configuration is defined as a plain object in `src/config.ts`, validated and transformed at startup by `parseConfig()`.

The configuration system lives in `src/core/configuration/` and provides:

- **Schema validation** via Zod with clear error messages on failure
- **Secret resolution** from environment variables
- **Environment mapping** for production vs development values
- **Type-safe ID access** with literal key preservation

## Overview

Configuration follows a define-then-parse pattern:

1. Define your config object in `src/config.ts` using `satisfies UnicornConfig`
2. At startup, `parseConfig()` validates the object against the Zod schema
3. If validation fails, a `ZodError` is thrown and the process terminates
4. If validation succeeds, the parsed config is attached to the client as `client.config`

```ts
import { parseConfig } from '@/core/configuration';
import { appConfig } from './config.ts';

const config = parseConfig(appConfig);
// config is now validated, secrets are resolved, envMap values are selected
```

## Config Structure

Here is a complete example configuration:

```ts
import { ActivityType, GatewayIntentBits, Partials } from 'discord.js';
import type { UnicornConfig } from '@/core/configuration';

export const appConfig = {
  discord: {
    appID: '1225958405542383747',
    apiToken: 'secret://apiKey',
    intents: [GatewayIntentBits.Guilds],
    enabledPartials: [Partials.Channel],
    enforceNonce: true,
    defaultPresence: {
      status: 'online',
      activities: [
        { type: ActivityType.Watching, name: 'fabulous communities.' },
      ],
    },
  },
  healthCheckPort: 3000,
  misc: {},
  ids: {
    role: {
      admin: '123456789012345678',
      moderator: ['234567890123456789', '345678901234567890'],
    },
    channel: {
      logs: '456789012345678901',
    },
    emoji: {},
  },
} satisfies UnicornConfig;
```

### Schema Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `discord.appID` | `Snowflake \| envMap` | Yes | Discord application ID |
| `discord.apiToken` | `Secret \| envMap` | Yes | Bot token, resolved from env vars |
| `discord.intents` | `GatewayIntentBits[]` | Yes | Gateway intents to enable |
| `discord.enabledPartials` | `Partials[]` | Yes | Partials to enable |
| `discord.enforceNonce` | `boolean` | Yes | Whether to enforce nonces on messages |
| `discord.defaultPresence` | `object` | Yes | Bot presence on startup |
| `discord.defaultPresence.status` | `'online' \| 'idle' \| 'dnd' \| 'invisible'` | Yes | Online status |
| `discord.defaultPresence.activities` | `{ name: string, type: ActivityType }[]` | Yes | Activity list |
| `discord.oAuth2` | `object` | No | OAuth2 configuration |
| `discord.oAuth2.apiToken` | `Secret \| envMap` | Yes | OAuth2 token |
| `discord.oAuth2.url` | `URL \| envMap` | Yes | OAuth2 URL |
| `healthCheckPort` | `number (1-65535)` | No | Port for health check server |
| `misc` | `Record<string, any>` | Yes | Arbitrary key-value storage |
| `ids.role` | `Record<string, Snowflake \| envMap>` | Yes | Role ID mappings |
| `ids.channel` | `Record<string, Snowflake \| envMap>` | Yes | Channel ID mappings |
| `ids.emoji` | `Record<string, Snowflake \| envMap>` | Yes | Emoji ID mappings |

## Secret Resolution

Values prefixed with `secret://` are resolved from environment variables at parse time. The prefix is stripped and the remainder is used as the env var name.

```ts
{
  apiToken: 'secret://apiKey',
  // Reads process.env.apiKey at parse time
  // If apiKey is not set, validation fails with:
  //   "Environment variable "apiKey" is not set"
}
```

Secrets are validated in two steps:

1. The input must match the format `secret://<key>` (at least one character after the prefix)
2. The corresponding environment variable must be set and non-empty

If either check fails, `parseConfig()` throws a `ZodError` and the bot will not start. This ensures secrets are never silently missing.

## Environment Mapping (envMap)

Any field that supports `envMap` accepts three input forms, allowing different values for production and development environments:

| Form | Example | Behavior |
|---|---|---|
| Single value | `'123456789012345678'` | Used in all environments |
| Single-element tuple | `['123456789012345678']` | Production value, used in all environments |
| Two-element tuple | `['123456789012345678', '987654321098765432']` | First is production, second is development |

The environment is determined by `NODE_ENV`:

- `NODE_ENV === 'development'` selects the second tuple element (dev value)
- Any other value (including unset) selects the first tuple element (prod value)

```ts
{
  ids: {
    role: {
      // Always this value
      admin: '123456789012345678',

      // Prod-only (same value in all environments)
      moderator: ['234567890123456789'],

      // Different IDs for prod and dev servers
      member: ['345678901234567890', '456789012345678901'],
    },
  },
}
```

The `envMap` wrapper works with any inner schema. In the Unicorn config, it wraps `Snowflake`, `Secret`, and `URL` fields. After parsing, the value is always the resolved inner type -- the tuple structure is transparent to consumers.

## Type-Safe IDs

The `ids` section provides type-safe access to Discord Snowflake IDs for roles, channels, and emoji. The key to this is the combination of `satisfies UnicornConfig` and the `const` generic on `parseConfig()`.

```ts
// src/config.ts
export const appConfig = {
  // ...
  ids: {
    role: { admin: '123456789012345678' },
    channel: { logs: '234567890123456789' },
    emoji: {},
  },
} satisfies UnicornConfig;
```

After parsing, the literal keys are preserved in the type:

```ts
client.config.ids.role.admin    // typed as Snowflake
client.config.ids.channel.logs  // typed as Snowflake
client.config.ids.role.unknown  // TypeScript error: Property 'unknown' does not exist
```

This works because:

1. `satisfies UnicornConfig` validates the shape without widening the type -- literal keys like `'admin'` and `'logs'` are preserved
2. `parseConfig` uses `const T extends UnicornConfig` to capture the exact literal type
3. `ParsedConfig<T>` maps each key in `T['ids']` to `Snowflake`, preserving the key names while transforming the value types

## Health Check Server

When `healthCheckPort` is set in the config, Unicorn starts a `Bun.serve()` HTTP server with endpoints for container orchestration probes:

| Endpoint | Type | Status | Condition |
|---|---|---|---|
| `/health` | Liveness | `200 OK` | Always |
| `/healthz` | Liveness | `200 OK` | Always |
| `/ready` | Readiness | `200 Ready` | `client.isReady()` is `true` |
| `/readyz` | Readiness | `200 Ready` | `client.isReady()` is `true` |
| `/ready` | Readiness | `503 Not Ready` | `client.isReady()` is `false` |
| `/readyz` | Readiness | `503 Not Ready` | `client.isReady()` is `false` |

All other paths return `404 Not Found`.

The health check server is stopped during graceful shutdown alongside scheduled jobs and the Discord client.

```ts
{
  healthCheckPort: 3000,
}
```

If `healthCheckPort` is omitted, no health check server is started.

## Startup Behavior

Configuration is parsed at the very beginning of the startup sequence, before the Discord client is created. This is intentional -- if the config is invalid, the bot fails immediately with a clear error rather than partially initializing.

```text
1. Create logger
2. Parse config        <-- validation happens here, throws on failure
3. Create Discord client with parsed intents/partials/presence
4. Initialize UnicornClient
5. Load sparks
6. Register commands
7. Start health check server (if configured)
8. Login to Discord
```

If `parseConfig()` throws, none of the subsequent steps execute.
