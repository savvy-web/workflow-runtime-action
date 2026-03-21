---
status: current
module: workflow-runtime-action
category: architecture
created: 2026-03-21
updated: 2026-03-21
last-synced: 2026-03-21
completeness: 90
related:
  - ./effect-service-model.md
  - ./caching-strategy.md
  - ./runtime-installation.md
  - ./build-and-distribution.md
dependencies: []
---

# Workflow Runtime Action - Architecture

Comprehensive architecture of the Effect-based GitHub Action that sets up JavaScript runtimes,
package managers, and dependency caching from a single `package.json` `devEngines` configuration.

## Table of Contents

1. [Overview](#overview)
2. [Current State](#current-state)
3. [Rationale](#rationale)
4. [System Architecture](#system-architecture)
5. [Data Flow](#data-flow)
6. [Integration Points](#integration-points)
7. [Testing Strategy](#testing-strategy)
8. [Future Enhancements](#future-enhancements)
9. [Related Documentation](#related-documentation)

---

## Overview

The workflow-runtime-action is a compiled Node.js GitHub Action (`node24` runtime) that reads runtime
and package manager configuration exclusively from the `devEngines` field in `package.json`. It
supports Node.js, Bun, and Deno runtimes with automatic dependency caching, optional Biome CLI
installation, and Turborepo detection.

The entire codebase is built on the Effect framework, using `@savvy-web/github-action-effects` for
all GitHub Actions runtime interactions. This library implements the GitHub Actions runtime protocol
natively -- it speaks directly to the Actions runner services (V2 Twirp protocol, Azure Blob
Storage) without depending on any `@actions/*` packages.

**Key Design Principles:**

- **Package.json-driven configuration** -- all runtime and package manager versions come from
  `devEngines`, enforcing absolute versions (no semver ranges) for reproducible builds
- **Effect-based composition** -- all side effects flow through Effect services, enabling typed
  error handling, dependency injection, and testability
- **Zero `@actions/*` dependencies** -- the effects library reimplements the runtime protocol,
  eliminating version conflicts and reducing bundle size
- **Non-fatal degradation** -- cache failures and optional tool installations (Biome) degrade
  gracefully with warnings rather than failing the job

**When to reference this document:**

- When understanding the overall system design and entry points
- When adding new runtime support or modifying the installation pipeline
- When debugging service layer interactions
- When modifying layer composition or Effect program structure

---

## Current State

### Entry Points

Two lifecycle hooks, both compiled to ES module bundles:

| Entry Point | Source | Output | Purpose |
| --- | --- | --- | --- |
| `main` | `src/main.ts` | `dist/main.js` | Full setup pipeline |
| `post` | `src/post.ts` | `dist/post.js` | Cache save after job |

There is no `pre` hook. The previous `pre.ts` (diagnostic logging only) was collapsed into `main.ts`
during the Effect rewrite with no behavioral impact.

### Source Module Map

| Module | Path | Responsibility |
| --- | --- | --- |
| Main pipeline | `src/main.ts` | Nine-step orchestration: config, cache, runtimes, PM, deps, Biome, outputs, summary |
| Post action | `src/post.ts` | Read cache state, save cache if not exact hit |
| Configuration | `src/config.ts` | `loadPackageJson`, `parseDevEngines`, `detectBiome`, `detectTurbo` |
| Cache | `src/cache.ts` | Key generation, restore/save, lockfile detection, path resolution |
| Runtime installer | `src/runtime-installer.ts` | `RuntimeInstaller` service, `makeRuntimeInstaller` factory, per-runtime layers |
| Schemas | `src/schemas.ts` | `AbsoluteVersion`, `DevEngines`, `CacheStateSchema`, typed name literals |
| Errors | `src/errors.ts` | `ConfigError`, `RuntimeInstallError`, `PackageManagerSetupError`, `DependencyInstallError`, `CacheError` |
| Emoji/formatting | `src/emoji.ts` | Log formatting helpers with emoji prefixes |
| Node descriptor | `src/descriptors/node.ts` | Download URL, archive type, verify command for Node.js |
| Bun descriptor | `src/descriptors/bun.ts` | Download URL, archive type, verify command for Bun |
| Deno descriptor | `src/descriptors/deno.ts` | Download URL, archive type, verify command for Deno |
| Biome binary map | `src/descriptors/biome.ts` | Platform/arch to binary name mapping |
| Build config | `action.config.ts` | `@savvy-web/github-action-builder` entry points and options |

### Architecture Diagram

```text
action.yml (node24 runtime)
    |
    +-- main: dist/main.js
    |       |
    |       v
    |   src/main.ts  (Effect.gen pipeline)
    |       |
    |       +-- config.ts ---------> schemas.ts
    |       |   loadPackageJson       DevEngines, AbsoluteVersion
    |       |   detectBiome           RuntimeEntry, PackageManagerEntry
    |       |   detectTurbo
    |       |
    |       +-- cache.ts ----------> errors.ts (CacheError)
    |       |   getCombinedCacheConfig
    |       |   findLockFiles
    |       |   restoreCache
    |       |
    |       +-- runtime-installer.ts -> descriptors/{node,bun,deno}.ts
    |       |   RuntimeInstaller service
    |       |   makeRuntimeInstaller factory
    |       |   NodeInstallerLive / BunInstallerLive / DenoInstallerLive
    |       |
    |       +-- main.ts (inline)
    |       |   setupPackageManager
    |       |   installDependencies
    |       |   installBiome  -----> descriptors/biome.ts (binaryMap)
    |       |   setOutputs
    |       |
    |       +-- emoji.ts (formatting helpers)
    |
    +-- post: dist/post.js
            |
            v
        src/post.ts  (Effect.gen)
            |
            +-- cache.ts
                saveCache
```

### Layer Composition

`Action.run` provides core services automatically: `ActionOutputsLive`, `ActionLoggerLive`,
`ConfigProvider` (GitHub Actions inputs), `NodeFileSystem.layer`.

**MainLive** composes business logic layers:

```text
MainLive = Layer.mergeAll(
    ActionCacheLive,           -- V2 Twirp cache protocol
    ToolInstallerLive,         -- Download, extract, cache tools
    CommandRunnerLive,         -- Process execution
    ActionStateLive            -- Cross-phase state (requires FileSystem)
      .pipe(Layer.provide(NodeFileSystem.layer)),
    ActionEnvironmentLive,     -- GitHub context (GITHUB_REF, etc.)
    NodeFileSystem.layer       -- FileSystem for program code
)
```

**PostLive** is minimal:

```text
PostLive = Layer.mergeAll(
    ActionCacheLive,
    ActionStateLive.pipe(Layer.provide(NodeFileSystem.layer))
)
```

---

## Rationale

### Architectural Decisions

#### Decision 1: Effect Framework for Action Logic

**Context:** The imperative TypeScript codebase had deeply nested try/catch blocks, manual state
threading, and difficulty testing individual steps in isolation.

**Options considered:**

1. **Effect (Chosen):** Typed errors, dependency injection via services, composable pipelines
2. **Plain TypeScript with DI:** Manual injection, untyped errors, more boilerplate
3. **Keep imperative:** Fast to implement but increasingly unmaintainable

**Why chosen:** Effect provides typed error channels (`TaggedError`), service composition
(`Layer.mergeAll`), and built-in config/logging that map naturally to GitHub Actions concerns. The
`@savvy-web/github-action-effects` library provides Effect service wrappers for the Actions runtime,
making the integration seamless.

#### Decision 2: Zero @actions/* Dependencies

**Context:** The `@actions/*` packages have frequent breaking changes, conflicting peer deps, and
heavyweight transitive dependency trees.

**Why chosen:** `@savvy-web/github-action-effects` implements the GitHub Actions runtime protocol
natively (V2 Twirp protocol for caching, direct Azure Blob Storage interaction, native process
execution via `@effect/platform`). This eliminates version conflicts, reduces bundle size, and
removes the need for pnpm overrides or patches.

#### Decision 3: devEngines-Only Configuration

**Context:** Previously the action accepted explicit version inputs (`node-version`, `bun-version`,
etc.) alongside `packageManager` field parsing, creating ambiguity about which source of truth
to use.

**Why chosen:** The `devEngines` standard (supported by Corepack and pnpm) provides a single,
declarative source of truth in `package.json`. Removing explicit inputs eliminates configuration
drift between `package.json` and workflow files.

#### Decision 4: Inputs via Effect Config API (not ActionInputs service)

**Context:** Action inputs could be read eagerly via an `ActionInputs` service or lazily via
Effect's `Config` API.

**Why chosen:** `Config.string("input-name").pipe(Config.withDefault(""))` reads inputs lazily at
point of use. `Action.run` sets up a `ConfigProvider` backed by `INPUT_*` environment variables.
This avoids an upfront parsing step and makes each input's usage self-documenting at the call site.

#### Decision 5: RuntimeInstaller Service with GenericTag

**Context:** Multiple runtimes (Node, Bun, Deno) need the same install flow with different
configuration.

**Why chosen:** A single `RuntimeInstaller` interface with `Context.GenericTag` allows swapping
the implementation per runtime via `Layer.succeed`. The `makeRuntimeInstaller(descriptor)` factory
creates installer implementations from pure data descriptors. The main pipeline uses
`Effect.forEach` with `Effect.provide(installerLayerFor(rt.name))` to install each runtime with
the correct descriptor.

### Design Patterns Used

#### Pattern 1: Descriptor Pattern

- **Where used:** `src/descriptors/{node,bun,deno}.ts`
- **Why used:** Separates per-runtime configuration (URLs, archive types) from shared installation
  logic
- **Implementation:** Each descriptor exports a plain object conforming to `RuntimeDescriptor`
  interface; `makeRuntimeInstaller` consumes it

#### Pattern 2: Non-Fatal Error Demotion

- **Where used:** Cache restore, Biome installation, post-action cache save
- **Why used:** Optional operations should not fail the entire job
- **Implementation:** `Effect.catchTag("CacheError", ...)` demotes to `Effect.logWarning`;
  `Effect.catchAll` wraps Biome install and post-action errors

#### Pattern 3: Cross-Phase State via ActionState

- **Where used:** Cache state passed from main to post action
- **Why used:** GitHub Actions separates main and post into different processes
- **Implementation:** `ActionState.save("CACHE_STATE", data, CacheStateSchema)` in main;
  `ActionState.get("CACHE_STATE", CacheStateSchema)` in post. Schema validation ensures type safety
  across process boundaries.

---

## System Architecture

### Pipeline Steps (main.ts)

The main pipeline executes nine sequential steps within a single `Effect.gen` block:

1. **Parse configuration** -- Load `package.json`, decode `devEngines`, detect Biome and Turbo
2. **Compute cache config** -- Determine active package managers, merge cache paths, find lockfiles
3. **Restore cache** -- Generate cache key, attempt restore via V2 Twirp protocol (non-fatal)
4. **Install runtimes** -- Download, extract, cache, and verify each runtime via `RuntimeInstaller`
5. **Setup package manager** -- Activate via corepack (pnpm/yarn) or npm global install
6. **Install dependencies** -- Run lockfile-aware install command (non-fatal skip for Deno)
7. **Install Biome** -- Download binary if detected (non-fatal on failure)
8. **Set outputs** -- Write all action outputs (versions, cache status, paths)
9. **Log summary** -- Collapsible summary group with runtime/PM/cache status

### Error Hierarchy

```text
ConfigError                  -- Fatal: invalid package.json or devEngines
RuntimeInstallError          -- Fatal: runtime download/setup failure
PackageManagerSetupError     -- Fatal: corepack/npm setup failure
DependencyInstallError       -- Fatal: npm/pnpm/yarn/bun install failure
CacheError                   -- Non-fatal on restore; fatal on save only in post
```

All fatal errors propagate to `Action.run` which calls `setFailed`. Non-fatal errors are caught
via `Effect.catchTag` or `Effect.catchAll` and demoted to warnings.

---

## Data Flow

### Configuration Flow

```text
package.json
    |
    v
loadPackageJson (FileSystem.readFileString -> JSON.parse -> Schema.decodeUnknown)
    |
    v
DevEngines { packageManager: PackageManagerEntry, runtime: RuntimeEntry | RuntimeEntry[] }
    |
    v
parseDevEngines (normalize runtime to always-array)
    |
    v
detectBiome (Config override -> biome.jsonc -> biome.json -> $schema URL regex)
    |
    v
detectTurbo (FileSystem.access("turbo.json"))
    |
    v
Typed config object { runtimes, packageManager, biome: Option<string>, turbo: boolean }
```

### Cache Key Generation

```text
Input:  runtimes[], packageManager, lockfiles[], cacheBust?

Step 1: versionHash = SHA256(cacheBust? + sorted(name:version pairs))[0:8]
Step 2: branch = GITHUB_HEAD_REF || GITHUB_REF.replace("refs/heads/", "")
Step 3: branchHash = SHA256(branch)[0:8]
Step 4: lockfileHash = SHA256(concat(lockfile contents))[0:8]

Output: {platform}-{versionHash}-{branchHash}-{lockfileHash}
        e.g., "linux-abc12345-def67890-ghi11223"

Restore keys (fallback chain):
  1. {platform}-{versionHash}-{branchHash}-   (same branch, same versions)
  2. {platform}-{versionHash}-                (any branch, same versions)
  (empty when cacheBust is set -- forces exact match for testing)
```

### Cross-Phase State

```text
Main Action                          Post Action
    |                                     |
    v                                     v
restoreCache()                       saveCache()
    |                                     |
    +-- ActionState.save(              +-- ActionState.get(
    |     "CACHE_STATE",              |     "CACHE_STATE",
    |     { hit, key, paths },        |     CacheStateSchema
    |     CacheStateSchema            |   )
    |   )                             |
    v                                 +-- Skip if hit === "exact"
                                      +-- ActionCache.save(paths, key)
```

---

## Integration Points

### GitHub Actions Runtime

- **Inputs:** Read via Effect `Config` API backed by `INPUT_*` environment variables
- **Outputs:** Set via `ActionOutputs.set(name, value)`
- **Environment:** `ActionEnvironment` provides `GITHUB_REF`, `GITHUB_HEAD_REF`, `RUNNER_TOOL_CACHE`
- **Cache:** `ActionCache` implements V2 Twirp protocol with Azure Blob Storage
- **State:** `ActionState` persists data between main and post hooks via runner state files
- **Logging:** `ActionLogger.group()` creates collapsible log sections; `Effect.log*` for messages

### @savvy-web/github-action-effects Services

| Service | Purpose | Used By |
| --- | --- | --- |
| `ActionOutputs` | Set outputs, add PATH, export variables | main.ts, runtime-installer.ts |
| `ActionLogger` | Collapsible log groups | main.ts |
| `ActionCache` | V2 Twirp cache restore/save | cache.ts |
| `ActionState` | Cross-phase state persistence | cache.ts |
| `ActionEnvironment` | GitHub context variables | cache.ts |
| `ToolInstaller` | Download, extract, cache tools | runtime-installer.ts, main.ts (Biome) |
| `CommandRunner` | Execute processes | cache.ts, main.ts, runtime-installer.ts |

### @effect/platform Services

| Service | Purpose | Used By |
| --- | --- | --- |
| `FileSystem.FileSystem` | File read/access/write | config.ts, cache.ts |

---

## Testing Strategy

### Tier 1: Unit Tests (Effect Test Layers + Vitest)

Each module is tested with in-memory service layers. No `vi.mock` is needed because
`github-action-effects` has zero `@actions/*` transitive imports.

Tests import service tags directly and provide mock implementations via `Layer.succeed`:

```typescript
const makeOutputsLayer = (store: Record<string, string>) =>
  Layer.succeed(ActionOutputs, {
    set: (name, value) => { store[name] = value; return Effect.void },
    // ...
  } as unknown as ContextType.Tag.Service<typeof ActionOutputs>)
```

Config inputs are provided via `ConfigProvider.fromMap`.

### Tier 2: Fixture Tests (GitHub Actions Workflows)

Real-world integration tests using `__fixtures__/` directories with valid `package.json` files.
The `.github/actions/test-fixture/` composite action handles setup, execution, and output
verification. Tests run across Ubuntu, macOS, and Windows in a matrix configuration.

---

## Future Enhancements

### Short-term

- Add lockfile-less cache support (hash `package.json` when no lockfile exists)
- Support `devEngines.cpu` field for architecture constraints

### Medium-term

- Add telemetry/metrics for installation times and cache hit rates
- Support workspace-aware caching for monorepos with multiple lockfiles

### Long-term

- Plugin system for custom runtime descriptors
- Pre-built layer composition for common stacks (Next.js, Remix, etc.)

---

## Related Documentation

**Internal Design Docs:**

- [Effect Service Model](./effect-service-model.md) - Service layer design and layer composition
- [Caching Strategy](./caching-strategy.md) - Cache key generation and multi-PM support
- [Runtime Installation](./runtime-installation.md) - RuntimeInstaller service and descriptors
- [Build and Distribution](./build-and-distribution.md) - Build pipeline and dist management

**Context Files:**

- [Root CLAUDE.md](../../CLAUDE.md) - Repository overview and quick reference
- [src/CLAUDE.md](../../src/CLAUDE.md) - Source code architecture guide
- [**test**/CLAUDE.md](../../__test__/CLAUDE.md) - Unit testing strategy

**External Resources:**

- [Effect Documentation](https://effect.website/docs) - Effect framework reference
- [devEngines specification](https://pnpm.io/package_json#devenginesruntime) - pnpm devEngines docs
- [Corepack documentation](https://github.com/nodejs/corepack) - Node.js Corepack

---

**Document Status:** Current -- reflects the implemented Effect-based architecture after the full
rewrite from imperative TypeScript.

**Next Steps:** Update when new runtime support is added or architectural patterns change.
