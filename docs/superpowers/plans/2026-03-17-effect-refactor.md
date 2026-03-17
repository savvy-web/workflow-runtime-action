# Effect Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite workflow-runtime-action from imperative TypeScript to Effect-based programs using `@savvy-web/github-action-effects`.

**Architecture:** Two entry points (main.ts, post.ts) orchestrate Effect programs. A shared `RuntimeInstaller` service with per-runtime descriptor layers handles all tool installation via `ToolInstaller.installAndAddToPath()`. Cache logic preserved as domain Effect functions backed by `ActionCache`. All unit tests use Effect test layers.

**Tech Stack:** Effect, `@savvy-web/github-action-effects`, `@savvy-web/github-action-builder`, Vitest, `@effect/platform`

**Spec:** `docs/superpowers/specs/2026-03-17-effect-refactor-design.md`

---

## File Map

**Create:**

- `src/schemas.ts` -- Effect Schemas for DevEngines, CacheState, version validation
- `src/errors.ts` -- Domain TaggedError types (ConfigError, RuntimeInstallError, etc.)
- `src/emoji.ts` -- Copy from `src/utils/emoji.ts` (preserved unchanged)
- `src/config.ts` -- Package.json parsing, Biome/Turbo detection using FileSystem
- `src/runtime-installer.ts` -- RuntimeInstaller service + makeRuntimeInstaller factory
- `src/descriptors/node.ts` -- Node.js descriptor + corepack postInstall
- `src/descriptors/bun.ts` -- Bun descriptor
- `src/descriptors/deno.ts` -- Deno descriptor
- `src/descriptors/biome.ts` -- Biome descriptor
- `src/cache.ts` -- Cache key generation, restore/save, lockfile detection
- `src/main.ts` -- Rewrite: Effect orchestration pipeline
- `src/post.ts` -- Rewrite: Cache save Effect program
- `action.config.ts` -- github-action-builder config (already partially exists via build scripts)
- `__test__/schemas.test.ts` -- Schema validation tests
- `__test__/errors.test.ts` -- Error type tests
- `__test__/config.test.ts` -- Config parsing tests
- `__test__/runtime-installer.test.ts` -- RuntimeInstaller service tests
- `__test__/descriptors.test.ts` -- Descriptor URL/archive tests
- `__test__/cache.test.ts` -- Cache logic tests
- `__test__/main.test.ts` -- Main orchestration tests
- `__test__/post.test.ts` -- Post action tests

**Modify:**

- `action.yml` -- Remove explicit version inputs (pre hook already absent)
- `package.json` -- Update dependencies
- `.github/actions/test-fixture/action.yml` -- Remove explicit version input pass-throughs
- `.github/workflows/test.yml` -- Remove explicit input test matrix entries

**Note:** `.github/actions/test-fixture/` already uses `.github/actions/local` -- no path rename needed.

**Delete:**

- `src/utils/` (entire directory -- all modules replaced by new `src/` files)
- `src/types/shared-types.ts` (and `src/types/` directory)
- `src/main.ts` (rewritten in Task 8)
- `src/post.ts` (rewritten in Task 9)
- `__test__/` old test files (replaced by new tests in same directory)

**Note:** `src/pre.ts`, `lib/scripts/build.ts`, and `.github/actions/runtime/` do not exist on this branch -- no cleanup needed for those.

---

## Task 1: Update Dependencies and Build Config

**Files:**

- Modify: `package.json`
- Create: `action.config.ts`
- Modify: `action.yml`
- Delete: `lib/scripts/build.ts`

- [ ] **Step 1: Update package.json dependencies**

Replace the dependencies section. Keep devDependencies that are still needed (`@savvy-web/changesets`, `@savvy-web/commitlint`, `@savvy-web/lint-staged`, `@savvy-web/vitest`, `@savvy-web/github-action-builder`). Remove `@types/semver`.

```jsonc
// dependencies -- replace entire block
{
  "@savvy-web/github-action-effects": "latest",
  "effect": "latest",
  "@effect/platform": "latest",
  "@effect/platform-node": "latest",
  "@actions/cache": "^6.0.0",
  "@actions/core": "^3.0.0",
  "@actions/exec": "^3.0.0",
  "@actions/github": "^9.0.0",
  "@actions/glob": "^0.6.1",
  "@actions/tool-cache": "^4.0.0"
}
```

**Do NOT remove** `jsonc-parser`, `semver`, `workspace-tools`, `@actions/http-client`, `@actions/io` yet -- the old source files still import them. These are cleaned up in Task 10 after old source is deleted. Keep `@actions/*` core packages as direct deps for bundler resolution (they are peer deps of `github-action-effects` but must be resolvable at bundle time since most Live layers use static imports).

Run `pnpm install` to verify resolution.

- [ ] **Step 2: Create action.config.ts**

```typescript
import { defineConfig } from "@savvy-web/github-action-builder";

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
});
```

- [ ] **Step 3: Update action.yml AND test-fixture in one step**

These must be coordinated to avoid breaking CI:

In `action.yml`: Remove inputs `node-version`, `bun-version`, `deno-version`, `package-manager`, `package-manager-version`. Keep all other inputs and all outputs unchanged. `runs.main` is already `dist/main.js` and `runs.post` is already `dist/post.js`.

In `.github/actions/test-fixture/action.yml`: Remove any pass-through of the removed inputs (`node-version`, `bun-version`, `deno-version`, `package-manager`, `package-manager-version`) to `.github/actions/local`.

- [ ] **Step 5: Verify build works**

```bash
pnpm install && pnpm build
```

Expected: Build succeeds (may produce empty/stub dist files if src/main.ts doesn't exist yet, but the builder should run).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: update deps and build config for Effect refactor"
```

---

## Task 2: Schemas and Error Types

**Files:**

- Create: `src/schemas.ts`
- Create: `src/errors.ts`
- Create: `__test__/schemas.test.ts`
- Create: `__test__/errors.test.ts`

- [ ] **Step 1: Write schema tests**

Test file: `__test__/schemas.test.ts`

Test cases:

- `DevEngineEntry` accepts `{ name: "node", version: "24.11.0" }`
- `DevEngineEntry` accepts `{ name: "node", version: "24.11.0", onFail: "error" }`
- `DevEngineEntry` rejects `{ name: "node", version: "^24.0.0" }` (semver range)
- `DevEngineEntry` rejects `{ name: "node", version: "~24.0.0" }` (tilde range)
- `DevEngineEntry` rejects `{ name: "node", version: "*" }` (wildcard)
- `DevEngines` accepts single runtime object
- `DevEngines` accepts array of runtimes
- `DevEngines` rejects missing `packageManager`
- `CacheStateSchema` round-trips correctly with `hit: "exact"`, `"partial"`, `"none"`
- `AbsoluteVersion` accepts `1.0.0-beta.1+build.123`

Use `Schema.decodeUnknownEither` for assertions -- no Effect runtime needed.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- __test__/schemas.test.ts
```

Expected: FAIL (modules don't exist yet)

- [ ] **Step 3: Write src/schemas.ts**

Define:

- `AbsoluteVersion` -- `Schema.String` with `Schema.filter` that rejects `^`, `~`, `>`, `<`, `=`, `*`, `x` prefixes using the regex from the current `isAbsoluteVersion()` in `src/utils/parse-package-json.ts`
- `DevEngineEntry` -- `Schema.Struct({ name: Schema.String, version: AbsoluteVersion, onFail: Schema.optional(Schema.Literal("error", "warn", "ignore")) })`
- `DevEngines` -- `Schema.Struct({ runtime: Schema.Union(DevEngineEntry, Schema.Array(DevEngineEntry)), packageManager: DevEngineEntry })`
- `CacheStateSchema` -- As specified in spec
- `RuntimeName` -- `Schema.Literal("node", "bun", "deno")`
- `PackageManagerName` -- `Schema.Literal("npm", "pnpm", "yarn", "bun")`
- `InstalledRuntime` -- `Schema.Struct({ name: Schema.String, version: Schema.String, path: Schema.String })`

Reference `src/utils/parse-package-json.ts:14-30` for the version validation regex.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- __test__/schemas.test.ts
```

Expected: PASS

- [ ] **Step 5: Write error type tests**

Test file: `__test__/errors.test.ts`

Test cases:

- Each error type has the correct `_tag`
- Each error carries its expected fields
- Errors can be matched with `Effect.catchTag`

- [ ] **Step 6: Write src/errors.ts**

Define all 5 error types from the spec using `Data.TaggedError`:

- `ConfigError` with `reason`, `file?`, `cause?`
- `RuntimeInstallError` with `runtime`, `version`, `reason`, `cause?`
- `PackageManagerSetupError` with `packageManager`, `version`, `reason`, `cause?`
- `DependencyInstallError` with `packageManager`, `reason`, `cause?`
- `CacheError` with `operation`, `reason`, `cause?`

- [ ] **Step 7: Run all tests**

```bash
pnpm test -- __test__/schemas.test.ts __test__/errors.test.ts
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/schemas.ts src/errors.ts __test__/schemas.test.ts __test__/errors.test.ts
git commit -m "feat: add Effect schemas and domain error types"
```

---

## Task 3: Emoji Module (Move)

**Files:**

- Create: `src/emoji.ts` (copy from `src/utils/emoji.ts`)

- [ ] **Step 1: Copy emoji.ts to new location**

```bash
cp src/utils/emoji.ts src/emoji.ts
```

Update import paths if any (the current file has no imports -- it's self-contained). No changes to content needed.

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: PASS (or existing errors unrelated to emoji)

- [ ] **Step 3: Commit**

```bash
git add src/emoji.ts
git commit -m "feat: move emoji module to src root"
```

---

## Task 4: Config Module

**Files:**

- Create: `src/config.ts`
- Create: `__test__/config.test.ts`

- [ ] **Step 1: Write config tests**

Test file: `__test__/config.test.ts`

Use `@effect/platform` test `FileSystem` layer (or a mock layer that provides `FileSystem`). Test cases:

- `loadPackageJson` reads and parses valid `package.json` with `devEngines`
- `loadPackageJson` fails with `ConfigError` for missing file
- `loadPackageJson` fails with `ConfigError` for missing `devEngines`
- `loadPackageJson` fails with `ConfigError` for semver range in version
- `parseDevEngines` normalizes single runtime to array
- `detectBiome` extracts version from `biome.jsonc` `$schema` URL
- `detectBiome` returns `None` when no biome config exists
- `detectBiome` uses input override when provided
- `detectTurbo` returns `true` when `turbo.json` exists
- `detectTurbo` returns `false` when `turbo.json` missing

For the FileSystem test layer, use `@effect/platform/FileSystem` with an in-memory implementation or mock. Reference how `github-action-effects` tests use `@effect/platform` layers.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- __test__/config.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write src/config.ts**

Functions:

- `loadPackageJson` -- `FileSystem.readFileString("package.json")` then `JSON.parse` then `Schema.decodeUnknown(DevEngines)(parsed.devEngines)`. Wrap failures in `ConfigError`.
- `parseDevEngines` -- Normalize single runtime object to `Array<DevEngineEntry>`. Pure function.
- `detectBiome(fs, inputs)` -- Try `biome-version` input first (via `ActionInputs.getOptional`). Then try reading `biome.jsonc` or `biome.json`, extract version via regex `/schemas\/([^/]+)\/schema\.json/`. Return `Option<string>`.
- `detectTurbo(fs)` -- `FileSystem.exists("turbo.json")`. Return `boolean`.

Reference current implementations:

- `src/utils/parse-package-json.ts` for validation logic
- `src/main.ts:109-125` for `detectBiome()` and `extractBiomeVersionFromSchema()`
- `src/main.ts:95-107` for `detectTurbo()`

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- __test__/config.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts __test__/config.test.ts
git commit -m "feat: add config module with devEngines parsing"
```

---

## Task 5: Runtime Descriptors

**Files:**

- Create: `src/descriptors/node.ts`
- Create: `src/descriptors/bun.ts`
- Create: `src/descriptors/deno.ts`
- Create: `src/descriptors/biome.ts`
- Create: `__test__/descriptors.test.ts`

- [ ] **Step 1: Write descriptor tests**

Test file: `__test__/descriptors.test.ts`

Test each descriptor's `getDownloadUrl` and `getToolInstallOptions` for multiple platform/arch combos. These are pure functions -- no Effect layers needed.

Test cases per descriptor:

- **Node**: linux/x64 gives `https://nodejs.org/dist/v{ver}/node-v{ver}-linux-x64.tar.gz`, darwin/arm64 gives `.tar.gz`, win32/x64 gives `.zip`. `binSubPath` is `bin` on unix, empty on windows.
- **Bun**: linux/x64 gives `https://github.com/oven-sh/bun/releases/download/bun-v{ver}/bun-linux-x64.zip`. Arch mapping: arm64 to `aarch64`.
- **Deno**: Uses Rust target triples. linux/x64 gives `deno-x86_64-unknown-linux-gnu.zip`.
- **Biome**: linux/x64 gives `https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%40{ver}/biome-linux-x64`. Single binary (no archive).

Reference current implementations for exact URL patterns:

- `src/utils/install-node.ts:10-30` for Node URL construction
- `src/utils/install-bun.ts:5-25` for Bun URL construction
- `src/utils/install-deno.ts:5-30` for Deno URL construction
- `src/utils/install-biome.ts:5-25` for Biome URL construction

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- __test__/descriptors.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write descriptor modules**

Each descriptor file exports a `RuntimeDescriptor` object. Extract URL construction and platform mapping from current install modules.

`src/descriptors/node.ts`:

- `getDownloadUrl`: `https://nodejs.org/dist/v${version}/node-v${version}-${platform}-${arch}.${ext}`
- `getToolInstallOptions`: `{ archiveType: platform === "win32" ? "zip" : "tar.gz", binSubPath: platform === "win32" ? "" : "bin" }`
- `verifyCommand`: `["node", "--version"]`
- `postInstall`: Handles corepack/npm setup (requires `CommandRunner`). Port logic from `src/utils/install-node.ts:90-160` (`setupPackageManager`, `setupNpm`).

`src/descriptors/bun.ts`:

- `getDownloadUrl`: `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${archiveName}`
- `getToolInstallOptions`: `{ archiveType: "zip" }`
- `verifyCommand`: `["bun", "--version"]`

`src/descriptors/deno.ts`:

- `getDownloadUrl`: `https://github.com/denoland/deno/releases/download/v${version}/${archiveName}`
- `getToolInstallOptions`: `{ archiveType: "zip" }`
- `verifyCommand`: `["deno", "--version"]`

`src/descriptors/biome.ts`:

- Special case: single binary download, not an archive
- Will need to handle this differently in `makeRuntimeInstaller` (use `ToolInstaller.install` with file download rather than archive extraction)
- `verifyCommand`: `["biome", "--version"]`

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- __test__/descriptors.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/descriptors/ __test__/descriptors.test.ts
git commit -m "feat: add runtime descriptors for node, bun, deno, biome"
```

---

## Task 6: RuntimeInstaller Service

**Files:**

- Create: `src/runtime-installer.ts`
- Create: `__test__/runtime-installer.test.ts`

- [ ] **Step 1: Write RuntimeInstaller tests**

Test file: `__test__/runtime-installer.test.ts`

Use `ToolInstallerTest` and `CommandRunnerTest` from `@savvy-web/github-action-effects`. Test cases:

- `install("24.11.0")` calls `ToolInstaller.installAndAddToPath` with correct args and returns `InstalledRuntime`
- `install` runs `verifyCommand` after installation
- `install` runs `postInstall` when defined
- `install` wraps `ToolInstallerError` in `RuntimeInstallError`
- `install` wraps `CommandRunnerError` in `RuntimeInstallError`
- `isCached` returns true when tool exists in cache

Reference `github-action-effects/src/services/ToolInstaller.test.ts:80-120` for test layer usage patterns.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- __test__/runtime-installer.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write src/runtime-installer.ts**

Define:

- `RuntimeDescriptor` type (as in spec)
- `RuntimeInstaller` service interface with `Context.GenericTag`
- `makeRuntimeInstaller(descriptor)` factory function that:
  1. Yields `ToolInstaller` and `CommandRunner` from context
  2. Computes URL via `descriptor.getDownloadUrl(version, process.platform, process.arch)`
  3. Computes options via `descriptor.getToolInstallOptions(version, process.platform, process.arch)`
  4. Calls `toolInstaller.installAndAddToPath(descriptor.name, version, url, options)`
  5. Calls `runner.exec(descriptor.verifyCommand[0], descriptor.verifyCommand.slice(1))`
  6. Calls `descriptor.postInstall?.(version)` if defined
  7. Returns `{ name: descriptor.name, version, path }`
  8. Wraps all errors via `Effect.catchAll` into `RuntimeInstallError`
- Per-runtime layer constructors: `NodeInstallerLive`, `BunInstallerLive`, `DenoInstallerLive`, `BiomeInstallerLive`
- `installerLayerFor(name: string)` helper that maps runtime name to the correct layer

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- __test__/runtime-installer.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/runtime-installer.ts __test__/runtime-installer.test.ts
git commit -m "feat: add RuntimeInstaller service with per-runtime layers"
```

---

## Task 7: Cache Module

**Files:**

- Create: `src/cache.ts`
- Create: `__test__/cache.test.ts`

- [ ] **Step 1: Write cache tests**

Test file: `__test__/cache.test.ts`

Use `ActionCacheTest`, `ActionStateTest`, `ActionEnvironmentTest`, `CommandRunnerTest` from `@savvy-web/github-action-effects`. Test cases:

- `generateCacheKey` produces correct format: `{os}-{versionHash}-{branchHash}-{lockfileHash}`
- `generateCacheKey` produces different keys for different versions
- `generateCacheKey` produces different keys for different branches
- `restoreCache` calls `ActionCache.restore` with primary key and restore keys
- `restoreCache` saves state via `ActionState` for post action
- `restoreCache` returns `"exact"` on primary key hit, `"partial"` on restore key hit, `"none"` on miss
- `saveCache` reads state from `ActionState` and calls `ActionCache.save`
- `saveCache` skips saving when hit was `"exact"`
- `getCombinedCacheConfig` merges paths from multiple package managers
- `getCombinedCacheConfig` deduplicates paths
- `detectCachePath` queries package manager via `CommandRunner.execCapture`
- `detectCachePath` falls back to platform defaults on failure

Reference current implementation: `src/utils/cache-utils.ts` (entire file -- preserve the battle-tested logic).

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- __test__/cache.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write src/cache.ts**

Port logic from `src/utils/cache-utils.ts`. Key functions:

- `detectCachePath(pm)` -- Use `CommandRunner.execCapture` to query cache location (e.g., `npm config get cache`). Fall back to `getDefaultCachePaths(pm)`.
- `getCacheConfig(pm)` -- Returns `{ cachePaths, lockfilePatterns }` per package manager.
- `getCombinedCacheConfig(pms)` -- Merges and deduplicates.
- `findLockFiles(patterns)` -- Use `@actions/glob` patterns via `FileSystem` or keep glob usage.
- `generateCacheKey(runtimes, pm, lockfiles)` -- Hashes versions, branch, lockfiles. Uses `ActionEnvironment` for branch name.
- `restoreCache(config)` -- Calls `ActionCache.restore`, saves `CacheStateSchema` via `ActionState`.
- `saveCache()` -- Reads `CacheStateSchema` from `ActionState`, calls `ActionCache.save` if hit was not `"exact"`.

Key references:

- `src/utils/cache-utils.ts:200-280` for `getCacheConfig` and `detectCachePath`
- `src/utils/cache-utils.ts:300-400` for `generateCacheKey`, `hashFiles`, `hashBranch`
- `src/utils/cache-utils.ts:500-650` for `restoreCache` and `saveCache`
- `src/utils/cache-utils.ts:100-180` for `getDefaultCachePaths` platform-specific paths

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- __test__/cache.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cache.ts __test__/cache.test.ts
git commit -m "feat: add cache module with Effect-based key generation"
```

---

## Task 8: Main Orchestration

**Files:**

- Create: `src/main.ts` (rewrite)
- Create: `__test__/main.test.ts`

- [ ] **Step 1: Write main tests**

Test file: `__test__/main.test.ts`

Compose all test layers. Test the full pipeline:

- Config is loaded from inputs/filesystem
- Runtimes are installed in order
- Package manager is set up
- Dependencies are installed when `install-deps` is true
- Dependencies are skipped when `install-deps` is false
- Biome install failure doesn't fail the action
- All outputs are set correctly
- Cache state is saved for post action

Use `ActionInputsTest`, `ActionOutputsTest`, `ActionLoggerTest`, `ActionStateTest`, `ActionCacheTest`, `ActionEnvironmentTest`, `ToolInstallerTest`, `CommandRunnerTest` composed into a single test layer.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- __test__/main.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write src/main.ts**

Implement the orchestration pipeline from the spec. Key structure:

```typescript
import { Action, ActionInputs, ActionOutputs, ActionLogger, ActionCache, ActionState,
  ActionEnvironment, ToolInstaller, CommandRunner } from "@savvy-web/github-action-effects";
import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
// ... domain imports

const main = Effect.gen(function* () {
  // 1. Parse config
  // 2. Restore cache
  // 3. Install runtimes
  // 4. Setup package manager
  // 5. Install deps
  // 6. Install biome (non-fatal)
  // 7. Set outputs
});

const MainLive = Layer.mergeAll(
  ActionCacheLive, ToolInstallerLive, CommandRunnerLive,
  ActionStateLive, ActionEnvironmentLive,
);

Action.run(main, MainLive);
```

**Important:** The `cache-hit` output expects `"true"` | `"partial"` | `"false"` | `"n/a"` but internal `CacheStateSchema` uses `"exact"` | `"partial"` | `"none"`. The `setOutputs` function must map: `"exact"` -> `"true"`, `"partial"` -> `"partial"`, `"none"` -> `"false"`.

`FileSystem` and `Path` from `@effect/platform` are available in the program's environment automatically -- `Action.run` provides them via `NodeContext.layer` (part of `CoreServices`). No need to include them in `MainLive`.

Reference the orchestration pseudocode from the spec (lines 285-338).

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- __test__/main.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main.ts __test__/main.test.ts
git commit -m "feat: rewrite main action as Effect pipeline"
```

---

## Task 9: Post Action

**Files:**

- Create: `src/post.ts` (rewrite)
- Create: `__test__/post.test.ts`

- [ ] **Step 1: Write post tests**

Test file: `__test__/post.test.ts`

Use `ActionCacheTest` and `ActionStateTest`. Test cases:

- `saveCache` reads state and saves when hit was `"partial"` or `"none"`
- `saveCache` skips when hit was `"exact"`
- `saveCache` handles missing state gracefully (warns, doesn't fail)
- Post action catches errors and warns (non-fatal)

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- __test__/post.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write src/post.ts**

```typescript
import { Action, ActionCache, ActionState } from "@savvy-web/github-action-effects";
import { Effect, Layer } from "effect";
import { saveCache } from "./cache.js";

const post = Effect.gen(function* () {
  yield* saveCache();
}).pipe(
  Effect.catchAll((e) => Effect.logWarning(`Post action error: ${e}`)),
);

const PostLive = Layer.mergeAll(ActionCacheLive, ActionStateLive);

Action.run(post, PostLive);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- __test__/post.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/post.ts __test__/post.test.ts
git commit -m "feat: rewrite post action as Effect program"
```

---

## Task 10: Clean Up Old Code

**Files:**

- Delete: `src/utils/` (entire directory), `src/types/` (entire directory)
- Delete: `__test__/` old test files (keep new ones from Tasks 2-9)
- Modify: `package.json` (remove old-only dependencies)

- [ ] **Step 1: Delete old source files**

```bash
rm -rf src/utils/
rm -rf src/types/
```

- [ ] **Step 2: Delete old test files**

Remove from `__test__/`: `action-io.test.ts`, `cache-utils.test.ts`, `emoji.test.ts`, `error.test.ts`, `install-biome.test.ts`, `install-bun.test.ts`, `install-deno.test.ts`, `install-node.test.ts`, `main.test.ts`, `parse-package-json.test.ts`, `post.test.ts`, and the `utils/` subdirectory. Keep new test files created in previous tasks.

- [ ] **Step 3: Remove old-only dependencies from package.json**

Remove from `dependencies`: `jsonc-parser`, `semver`, `workspace-tools`, `@actions/http-client`, `@actions/io`. Remove from `devDependencies`: `@types/semver`. Run `pnpm install`.

- [ ] **Step 4: Run all tests to verify nothing is broken**

```bash
pnpm test
```

Expected: PASS (all new tests pass, no old tests to fail)

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 6: Run lint**

```bash
pnpm lint:fix && pnpm lint:md:fix
```

Expected: No errors (or only auto-fixable ones)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove old imperative source code and tests"
```

---

## Task 11: Build and Verify

**Files:**

- Verify: `dist/main.js`, `dist/post.js`, `.github/actions/local/`

- [ ] **Step 1: Build the action**

```bash
pnpm build
```

Expected: Build succeeds, produces `dist/main.js`, `dist/post.js`, `.github/actions/local/` with main.js and post.js.

- [ ] **Step 2: Verify dist structure**

```bash
ls -la dist/
ls -la .github/actions/local/dist/
```

Expected: `main.js`, `post.js`, `package.json` in both locations. No `pre.js`.

- [ ] **Step 3: Run full validation**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm lint:md
```

Expected: All pass

- [ ] **Step 4: Commit dist**

```bash
git add dist/ .github/actions/local/
git commit -m "chore: build refactored action"
```

---

## Task 12: Update Fixture Tests

**Files:**

- Modify: `.github/actions/test-fixture/action.yml`
- Modify: `.github/workflows/test.yml`
- Modify: `__fixtures__/` (update fixtures that used explicit inputs)

- [ ] **Step 1: Verify test-fixture action path**

`.github/actions/test-fixture/action.yml` already uses `.github/actions/local` -- verify this and remove any pass-through of the deleted inputs (`node-version`, `bun-version`, `deno-version`, `package-manager`, `package-manager-version`) if not already done in Task 1.

- [ ] **Step 2: Remove explicit input test matrix entries**

In `.github/workflows/test.yml`, remove matrix entries that test explicit version inputs (`node-version`, `bun-version`, etc. as action inputs). These inputs no longer exist. Keep all `devEngines`-based fixture tests.

- [ ] **Step 3: Update fixture package.json files**

Ensure all fixture `package.json` files use the `devEngines` format. Check each fixture in `__fixtures__/` -- the current ones may use the old `packageManager` field format. Update any that need the `devEngines.packageManager` and `devEngines.runtime` structure.

Reference: `__fixtures__/CLAUDE.md` for the list of fixtures.

- [ ] **Step 4: Commit**

```bash
git add .github/ __fixtures__/
git commit -m "chore: update fixture tests for refactored action"
```

---

## Task 13: Update Documentation

**Files:**

- Modify: `CLAUDE.md`
- Modify: `src/CLAUDE.md`
- Modify: `__test__/CLAUDE.md`
- Modify: `.github/workflows/CLAUDE.md`

- [ ] **Step 1: Update root CLAUDE.md**

Update the project structure section to reflect new file layout. Update the build process section to reference `action.config.ts` and `github-action-builder`. Remove references to `@vercel/ncc`, `lib/scripts/build.ts`, explicit input mode. Update dependency list. Update the action inputs section to remove explicit version inputs.

- [ ] **Step 2: Update src/CLAUDE.md**

Rewrite to describe the Effect-based architecture: entry points, service pattern, RuntimeInstaller, descriptors, config, cache modules. Remove references to old `utils/` files.

- [ ] **Step 3: Update **tests**/CLAUDE.md**

Describe the Effect test layer approach. Remove references to manual mocking patterns.

- [ ] **Step 4: Update .github/workflows/CLAUDE.md**

Update references from `.github/actions/runtime` to `.github/actions/local`. Remove references to explicit input test scenarios.

- [ ] **Step 5: Lint markdown**

```bash
pnpm lint:md:fix
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md src/CLAUDE.md __test__/CLAUDE.md .github/workflows/CLAUDE.md
git commit -m "docs: update documentation for Effect refactor"
```
