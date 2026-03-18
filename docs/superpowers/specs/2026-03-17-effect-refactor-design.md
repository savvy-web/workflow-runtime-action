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
| Build tool | `@savvy-web/github-action-builder` replacing custom `lib/scripts/build.ts` |
| File operations | `@effect/platform` + `@effect/platform-node` (no `node:` fs imports) |
| Logging | Preserve `emoji.ts` formatting helpers, used with `ActionLogger.group` + `Effect.log` |

## Architecture

### Entry Points

Two entry points, down from three:

- **`src/main.ts`** -- Single `Effect.gen` pipeline: parse config, compute cache config, restore cache, install runtimes, install deps, install Biome, set outputs, log summary.
- **`src/post.ts`** -- Restore state from main via `ActionState`, save cache if no primary hit. Errors are caught globally and demoted to warnings so a cache-save failure never fails the job.

**Why pre.ts is safe to remove:** The current `pre.ts` only logs action inputs as a diagnostic aid. It has no ordering dependency on `actions/checkout` or any other step. Collapsing it into `main.ts` has no behavioral impact.

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

Pure data that produces the inputs `ToolInstaller.install()` needs:

```typescript
type RuntimeDescriptor = {
  name: string
  getDownloadUrl: (version: string, platform: string, arch: string) => string
  getToolInstallOptions: (version: string, platform: string, arch: string) => Partial<ToolInstallOptions>
  verifyCommand: [command: string, ...args: Array<string>]
  postInstall?: (version: string) => Effect<void, RuntimeInstallError, CommandRunner>
}
```

The `postInstall` Effect requires `CommandRunner` in its environment (e.g., Node's corepack setup needs to exec shell commands). This dependency is satisfied by `makeRuntimeInstaller` which has `CommandRunner` in scope.

### Service Interface and Tag

The `RuntimeInstaller` service uses `Context.GenericTag` (not the class-based `Context.Tag` pattern from `github-action-effects` 0.8.0, since this is our own project-local service, not a library export):

```typescript
interface RuntimeInstaller {
  readonly install: (
    version: string,
  ) => Effect<InstalledRuntime, RuntimeInstallError, ToolInstaller | CommandRunner>
}

const RuntimeInstaller = Context.GenericTag<RuntimeInstaller>("RuntimeInstaller")
```

Note the `install` method's return type includes `ToolInstaller | CommandRunner` in its environment -- these transitive dependencies are satisfied when the effect runs within the main pipeline's layer composition.

### Shared Implementation

`makeRuntimeInstaller(descriptor)` delegates download/extract/cache/PATH to `ToolInstaller.install()` from `github-action-effects`. It only adds verification and post-install on top:

1. Computes download URL and `ToolInstallOptions` from descriptor
2. Calls `ToolInstaller.installAndAddToPath(descriptor.name, version, url, options)` -- this handles download, extract, cache, and addPath in one call (positional arguments, not an options object)
3. Verifies with `CommandRunner.exec(descriptor.verifyCommand)`
4. Runs `descriptor.postInstall` if defined (e.g., corepack for Node)
5. All `ToolInstallerError` and `CommandRunnerError` failures are caught via `Effect.catchAll` and wrapped into `RuntimeInstallError` with the runtime name, version, and original cause

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
const AbsoluteVersion = Schema.String.pipe(
  Schema.filter((v) => {
    const hasRangeOperators = /[~^<>=*xX]/.test(v)
    if (hasRangeOperators) return false
    return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/.test(v)
  }, { message: () => "Must be an absolute version (e.g., '24.11.0'), not a semver range" }),
)

const DevEngineEntry = Schema.Struct({
  name: Schema.String,
  version: AbsoluteVersion,
  onFail: Schema.optional(Schema.String),
})

const DevEngines = Schema.Struct({
  packageManager: DevEngineEntry,
  runtime: Schema.Union(DevEngineEntry, Schema.Array(DevEngineEntry)),
})
```

Note: `onFail` accepts any string (not restricted to a literal union) to remain forward-compatible with future values.

### Version Validation

Absolute version refinement rejects `^`, `~`, `>`, `<`, `=`, `*`, `x` prefixes. Accepts `X.Y.Z` with optional prerelease and build metadata.

### Feature Detection

- **Biome**: Checks the `biome-version` input override first. If not provided, reads `biome.jsonc` or `biome.json` via `FileSystem.readFileString` and extracts the `$schema` URL via regex (`/schemas\/([^/]+)\/schema\.json/`) -- no JSONC parser needed since we only need the schema field, not the full config. Returns `Option.none()` if no Biome config is detected and no override is given.
- **Turbo**: Check `turbo.json` existence via `FileSystem.access` (not `FileSystem.exists`)

### Configuration Flow

`loadPackageJson` is an Effect value (not a function taking `fs`) -- it obtains `FileSystem` from the Effect context internally:

1. `loadPackageJson` reads `package.json` via `FileSystem.readFileString`, parses JSON, decodes through `Schema.Struct({ devEngines: DevEngines })`
2. `parseDevEngines(devEngines)` normalises `runtime` to always-array form
3. `detectBiome(inputs)` checks override input, then reads config files (obtains `FileSystem` from context)
4. `detectTurbo` checks for `turbo.json` (obtains `FileSystem` from context)
5. Return typed config object

### Remaining Action Inputs

| Input | Type | Purpose |
| ------- | ------ | --------- |
| `install-deps` | boolean (default: true) | Whether to install dependencies |
| `biome-version` | string (optional) | Explicit Biome version override |
| `turbo-token` | string (optional) | Turbo remote cache token |
| `turbo-team` | string (optional) | Turbo team slug |
| `cache-bust` | string (optional) | Cache busting for testing |
| `additional-lockfiles` | string (optional) | Extra lockfile patterns for cache key |
| `additional-cache-paths` | string (optional) | Extra paths to include in cache |

**Note:** `additional-lockfiles` and `additional-cache-paths` are declared in `action.yml` but are not yet consumed by the source code. OTel inputs are handled automatically by `Action.run` if configured at the `github-action-effects` level.

### Removed Inputs (Breaking Changes)

- `node-version`, `bun-version`, `deno-version` -- read from `devEngines.runtime`
- `package-manager`, `package-manager-version` -- read from `devEngines.packageManager`

These are breaking changes. Users who relied on explicit version inputs must migrate to `devEngines` fields in `package.json`. This will be documented in the release notes and is the primary motivation for the major version bump.

## Cache Module

### What Services Handle

- **`ActionCache`**: Raw `save(key, paths)` and `restore(key, paths, restoreKeys)` operations

### PackageManagerAdapter Decision

The `PackageManagerAdapter` from `github-action-effects` detects from the `packageManager` field in `package.json`, not `devEngines`. Since we read from `devEngines.packageManager` exclusively, we do **not** use `PackageManagerAdapter` for detection. Instead, `cache.ts` implements its own cache path resolution and lockfile detection, matching the current battle-tested logic. This avoids a mismatch between the adapter's detection strategy and our config source.

### Domain Logic (cache.ts)

Pure Effect functions using `CommandRunner` to query package manager cache paths and `FileSystem` for lockfile detection. `@actions/glob` is **not** used directly -- lockfile detection uses simple `FileSystem.access` checks against well-known filenames extracted from glob patterns (e.g., `**/pnpm-lock.yaml` becomes `pnpm-lock.yaml`):

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
  const inputs = yield* ActionInputs
  const outputs = yield* ActionOutputs
  const logger = yield* ActionLogger

  // 1. Parse configuration
  const config = yield* logger.group("Detect configuration", Effect.gen(function* () {
    const devEngines = yield* loadPackageJson  // Effect value, gets FileSystem from context
    const parsed = parseDevEngines(devEngines)
    const biome = yield* detectBiome(inputs)   // gets FileSystem from context
    const turbo = yield* detectTurbo           // gets FileSystem from context
    return { runtimes: parsed.runtime, packageManager: parsed.packageManager, biome, turbo }
  }))

  // 2. Compute cache config and find lockfiles
  const activePackageManagers = getActivePackageManagers(config.runtimes, pmName)
  const cacheConfig = yield* getCombinedCacheConfig(activePackageManagers, runtimeEntries)
  const lockfiles = yield* findLockFiles(cacheConfig.lockfilePatterns)

  // 3. Restore cache (non-fatal -- CacheError caught and demoted to warning)
  const cacheResult = yield* logger.group("Restore cache",
    restoreCache({ cachePaths, runtimes, packageManager, lockfiles, cacheBust }).pipe(
      Effect.catchTag("CacheError", (e) => Effect.logWarning(...) *> Effect.succeed("none"))
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

  // 5. Install dependencies (lockfile-aware, no separate "setup package manager" step)
  const installDeps = yield* inputs.getBooleanOptional("install-deps", true)
  if (installDeps) {
    yield* logger.group(formatInstallation(...), installDependencies(pmName))
  }

  // 6. Install Biome (non-fatal)
  if (Option.isSome(config.biome)) {
    yield* logger.group(formatInstallation("Biome"),
      RuntimeInstaller.pipe(
        Effect.flatMap((installer) => installer.install(biomeVersion)),
        Effect.provide(BiomeInstallerLive),
        Effect.catchTag("RuntimeInstallError", (e) =>
          Effect.logWarning(`Biome installation failed: ${e.reason}`)
        ),
      )
    )
  }

  // 7. Set outputs (includes lockfiles and cachePaths)
  yield* setOutputs(outputs, installed, config, cacheResult, lockfiles, cacheConfig.cachePaths)

  // 8. Log summary
  yield* logger.group("Runtime Setup Complete", ...)
})

await Action.run(main, MainLive)
```

Key differences from the original spec:

- **No `setupPackageManager` step** -- package manager setup (corepack) is handled by Node's `postInstall` descriptor
- **`RuntimeInstaller` access uses `GenericTag` pattern** -- requires `RuntimeInstaller.pipe(Effect.flatMap(...))` instead of direct `.install()` call
- **`setOutputs` takes six arguments** -- includes `lockfiles` and `cachePaths` for cache output reporting
- **`loadPackageJson` is an Effect** -- obtains `FileSystem` from context, not a function argument
- **`detectBiome(inputs)` only takes inputs** -- obtains `FileSystem` from context
- **`config.biome` is `Option<string>`** -- checked with `Option.isSome()`

### post.ts

```typescript
const post = Effect.gen(function* () {
  yield* saveCache()
}).pipe(
  // Non-fatal: cache save errors should warn, not fail the action
  Effect.catchAll((error) => Effect.logWarning(`Post action cache save failed: ${error}`)),
)

const PostLive = Layer.mergeAll(ActionCacheLive, ActionStateLive)

await Action.run(post, PostLive)
```

### Layer Composition

**`Action.run` provides automatically** (no user composition needed):

- `ActionInputsLive`, `ActionOutputsLive`, `ActionLoggerLive`
- `NodeContext.layer` (FileSystem, Path, CommandExecutor)
- OTel tracing (auto-configured from inputs)

Services from `github-action-effects` 0.8.0 use the **class-based `Context.Tag` pattern** with namespaced identifiers (e.g., `"github-action-effects/ActionInputs"`). This means accessing them in Effect programs uses the standard `yield* ServiceTag` pattern. Our project-local `RuntimeInstaller`, by contrast, uses `Context.GenericTag` since it is not a library export.

**Service type annotations** use `Context.Tag.Service<T>` to extract the service type from a tag. For example, `setOutputs` takes `outputs: Context.Tag.Service<ActionOutputs>` rather than using the tag type directly.

**`MainLive`** -- composed with `Layer.mergeAll`:

```typescript
const MainLive = Layer.mergeAll(
  ActionCacheLive,
  ToolInstallerLive,
  CommandRunnerLive,
  ActionStateLive,
  ActionEnvironmentLive,
)
```

Most Live layers in `github-action-effects` use static top-level imports of their `@actions/*` peer deps (e.g., `ActionCacheLive` statically imports `@actions/cache`, `CommandRunnerLive` statically imports `@actions/exec`). Only `ToolInstallerLive` uses dynamic `import()`. This means `@actions/*` packages must be resolvable at module load time and must be listed as direct dependencies (not just peers) so the bundler can include them. The layers do not require other Effect services in their construction -- they are self-contained in terms of the Effect dependency graph.

`FileSystem` and `Path` from `@effect/platform` are provided by `Action.run` via `NodeContext.layer` (part of `CoreServices`) and are available in the program's environment without being listed in `MainLive`.

**`PostLive`**: `Layer.mergeAll(ActionCacheLive, ActionStateLive)`

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

**Removed:**

- `@vercel/ncc` (replaced by `github-action-builder`)
- All pnpm patches (no patches remain in the project)

**Added as direct dependencies:**

- `@savvy-web/github-action-effects` (^0.8.0 -- uses class-based `Context.Tag` with namespaced identifiers)
- `effect` (catalog:silk)
- `@effect/platform` (catalog:silk)
- `@effect/platform-node` (catalog:silk)
- `@effect/cluster`, `@effect/rpc`, `@effect/sql` (catalog:silk, transitive requirements)

**Added as devDependencies:**

- `@savvy-web/github-action-builder` (^0.4.0)

**Retained as direct dependencies:**

- `@actions/core` (^3.0.0)
- `@actions/exec` (^3.0.0)
- `@actions/tool-cache` (^4.0.0)
- `@actions/cache` (^6.0.0)
- `@actions/github` (^9.0.0)

The `@actions/*` packages are peer dependencies of `github-action-effects` but must also remain as direct dependencies so the bundler can resolve them at bundle time.

**`@actions/glob` handling:** Not a direct dependency of this project. It is a transitive dependency via `@actions/cache`. Its sub-dependency `minimatch` is pinned to 3.1.2 via a pnpm override in `pnpm-workspace.yaml` (not a patch) to avoid bundler collisions:

```yaml
overrides:
  "@actions/glob>minimatch": 3.1.2
```

**`semver-effect`** updated to 0.2.0 (transitive dependency via `github-action-effects`), resolving the previous rslib/webpack collision that required patching.

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
- **`.github/actions/test-fixture/`** -- Composite action updated to reference `.github/actions/local` (renamed from `.github/actions/runtime`)
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
