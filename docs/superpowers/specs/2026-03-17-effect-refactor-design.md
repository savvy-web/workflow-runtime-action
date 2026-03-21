# Refactor workflow-runtime-action to Effect with github-action-effects

## Summary

Full rewrite of `workflow-runtime-action` from imperative TypeScript to Effect-based programs using `@savvy-web/github-action-effects` and `@savvy-web/github-action-builder`. The action's external behavior (inputs, outputs, caching, runtime installation) is preserved while the internals become composable, testable, and type-safe through Effect services.

## Decisions

| Decision | Choice |
| --- | --- |
| Scope | Full rewrite |
| Lifecycle | main + post (pre collapsed into main) |
| Config mode | `devEngines` from `package.json` only (drop explicit input mode) |
| Testing | Effect test layers for unit tests + existing fixture workflows for E2E |
| Installer pattern | `RuntimeInstaller` service with per-runtime descriptor layers |
| Error handling | Domain-specific `TaggedError` types wrapping service errors |
| Caching | Domain logic as Effect functions, backed by `ActionCache` + `CommandRunner` |
| Build tool | `@savvy-web/github-action-builder` (rsbuild) replacing custom `lib/scripts/build.ts` |
| File operations | `@effect/platform` + `@effect/platform-node` (no `node:` fs imports) |
| Logging | `Effect.log` / `Effect.logWarning` / `Effect.logError` + `ActionLogger.group` for collapsible sections |
| Inputs | Effect `Config` API (`Config.string`, `Config.boolean`, `Config.withDefault`) |

## Architecture

### Entry Points

Two entry points, down from three:

- **`src/main.ts`** -- Single `Effect.gen` pipeline: parse config, compute cache config, restore cache, install runtimes, setup package manager, install deps, install Biome, set outputs, log summary.
- **`src/post.ts`** -- Restore state from main via `ActionState`, save cache if no primary hit. Errors are caught globally and demoted to warnings so a cache-save failure never fails the job.

**Why pre.ts is safe to remove:** The current `pre.ts` only logs action inputs as a diagnostic aid. It has no ordering dependency on `actions/checkout` or any other step. Collapsing it into `main.ts` has no behavioral impact.

`Action.run(program, { layer })` is the top-level runner for both. It provides `ActionOutputsLive`, `ActionLoggerLive`, a `ConfigProvider` backed by GitHub Actions inputs, `NodeFileSystem` (FileSystem), and OTel tracing automatically.

### File Structure

```text
src/
  main.ts                  -- Orchestration pipeline
  post.ts                  -- Cache save program
  config.ts                -- loadPackageJson, detectBiome, detectTurbo
  cache.ts                 -- Cache key generation, restore/save, lockfile detection
  errors.ts                -- Domain-specific TaggedError types
  schemas.ts               -- Effect Schemas (DevEngines, RuntimeConfig, CacheState)
  emoji.ts                 -- Emoji constants and log formatting helpers (preserved from current)
  runtime-installer.ts     -- RuntimeInstaller service interface + makeRuntimeInstaller factory
  descriptors/
    node.ts                -- Node descriptor (no postInstall -- PM setup is separate)
    bun.ts                 -- Bun descriptor
    deno.ts                -- Deno descriptor
    biome.ts               -- Biome binary map (not a RuntimeDescriptor -- uses installBiome() directly)
action.config.ts           -- github-action-builder configuration
```

## Zero @actions/\* Dependencies

The `@savvy-web/github-action-effects` library (0.11.10) implements the GitHub Actions runtime protocol natively -- it speaks directly to the Actions runner services without depending on any `@actions/*` packages. This means:

- **No `@actions/core`** -- logging, outputs, state, and input reading are handled natively
- **No `@actions/cache`** -- `ActionCache` uses the V2 Twirp protocol with Azure Blob Storage directly
- **No `@actions/exec`** -- `CommandRunner` uses `@effect/platform` process execution
- **No `@actions/tool-cache`** -- `ToolInstaller` handles download, extract, cache, and PATH natively
- **No `@actions/github`** -- not needed by this action
- **No pnpm overrides or patches** -- the `pnpm-workspace.yaml` has no overrides section

## Action Inputs via Effect Config API

Action inputs are **not** read via an `ActionInputs` service. Instead, they use the Effect `Config` API, which is backed by a `ConfigProvider` that `Action.run` sets up to read from GitHub Actions input environment variables:

```typescript
// Boolean input with default
const installDeps = yield* Config.boolean("install-deps").pipe(Config.withDefault(true))

// String input with default (empty = not provided)
const rawLockfiles = yield* Config.string("additional-lockfiles").pipe(Config.withDefault(""))
const cacheBust = yield* Config.string("cache-bust").pipe(Config.withDefault(""))
const turboToken = yield* Config.string("turbo-token").pipe(Config.withDefault(""))
```

This pattern means inputs are resolved lazily at point of use rather than eagerly read into a record.

## RuntimeInstaller Service

A single shared service driven by per-runtime configuration layers. Each runtime provides a descriptor (pure data) that drives the shared install logic.

### RuntimeDescriptor

Pure data that describes how to download and install a runtime:

```typescript
interface RuntimeDescriptor {
  readonly name: string
  readonly getDownloadUrl: (version: string, platform: string, arch: string) => string
  readonly getToolInstallOptions: (
    version: string,
    platform: string,
    arch: string,
  ) => Partial<{ archiveType: "tar.gz" | "tar.xz" | "zip"; binSubPath: string }>
  readonly verifyCommand: readonly [string, ...string[]]
}
```

Descriptors are pure data objects with no `postInstall` hook. Package manager setup (corepack, npm global install) is handled as a separate `setupPackageManager` step in `main.ts` after all runtimes are installed.

### Service Interface and Tag

The `RuntimeInstaller` service uses `Context.GenericTag`:

```typescript
interface RuntimeInstaller {
  readonly install: (
    version: string,
  ) => Effect<InstalledRuntime, RuntimeInstallError, ToolInstaller | CommandRunner | ActionOutputs>
}

const RuntimeInstaller = Context.GenericTag<RuntimeInstaller>("RuntimeInstaller")
```

Note the `install` method's return type includes `ToolInstaller | CommandRunner | ActionOutputs` in its environment -- these transitive dependencies are satisfied when the effect runs within the main pipeline's layer composition.

### Shared Implementation

`makeRuntimeInstaller(descriptor)` orchestrates download, extraction, caching, and PATH setup using individual `ToolInstaller` primitives:

1. Computes download URL and install options from descriptor
2. Downloads the archive via `toolInstaller.download(url)`
3. Extracts the archive via `toolInstaller.extractTar(path)` or `toolInstaller.extractZip(path)` based on `archiveType`
4. Caches the extracted directory via `toolInstaller.cacheDir(extractedDir, name, version)`
5. Adds the tool path (with optional `binSubPath`) to PATH via `outputs.addPath(toolPath)`
6. Verifies with `runner.exec(descriptor.verifyCommand)`
7. All failures are caught via `Effect.catchAll` and wrapped into `RuntimeInstallError` with the runtime name, version, and original cause

### Per-Runtime Layers

```typescript
const NodeInstallerLive  = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(nodeDescriptor))
const BunInstallerLive   = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(bunDescriptor))
const DenoInstallerLive  = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(denoDescriptor))
```

There is no `BiomeInstallerLive` -- Biome is a single binary, not an archive, so it uses a dedicated `installBiome()` function in `main.ts` that calls `toolInstaller.download()` and `toolInstaller.cacheFile()` directly.

### Package Manager Setup (Separate Step)

Package manager setup is a standalone `setupPackageManager` function in `main.ts`, called after all runtimes are installed:

- **npm**: Compare current vs required version, run `sudo npm install -g npm@X.Y.Z` on Unix
- **pnpm/yarn**: Enable corepack, run `corepack prepare {name}@{version} --activate` (from tmpdir for pnpm to avoid workspace interference)
- **bun/deno**: No setup needed (they are their own package manager)
- **Node 25+**: Installs corepack globally via npm since it is no longer bundled

### Biome Installation

Biome is installed as a raw binary download (not an archive), so it does not use the `RuntimeInstaller` pattern:

```typescript
const installBiome = (version: string) =>
  Effect.gen(function* () {
    const toolInstaller = yield* ToolInstaller
    const outputs = yield* ActionOutputs
    // Look up platform-specific binary name from biome.ts binaryMap
    const url = `https://github.com/biomejs/biome/releases/download/.../${binaryName}`
    const downloadedPath = yield* toolInstaller.download(url)
    const cachedDir = yield* toolInstaller.cacheFile(downloadedPath, finalName, "biome", version)
    yield* outputs.addPath(cachedDir)
  })
```

`ToolInstaller.cacheFile` (available since `github-action-effects` 0.11.x) caches a single file rather than a directory, which is the correct primitive for binary downloads.

## Configuration & Schemas

### Package.json Parsing

Configuration comes exclusively from `package.json` `devEngines`. The actual schemas use typed name fields (not generic strings):

```typescript
const AbsoluteVersion = Schema.String.pipe(
  Schema.filter((v) => {
    const hasRangeOperators = /[~^<>=*xX]/.test(v)
    if (hasRangeOperators) return false
    return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/.test(v)
  }, { message: () => "Must be an absolute version (e.g., '24.11.0'), not a semver range" }),
)

const RuntimeName = Schema.Literal("node", "bun", "deno")
const PackageManagerName = Schema.Literal("npm", "pnpm", "yarn", "bun", "deno")

const RuntimeEntry = Schema.Struct({
  name: RuntimeName,
  version: AbsoluteVersion,
  onFail: Schema.optional(Schema.String),
})

const PackageManagerEntry = Schema.Struct({
  name: PackageManagerName,
  version: AbsoluteVersion,
  onFail: Schema.optional(Schema.String),
})

const DevEngines = Schema.Struct({
  packageManager: PackageManagerEntry,
  runtime: Schema.Union(RuntimeEntry, Schema.Array(RuntimeEntry)),
})
```

Note: `onFail` accepts any string (not restricted to a literal union) to remain forward-compatible with future values.

### Version Validation

Absolute version refinement rejects `^`, `~`, `>`, `<`, `=`, `*`, `x` prefixes. Accepts `X.Y.Z` with optional prerelease and build metadata.

### Feature Detection

- **Biome**: Checks the `biome-version` Config input override first (via `Config.string("biome-version").pipe(Config.withDefault(""))`). If not provided, reads `biome.jsonc` or `biome.json` via `FileSystem.readFileString` and extracts the `$schema` URL via regex (`/schemas\/([^/]+)\/schema\.json/`) -- no JSONC parser needed since we only need the schema field, not the full config. Returns `Option.none()` if no Biome config is detected and no override is given.
- **Turbo**: Check `turbo.json` existence via `FileSystem.access` (not `FileSystem.exists`)

### Configuration Flow

`loadPackageJson` is an Effect value (not a function taking `fs`) -- it obtains `FileSystem` from the Effect context internally:

1. `loadPackageJson` reads `package.json` via `FileSystem.readFileString`, parses JSON, decodes through `Schema.Struct({ devEngines: DevEngines })`
2. `parseDevEngines(devEngines)` normalises `runtime` to always-array form
3. `detectBiome` checks Config override input, then reads config files (obtains `FileSystem` from context)
4. `detectTurbo` checks for `turbo.json` (obtains `FileSystem` from context)
5. Return typed config object

### Remaining Action Inputs

All inputs are read via the Effect `Config` API at point of use:

| Input | Config call | Purpose |
| ------- | ------ | --------- |
| `install-deps` | `Config.boolean("install-deps").pipe(Config.withDefault(true))` | Whether to install dependencies |
| `biome-version` | `Config.string("biome-version").pipe(Config.withDefault(""))` | Explicit Biome version override |
| `turbo-token` | `Config.string("turbo-token").pipe(Config.withDefault(""))` | Turbo remote cache token |
| `turbo-team` | `Config.string("turbo-team").pipe(Config.withDefault(""))` | Turbo team slug |
| `cache-bust` | `Config.string("cache-bust").pipe(Config.withDefault(""))` | Cache busting for testing |
| `additional-lockfiles` | `Config.string("additional-lockfiles").pipe(Config.withDefault(""))` | Extra lockfile patterns for cache key |
| `additional-cache-paths` | `Config.string("additional-cache-paths").pipe(Config.withDefault(""))` | Extra paths to include in cache |

Multi-value inputs (`additional-lockfiles`, `additional-cache-paths`) are parsed by `parseMultiValueInput()` which supports newline-separated, bullet lists, comma-separated, and JSON array formats.

### Removed Inputs (Breaking Changes)

- `node-version`, `bun-version`, `deno-version` -- read from `devEngines.runtime`
- `package-manager`, `package-manager-version` -- read from `devEngines.packageManager`

These are breaking changes. Users who relied on explicit version inputs must migrate to `devEngines` fields in `package.json`. This will be documented in the release notes and is the primary motivation for the major version bump.

## Cache Module

### What Services Handle

- **`ActionCache`**: Raw `save(paths, key)` and `restore(paths, key, restoreKeys)` operations using the V2 Twirp protocol with Azure Blob Storage (implemented natively in `github-action-effects`, no `@actions/cache` dependency)

### PackageManagerAdapter Decision

The `PackageManagerAdapter` from `github-action-effects` detects from the `packageManager` field in `package.json`, not `devEngines`. Since we read from `devEngines.packageManager` exclusively, we do **not** use `PackageManagerAdapter` for detection. Instead, `cache.ts` implements its own cache path resolution and lockfile detection, matching the current battle-tested logic. This avoids a mismatch between the adapter's detection strategy and our config source.

### Domain Logic (cache.ts)

Pure Effect functions using `CommandRunner` to query package manager cache paths and `FileSystem` for lockfile detection. `@actions/glob` is **not** used (and is not a dependency) -- lockfile detection uses simple `FileSystem.access` checks against well-known filenames extracted from glob patterns (e.g., `**/pnpm-lock.yaml` becomes `pnpm-lock.yaml`):

- **Cache path resolution**: Query package manager for its cache directory via `CommandRunner.execCapture`, fall back to platform-specific defaults
- **Tool cache paths**: Includes per-runtime tool cache entries (e.g., `/opt/hostedtoolcache/node/24.11.0`)
- **Cache key generation**: `{os}-{versionHash}-{branchHash}-{lockfileHash}`
- **Version hash**: SHA256 of runtime versions + package manager version + optional cache-bust value (truncated to 8 chars)
- **Branch hash**: Branch name from `ActionEnvironment` GitHub context (handles PR via `GITHUB_HEAD_REF`, push via `GITHUB_REF`)
- **Lockfile hash**: SHA256 of lockfile contents via `FileSystem.readFileString`
- **Restore key fallback chain**: branch-specific prefix, then version-only prefix. Empty when `cacheBust` is set (forces exact matches for testing)
- **Combined cache config**: Merge and deduplicate paths across multiple package managers, sorted with absolute paths first then globs
- **Platform-specific defaults**: Fallback cache paths per package manager and OS

### Cross-Phase State

`ActionState` with `CacheStateSchema` replaces fragile string-based `saveState`/`getState`:

```typescript
const CacheStateSchema = Schema.Struct({
  hit: Schema.Literal("exact", "partial", "none"),
  key: Schema.optional(Schema.String),
  paths: Schema.optional(Schema.Array(Schema.String)),
})
```

The schema is deliberately minimal -- only the cache key, paths, and hit status are needed. Main saves state under the key `"CACHE_STATE"`; post reads it to decide whether to save (skips on exact hit).

## Error Types

```typescript
class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly reason: string
  readonly file?: string
  readonly cause?: unknown
}> {}

class RuntimeInstallError extends Data.TaggedError("RuntimeInstallError")<{
  readonly runtime: string
  readonly version: string
  readonly reason: string
  readonly cause?: unknown
}> {}

class PackageManagerSetupError extends Data.TaggedError("PackageManagerSetupError")<{
  readonly packageManager: string
  readonly version: string
  readonly reason: string
  readonly cause?: unknown
}> {}

class DependencyInstallError extends Data.TaggedError("DependencyInstallError")<{
  readonly packageManager: string
  readonly reason: string
  readonly cause?: unknown
}> {}

class CacheError extends Data.TaggedError("CacheError")<{
  readonly operation: "save" | "restore" | "key-generation"
  readonly reason: string
  readonly cause?: unknown
}> {}
```

### Error Handling Strategy

- **Fatal**: `ConfigError`, `RuntimeInstallError`, `PackageManagerSetupError`, `DependencyInstallError` -- `Action.run` catches and calls `setFailed`
- **Non-fatal on restore**: `CacheError` with `operation: "restore"` -- `catchTag` to `Effect.logWarning`, continue with `"none"`
- **Non-fatal**: Biome install -- `catchAll` to `Effect.logWarning`

## Logging

### ActionLogger

`ActionLogger` provides two methods:

- **`group(name, effect)`** -- Wraps an effect in a collapsible GitHub Actions log group
- **`withBuffer(label, effect)`** -- Buffers log output for a labeled section

All actual log messages use Effect's built-in logging:

- `Effect.log(message)` -- info-level output
- `Effect.logWarning(message)` -- warning-level output
- `Effect.logError(message)` -- error-level output
- `Effect.logDebug(message)` -- debug-level output (only visible with ACTIONS_STEP_DEBUG)

### Preserved: emoji.ts

The `emoji.ts` module carries over unchanged. It provides:

- **Runtime emojis**: node (package), bun (dumpling), deno (dinosaur)
- **Package manager emojis**: npm, pnpm (lightning), yarn (yarn ball), bun, deno
- **State icons**: good (green circle), neutral, warning, issue
- **Operation icons**: detection (magnifying glass), setup (wrench), cache (recycle), installation (gear)
- **Status icons**: pass (check), neutral, fail, warning
- **Formatter functions**: `formatRuntime`, `formatPackageManager`, `formatDetection`, `formatSetup`, `formatCache`, `formatInstallation`, `formatSuccess`, `formatWarning`, `formatFailure`

### Integration with ActionLogger

```typescript
// Collapsible log groups with emoji headers
yield* logger.group(formatInstallation("runtimes"), Effect.gen(function* () {
  // Install each runtime and log success
  yield* Effect.log(formatSuccess(`${formatRuntime("node")} 24.11.0`))
}))

// Summary group
yield* logger.group("Runtime Setup Complete", Effect.gen(function* () {
  yield* Effect.log(`Runtime(s): ${runtimes.map(r => formatRuntime(r.name)).join(", ")}`)
  yield* Effect.log(`${formatPackageManager(pmName)}: ${version}`)
}))
```

## Orchestration

### main.ts

```typescript
const main = Effect.gen(function* () {
  const outputs = yield* ActionOutputs
  const logger = yield* ActionLogger

  // 1. Parse configuration
  const config = yield* logger.group("Detect configuration", Effect.gen(function* () {
    const devEngines = yield* loadPackageJson  // Effect value, gets FileSystem from context
    const parsed = parseDevEngines(devEngines)
    const biome = yield* detectBiome           // reads Config + FileSystem from context
    const turbo = yield* detectTurbo           // reads FileSystem from context
    return { runtimes: parsed.runtime, packageManager: parsed.packageManager, biome, turbo }
  }))

  // 2. Compute cache config and find lockfiles
  const activePackageManagers = getActivePackageManagers(config.runtimes, pmName)
  const cacheConfig = yield* getCombinedCacheConfig(activePackageManagers, runtimeEntries)
  const rawLockfiles = yield* Config.string("additional-lockfiles").pipe(Config.withDefault(""))
  const additionalLockfiles = rawLockfiles ? parseMultiValueInput(rawLockfiles) : []
  const lockfiles = yield* findLockFiles([...cacheConfig.lockfilePatterns, ...additionalLockfiles])

  // 3. Restore cache (non-fatal -- CacheError caught and demoted to warning)
  const cacheResult = yield* logger.group("Restore cache",
    restoreCache({ cachePaths, runtimes, packageManager, lockfiles, cacheBust }).pipe(
      Effect.catchTag("CacheError", (e) => {
        yield* Effect.logWarning(`Cache restore failed: ${e.reason}`)
        return Effect.succeed("none" as const)
      })
    )
  )

  // 4. Install runtimes (GenericTag pattern -- must flatMap to get service)
  const installed = yield* logger.group(formatInstallation("runtimes"),
    Effect.forEach(config.runtimes, (rt) =>
      RuntimeInstaller.pipe(
        Effect.flatMap((installer) => installer.install(rt.version)),
        Effect.provide(installerLayerFor(rt.name)),
      )
    )
  )

  // 5. Setup package manager (after runtimes are installed and on PATH)
  yield* logger.group(
    formatInstallation(`${formatPackageManager(pmName)} via ${pmName === "npm" ? "npm" : "corepack"}`),
    setupPackageManager(pmName, config.packageManager.version),
  )

  // 6. Install dependencies (lockfile-aware)
  const installDeps = yield* Config.boolean("install-deps").pipe(Config.withDefault(true))
  if (installDeps) {
    yield* logger.group(formatInstallation(...), installDependencies(pmName))
  }

  // 7. Install Biome (non-fatal) -- uses direct download, not RuntimeInstaller
  if (Option.isSome(config.biome)) {
    yield* logger.group(formatInstallation("Biome"),
      installBiome(config.biome.value).pipe(
        Effect.catchAll((e) =>
          Effect.logWarning(`Biome installation failed: ${e.message}`)
        ),
      )
    )
  }

  // 8. Set outputs (includes lockfiles and cachePaths)
  yield* setOutputs(outputs, installed, config, cacheResult, lockfiles, finalCachePaths)

  // 9. Log summary
  yield* logger.group("Runtime Setup Complete", ...)
})

await Action.run(main, { layer: MainLive })
```

Key implementation details:

- **Separate `setupPackageManager` step** between runtime install and dependency install -- handles corepack/npm setup
- **`RuntimeInstaller` access uses `GenericTag` pattern** -- requires `RuntimeInstaller.pipe(Effect.flatMap(...))` instead of direct `.install()` call
- **`setOutputs` takes six arguments** -- includes `lockfiles` and `cachePaths` for cache output reporting
- **`loadPackageJson` is an Effect** -- obtains `FileSystem` from context, not a function argument
- **`detectBiome` is an Effect** -- obtains both Config and FileSystem from context
- **`config.biome` is `Option<string>`** -- checked with `Option.isSome()`
- **Biome uses `installBiome()` directly** -- not the `RuntimeInstaller` pattern, since it's a single binary download using `ToolInstaller.cacheFile`
- **Inputs use `Config` API** -- not an `ActionInputs` service

### post.ts

```typescript
const post = Effect.gen(function* () {
  yield* saveCache()
}).pipe(
  // Non-fatal: cache save errors should warn, not fail the action
  Effect.catchAll((error) =>
    Effect.gen(function* () {
      yield* Effect.logWarning(`Post action cache save failed: ${extractErrorReason(error)}`)
    })
  ),
)

const PostLive = Layer.mergeAll(
  ActionCacheLive,
  ActionStateLive.pipe(Layer.provide(NodeFileSystem.layer)),
)

await Action.run(post, { layer: PostLive })
```

### Layer Composition

**`Action.run` provides automatically** (no user composition needed):

- `ActionOutputsLive`, `ActionLoggerLive`
- `ConfigProvider` backed by GitHub Actions input environment variables
- `NodeFileSystem.layer` (FileSystem)

**`MainLive`** -- composed with `Layer.mergeAll`:

```typescript
const FileSystemLive = NodeFileSystem.layer

const MainLive = Layer.mergeAll(
  ActionCacheLive,
  ToolInstallerLive,
  CommandRunnerLive,
  ActionStateLive.pipe(Layer.provide(FileSystemLive)),
  ActionEnvironmentLive,
  FileSystemLive,
)
```

`ActionStateLive` depends on `FileSystem` for state persistence, so `NodeFileSystem.layer` is provided to it explicitly. `FileSystemLive` is also merged at the top level so that program-level code (e.g., `loadPackageJson`, `detectBiome`, `findLockFiles`) can access `FileSystem.FileSystem` directly.

**`PostLive`**: `Layer.mergeAll(ActionCacheLive, ActionStateLive.pipe(Layer.provide(NodeFileSystem.layer)))`

## Build

### action.config.ts

```typescript
import { defineConfig } from "@savvy-web/github-action-builder"

export default defineConfig({
  entries: {
    main: "src/main.ts",
    post: "src/post.ts",
  },
  build: {
    minify: false,
  },
  persistLocal: {
    enabled: true,
    path: ".github/actions/local",
  },
})
```

The build uses **rsbuild** under the hood (via `@savvy-web/github-action-builder` 0.5.0). Minification is disabled for easier debugging of bundled output in CI.

### Build Output

```text
dist/
  main.js          -- Bundled main action
  post.js          -- Bundled post action
  package.json     -- { "type": "module" }

.github/actions/local/
  dist/
    main.js
    post.js
    package.json
```

### Dependency Changes

**Removed:**

- `@vercel/ncc` (replaced by `github-action-builder` with rsbuild)
- All `@actions/*` direct dependencies (zero remaining -- `github-action-effects` implements the runtime protocol natively)
- All pnpm patches and overrides (none remain in the project)

**Added as direct dependencies:**

- `@savvy-web/github-action-effects` (^0.11.10 -- implements GitHub Actions runtime protocol natively, zero `@actions/*` deps)
- `effect` (catalog:silk)
- `@effect/platform` (catalog:silk)
- `@effect/platform-node` (catalog:silk)
- `@effect/cluster`, `@effect/rpc`, `@effect/sql` (catalog:silk, transitive requirements)

**Added as devDependencies:**

- `@savvy-web/github-action-builder` (^0.5.0 -- rsbuild-based bundler)

**Not direct dependencies (handled by github-action-effects internally):**

- `@octokit/auth-app` -- a regular dependency of the effects library, not of this project
- `@actions/cache`, `@actions/core`, `@actions/exec`, `@actions/tool-cache`, `@actions/github` -- not needed at all; the effects library reimplements the runtime protocol

## Test Strategy

### Tier 1: Unit Tests (Effect Test Layers + Vitest)

Each module tested with in-memory layers. **No `vi.mock` needed** -- tests import service tags directly from `@savvy-web/github-action-effects` and provide inline mock implementations via `Layer.succeed`:

```typescript
import { ActionOutputs, ActionLogger, ActionCache } from "@savvy-web/github-action-effects"
import { Effect, Layer } from "effect"

const makeOutputsLayer = (store: Record<string, string>) =>
  Layer.succeed(ActionOutputs, {
    set: (name, value) => { store[name] = value; return Effect.void },
    // ... other methods
  } as unknown as Context.Tag.Service<typeof ActionOutputs>)
```

This works because `github-action-effects` 0.11.10 has no transitive `@actions/*` imports that would break in the test environment.

| Module | Key test layers |
| -------- | ---------------- |
| `schemas.ts` | Pure (no layers) |
| `config.ts` | `FileSystem` test layer (via `FileSystem.makeNoop`) |
| `cache.ts` | `ActionCache`, `ActionState`, `ActionEnvironment`, `CommandRunner` |
| `runtime-installer.ts` | `ToolInstaller`, `CommandRunner`, `ActionOutputs` |
| `descriptors/*.ts` | Pure (no layers) |
| `main.ts` | All test layers composed |
| `post.ts` | `ActionCache`, `ActionState` |
| `emoji.ts` | Pure (no layers) |

### Tier 2: Fixture Tests (Preserved)

Unchanged from current implementation:

- **`__fixtures__/`** -- All fixture directories preserved as-is
- **`.github/actions/test-fixture/`** -- Composite action updated to reference `.github/actions/local` (renamed from `.github/actions/runtime`)
- **`.github/workflows/test.yml`** -- Matrix entries using explicit input mode removed or converted to `devEngines`-based fixtures

The fixture tests validate the built action in real GitHub Actions runners across Ubuntu, macOS, and Windows. They test the complete lifecycle including actual runtime downloads, cache operations, and dependency installation.

## Files Removed

| File | Replacement |
| ------ | ------------- |
| `src/pre.ts` | Collapsed into `main.ts` |
| `src/utils/action-io.ts` | `ActionOutputs` service + Effect `Config` API for inputs |
| `src/utils/parse-package-json.ts` | `schemas.ts` + `config.ts` |
| `src/utils/error.ts` | `errors.ts` with `Data.TaggedError` |
| `src/utils/install-node.ts` | `descriptors/node.ts` + `runtime-installer.ts` |
| `src/utils/install-bun.ts` | `descriptors/bun.ts` + `runtime-installer.ts` |
| `src/utils/install-deno.ts` | `descriptors/deno.ts` + `runtime-installer.ts` |
| `src/utils/install-biome.ts` | `descriptors/biome.ts` + `installBiome()` in `main.ts` |
| `src/utils/cache-utils.ts` | `cache.ts` |
| `lib/scripts/build.ts` | `action.config.ts` + `github-action-builder` CLI |

## Action.yml Changes

- Remove `pre:` entry (no more pre-action hook)
- Remove explicit runtime version inputs (`node-version`, `bun-version`, `deno-version`)
- Remove explicit package manager inputs (`package-manager`, `package-manager-version`)
- Add: `additional-lockfiles`, `additional-cache-paths` (consumed by source code)
- Keep: `install-deps`, `biome-version`, `turbo-token`, `turbo-team`, `cache-bust`
- Keep: All outputs unchanged
- Update `main:` and `post:` paths if needed
