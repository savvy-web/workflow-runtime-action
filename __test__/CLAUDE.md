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

### vi.mock for @savvy-web/github-action-effects

The real package imports `@actions/cache`, which pulls in `minimatch` with a broken default export in the test environment. Every test file that imports from `@savvy-web/github-action-effects` must stub it at the top:

```typescript
vi.mock("@savvy-web/github-action-effects", () => {
  const { Context: C } = require("effect");
  return {
    Action: { run: () => Promise.resolve() },
    ActionInputs: C.GenericTag("ActionInputs"),
    ActionOutputs: C.GenericTag("ActionOutputs"),
    ActionLogger: C.GenericTag("ActionLogger"),
    ActionCache: C.GenericTag("ActionCache"),
    ActionState: C.GenericTag("ActionState"),
    ActionEnvironment: C.GenericTag("ActionEnvironment"),
    CommandRunner: C.GenericTag("CommandRunner"),
    ToolInstaller: C.GenericTag("ToolInstaller"),
    // ... Live layers as GenericTags
  };
});

// Import AFTER the mock is registered
const { ActionInputs, ActionOutputs, /* ... */ } = await import("@savvy-web/github-action-effects");
```

The `Context.GenericTag` strings must match those used by the real package, because Effect matches services by their string identifier.

### Effect Test Layers (instead of manual mocking)

Services are injected via `Layer.succeed` rather than `vi.mocked`. This mirrors the real production layer composition and tests the actual Effect plumbing.

**Pattern:**

```typescript
const makeInputsLayer = (inputs: Record<string, string>) =>
  Layer.succeed(ActionInputs, makeInputsImpl(inputs) as unknown as Service<ActionInputs>);

const makeFileSystemLayer = (files: Record<string, string>) =>
  Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({ readFileString: ..., access: ... }));

const layer = Layer.mergeAll(
  makeInputsLayer({ "install-deps": "false" }),
  makeOutputsLayer(outputStore),
  makeLoggerLayer(),
  makeCacheLayer("none"),
  makeStateLayer(),
  makeEnvironmentLayer({ GITHUB_REF: "refs/heads/main" }),
  makeCommandRunnerLayer(cmdResponses),
  makeToolInstallerLayer(),
  makeFileSystemLayer({ "package.json": VALID_PACKAGE_JSON }),
);

await Effect.runPromise(Effect.provide(pipeline, layer));
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
* Cache hit mapping (`exact` → `"true"`, `partial` → `"partial"`, `none` → `"false"`)
* Multi-runtime config installs all runtimes
* Turbo detection sets `TURBO_TOKEN` and `TURBO_TEAM` env vars

### runtime-installer.test.ts

Tests `makeRuntimeInstaller` in isolation with `ToolInstallerTest` and `CommandRunnerTest` helper layers. Covers:

* Returns correct `InstalledRuntime` on success
* Wraps `ToolInstallerError` as `RuntimeInstallError`
* Wraps `CommandRunnerError` as `RuntimeInstallError`
* `postInstall` runs when defined
* `installerLayerFor` returns correct layers and throws for unknown names

### cache.test.ts

Tests cache key generation, lockfile detection, path defaults, and the restore/save roundtrip.

### config.test.ts

Tests `loadPackageJson`, `parseDevEngines`, `detectBiome`, and `detectTurbo` against mock `FileSystem` layers.

### schemas.test.ts

Tests `AbsoluteVersion` rejects range operators and accepts well-formed semver strings. Tests `DevEngines` schema decoding.

## Layer Composition Pattern

```typescript
const buildBaseLayer = (opts: { files?, inputs?, cacheHit?, ... }) => {
  const outputStore: Record<string, string> = {};
  const layer = Layer.mergeAll(
    makeInputsLayer(opts.inputs ?? {}),
    makeOutputsLayer(outputStore),
    makeLoggerLayer(),
    makeCacheLayer(opts.cacheHit ?? "none"),
    makeStateLayer(),
    makeEnvironmentLayer(opts.env ?? { GITHUB_REF: "refs/heads/main" }),
    makeCommandRunnerLayer(opts.cmdResponses),
    makeToolInstallerLayer(),
    makeFileSystemLayer(opts.files ?? { "package.json": VALID_PACKAGE_JSON }),
  );
  return { layer, outputStore };
};

const runPipeline = (layer: Layer.Layer<never>) =>
  Effect.runPromise(Effect.provide(pipeline, layer));
```

## Coverage Requirements

Configured in `vitest.config.ts`:

* **Branches:** 85%
* **Functions/Lines/Statements:** 90%

## Common Issues

### "Module not mocked"

Add the `vi.mock(...)` call before any imports that transitively import `@savvy-web/github-action-effects`.

### Type errors in test layers

Use `as unknown as Service<Tag>` at service boundaries — mock implementations don't need to satisfy the full service type.

### "Effect service not found"

Ensure all services required by the Effect under test are present in `Layer.mergeAll(...)`.

## Related Documentation

* [Root CLAUDE.md](../CLAUDE.md) - Repository overview
* [src/CLAUDE.md](../src/CLAUDE.md) - Source code architecture
* [**fixtures**/CLAUDE.md](../__fixtures__/CLAUDE.md) - Integration testing
* [Vitest Documentation](https://vitest.dev/) - Testing framework
* [Effect Documentation](https://effect.website/docs) - Effect framework reference
