---
status: current
module: workflow-runtime-action
category: architecture
created: 2026-03-21
updated: 2026-03-21
last-synced: 2026-03-21
completeness: 90
related:
  - ./architecture.md
  - ./runtime-installation.md
dependencies: []
---

# Effect Service Model

How the action uses the Effect framework for typed errors, dependency injection, and composable
service layers.

## Table of Contents

1. [Overview](#overview)
2. [Current State](#current-state)
3. [Rationale](#rationale)
4. [Implementation Details](#implementation-details)
5. [Testing Strategy](#testing-strategy)
6. [Future Enhancements](#future-enhancements)
7. [Related Documentation](#related-documentation)

---

## Overview

Every side effect in the action -- file I/O, process execution, caching, output setting, logging --
flows through Effect services. The action never imports `@actions/*` packages or calls Node.js APIs
directly (except `node:os` and `node:crypto` for platform detection and hashing). This design
enables full testability via service substitution and typed error propagation.

**Key Features:**

- All GitHub Actions interactions via `@savvy-web/github-action-effects` service tags
- Inputs read lazily via Effect `Config` API (not an `ActionInputs` service)
- Errors modeled as `Data.TaggedError` with typed fields
- Layer composition at program boundaries (`MainLive`, `PostLive`)
- No `vi.mock` needed in tests -- services are swapped via `Layer.succeed`

**When to reference this document:**

- When adding a new service dependency to the pipeline
- When modifying layer composition
- When understanding how inputs, outputs, and state are accessed
- When writing or debugging unit tests with Effect test layers

---

## Current State

### Service Dependencies by Module

| Module | Services Required |
| --- | --- |
| `config.ts` | `FileSystem.FileSystem`, `Config` (via ConfigProvider) |
| `cache.ts` | `ActionCache`, `ActionState`, `ActionEnvironment`, `CommandRunner`, `FileSystem.FileSystem` |
| `runtime-installer.ts` | `ToolInstaller`, `CommandRunner`, `ActionOutputs` |
| `main.ts` (pipeline) | All of the above + `ActionLogger` |
| `main.ts` (Biome) | `ToolInstaller`, `ActionOutputs` |
| `main.ts` (PM setup) | `CommandRunner` |
| `main.ts` (deps install) | `CommandRunner`, `FileSystem.FileSystem` |
| `post.ts` | `ActionCache`, `ActionState` |

### Input Access Pattern

Action inputs use the Effect `Config` API rather than a dedicated service:

```typescript
// Boolean input with default
const installDeps = yield* Config.boolean("install-deps").pipe(Config.withDefault(true))

// String input with default (empty = not provided)
const biomeVersion = yield* Config.string("biome-version").pipe(Config.withDefault(""))
const cacheBust = yield* Config.string("cache-bust").pipe(Config.withDefault(""))
```

`Action.run` sets up a `ConfigProvider` that reads from `INPUT_*` environment variables. Inputs are
resolved lazily at point of use, making each call self-documenting.

### Error Type Mapping

| Error Type | Tag | Fatal? | Fields |
| --- | --- | --- | --- |
| `ConfigError` | `"ConfigError"` | Yes | `reason`, `file?`, `cause?` |
| `RuntimeInstallError` | `"RuntimeInstallError"` | Yes | `runtime`, `version`, `reason`, `cause?` |
| `PackageManagerSetupError` | `"PackageManagerSetupError"` | Yes | `packageManager`, `version`, `reason`, `cause?` |
| `DependencyInstallError` | `"DependencyInstallError"` | Yes | `packageManager`, `reason`, `cause?` |
| `CacheError` | `"CacheError"` | Conditional | `operation`, `reason`, `cause?` |

`CacheError` is non-fatal during restore (caught and demoted to warning) but causes a warning in
the post action as well (post.ts catches all errors globally).

---

## Rationale

### Why Effect Config API Instead of ActionInputs Service

The `@savvy-web/github-action-effects` library provides an `ActionInputs` service, but this action
does not use it. Instead, inputs are read via `Config.string` / `Config.boolean` with
`Config.withDefault`.

**Advantages:**

- Each input is read at its point of use, making the code self-documenting
- Default values are co-located with the read operation
- No upfront parsing step that could fail before the pipeline starts
- In tests, inputs are injected via `ConfigProvider.fromMap` without mocking a service

### Why GenericTag for RuntimeInstaller

`Context.GenericTag<RuntimeInstaller>("RuntimeInstaller")` is used instead of a `Context.Tag`
class because the installer needs to be swapped per runtime within a single pipeline execution.
The `Effect.forEach` loop provides a different layer for each runtime name:

```typescript
Effect.forEach(config.runtimes, (rt) =>
  RuntimeInstaller.pipe(
    Effect.flatMap((installer) => installer.install(rt.version)),
    Effect.provide(installerLayerFor(rt.name)),
  )
)
```

This pattern requires `Effect.flatMap` to access the service (not direct method calls) because
`GenericTag` wraps the service value.

### Why TaggedError Instead of Plain Error

`Data.TaggedError` provides:

- A `_tag` discriminant for `Effect.catchTag` pattern matching
- Typed error fields accessible without casting
- Structural equality for testing assertions
- Integration with Effect's error channel type tracking

---

## Implementation Details

### Layer Composition

**What `Action.run` provides automatically:**

- `ActionOutputsLive` -- output setting, PATH manipulation, variable export
- `ActionLoggerLive` -- collapsible log groups
- `ConfigProvider` -- backed by GitHub Actions `INPUT_*` environment variables
- `NodeFileSystem.layer` -- `FileSystem.FileSystem` for platform file operations

**What `MainLive` adds:**

```typescript
const MainLive = Layer.mergeAll(
  ActionCacheLive,           // V2 Twirp cache protocol implementation
  ToolInstallerLive,         // Download, extract (tar/zip), cache tools
  CommandRunnerLive,         // Process execution via @effect/platform
  ActionStateLive.pipe(      // Cross-phase state (file-based persistence)
    Layer.provide(NodeFileSystem.layer)  // ActionStateLive depends on FileSystem
  ),
  ActionEnvironmentLive,     // GitHub context env vars (GITHUB_REF, etc.)
  NodeFileSystem.layer,      // FileSystem for program-level code
)
```

`ActionStateLive` depends on `FileSystem` for state file persistence, so `NodeFileSystem.layer` is
explicitly provided to it. The same `NodeFileSystem.layer` is also merged at the top level so that
program code (`loadPackageJson`, `detectBiome`, `findLockFiles`) can access `FileSystem.FileSystem`
directly.

**What `PostLive` adds:**

```typescript
const PostLive = Layer.mergeAll(
  ActionCacheLive,
  ActionStateLive.pipe(Layer.provide(NodeFileSystem.layer)),
)
```

### Error Handling Patterns

**Fatal errors** propagate through the Effect error channel to `Action.run`, which calls
`setFailed`:

```typescript
// ConfigError propagates naturally from loadPackageJson
const devEngines = yield* loadPackageJson

// RuntimeInstallError propagates from installer.install()
const installed = yield* Effect.forEach(config.runtimes, (rt) =>
  RuntimeInstaller.pipe(
    Effect.flatMap((installer) => installer.install(rt.version)),
    Effect.provide(installerLayerFor(rt.name)),
  )
)
```

**Non-fatal errors** are caught and demoted:

```typescript
// Cache restore: CacheError -> warning + continue with "none"
const cacheResult = yield* restoreCache(config).pipe(
  Effect.catchTag("CacheError", (e) =>
    Effect.gen(function* () {
      yield* Effect.logWarning(`Cache restore failed: ${e.reason}`)
      return "none" as const
    })
  )
)

// Biome install: any error -> warning + continue
yield* installBiome(version).pipe(
  Effect.catchAll((e) =>
    Effect.logWarning(`Biome installation failed: ${e.message}`)
  )
)

// Post action: any error -> warning (never fails the job)
const post = Effect.gen(function* () {
  yield* saveCache()
}).pipe(
  Effect.catchAll((error) =>
    Effect.logWarning(`Post action cache save failed: ${extractErrorReason(error)}`)
  )
)
```

### Logging Integration

All log messages use Effect's built-in logging, which `Action.run` wires to the GitHub Actions
log format:

- `Effect.log(message)` -- info-level, visible in normal logs
- `Effect.logWarning(message)` -- warning annotation in GitHub Actions
- `Effect.logError(message)` -- error annotation in GitHub Actions
- `Effect.logDebug(message)` -- only visible when `ACTIONS_STEP_DEBUG=true`

`ActionLogger.group(name, effect)` wraps an effect in a collapsible GitHub Actions log group.

### extractErrorReason Helper

`runtime-installer.ts` exports `extractErrorReason(error)` which extracts a human-readable
message from any error type:

1. Check for `.reason` field (TaggedError pattern)
2. Check for `.message` field (standard Error)
3. Check for `._tag` field (Effect error tag)
4. Fall back to `String(error)`

This is used in error demotion paths where the error type is not statically known.

---

## Testing Strategy

### Service Substitution

Tests provide mock implementations via `Layer.succeed`:

```typescript
const makeOutputsLayer = (store: Record<string, string>) =>
  Layer.succeed(ActionOutputs, {
    set: (name: string, value: string) => {
      store[name] = value
      return Effect.void
    },
    addPath: () => Effect.void,
    exportVariable: (name: string, value: string) => {
      exportedVars[name] = value
      return Effect.void
    },
    // ... other methods
  } as unknown as ContextType.Tag.Service<typeof ActionOutputs>)
```

### Config Injection

```typescript
const configLayer = Layer.setConfigProvider(
  ConfigProvider.fromMap(new Map([
    ["install-deps", "false"],
    ["biome-version", "2.3.14"],
  ]))
)
```

### Full Pipeline Testing

`main.test.ts` composes all test layers and runs the full pipeline, asserting against captured
output stores and exported variables.

---

## Future Enhancements

### Short-term

- Add structured logging with key-value pairs for better CI debugging
- Consider `Effect.acquireRelease` for cleanup-on-failure patterns

### Medium-term

- Explore `@effect/opentelemetry` integration for pipeline tracing
- Add service-level metrics (install duration, cache hit rate)

---

## Related Documentation

**Internal Design Docs:**

- [Architecture](./architecture.md) - Overall system architecture
- [Runtime Installation](./runtime-installation.md) - RuntimeInstaller service details

**Context Files:**

- [src/CLAUDE.md](../../src/CLAUDE.md) - Source code development guide
- [**test**/CLAUDE.md](../../__test__/CLAUDE.md) - Unit testing patterns

---

**Document Status:** Current -- reflects the implemented Effect service model.

**Next Steps:** Update when new services are added or error handling patterns change.
