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
| Caching | Domain logic as Effect functions, backed by `ActionCache` + `PackageManagerAdapter` |
| Build tool | `@savvy-web/github-action-builder` replacing custom `lib/scripts/build.ts` |
| File operations | `@effect/platform` + `@effect/platform-node` (no `node:` fs imports) |
| Logging | Preserve `emoji.ts` formatting helpers, used with `ActionLogger.group` + `Effect.log` |

## Architecture

### Entry Points

Two entry points, down from three:

- **`src/main.ts`** -- Single `Effect.gen` pipeline: parse config, restore cache, install runtimes, setup package manager, install deps, install Biome, set outputs.
- **`src/post.ts`** -- Restore state from main via `ActionState`, save cache if no primary hit.

`Action.run(program, layer)` is the top-level runner for both. It provides `ActionInputsLive`, `ActionOutputsLive`, `ActionLoggerLive`, `NodeContext.layer` (FileSystem, Path), and OTel tracing automatically.

### File Structure

```text
src/
  main.ts                  -- Orchestration pipeline
  post.ts                  -- Cache save program
  config.ts                -- parsePackageJson, detectBiome, detectTurbo
  cache.ts                 -- Cache key generation, restore/save, lockfile detection
  errors.ts                -- Domain-specific TaggedError types
  schemas.ts               -- Effect Schemas (DevEngines, RuntimeConfig, CacheState)
  emoji.ts                 -- Emoji constants and log formatting helpers (preserved from current)
  runtime-installer.ts     -- RuntimeInstaller service interface + makeRuntimeInstaller factory
  descriptors/
    node.ts                -- Node descriptor + postInstall (corepack/npm setup)
    bun.ts                 -- Bun descriptor
    deno.ts                -- Deno descriptor
    biome.ts               -- Biome descriptor
action.config.ts           -- github-action-builder configuration
```

## RuntimeInstaller Service

A single shared service driven by per-runtime configuration layers. Each runtime provides a descriptor (pure data) that drives the shared install logic.

### RuntimeDescriptor

```typescript
type RuntimeDescriptor = {
  name: string
  getDownloadUrl: (version: string, platform: string, arch: string) => string
  getArchiveType: (platform: string) => "tar.gz" | "zip"
  getBinPath: (extractedDir: string, platform: string) => string
  verifyCommand: [command: string, ...args: Array<string>]
  postInstall?: (version: string) => Effect<void, RuntimeInstallError>
}
```

### Service Interface

```typescript
interface RuntimeInstaller {
  readonly install: (version: string) => Effect<InstalledRuntime, RuntimeInstallError>
}
```

### Shared Implementation

`makeRuntimeInstaller(descriptor)` returns a `RuntimeInstaller` that:

1. Computes download URL from descriptor
2. Checks tool cache via `ToolInstaller`
3. Downloads and extracts if not cached
4. Adds to PATH via `ActionOutputs.addPath`
5. Verifies with `CommandRunner.exec(descriptor.verifyCommand)`
6. Runs `descriptor.postInstall` if defined (e.g., corepack for Node)
7. Wraps all errors in `RuntimeInstallError` with runtime name and version context

### Per-Runtime Layers

```typescript
const NodeInstallerLive  = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(nodeDescriptor))
const BunInstallerLive   = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(bunDescriptor))
const DenoInstallerLive  = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(denoDescriptor))
const BiomeInstallerLive = Layer.succeed(RuntimeInstaller, makeRuntimeInstaller(biomeDescriptor))
```

### Node-Specific PostInstall

Node's `postInstall` handles:

- **npm as package manager**: Compare current vs required npm version, run `npm install -g npm@X.Y.Z` if needed
- **pnpm/yarn as package manager**: Enable corepack, run `corepack prepare {name}@{version} --activate`
- **Node 25+**: Handle missing bundled corepack

### Biome Fits the Pattern

Biome is a single binary download with the same lifecycle (download, cache, PATH, verify). It uses the `RuntimeInstaller` service with a Biome-specific descriptor.

## Configuration & Schemas

### Package.json Parsing

Configuration comes exclusively from `package.json` `devEngines`:

```typescript
const DevEngineEntry = Schema.Struct({
  name: Schema.String,
  version: Schema.String,  // refined to reject semver ranges
  onFail: Schema.optional(Schema.Literal("error", "warn", "ignore")),
})

const DevEngines = Schema.Struct({
  runtime: Schema.Union(DevEngineEntry, Schema.Array(DevEngineEntry)),
  packageManager: DevEngineEntry,
})
```

### Version Validation

Absolute version refinement rejects `^`, `~`, `>`, `<`, `=`, `*`, `x` prefixes. Accepts `X.Y.Z` with optional prerelease and build metadata.

### Feature Detection

- **Biome**: Read `biome.jsonc` or `biome.json` via `FileSystem.readFileString`, extract version from `$schema` URL
- **Turbo**: Check `turbo.json` existence via `FileSystem.exists`

### Configuration Flow

1. `FileSystem.readFileString("package.json")` + `Schema.decode(DevEngines)`
2. Detect Biome version from config file (or optional `biome-version` input override)
3. Detect Turbo from `turbo.json`
4. Return typed config object

### Remaining Action Inputs

| Input | Type | Purpose |
| ------- | ------ | --------- |
| `install-deps` | boolean (default: true) | Whether to install dependencies |
| `biome-version` | string (optional) | Explicit Biome version override |
| `turbo-token` | string (optional) | Turbo remote cache token |
| `turbo-team` | string (optional) | Turbo team slug |
| `cache-bust` | string (optional) | Cache busting for testing |

OTel inputs (`otel-enabled`, `otel-endpoint`, `otel-protocol`, `otel-headers`) are handled automatically by `Action.run`.

### Removed Inputs

- `node-version`, `bun-version`, `deno-version` -- read from `devEngines.runtime`
- `package-manager`, `package-manager-version` -- read from `devEngines.packageManager`

## Cache Module

### What Services Handle

- **`ActionCache`**: Raw `save(key, paths)` and `restore(key, paths, restoreKeys)` operations
- **`PackageManagerAdapter`**: `getCachePaths()` and `getLockfilePaths()` per package manager

### Domain Logic (cache.ts)

Pure Effect functions preserving the current battle-tested logic:

- **Cache key generation**: `{os}-{versionHash}-{branchHash}-{lockfileHash}`
- **Version hash**: SHA256 of runtime versions + package manager version (truncated to 8 chars)
- **Branch hash**: Branch name from `ActionEnvironment` GitHub context (handles PR vs push)
- **Lockfile hash**: SHA256 of lockfile contents
- **Restore key fallback chain**: branch-specific, then cross-branch
- **Combined cache config**: Merge and deduplicate paths across multiple package managers
- **Platform-specific defaults**: Fallback cache paths per package manager and OS

### Cross-Phase State

`ActionState` with `CacheStateSchema` replaces fragile string-based `saveState`/`getState`:

```typescript
const CacheStateSchema = Schema.Struct({
  primaryKey: Schema.String,
  restoreKeys: Schema.Array(Schema.String),
  paths: Schema.Array(Schema.String),
  packageManagers: Schema.Array(Schema.String),
  hit: Schema.Boolean,
})
```

Main saves cache state; post restores it to decide whether to save.

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

- **Fatal**: `ConfigError`, `RuntimeInstallError`, `PackageManagerSetupError`, `DependencyInstallError` -- `Action.run` catches via `Action.formatCause` and calls `setFailed`
- **Non-fatal on restore**: `CacheError` with `operation: "restore"` -- warn and continue
- **Non-fatal**: Biome install (`RuntimeInstallError` where `runtime === "biome"`) -- `catchTag` to `Effect.logWarning`

## Logging

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
yield* logger.group(formatInstallation(formatRuntime("deno")), Effect.gen(function* () {
  yield* Effect.log(formatDetection(`Deno ${version} in tool cache`, true))
  yield* Effect.log(formatSuccess(`Deno ${version} installed successfully`))
}))

// Buffered logging for verbose operations
yield* logger.withBuffer("cache-restore", Effect.gen(function* () {
  yield* Effect.log(`Primary key: ${primaryKey}`)
  yield* Effect.log(`Restore keys: ${restoreKeys.join(", ")}`)
  // On failure: all buffered lines flush to output
}))
```

## Orchestration

### main.ts

```typescript
const main = Effect.gen(function* () {
  const inputs = yield* ActionInputs
  const outputs = yield* ActionOutputs
  const logger = yield* ActionLogger
  const fs = yield* FileSystem

  // 1. Parse configuration
  const config = yield* logger.group("Detect configuration", Effect.gen(function* () {
    const pkg = yield* loadPackageJson(fs)
    const runtimes = yield* parseDevEngines(pkg)
    const biome = yield* detectBiome(fs, inputs)
    const turbo = yield* detectTurbo(fs)
    return { runtimes, packageManager: pkg.devEngines.packageManager, biome, turbo }
  }))

  // 2. Restore cache
  const cacheResult = yield* logger.group("Restore cache", restoreCache(config))

  // 3. Install runtimes
  const installed = yield* logger.group("Install runtimes",
    Effect.forEach(config.runtimes, (rt) =>
      RuntimeInstaller.install(rt.version).pipe(
        Effect.provide(installerLayerFor(rt.name))
      )
    )
  )

  // 4. Setup package manager
  yield* logger.group("Setup package manager", setupPackageManager(config.packageManager))

  // 5. Install dependencies
  const installDeps = yield* inputs.getBooleanOptional("install-deps", true)
  if (installDeps) {
    yield* logger.group("Install dependencies", installDependencies(config.packageManager))
  }

  // 6. Install Biome (non-fatal)
  if (config.biome) {
    yield* logger.group("Install Biome",
      RuntimeInstaller.install(config.biome).pipe(
        Effect.provide(BiomeInstallerLive),
        Effect.catchTag("RuntimeInstallError", (e) =>
          Effect.logWarning(`Biome installation failed: ${e.reason}`)
        ),
      )
    )
  }

  // 7. Set outputs
  yield* setOutputs(outputs, installed, config, cacheResult)
})

Action.run(main, MainLive)
```

### post.ts

```typescript
const post = Effect.gen(function* () {
  yield* saveCache()
})

Action.run(post, PostLive)
```

### Layer Composition

- **`Action.run` provides automatically**: `ActionInputsLive`, `ActionOutputsLive`, `ActionLoggerLive`, `NodeContext.layer` (FileSystem, Path), OTel tracing
- **`MainLive`**: `ActionCacheLive`, `ToolInstallerLive`, `CommandRunnerLive`, `ActionStateLive`, `ActionEnvironmentLive`
- **`PostLive`**: `ActionCacheLive`, `ActionStateLive`

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
    minify: true,
    target: "es2022",
  },
  persistLocal: {
    enabled: true,
    path: ".github/actions/local",
  },
})
```

### Build Output

```text
dist/
  main.js          -- Bundled main action
  post.js          -- Bundled post action
  package.json     -- { "type": "module" }

.github/actions/local/
  action.yml       -- Action definition (no pre script)
  dist/
    main.js
    post.js
    package.json
```

### Dependency Changes

**Removed (direct):**

- `@actions/core`
- `@actions/exec`
- `@actions/tool-cache`
- `@actions/cache`
- `@actions/github`
- `@actions/glob`
- `@vercel/ncc`

**Added:**

- `@savvy-web/github-action-effects` (dependency)
- `@savvy-web/github-action-builder` (devDependency)
- `effect` (peer dependency of github-action-effects)
- `@effect/platform` (peer dependency of github-action-effects)
- `@effect/platform-node` (peer dependency of github-action-effects)

The `@actions/*` packages become transitive peers satisfied through `github-action-effects`.

## Test Strategy

### Tier 1: Unit Tests (Effect Test Layers + Vitest)

Each module tested with in-memory layers. No manual mocking of `@actions/*`.

| Module | Key test layers |
| -------- | ---------------- |
| `schemas.ts` | Pure (no layers) |
| `config.ts` | `FileSystem` test layer |
| `cache.ts` | `ActionCacheTest`, `ActionStateTest`, `ActionEnvironmentTest` |
| `runtime-installer.ts` | `ToolInstallerTest`, `CommandRunnerTest` |
| `descriptors/*.ts` | Pure (no layers) |
| `main.ts` | All test layers composed |
| `post.ts` | `ActionCacheTest`, `ActionStateTest` |
| `emoji.ts` | Pure (no layers) |

### Tier 2: Fixture Tests (Preserved)

Unchanged from current implementation:

- **`__fixtures__/`** -- All fixture directories preserved as-is
- **`.github/actions/test-fixture/`** -- Composite action updated to reference `.github/actions/local`
- **`.github/workflows/test.yml`** -- Matrix entries using explicit input mode removed or converted to `devEngines`-based fixtures

The fixture tests validate the built action in real GitHub Actions runners across Ubuntu, macOS, and Windows. They test the complete lifecycle including actual runtime downloads, cache operations, and dependency installation.

## Files Removed

| File | Replacement |
| ------ | ------------- |
| `src/pre.ts` | Collapsed into `main.ts` |
| `src/utils/action-io.ts` | `ActionInputs` / `ActionOutputs` services |
| `src/utils/parse-package-json.ts` | `schemas.ts` + `config.ts` |
| `src/utils/error.ts` | `errors.ts` with `Data.TaggedError` |
| `src/utils/install-node.ts` | `descriptors/node.ts` + `runtime-installer.ts` |
| `src/utils/install-bun.ts` | `descriptors/bun.ts` + `runtime-installer.ts` |
| `src/utils/install-deno.ts` | `descriptors/deno.ts` + `runtime-installer.ts` |
| `src/utils/install-biome.ts` | `descriptors/biome.ts` + `runtime-installer.ts` |
| `src/utils/cache-utils.ts` | `cache.ts` |
| `lib/scripts/build.ts` | `action.config.ts` + `github-action-builder` CLI |

## Action.yml Changes

- Remove `pre:` entry (no more pre-action hook)
- Remove explicit runtime version inputs (`node-version`, `bun-version`, `deno-version`)
- Remove explicit package manager inputs (`package-manager`, `package-manager-version`)
- Keep: `install-deps`, `biome-version`, `turbo-token`, `turbo-team`, `cache-bust`
- Keep: All outputs unchanged
- Update `main:` and `post:` paths if needed
