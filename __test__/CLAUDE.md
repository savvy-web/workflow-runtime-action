# **test**/CLAUDE.md

Unit testing strategy, mocking patterns, and coverage requirements for workflow-runtime-action.

**See also:** [Root CLAUDE.md](../CLAUDE.md) | [src/CLAUDE.md](../src/CLAUDE.md) | [**fixtures**/CLAUDE.md](../__fixtures__/CLAUDE.md) for integration testing.

## Testing Strategy

This action uses a **dual testing approach**:

1. **Unit Tests** (this document) - Fast, isolated tests using Effect test layers with Vitest
2. **Fixture Tests** (see [**fixtures**/CLAUDE.md](../__fixtures__/CLAUDE.md)) - Real-world integration tests in GitHub Actions workflows

Unit tests provide fast feedback during development and ensure code coverage thresholds are met.

## Test Organization

```text
__test__/
├── cache.test.ts             # Cache restore/save, key generation, lockfile detection
├── config.test.ts            # devEngines loading, Biome/Turbo detection
├── descriptors.test.ts       # Per-runtime download URL and install option helpers
├── errors.test.ts            # TaggedError construction and tag assertions
├── main.test.ts              # Full pipeline integration via Effect test layers
├── post.test.ts              # Post-action cache save logic
├── runtime-installer.test.ts # RuntimeInstaller service, makeRuntimeInstaller factory
└── schemas.test.ts           # Effect Schema validators (AbsoluteVersion, DevEngines, etc.)
```

## Running Tests

```bash
# Run all tests with coverage
pnpm test

# Run tests in watch mode
pnpm test --watch

# Run specific test file
pnpm test __test__/cache.test.ts

# View coverage report
open coverage/index.html
```

## Mocking Strategy

### No vi.mock Needed

Since `@savvy-web/github-action-effects` 0.11.10 has **zero `@actions/*` dependencies** (it implements the GitHub Actions runtime protocol natively), there are no problematic transitive imports that break in the test environment. Tests import service tags directly and provide inline mock implementations via `Layer.succeed`:

```typescript
import { ActionOutputs, ActionLogger, ActionCache } from "@savvy-web/github-action-effects"
import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"
import type { Context as ContextType } from "effect"

const makeOutputsLayer = (store: Record<string, string>) =>
  Layer.succeed(ActionOutputs, {
    set: (name: string, value: string) => {
      store[name] = value
      return Effect.void
    },
    setJson: () => Effect.void,
    summary: () => Effect.void,
    exportVariable: (name: string, value: string) => {
      exportedVars[name] = value
      return Effect.void
    },
    addPath: () => Effect.void,
    setFailed: () => Effect.void,
    setSecret: () => Effect.void,
  } as unknown as ContextType.Tag.Service<typeof ActionOutputs>)
```

### Effect Test Layers

Services are injected via `Layer.succeed` with inline mock implementations. This mirrors the real production layer composition and tests the actual Effect plumbing. No `vi.mock`, no `/testing` subpath import -- just direct imports and layers.

**Pattern:**

```typescript
const makeFileSystemLayer = (files: Record<string, string>) =>
  Layer.succeed(
    FileSystem.FileSystem,
    FileSystem.makeNoop({
      readFileString: (path) => {
        const content = files[path]
        if (content === undefined) return Effect.fail(new Error(`File not found: ${path}`))
        return Effect.succeed(content)
      },
      access: (path) => {
        if (files[path] !== undefined) return Effect.void
        return Effect.fail(new Error(`No access: ${path}`))
      },
    }),
  )

const layer = Layer.mergeAll(
  makeOutputsLayer(outputStore),
  makeLoggerLayer(),
  makeCacheLayer("none"),
  makeStateLayer(),
  makeEnvironmentLayer({ GITHUB_REF: "refs/heads/main" }),
  makeCommandRunnerLayer(cmdResponses),
  makeToolInstallerLayer(),
  makeFileSystemLayer({ "package.json": VALID_PACKAGE_JSON }),
)

await Effect.runPromise(Effect.provide(pipeline, layer))
```

### Config Inputs in Tests

Since action inputs use the Effect `Config` API (`Config.string`, `Config.boolean`, `Config.withDefault`), tests provide input values via `ConfigProvider.fromMap`:

```typescript
const configLayer = Layer.setConfigProvider(
  ConfigProvider.fromMap(new Map([
    ["install-deps", "false"],
    ["biome-version", "2.3.14"],
  ]))
)
```

## Key Test Files

### main.test.ts

Tests the full pipeline by re-composing the same Effect logic that `main.ts` uses, injecting all services as test layers. Assertions run against the captured `outputStore` and `exportedVars` records.

Scenarios covered:

* Full pipeline with valid config sets all outputs correctly
* `install-deps=false` skips dependency installation
* Biome install failure is non-fatal
* Cache restore failure is non-fatal
* Missing `package.json` fails with `ConfigError`
* Cache hit mapping (`exact` -> `"true"`, `partial` -> `"partial"`, `none` -> `"false"`)
* Multi-runtime config installs all runtimes
* Turbo detection sets `TURBO_TOKEN` and `TURBO_TEAM` env vars

### runtime-installer.test.ts

Tests `makeRuntimeInstaller` in isolation with `ToolInstaller` and `CommandRunner` mock layers. Covers:

* Returns correct `InstalledRuntime` on success
* Wraps download/extract failures as `RuntimeInstallError`
* `installerLayerFor` returns correct layers and fails for unknown names

### cache.test.ts

Tests cache key generation, lockfile detection, path defaults, and the restore/save roundtrip.

### config.test.ts

Tests `loadPackageJson`, `parseDevEngines`, `detectBiome`, and `detectTurbo` against mock `FileSystem` layers. Uses `ConfigProvider.fromMap` for Config input overrides.

### schemas.test.ts

Tests `AbsoluteVersion` rejects range operators and accepts well-formed semver strings. Tests `DevEngines` schema decoding with typed `RuntimeName` and `PackageManagerName` fields.

## Layer Composition Pattern

```typescript
const buildBaseLayer = (opts: { files?, cacheHit?, env?, cmdResponses? }) => {
  const outputStore: Record<string, string> = {}
  const exportedVars: Record<string, string> = {}
  const layer = Layer.mergeAll(
    makeOutputsLayer(outputStore, exportedVars),
    makeLoggerLayer(),
    makeCacheLayer(opts.cacheHit ?? "none"),
    makeStateLayer(),
    makeEnvironmentLayer(opts.env ?? { GITHUB_REF: "refs/heads/main" }),
    makeCommandRunnerLayer(opts.cmdResponses),
    makeToolInstallerLayer(),
    makeFileSystemLayer(opts.files ?? { "package.json": VALID_PACKAGE_JSON }),
  )
  return { layer, outputStore, exportedVars }
}

const runPipeline = (layer: Layer.Layer<never>) =>
  Effect.runPromise(Effect.provide(pipeline, layer))
```

## Coverage Requirements

Configured in `vitest.config.ts`:

* **Branches:** 85%
* **Functions/Lines/Statements:** 90%

## Common Issues

### Type errors in test layers

Use `as unknown as ContextType.Tag.Service<typeof ServiceTag>` at service boundaries -- mock implementations don't need to satisfy the full service type, only the methods actually called by the code under test.

### "Effect service not found"

Ensure all services required by the Effect under test are present in `Layer.mergeAll(...)`.

### Config values not picked up in tests

Wrap the effect with a `ConfigProvider` layer:

```typescript
const result = await Effect.runPromise(
  myEffect.pipe(
    Effect.provide(Layer.setConfigProvider(
      ConfigProvider.fromMap(new Map([["input-name", "value"]]))
    )),
  ),
)
```

## Related Documentation

* [Root CLAUDE.md](../CLAUDE.md) - Repository overview
* [src/CLAUDE.md](../src/CLAUDE.md) - Source code architecture
* [**fixtures**/CLAUDE.md](../__fixtures__/CLAUDE.md) - Integration testing
* [Vitest Documentation](https://vitest.dev/) - Testing framework
* [Effect Documentation](https://effect.website/docs) - Effect framework reference
