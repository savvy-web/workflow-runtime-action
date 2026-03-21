---
status: current
module: workflow-runtime-action
category: integration
created: 2026-03-21
updated: 2026-03-21
last-synced: 2026-03-21
completeness: 85
related:
  - ./architecture.md
  - ./testing-strategy.md
dependencies: []
---

# Build and Distribution

Build pipeline, bundle configuration, distribution strategy, and the local testing copy.

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

The action is built using `@savvy-web/github-action-builder` (rsbuild-based) and produces compiled
JavaScript bundles that are committed to git. GitHub Actions requires the compiled output to be
present in the repository because it runs actions directly from the checked-out source.

**Key Features:**

- Two entry points compiled to ES module bundles (`main.js`, `post.js`)
- Minification enabled for production bundles
- Automatic local testing copy at `.github/actions/local/`
- ES module marker (`package.json` with `"type": "module"`)
- Source maps for debugging

**When to reference this document:**

- When modifying the build configuration
- When debugging bundle issues in CI
- When understanding why `dist/` is committed to git
- When adding new entry points

---

## Current State

### Build Configuration (`action.config.ts`)

```typescript
import { defineConfig } from "@savvy-web/github-action-builder"

export default defineConfig({
  entries: {
    main: "src/main.ts",
    post: "src/post.ts",
  },
  build: {
    minify: true,
  },
  persistLocal: {
    enabled: true,
    path: ".github/actions/local",
  },
})
```

### Build Output

```text
dist/                            # Production build (committed to git)
  main.js                        # Bundled main action
  post.js                        # Bundled post action
  package.json                   # { "type": "module" }

.github/actions/local/           # Local testing copy (committed to git)
  dist/
    main.js
    post.js
    package.json
```

### Build Commands

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build via Turbo (runs `build:prod`) |
| `pnpm build:prod` | Direct `github-action-builder build` |
| `pnpm ci:build` | CI build with full output logs |

### Action Runtime Configuration (`action.yml`)

```yaml
runs:
  using: node24
  main: dist/main.js
  post: dist/post.js
```

---

## Rationale

### Why Commit dist/ to Git

GitHub Actions loads the action directly from the repository at the specified ref. There is no
build step in the Actions runtime. The compiled JavaScript must be present in the repository for
the action to work. This is a fundamental requirement of all JavaScript GitHub Actions.

### Why rsbuild via github-action-builder

The `@savvy-web/github-action-builder` package wraps rsbuild with sensible defaults for GitHub
Actions:

- Automatic tree shaking and dead code elimination
- ES module output compatible with Node.js 24
- Entry point configuration via `defineConfig`
- Local copy generation for testing workflows
- Clean builds (removes output directories before building)

### Why a Local Testing Copy

The `.github/actions/local/` copy exists to separate test artifacts from the production build.
The `test-fixture` composite action references `.github/actions/local` instead of the repo root,
allowing tests to run against the built action without interfering with the production `dist/`.

### Why Minification Is Enabled

Minification reduces bundle size, which improves action load time in CI. The bundles are compiled
output and not intended for human reading. Source maps are available for debugging when needed.

---

## Implementation Details

### Build Process

1. `github-action-builder build` reads `action.config.ts`
2. Cleans `dist/` and `.github/actions/local/dist/`
3. Compiles TypeScript via rsbuild with two entry points
4. Writes bundles to `dist/`
5. Creates `dist/package.json` with `{ "type": "module" }`
6. Copies bundles to `.github/actions/local/dist/`
7. Creates `.github/actions/local/dist/package.json`

### Dependencies

**Production dependencies** (bundled into output):

- `@savvy-web/github-action-effects` - GitHub Actions runtime protocol
- `effect`, `@effect/platform`, `@effect/platform-node` - Effect framework
- Related Effect packages (`@effect/cluster`, `@effect/rpc`, `@effect/sql` - transitive)

**Dev dependencies** (not in bundle):

- `@savvy-web/github-action-builder` - Build tool
- `@savvy-web/vitest` - Test runner configuration
- `@savvy-web/changesets` - Release management
- Biome, TypeScript, lint-staged, husky - Development tooling

### TypeScript Configuration

- `module: "ESNext"`, `moduleResolution: "bundler"`, `target: "ES2022"`
- `strict: true`, `noEmit: true` (type checking only, no emit)
- Uses `@typescript/native-preview` (tsgo) for fast type checking
- All imports require `.js` extensions (enforced by Biome)
- Node.js imports require `node:` protocol (enforced by Biome)

### Release Process

Uses Changesets for versioning:

1. Create changeset: `pnpm changeset`
2. Changesets workflow creates release PR
3. PR updates `package.json` version and `CHANGELOG.md`
4. Merge creates GitHub release with tags
5. Users reference by tag: `savvy-web/workflow-runtime-action@v1`

---

## Testing Strategy

### Build Verification

The CI workflow (`pnpm ci:build`) builds the action and verifies:

- Build succeeds without errors
- `dist/main.js` and `dist/post.js` exist
- `.github/actions/local/dist/` is populated
- `package.json` module markers are present

### Fixture Tests Use Local Copy

All fixture tests reference `.github/actions/local` via the `test-fixture` composite action,
ensuring tests run against the same build output that will be distributed.

---

## Future Enhancements

### Short-term

- Add bundle size reporting to CI
- Add source map validation

### Medium-term

- Explore pre-bundled dependency caching for faster CI builds
- Add bundle analysis (tree map of included dependencies)

---

## Related Documentation

**Internal Design Docs:**

- [Architecture](./architecture.md) - Overall system design
- [Testing Strategy](./testing-strategy.md) - Test infrastructure

**Source Files:**

- `action.config.ts` - Build configuration
- `action.yml` - Action definition
- `package.json` - Dependencies and scripts

---

**Document Status:** Current -- reflects the implemented build pipeline.

**Next Steps:** Update when build configuration changes or new entry points are added.
