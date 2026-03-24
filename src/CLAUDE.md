# src/CLAUDE.md

Source code architecture, build process, and development guidelines for the workflow-runtime-action.

**See also:** [Root CLAUDE.md](../CLAUDE.md) for repository overview.

## Architecture Overview

The action is written as an **Effect-based program** using `@savvy-web/github-action-effects` (0.11.10) for GitHub Action service abstractions. All side effects (file I/O, command execution, caching, outputs) flow through Effect services rather than direct API calls.

Key architectural properties:

- **Zero `@actions/*` dependencies** -- `github-action-effects` implements the GitHub Actions runtime protocol natively (V2 Twirp protocol with Azure Blob Storage for caching, native process execution, etc.)
- **Inputs via Effect Config API** -- `Config.string`, `Config.boolean`, `Config.withDefault` backed by a `ConfigProvider` that reads GitHub Actions input environment variables
- **Logging via Effect.log** -- `Effect.log`, `Effect.logWarning`, `Effect.logError`, `Effect.logDebug` for all log output; `ActionLogger.group()` for collapsible sections
- **Build via rsbuild** -- `@savvy-web/github-action-builder` 0.5.0 uses rsbuild under the hood

For a full architectural spec see `.claude/design/workflow-runtime-action/architecture.md`.

## Entry Points

The action has two lifecycle hooks:

```yaml
runs:
  using: "node24"
  main: "dist/main.js"
  post: "dist/post.js"
```

- **[main.ts](main.ts)** -> `dist/main.js` -- Effect pipeline that detects config, installs runtimes, sets up package manager, caches dependencies, and sets outputs
- **[post.ts](post.ts)** -> `dist/post.js` -- Saves the dependency cache after the job completes (non-fatal; errors are warnings)

## Source Modules

### [main.ts](main.ts)

Top-level Effect pipeline composed of nine sequential steps:

1. Parse configuration (load `package.json`, detect Biome, detect Turbo)
2. Compute cache config and find lockfiles
3. Restore cache (non-fatal on error)
4. Install runtimes via `RuntimeInstaller` service
5. Setup package manager (corepack/npm)
6. Install dependencies (lockfile-aware)
7. Install Biome (non-fatal on error)
8. Set action outputs
9. Log a summary

Also contains:

- **`parseMultiValueInput`** -- Parses multi-value input strings (newlines, bullets, commas, JSON arrays)
- **`installBiome`** -- Installs Biome as a raw binary using `ToolInstaller.download` + `ToolInstaller.cacheFile`
- **`getActivePackageManagers`** -- Determines active package managers from runtimes
- **`installDependencies`** -- Runs lockfile-aware install command for the detected package manager
- **`setupPackageManager`** -- Activates the correct package manager version via corepack or npm global install
- **`setOutputs`** -- Sets all action outputs from pipeline results

Layer composition at the bottom wires `ActionCacheLive`, `ToolInstallerLive`, `CommandRunnerLive`, `ActionStateLive` (with `NodeFileSystem`), `ActionEnvironmentLive`, and `NodeFileSystem.layer` into `MainLive`, then calls `Action.run(main, { layer: MainLive })`.

### [post.ts](post.ts)

Minimal Effect program that calls `saveCache()`. Errors are caught globally and demoted to warnings so a cache-save failure never fails the job.

### [config.ts](config.ts)

Pure Effect functions for configuration loading and detection:

- **`loadPackageJson`** -- Reads and decodes `package.json` via `FileSystem.FileSystem`, wrapping all failures in `ConfigError`
- **`parseDevEngines`** -- Normalises `devEngines.runtime` from single-object or array form to always-array
- **`detectBiome`** -- Checks the `biome-version` Config input override first (via `Config.string("biome-version").pipe(Config.withDefault(""))`), then reads `$schema` from `biome.jsonc` / `biome.json`
- **`detectTurbo`** -- Returns `true` if `turbo.json` exists in the working directory

### [cache.ts](cache.ts)

Effect functions backed by `ActionCache`, `ActionState`, `ActionEnvironment`, `CommandRunner`, and `FileSystem` services:

- **`getDefaultCachePaths`** / **`getLockfilePatterns`** -- Pure helpers per package manager
- **`detectCachePath`** -- Queries the installed package manager for its actual cache directory (e.g., `pnpm store path`)
- **`getCacheConfig`** / **`getCombinedCacheConfig`** -- Merges configs for all active package managers and adds tool cache paths for installed runtimes
- **`findLockFiles`** -- Checks for known lockfile filenames at the workspace root
- **`generateCacheKey`** / **`generateRestoreKeys`** -- Build deterministic cache keys from runtime versions, package manager version, branch, and lockfile hashes
- **`restoreCache`** -- Restores cache via `ActionCache` (V2 Twirp protocol) and saves state (key + paths + hit status) for the post action
- **`saveCache`** -- Reads state saved by `restoreCache` and saves cache only when the previous restore was not an exact hit

### [runtime-installer.ts](runtime-installer.ts)

Service-based runtime installation:

- **`RuntimeDescriptor`** interface -- Describes how to download and install a tool: download URL factory, tool install options factory (archive type, bin sub-path), verify command
- **`RuntimeInstaller`** service tag -- `Context.GenericTag<RuntimeInstaller>` with a single `install(version)` method
- **`makeRuntimeInstaller`** -- Factory that creates a `RuntimeInstaller` from a `RuntimeDescriptor`; uses individual `ToolInstaller` primitives (`download`, `extractTar`/`extractZip`, `cacheDir`) rather than a single high-level call; wraps all failures in `RuntimeInstallError`
- Pre-built layers: `NodeInstallerLive`, `BunInstallerLive`, `DenoInstallerLive` (Biome uses `installBiome()` directly since it's a raw binary)
- **`installerLayerFor(name)`** -- Returns the appropriate layer by runtime name

### [schemas.ts](schemas.ts)

Effect Schema definitions shared across the codebase:

- **`AbsoluteVersion`** -- Rejects semver range operators; requires `major.minor.patch` format
- **`RuntimeName`** -- `Schema.Literal("node", "bun", "deno")`
- **`PackageManagerName`** -- `Schema.Literal("npm", "pnpm", "yarn", "bun", "deno")`
- **`RuntimeEntry`** -- `{ name: RuntimeName, version: AbsoluteVersion, onFail? }` struct
- **`PackageManagerEntry`** -- `{ name: PackageManagerName, version: AbsoluteVersion, onFail? }` struct
- **`DevEngines`** -- `{ packageManager: PackageManagerEntry, runtime: RuntimeEntry | RuntimeEntry[] }`
- **`CacheStateSchema`** -- State persisted between main and post actions: `{ hit, key?, paths? }`

### [errors.ts](errors.ts)

`Data.TaggedError` hierarchy for typed error handling:

| Tag | Fields | When thrown |
| --- | ------- | ----------- |
| `ConfigError` | `reason`, `file?`, `cause?` | Invalid/missing `package.json` or `devEngines` |
| `RuntimeInstallError` | `runtime`, `version`, `reason`, `cause?` | Runtime download or setup failure |
| `PackageManagerSetupError` | `packageManager`, `version`, `reason`, `cause?` | Package manager setup failure |
| `DependencyInstallError` | `packageManager`, `reason`, `cause?` | `npm install` / `pnpm install` etc. failure |
| `CacheError` | `operation`, `reason`, `cause?` | Cache restore, save, or key-generation failure |

### [emoji.ts](emoji.ts)

Formatting helpers used by `main.ts` log messages. Provides `formatRuntime`, `formatPackageManager`, `formatDetection`, `formatInstallation`, `formatSuccess`, and similar functions that prepend emoji to log strings.

### [descriptors/](descriptors/)

One file per installable runtime (`node.ts`, `bun.ts`, `deno.ts`). Each exports a `descriptor` conforming to the `RuntimeDescriptor` interface, encoding the download URL template, archive options, and verify command. Descriptors are pure data with no `postInstall` hooks -- package manager setup is handled separately in `main.ts`.

`biome.ts` exports a `binaryMap` (platform/arch to binary name) rather than a `RuntimeDescriptor`, since Biome is a single binary download that uses `installBiome()` directly with `ToolInstaller.download` + `ToolInstaller.cacheFile`.

## Build Process

Build is configured in [`action.config.ts`](../action.config.ts) at the repo root:

```typescript
export default defineConfig({
  entries: { main: "src/main.ts", post: "src/post.ts" },
  build: { minify: false },
  persistLocal: { enabled: true, path: ".github/actions/local" },
});
```

Run the build:

```bash
pnpm build
```

This uses `@savvy-web/github-action-builder` (0.5.0, rsbuild-based) to bundle both entry points to `dist/` and copy a testing variant to `.github/actions/local/`.

**Always commit `dist/` and `.github/actions/local/` after building.**

## TypeScript Configuration

- `module: "ESNext"`, `moduleResolution: "bundler"`, `target: "ES2022"`, `strict: true`, `noEmit: true`
- All imports must use `.js` extensions (enforced by Biome)
- Built-in Node.js modules must use the `node:` protocol (enforced by Biome)
- Separate type imports from value imports (enforced by Biome)

## Development Workflow

```bash
# 1. Edit source
vim src/config.ts

# 2. Type-check
pnpm typecheck

# 3. Run tests
pnpm test

# 4. Lint
pnpm lint:fix

# 5. Build
pnpm build

# 6. Commit source AND dist
git add src/ dist/ .github/actions/local/
git commit -m "feat: ..."
```

## Effect Patterns

### Service injection

All services (FileSystem, CommandRunner, ActionOutputs, ToolInstaller, etc.) are provided via `Effect.provide` or as layers. Never import `@actions/*` packages directly -- they are not dependencies of this project.

### Input reading

Action inputs are read via the Effect `Config` API at point of use:

```typescript
const installDeps = yield* Config.boolean("install-deps").pipe(Config.withDefault(true))
const biomeVersion = yield* Config.string("biome-version").pipe(Config.withDefault(""))
```

`Action.run` sets up a `ConfigProvider` that reads from GitHub Actions input environment variables (`INPUT_*`).

### Error handling

Use tagged errors (`ConfigError`, `RuntimeInstallError`, etc.) and handle them with `Effect.catchTag`. Non-fatal steps use `Effect.catchAll` or `Effect.catchTag` to demote failures to warnings.

### Testing

Tests import service tags directly from `@savvy-web/github-action-effects` and provide inline mock implementations via `Layer.succeed`. No `vi.mock` needed since `github-action-effects` 0.11.10 has no `@actions/*` transitive imports. See [`__test__/CLAUDE.md`](../__test__/CLAUDE.md).

## Common Issues

### Changes don't take effect in CI

Run `pnpm build` and commit `dist/` + `.github/actions/local/`.

### Import not found

Add the `.js` extension to all local imports.

### Effect service not provided

Ensure the required service is included in the layer passed to `Effect.provide` or `Action.run`.

## Related Documentation

- [Root CLAUDE.md](../CLAUDE.md) - Repository overview
- [**test**/CLAUDE.md](../__test__/CLAUDE.md) - Unit testing strategy
- [**fixtures**/CLAUDE.md](../__fixtures__/CLAUDE.md) - Integration testing
- [Effect Documentation](https://effect.website/docs) - Effect framework reference

### Design Documentation

For deep architectural details:

- **Architecture:** `@../.claude/design/workflow-runtime-action/architecture.md`
- **Effect Service Model:** `@../.claude/design/workflow-runtime-action/effect-service-model.md`
- **Runtime Installation:** `@../.claude/design/workflow-runtime-action/runtime-installation.md`
- **Caching Strategy:** `@../.claude/design/workflow-runtime-action/caching-strategy.md`
