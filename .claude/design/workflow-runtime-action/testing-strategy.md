---
status: current
module: workflow-runtime-action
category: testing
created: 2026-03-21
updated: 2026-03-21
last-synced: 2026-03-21
completeness: 85
related:
  - ./architecture.md
  - ./effect-service-model.md
  - ./build-and-distribution.md
dependencies: []
---

# Testing Strategy

Dual testing approach: Effect test layers for unit tests and fixture-based workflow tests for
integration testing.

## Table of Contents

1. [Overview](#overview)
2. [Current State](#current-state)
3. [Rationale](#rationale)
4. [Implementation Details](#implementation-details)
5. [Testing Strategy](#test-infrastructure)
6. [Future Enhancements](#future-enhancements)
7. [Related Documentation](#related-documentation)

---

## Overview

The action uses a dual testing approach that provides both fast development feedback (unit tests)
and real-world validation (fixture tests):

1. **Unit Tests** -- Effect test layers with Vitest, testing each module in isolation with
   mock service implementations
2. **Fixture Tests** -- Real GitHub Actions workflow runs using `__fixtures__/` directories
   with actual runtime downloads, cache operations, and dependency installation

**Key Features:**

- No `vi.mock` needed -- services are swapped via `Layer.succeed`
- Config inputs injected via `ConfigProvider.fromMap`
- Full pipeline testing with composed test layers
- Matrix-based fixture testing across platforms (Ubuntu, macOS, Windows)
- Cache effectiveness testing (create/restore job pairs)

**When to reference this document:**

- When writing new unit tests for Effect-based code
- When adding fixture tests for new configurations
- When debugging test failures
- When understanding the mock layer composition pattern

---

## Current State

### Unit Test Organization

```text
__test__/
  cache.test.ts              # Cache key gen, lockfile detection, restore/save
  config.test.ts             # devEngines loading, Biome/Turbo detection
  descriptors.test.ts        # Download URL and install option helpers
  errors.test.ts             # TaggedError construction and assertions
  main.test.ts               # Full pipeline with all test layers
  post.test.ts               # Post-action cache save logic
  runtime-installer.test.ts  # RuntimeInstaller service and factory
  schemas.test.ts            # Schema validators (AbsoluteVersion, DevEngines)
```

### Coverage Requirements

- **Branches:** 85%
- **Functions/Lines/Statements:** 90%

### Fixture Organization

```text
__fixtures__/
  node-minimal/     # Node.js + npm (minimal config)
  node-pnpm/        # Node.js + pnpm
  node-yarn/        # Node.js + yarn
  node-bun/         # Node.js + bun as PM
  node-multi/       # Node.js + Deno (multi-runtime)
  bun-only/         # Bun runtime only
  deno-only/        # Deno runtime only
```

Each fixture contains a `package.json` with `devEngines.packageManager` and `devEngines.runtime`.

---

## Rationale

### Why No vi.mock

Since `@savvy-web/github-action-effects` 0.11.10 has zero `@actions/*` dependencies (it implements
the GitHub Actions runtime protocol natively), there are no problematic transitive imports that
break in the test environment. Services are injected via Effect's dependency injection, making
`vi.mock` unnecessary and test code more maintainable.

### Why Effect Test Layers Instead of /testing Subpath

The effects library does not expose `/testing` subpath imports. Instead, tests create mock
implementations inline via `Layer.succeed`. This approach:

- Makes test setup explicit and visible
- Allows per-test customization of service behavior
- Avoids coupling to library test utilities that might change

### Why Dual Testing

Unit tests catch logic errors quickly during development. Fixture tests catch integration issues
(actual runtime downloads, platform-specific behavior, cache protocol interactions) that unit
tests cannot. Both are essential for confidence in changes.

---

## Implementation Details

### Mock Layer Pattern

Each service has a factory function that creates a mock layer:

```typescript
const makeOutputsLayer = (store: Record<string, string>, exportedVars: Record<string, string>) =>
  Layer.succeed(ActionOutputs, {
    set: (name: string, value: string) => {
      store[name] = value
      return Effect.void
    },
    exportVariable: (name: string, value: string) => {
      exportedVars[name] = value
      return Effect.void
    },
    addPath: () => Effect.void,
    setFailed: () => Effect.void,
    setSecret: () => Effect.void,
    setJson: () => Effect.void,
    summary: () => Effect.void,
  } as unknown as ContextType.Tag.Service<typeof ActionOutputs>)
```

The `as unknown as ContextType.Tag.Service<typeof ServiceTag>` cast is intentional -- mock
implementations only need to satisfy the methods actually called by the code under test.

### Composed Test Layer

`main.test.ts` composes all mock layers for full pipeline testing:

```typescript
const buildBaseLayer = (opts) => {
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
```

### Config Input Testing

Since inputs use the Effect `Config` API, tests inject values via `ConfigProvider`:

```typescript
const configLayer = Layer.setConfigProvider(
  ConfigProvider.fromMap(new Map([
    ["install-deps", "false"],
    ["biome-version", "2.3.14"],
  ]))
)
```

### Fixture Test Infrastructure

The `.github/actions/test-fixture/` composite action:

1. **Setup:** Cleans workspace, copies fixture files to repo root
2. **Execute:** Runs `.github/actions/local` (the built action)
3. **Verify:** Python script compares actual outputs vs expected values
4. **Report:** Generates step summary with results

Fixture tests use matrix strategy with `fail-fast: false` to test all configurations even when
some fail.

### Cache Testing Pattern

Cache tests are split into two dependent jobs:

1. **Create cache** -- First run installs everything and saves cache
2. **Restore cache** -- Second run should restore from cache (validates `cache-hit` output)

---

## Test Infrastructure

### Running Tests

```bash
pnpm test                     # All tests with coverage
pnpm test --watch             # Watch mode
pnpm test __test__/cache.test.ts  # Single file
```

### Common Issues

| Issue | Cause | Solution |
| --- | --- | --- |
| Type errors in test layers | Mock doesn't match full service type | Use `as unknown as` cast |
| "Effect service not found" | Missing service in `Layer.mergeAll` | Add the missing mock layer |
| Config values not picked up | No `ConfigProvider` layer | Add `Layer.setConfigProvider` |
| Test passes locally, fails in CI | Platform-specific behavior | Check `process.platform` branching |

---

## Future Enhancements

### Short-term

- Add snapshot testing for cache key generation
- Add property-based testing for schema validation

### Medium-term

- Add performance benchmarks for build time
- Add visual regression testing for log output formatting

---

## Related Documentation

**Internal Design Docs:**

- [Architecture](./architecture.md) - System architecture
- [Effect Service Model](./effect-service-model.md) - Service layer patterns

**Context Files:**

- [**test**/CLAUDE.md](../../__test__/CLAUDE.md) - Detailed unit testing guide
- [**fixtures**/CLAUDE.md](../../__fixtures__/CLAUDE.md) - Fixture documentation
- [.github/workflows/CLAUDE.md](../../.github/workflows/CLAUDE.md) - Workflow testing guide

---

**Document Status:** Current -- reflects the implemented testing strategy.

**Next Steps:** Update when new test patterns are introduced or coverage thresholds change.
