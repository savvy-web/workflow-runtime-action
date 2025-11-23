# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This repository provides a **comprehensive JavaScript runtime setup GitHub Action** that supports Node.js, Bun, and Deno with a single, intelligent action that handles everything automatically.

**Primary purpose:** Simplify JavaScript/TypeScript CI/CD workflows with a standardized, package.json-driven runtime configuration that ensures reproducible builds.

**Key Features:**

* **Multi-Runtime Support** - Node.js, Bun, and Deno runtimes configured via `devEngines.runtime`
* **Complete Runtime Setup** - Downloads and installs runtimes directly from official sources
* **Package.json-Driven Configuration** - All runtime and package manager config from package.json
* **Absolute Version Enforcement** - Requires exact versions (no semver ranges) for reproducible builds
* **Package Manager Versioning** - Installs exact package manager versions via corepack
* **Intelligent Caching** - Dependency caching with lock file detection for all package managers
* **Optional Biome** - Auto-detects and installs Biome from config files
* **Turbo Detection** - Detects Turborepo configuration
* **Lockfile Intelligence** - Gracefully handles projects with or without lock files

## Requirements

Repositories using this action **MUST** have a `package.json` in their root directory with a `devEngines` field containing:

1. **`devEngines.packageManager` field** - Specifies the package manager and exact version
   * Must be an object with `name`, `version`, and `onFail` properties
   * Supported package managers: `npm`, `pnpm`, `yarn`, `bun`
   * Version MUST be absolute (e.g., "10.20.0"), NOT semver ranges
   * `onFail` MUST be set to `"error"` for strict validation
   * This follows the [Corepack devEngines format](https://github.com/nodejs/corepack)

2. **`devEngines.runtime` field** - Specifies runtime(s) and exact versions
   * Can be a single runtime object or an array of runtimes
   * Each runtime MUST have `name` (node|bun|deno), `version` (absolute version), and `onFail` properties
   * Versions MUST be absolute (e.g., "24.11.0"), NOT semver ranges (e.g., "^24.0.0")
   * `onFail` MUST be set to `"error"` for strict validation
   * See [pnpm devEngines.runtime](https://pnpm.io/package_json#devenginesruntime) for format details

**Example package.json:**

```json
{
  "name": "my-project",
  "devEngines": {
    "packageManager": {
      "name": "pnpm",
      "version": "10.20.0",
      "onFail": "error"
    },
    "runtime": {
      "name": "node",
      "version": "24.11.0",
      "onFail": "error"
    }
  }
}
```

**Multi-runtime example:**

```json
{
  "name": "my-project",
  "devEngines": {
    "packageManager": {
      "name": "bun",
      "version": "1.3.3",
      "onFail": "error"
    },
    "runtime": [
      {
        "name": "node",
        "version": "24.11.0",
        "onFail": "error"
      },
      {
        "name": "bun",
        "version": "1.3.3",
        "onFail": "error"
      }
    ]
  }
}
```

**Technical stack:**

* **Build tool:** @vercel/ncc for bundling TypeScript to standalone JavaScript
* **Action type:** Compiled Node.js action (uses `node24` runtime)
* **Package manager:** pnpm 10.20.0 (specified in package.json)
* **Node.js version:** 24.11.0 (specified in package.json devEngines.runtime)
* **Linting:** Biome 2.3.6 with strict rules
* **Testing:** Vitest with comprehensive unit tests + fixture-based workflow tests
* **Type checking:** TypeScript with native preview build (`@typescript/native-preview`)

## Quick Start

### Using the Action

Ensure your project has a valid `package.json` with `devEngines.packageManager` and `devEngines.runtime` fields:

```json
{
  "name": "my-project",
  "devEngines": {
    "packageManager": {
      "name": "pnpm",
      "version": "10.20.0",
      "onFail": "error"
    },
    "runtime": {
      "name": "node",
      "version": "24.11.0",
      "onFail": "error"
    }
  }
}
```

Then use the action in your workflow:

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: savvy-web/workflow-runtime-action@v1
    # That's it! Reads everything from package.json
  - run: pnpm test
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

All inputs are **optional**:

* **`biome-version`** - Biome version to install (e.g., `2.3.6`, `latest`). If not provided, auto-detected from biome.jsonc/biome.json. Leave empty to skip Biome installation.
* **`install-deps`** - Whether to install dependencies (default: `true`)
* **`turbo-token`** - Turbo remote cache token (optional, for Vercel Remote Cache)
* **`turbo-team`** - Turbo team slug (optional, for Vercel Remote Cache)

**Note:** Runtime versions and package manager configuration are read from `package.json` and cannot be overridden via inputs.

## Action Outputs

* **`runtime`** - Installed runtimes (e.g., `"node"`, `"bun"`, `"node,deno"`)
* **`node-version`** - Installed Node.js version (e.g., `"24.11.0"` or empty if not installed)
* **`bun-version`** - Installed Bun version (e.g., `"1.3.3"` or empty if not installed)
* **`deno-version`** - Installed Deno version (e.g., `"1.46.3"` or empty if not installed)
* **`package-manager`** - Package manager from package.json (e.g., `"pnpm"`, `"yarn"`, `"npm"`, `"bun"`)
* **`package-manager-version`** - Package manager version from package.json (e.g., `"10.20.0"`)
* **`turbo-enabled`** - Whether Turbo was detected (`"true"` | `"false"`)
* **`biome-enabled`** - Whether Biome was installed (`"true"` | `"false"`)
* **`cache-hit`** - Cache status (`"true"` | `"partial"` | `"false"` | `"n/a"`)

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

### Missing or invalid package.json

**Issue:** "package.json not found" or "package.json must have a devEngines.packageManager property"

**Solution:** Ensure your project has a `package.json` with both `devEngines.packageManager` and `devEngines.runtime` fields:

```json
{
  "devEngines": {
    "packageManager": {
      "name": "pnpm",
      "version": "10.20.0",
      "onFail": "error"
    },
    "runtime": {
      "name": "node",
      "version": "24.11.0",
      "onFail": "error"
    }
  }
}
```

### Semver range not allowed

**Issue:** "Must be an absolute version (e.g., '24.11.0'), not a semver range"

**Solution:** Use exact versions in `devEngines`, not semver ranges:

```json
// ✅ Correct
"devEngines": {
  "packageManager": {
    "name": "pnpm",
    "version": "10.20.0",
    "onFail": "error"
  },
  "runtime": {
    "name": "node",
    "version": "24.11.0",
    "onFail": "error"
  }
}

// ❌ Incorrect
"devEngines": {
  "packageManager": {
    "name": "pnpm",
    "version": "^10.0.0",  // Semver ranges not allowed
    "onFail": "error"
  },
  "runtime": {
    "name": "node",
    "version": "^24.0.0",  // Semver ranges not allowed
    "onFail": "error"
  }
}
```

## Important Notes

1. **Always commit dist/** - The compiled JavaScript must be committed for GitHub Actions to work
2. **Build before pushing** - Run `pnpm build` after any source changes
3. **Test with fixtures** - Push to test real-world scenarios (see [**fixtures**/CLAUDE.md](__fixtures__/CLAUDE.md))
4. **Changesets for versioning** - Use changesets for version management
5. **Biome is authoritative** - All formatting decisions defer to Biome
6. **Absolute versions only** - `devEngines.packageManager` and `devEngines.runtime` must use exact versions, not semver ranges
7. **package.json is required** - All projects using this action MUST have a valid package.json with `devEngines.packageManager` and `devEngines.runtime` fields
8. **Corepack integration** - Package managers are installed via `corepack prepare --activate` which reads from `devEngines.packageManager`

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
