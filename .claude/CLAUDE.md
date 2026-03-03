# Unicorn Claude Guidance

## Rules

Before writing or modifying code that uses discord.js, zod, Prisma, or other external dependency APIs, resolve the library in Context7 and query the relevant API docs. Do not rely on training data for these libraries — always verify against current documentation.

When working with sparks, guards, configuration, or their tests, read `.claude/spark-reference.md` and `.claude/testing-reference.md` first for APIs, types, patterns, and examples. Prefer these references as the starting point; if the docs are ambiguous, outdated, or incomplete, verify against the core source or corresponding `docs/*.md` file. When modifying a core module or built-in, read the corresponding `docs/*.md` file first.

## Project Overview

Unicorn is a Discord bot framework built on Discord.js and TypeScript, designed to run on Bun. It uses a "Spark" system for modular command/event handling with composable Guards for validation.

**Dependencies:** `discord.js` v14, `zod` v4, `pino`, `cron`, `@sentry/bun`

**Zod v4:** Use Zod 4 APIs — e.g. `z.url()`, `z.email()`, `z.uuid()` as standalone schemas instead of deprecated `z.string().url()` / `.email()` / `.uuid()` chains.

## Bun Runtime

- Use `bun` / `bun test` / `bun install` / `bun run <script>` — never node/npm/yarn/jest/vitest
- Bun auto-loads `.env` — don't use dotenv
- Prefer `Bun.serve()` over express, `Bun.file` over `node:fs` readFile/writeFile, `Bun.Glob` for file matching

## Scripts

```bash
bun start          # Run with Sentry preload
bun lint           # Format + check + typecheck
bun lint:tsc       # TypeScript typecheck
bun lint:code      # Biome lint check
bun lint:format    # Biome autoformat
bun test           # Run tests (90% coverage threshold)
```

## File Structure

```text
src/
├── index.ts                    # Main entry, startup sequence
├── config.ts                   # App config (satisfies UnicornConfig)
├── sentry.ts                   # Sentry init (preloaded via --preload)
├── health-check.ts             # Liveness/readiness probes (Bun.serve)
├── shutdown.ts                 # Graceful shutdown handler
├── core/
│   ├── client/                 # UnicornClient interface & initialization
│   ├── configuration/          # Zod schemas, parseConfig(), type-safe IDs
│   ├── guards/                 # Guard infrastructure (runGuards, createGuard)
│   ├── sparks/
│   │   ├── command.ts          # defineCommand, defineCommandWithAutocomplete
│   │   ├── command-group.ts    # defineCommandGroup (subcommands/groups)
│   │   ├── component.ts        # defineComponent, findComponentSpark
│   │   ├── gateway-event.ts    # defineGatewayEvent
│   │   ├── scheduled-event.ts  # defineScheduledEvent, stopAllScheduledJobs
│   │   ├── loader.ts           # loadSparks(), collectCommandBuilders()
│   │   └── index.ts            # Barrel export
│   └── lib/
│       ├── attempt/            # Result type, attempt(), isError, unwrap, etc.
│       ├── emoji/              # Application emoji resolver
│       ├── logger/             # Pino logger, AppError classes, Sentry integration
│       └── test-helpers/       # Mock client, interactions, guards for tests
├── guards/
│   ├── index.ts                # Re-exports core + built-in guards
│   └── built-in/               # Guard implementations
├── sparks/
│   ├── built-in/
│   │   ├── interaction-create.ts  # Routes interactions to handlers
│   │   └── ready.ts               # Client ready event
│   ├── lib/                       # Shared helpers for spark implementations
│   └── [user sparks]
docs/                           # User-facing documentation
```

## Import Aliases (tsconfig paths)

- `@/core/*` → `src/core/*`
- `@/guards` / `@/guards/*` → `src/guards/`
- `@/sparks/lib/*` → `src/sparks/lib/*`

## Types of Development

**Framework:** When in Unicorn repository, development focuses on core and built-in functionality. **Bot:** Child projects using core code to create bots — no changes to core or built-ins unless backporting.

**Backporting:** When editing core or built-in code in a bot repository, prefix the commit subject with `[backport]` before the standard format (e.g., `[backport] 🦠 fix(core): sync rate-limit logic`) and append a summary to `BACKPORT.md` at the project root with the file path, what changed, and why.

## Architecture

### Spark System

Six spark types share: `type`, `guards[]`, `action()`, `execute()`, `register(client)`.

- `defineCommand()` — slash commands with optional autocomplete
- `defineCommandWithAutocomplete()` — commands that always have autocomplete
- `defineCommandGroup()` — subcommand routing with guard chaining
- `defineComponent()` — button/select/modal handlers with pattern matching (exact, prefix, wildcard, regex)
- `defineGatewayEvent()` — Discord gateway event handlers (`once` flag supported)
- `defineScheduledEvent()` — cron-based tasks with timezone support

### Guards

Composable validators returning `{ ok: true, value }` or `{ ok: false, reason }`. Chain sequentially with type narrowing.

12 built-in guards (import from `@/guards/built-in`) — see `spark-reference.md` for the full list with types and usage.

### Component Lookup

Exact/prefix IDs use `client.components` (O(1)). Wildcard/regex use `client.componentPatterns` (O(n)). `findComponentSpark()` checks exact → prefix → patterns.

### Error Handling

Use `AppError` (from `@/core/lib/logger`) with structured codes/metadata. Startup: throw and terminate. Sparks: use `attempt()` (from `@/core/lib/attempt`) for all fallible/async calls and log errors — never uncaught exceptions. See `docs/errors.md` for the complete guide.

### Configuration

Type-safe Zod schemas. `secret://KEY` → `Bun.env.KEY`. IDs are typed `Snowflake` with literal key preservation for `client.config.ids.role.admin`-style access.

## Import Conventions

- `import type { ... }` for type-only imports (`verbatimModuleSyntax` enabled)
- Node built-ins use `node:` prefix (`node:path`, `node:process`, `node:stream`)
- Zod: `import * as z from 'zod'` — Sentry: `import * as Sentry from '@sentry/bun'`

## Linting

Biome with strict rules: **kebab-case** filenames, **no `console`** (use `client.logger`), **no `process.env`** (use config/`Bun.env`), **no floating promises**, single quotes, organized imports

## Documentation

- All exported and internal functions, classes, and types must have JSDoc docstrings. Keep them concise (one line where possible). 80% coverage enforced by CodeRabbit.
- When adding or modifying a library module or built-in spark, update both inline JSDoc and the corresponding file in `docs/`.
- Docs should be clear and concise — illustrate API usage without business logic in examples.
- Use GitHub callouts (`NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`) in `docs/` as appropriate.

## Testing

Use Bun's test runner. Coverage threshold: 90%.

**Test helpers** (`@/core/lib/test-helpers`): `createMockClient()`, `createMockChatInputInteraction()`, `createMockAutocompleteInteraction()`, `createMockComponentInteraction()`, `createMockBaseInteraction()`, `createMockMessage()`, `createMockReadyClient()`, `passThroughGuard()`, `failGuard()`

**Test code quality:** Extract shared setup, assertions, and mock construction into helper functions to minimize duplication. Tests should be DRY — if the same pattern appears in multiple tests, factor it into a reusable helper at the top of the test file.

## Task Completion

Run `bun lint` and `bun test` before marking any task complete. All changes must be committed.

## Git Commits

Never commit directly to `main` — create a descriptive branch first. Do not push; the user handles pushes and PRs.

**Format:** `<emoji> <type>([scope]): <description>` — 50 char max, imperative, lowercase. Types: `new` 🦄 / `improve` 🌈 / `fix` 🦠 / `chore` 🧺 / `release` 🚀 / `doc` 📖 / `ci` 🚦. Scope from files changed; omit if broad.
