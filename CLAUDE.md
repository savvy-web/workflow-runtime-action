# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This repository provides a **comprehensive JavaScript runtime setup GitHub Action** that supports Node.js, Bun, and Deno with a single, intelligent action that handles everything automatically.

**Primary purpose:** Simplify JavaScript/TypeScript CI/CD workflows by auto-detecting and configuring the complete runtime environment with smart defaults and zero configuration.

**Key Features:**

* **Multi-Runtime Support** - Node.js, Bun, and Deno runtimes with auto-detection
* **Complete Runtime Setup** - Downloads and installs runtimes directly from official sources
* **Smart Version Resolution** - Resolves `lts/*`, `20.x`, version files (.nvmrc, .node-version)
* **Package Manager Detection** - Auto-detects from package.json `packageManager` field (npm, pnpm, yarn, bun, deno)
* **Intelligent Caching** - Dependency caching with lock file detection for all package managers
* **Optional Biome** - Auto-detects and installs Biome from config files
* **Turbo Detection** - Detects Turborepo configuration
* **Lockfile Intelligence** - Gracefully handles projects with or without lock files

**Technical stack:**

* **Build tool:** @vercel/ncc for bundling TypeScript to standalone JavaScript
* **Action type:** Compiled Node.js action (uses `node24` runtime)
* **Package manager:** pnpm 10.20.0 (for development)
* **Node.js version:** 24.11.0 (specified in `.nvmrc`)
* **Linting:** Biome 2.3.6 with strict rules
* **Testing:** Vitest with comprehensive unit tests + fixture-based workflow tests
* **Type checking:** TypeScript with native preview build (`@typescript/native-preview`)

## Quick Start

### Using the Action

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: savvy-web/workflow-runtime-action@v1
    # That's it! Auto-detects everything from your repo
  - run: npm test
```

### Development Workflow

```bash
# Install dependencies
pnpm install

# Run type checking
pnpm typecheck

# Run tests
pnpm test

# Run linting
pnpm lint:fix

# Build the action (REQUIRED before commit!)
pnpm build

# Commit both source and dist
git add src/ dist/
git commit -m "feat: add new feature"
```

## Documentation Structure

This repository uses modular documentation organized by directory:

* **[src/CLAUDE.md](src/CLAUDE.md)** - Source code architecture, build process, and development guidelines
* **[**tests**/CLAUDE.md](__tests__/CLAUDE.md)** - Unit testing strategy, mocking, and coverage requirements
* **[**fixtures**/CLAUDE.md](__fixtures__/CLAUDE.md)** - Test fixtures for integration testing
* **[.github/workflows/CLAUDE.md](.github/workflows/CLAUDE.md)** - Workflow testing patterns and reusable actions

## Project Structure

```text
.
├── src/                     # TypeScript source code → See src/CLAUDE.md
│   ├── pre.ts              # Pre-action hook
│   ├── main.ts             # Main action logic
│   ├── post.ts             # Post-action hook
│   └── utils/              # Utility modules
├── dist/                    # Compiled JavaScript (committed!)
│   ├── pre.js
│   ├── main.js
│   └── post.js
├── __tests__/               # Unit tests → See __tests__/CLAUDE.md
├── __fixtures__/            # Integration test fixtures → See __fixtures__/CLAUDE.md
├── .github/
│   ├── actions/            # Reusable composite actions
│   │   ├── setup-fixture/  # Fixture setup action
│   │   └── verify-setup/   # Output verification action
│   └── workflows/          # GitHub Actions workflows → See .github/workflows/CLAUDE.md
├── action.yml               # Action definition
├── package.json             # Dependencies and scripts
├── tsconfig.json            # TypeScript config
└── biome.jsonc              # Biome config
```

## Action Inputs

All inputs are **optional** with intelligent defaults:

* **`package-manager`** - Package manager (`npm` | `pnpm` | `yarn` | `bun` | `deno`)
* **`node-version`** - Node.js version spec (`20.x`, `lts/*`, `24.11.0`)
* **`bun-version`** - Bun version to install (`1.1.42`)
* **`deno-version`** - Deno version to install (`1.46.3`)
* **`biome-version`** - Biome version to install (`2.3.6`, `latest`)
* **`install-deps`** - Whether to install dependencies (default: `true`)
* **`turbo-token`** - Turbo remote cache token (optional)
* **`turbo-team`** - Turbo team slug (optional)

## Action Outputs

* **`runtime`** - Installed runtimes (e.g., `"node"`, `"bun"`, `"node,deno"`)
* **`node-version`** - Installed Node.js version
* **`bun-version`** - Installed Bun version
* **`deno-version`** - Installed Deno version
* **`package-manager`** - Detected/specified package manager
* **`turbo-enabled`** - Whether Turbo was detected
* **`biome-enabled`** - Whether Biome was installed
* **`cache-hit`** - Cache status (`true` | `partial` | `false` | `n/a`)

## Code Quality Standards

### Biome Configuration

* **Indentation:** Tabs, width 2
* **Line width:** 120 characters
* **Import organization:** Lexicographic order
* **Import extensions:** Forced `.js` extensions (even for TypeScript files)
* **Import types:** Separated type imports
* **Node.js imports:** Must use `node:` protocol
* **Type definitions:** Prefer `type` over `interface`
* **No unused variables:** Error level

### TypeScript Configuration

* **Module system:** ESNext with bundler resolution
* **Target:** ES2022
* **Strict mode:** Enabled
* **Import extensions:** Required (`.js` for all imports)

## Common Commands

```bash
# Linting
pnpm lint              # Check with Biome
pnpm lint:fix          # Auto-fix Biome issues
pnpm lint:md           # Lint markdown
pnpm lint:md:fix       # Fix markdown

# Type Checking
pnpm typecheck         # Run TypeScript compiler

# Testing
pnpm test              # Run unit tests with coverage
pnpm test --watch      # Run tests in watch mode

# Building
pnpm build             # Build action with @vercel/ncc

# Release
pnpm changeset         # Create changeset for release
pnpm ci:version        # Prepare for release
```

## Release Process

Uses Changesets for versioning:

1. **Create changeset:** `pnpm changeset`
2. **Changesets workflow automatically:**
   * Creates release PR
   * Updates `package.json` version
   * Updates `CHANGELOG.md`
   * Creates GitHub release with tags
3. **Users reference by tag:**

   ```yaml
   - uses: savvy-web/workflow-runtime-action@v1
   - uses: savvy-web/workflow-runtime-action@v1.2.3
   ```

## Common Issues and Solutions

### dist/ not updated

**Issue:** Changes don't take effect in CI

**Solution:** Always run `pnpm build` and commit `dist/` files

```bash
pnpm build
git add dist/
git commit --amend --no-edit
```

### Import errors

**Issue:** "Module not found" or import errors

**Solution:** Always use `.js` extensions and `node:` protocol

```typescript
// ✅ Correct
import { installNode } from "./install-node.js";
import { readFile } from "node:fs/promises";

// ❌ Incorrect
import { installNode } from "./install-node";
import { readFile } from "fs/promises";
```

### Version resolution fails

**Issue:** "Could not find version matching X"

**Solution:** Verify version exists at [https://nodejs.org/dist/](https://nodejs.org/dist/)

## Important Notes

1. **Always commit dist/** - The compiled JavaScript must be committed for GitHub Actions to work
2. **Build before pushing** - Run `pnpm build` after any source changes
3. **Test with fixtures** - Push to test real-world scenarios (see [**fixtures**/CLAUDE.md](__fixtures__/CLAUDE.md))
4. **Changesets for versioning** - Use changesets for version management
5. **Biome is authoritative** - All formatting decisions defer to Biome

## Contributing

When contributing:

1. Modify TypeScript source in `src/` (see [src/CLAUDE.md](src/CLAUDE.md))
2. Add/update unit tests in `__tests__/` (see [**tests**/CLAUDE.md](__tests__/CLAUDE.md))
3. Add/update fixtures in `__fixtures__/` if needed (see [**fixtures**/CLAUDE.md](__fixtures__/CLAUDE.md))
4. Update workflows in `.github/workflows/` if needed (see [.github/workflows/CLAUDE.md](.github/workflows/CLAUDE.md))
5. Run `pnpm build` to compile
6. Commit both source and dist
7. Create changeset with `pnpm changeset`
8. Push and verify all tests pass in GitHub Actions
9. Update documentation if needed
