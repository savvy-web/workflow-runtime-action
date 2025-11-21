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

## Action Architecture

This is a **compiled GitHub Action** that bundles TypeScript to JavaScript using `@vercel/ncc`.

### Entry Points

The action has three lifecycle hooks:

* **`src/pre.ts`** → `dist/pre.js` - Logs action inputs (pre-execution)
* **`src/main.ts`** → `dist/main.js` - Main setup logic
* **`src/post.ts`** → `dist/post.js` - Cache saving (post-execution)

### Core Modules

Located in `src/utils/`:

* **`install-node.ts`** - Node.js version resolution and installation
  * Queries nodejs.org/dist/index.json for version specs
  * Downloads and extracts Node.js tarballs
  * Handles version files (.nvmrc, .node-version)
  * Supports lts/*, 20.x, exact versions

* **`install-bun.ts`** - Bun runtime installation
  * Downloads from GitHub releases (oven-sh/bun)
  * Extracts platform-specific zip archives
  * Cross-platform support (Linux, macOS, Windows)
  * Version detection from package.json `packageManager` field

* **`install-deno.ts`** - Deno runtime installation
  * Downloads from GitHub releases (denoland/deno)
  * Uses Rust target triples for platform detection
  * Cross-platform support (Linux, macOS, Windows)
  * Version detection from deno.json/deno.jsonc or package.json

* **`install-biome.ts`** - Biome CLI installation
  * Downloads binaries from GitHub releases
  * Detects version from biome.jsonc/$schema
  * Cross-platform binary selection

* **`cache-utils.ts`** - Dependency caching
  * Platform-specific cache paths
  * Lock file hashing for cache keys
  * Restore and save operations
  * Supports npm, pnpm, yarn, bun, deno

### Action Workflow

```typescript
// 1. Detect configuration (package.json, version files, configs)
const config = await detectConfiguration();

// 2. Install all detected runtimes (Node.js, Bun, Deno)
for (const runtime of config.runtimes) {
  if (runtime === "node") await installNode({ version, versionFile });
  if (runtime === "bun") await installBun({ version });
  if (runtime === "deno") await installDeno({ version });
}

// 3. Setup package manager (corepack for pnpm/yarn)
await setupPackageManager(packageManager);

// 4. Restore dependency cache
await restoreCache(packageManager);

// 5. Install dependencies (with lockfile detection)
await installDependencies(packageManager);

// 6. Install Biome (optional, from config)
await installBiome(version);

// Post-action: Save cache for next run
await saveCache();
```

## Usage Example

```yaml
steps:
  - uses: actions/checkout@v6

  - uses: savvy-web/workflow-runtime-action@v1
    # That's it! Auto-detects everything from your repo

  - run: npm test
```

### With Explicit Configuration (Node.js)

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    package-manager: pnpm      # Override detection
    node-version: "20.x"       # Override .nvmrc
    biome-version: "2.3.6"     # Override auto-detection
    install-deps: true         # Default: true
```

### Bun Runtime Example

```yaml
steps:
  - uses: actions/checkout@v6

  - uses: savvy-web/workflow-runtime-action@v1
    # Auto-detects Bun from package.json: "packageManager": "bun@1.1.42"

  - run: bun test

  # Or with explicit version:
  - uses: savvy-web/workflow-runtime-action@v1
    with:
      package-manager: bun
      bun-version: "1.1.42"
```

### Deno Runtime Example

```yaml
steps:
  - uses: actions/checkout@v6

  - uses: savvy-web/workflow-runtime-action@v1
    # Auto-detects Deno from deno.json or package.json
    with:
      deno-version: "1.46.3"

  - run: deno test

  # Or specify package manager explicitly:
  - uses: savvy-web/workflow-runtime-action@v1
    with:
      package-manager: deno
      deno-version: "1.46.3"
```

## Inputs

All inputs are **optional** with intelligent defaults:

* **`package-manager`** - Package manager to use (`npm` | `pnpm` | `yarn` | `bun` | `deno`)
  * Default: Auto-detect from package.json `packageManager` field, fallback to npm

* **`node-version`** - Node.js version spec (`20.x`, `lts/*`, `24.11.0`)
  * Default: Auto-detect from .nvmrc or .node-version, fallback to `lts/*`

* **`bun-version`** - Bun version to install (`1.1.42`)
  * Default: Auto-detect from package.json `packageManager` field

* **`deno-version`** - Deno version to install (`1.46.3`)
  * Default: Auto-detect from package.json `packageManager` field or deno.json/deno.jsonc

* **`biome-version`** - Biome version to install (`2.3.6`, `latest`)
  * Default: Auto-detect from biome.jsonc `$schema`, skip if no config

* **`install-deps`** - Whether to install dependencies (`true` | `false`)
  * Default: `true`

* **`turbo-token`** - Turbo remote cache token (optional)
* **`turbo-team`** - Turbo team slug (optional)

## Outputs

* **`runtime`** - Comma-separated list of installed runtimes (e.g., `"node"`, `"bun"`, `"node,deno"`)
* **`node-version`** - Installed Node.js version (e.g., `20.19.5`)
* **`node-version-file`** - Version file used (`.nvmrc`, `.node-version`, or empty)
* **`node-version-source`** - Version source (`nvmrc` | `node-version` | `input`)
* **`bun-version`** - Installed Bun version (e.g., `1.1.42` or empty if not installed)
* **`deno-version`** - Installed Deno version (e.g., `1.46.3` or empty if not installed)
* **`package-manager`** - Detected/specified package manager
* **`turbo-enabled`** - Whether Turbo was detected (`true` | `false`)
* **`turbo-config-file`** - Turbo config path (`turbo.json` or empty)
* **`biome-enabled`** - Whether Biome was installed and enabled (`true` | `false`)
* **`biome-version`** - Installed Biome version or empty
* **`biome-config-file`** - Biome config path or empty
* **`cache-hit`** - Cache status (`true` | `partial` | `false` | `n/a`)

## Development Workflow

### Building the Action

The action must be built before it can run:

```bash
# Build all entry points (pre/main/post)
pnpm build

# This runs: tsx lib/scripts/build.ts
# Which uses @vercel/ncc to bundle TypeScript → JavaScript
```

**Important:** The `dist/` directory is committed to git (required for GitHub Actions).

### Local Development

```bash
# Install dependencies
pnpm install

# Run type checking
pnpm typecheck

# Run linting
pnpm lint

# Fix linting issues
pnpm lint:fix

# Build the action
pnpm build
```

### Testing

The action uses **fixture-based testing** rather than unit tests:

```bash
# Test via GitHub Actions workflows
git push  # Triggers .github/workflows/test-fixtures.yml
```

The fixture workflow:

1. Creates temporary test projects with different configurations
2. Runs the action on each test project
3. Verifies the setup worked correctly

See [.github/workflows/test-fixtures.yml](.github/workflows/test-fixtures.yml) for test scenarios:

* NPM minimal project
* PNPM workspace
* Yarn modern project
* Biome auto-detection
* Turbo monorepo detection

### Making Changes

1. **Modify TypeScript source** in `src/` or `src/utils/`
2. **Run `pnpm build`** to compile to `dist/`
3. **Commit both source and dist** (dist must be committed!)
4. **Push and test** via fixture workflow

Example workflow:

```bash
# Edit src/main.ts
vim src/main.ts

# Build
pnpm build

# Commit
git add src/main.ts dist/main.js
git commit -m "feat: add new feature"

# Push and watch tests
git push
```

## Common Commands

### Linting and Formatting

```bash
# Run Biome checks (no auto-fix)
pnpm lint

# Run Biome with auto-fix
pnpm lint:fix

# Lint markdown files
pnpm lint:md

# Fix markdown files
pnpm lint:md:fix
```

### Type Checking

```bash
# Run type checking
pnpm typecheck

# This runs: turbo run typecheck:all --log-prefix=none
```

### Git Workflow

```bash
# Create a changeset for release
pnpm changeset

# Prepare changeset for release
pnpm ci:version
```

## Code Quality Standards

### Biome Configuration

The project enforces strict Biome rules (see `biome.jsonc`):

* **Indentation:** Tabs, width 2
* **Line width:** 120 characters
* **Import organization:** Lexicographic order
* **Import extensions:** Forced `.js` extensions
* **Import types:** Separated type imports
* **Node.js imports:** Must use `node:` protocol
* **Type definitions:** Prefer `type` over `interface`
* **Explicit types:** Required for exports
* **No import cycles:** Enforced
* **No unused variables:** Error level

### TypeScript Configuration

Base `tsconfig.json` settings:

* **Module system:** ESNext with bundler resolution
* **Target:** ES2022
* **Strict mode:** Enabled
* **JSON imports:** Enabled

### Pre-commit Hooks

The repository uses Husky with lint-staged:

1. **Staged files are automatically processed:**
   * TypeScript/JavaScript files checked with Biome
   * Markdown files linted
   * YAML files formatted and validated
   * TypeScript changes trigger full typecheck

2. **Hooks are skipped in CI**

## Project Structure

```text
.
├── src/                     # TypeScript source code
│   ├── pre.ts              # Pre-action hook
│   ├── main.ts             # Main action logic
│   ├── post.ts             # Post-action hook
│   └── utils/              # Utility modules
│       ├── install-node.ts    # Node.js installation
│       ├── install-biome.ts   # Biome installation
│       └── cache-utils.ts     # Dependency caching
├── dist/                    # Compiled JavaScript (committed!)
│   ├── pre.js
│   ├── main.js
│   └── post.js
├── .github/
│   └── workflows/
│       ├── test-fixtures.yml  # Fixture-based tests
│       ├── test-action.yml    # Original test workflow
│       ├── demo.yml           # Quick demo workflow
│       └── validate.yml       # PR validation
├── action.yml               # Action definition
├── package.json             # Dependencies and scripts
├── tsconfig.json            # TypeScript config
└── biome.jsonc              # Biome config
```

## Key Implementation Details

### Node.js Version Resolution

The action queries `https://nodejs.org/dist/index.json` to resolve version specs:

* `lts/*` → Latest LTS version (e.g., `20.19.5`)
* `20.x` → Latest 20.x version
* `20` → Latest 20.x version
* `24.11.0` → Exact version

### Node.js Installation

1. Downloads tarball from `https://nodejs.org/dist/v{version}/node-v{version}-{platform}-{arch}.tar.gz`
2. Extracts and finds the nested `node-v{version}-{platform}-{arch}/` directory
3. Caches using `@actions/tool-cache`
4. Adds `bin/` to PATH

### Package Manager Setup

* **npm** - Already included with Node.js
* **pnpm** - Installed via corepack (`corepack prepare pnpm@latest`)
* **yarn** - Installed via corepack (`corepack prepare yarn@stable`)

### Lockfile Intelligence

The action checks for lock files before using frozen/immutable flags:

```typescript
case "npm":
  command = existsSync("package-lock.json") ? ["ci"] : ["install"];
  break;

case "pnpm":
  command = existsSync("pnpm-lock.yaml")
    ? ["install", "--frozen-lockfile"]
    : ["install"];
  break;

case "yarn":
  command = existsSync("yarn.lock")
    ? ["install", "--immutable"]
    : ["install", "--no-immutable"];  // Yarn 4+ needs explicit flag
  break;
```

**Important:** Yarn 4+ automatically enables immutable mode in CI environments, so we must explicitly use `--no-immutable` when no lock file exists.

### Biome Installation

1. Detects version from `biome.jsonc` `$schema` field:

   ```json
   {
     "$schema": "https://biomejs.dev/schemas/2.3.6/schema.json"
   }
   ```

2. Downloads binary from GitHub releases:

   ```text
   https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%40{version}/{binary}
   ```

3. Binary names:
   * Linux x64: `biome-linux-x64`
   * macOS ARM64: `biome-darwin-arm64`
   * Windows x64: `biome-win32-x64.exe`

### Dependency Caching

Uses `@actions/cache` with platform-specific paths:

* **npm:** `~/.npm`, `**/node_modules`
* **pnpm:** `~/.local/share/pnpm/store`, `**/node_modules`
* **yarn:** `~/.yarn/cache`, `**/.yarn/cache`, `**/node_modules`

Cache keys include:

* Package manager name
* Platform and architecture
* SHA256 hash of lock files

## Testing Strategy

This action uses a **dual testing approach** combining unit tests and fixture-based integration tests:

1. **Unit Tests** - Fast, isolated tests of individual utility functions with Vitest
2. **Fixture Tests** - Real-world integration tests in GitHub Actions workflows

### Unit Testing with Vitest

The action includes comprehensive unit tests for all utility modules. Unit tests provide fast feedback during development and ensure code coverage thresholds are met.

#### Test Organization

```text
__tests__/
├── cache-utils.test.ts       # Dependency caching tests
├── install-biome.test.ts     # Biome installation tests
├── install-node.test.ts      # Node.js installation tests
├── main.test.ts              # Main action orchestration tests
└── utils/
    └── github-mocks.ts       # Shared test utilities
```

#### Running Tests

```bash
# Run all tests with coverage
pnpm test

# Run tests in watch mode
pnpm test --watch

# Run specific test file
pnpm test __tests__/install-node.test.ts

# View coverage report
open coverage/index.html
```

#### Coverage Requirements

```json
{
  "branches": 85,
  "functions": 90,
  "lines": 90,
  "statements": 90
}
```

**Current Coverage:**

* **88% branch coverage** ✅ (exceeds 85% threshold)
* **~95%+ function/line/statement coverage** ✅ (exceeds 90% threshold)

#### Mocking Strategy

All external dependencies are mocked using Vitest:

```typescript
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import { HttpClient } from "@actions/http-client";
import { readdirSync } from "node:fs";

// Mock all external modules
vi.mock("@actions/core");
vi.mock("@actions/tool-cache");
vi.mock("@actions/http-client");
vi.mock("node:fs");

beforeEach(() => {
  vi.clearAllMocks();

  // Setup default mocks
  vi.mocked(core.info).mockImplementation(() => {});
  vi.mocked(tc.find).mockReturnValue("");

  // Type-safe mocks using 'as unknown as Type'
  vi.mocked(readdirSync).mockReturnValue(
    ["node-v20.11.0-linux-x64"] as unknown as ReturnType<typeof readdirSync>
  );
});
```

**Never use `any` types** - Always use `as unknown as Type` for type-safe mocking.

#### Testing Version Resolution

The Node.js installer queries nodejs.org for version specs. Tests mock the HTTP client:

```typescript
const mockGet = vi.fn().mockResolvedValue({
  readBody: vi.fn().mockResolvedValue(
    JSON.stringify([
      { version: "v20.19.5", lts: "Iron" },
      { version: "v18.20.0", lts: "Hydrogen" },
    ])
  ),
});

vi.mocked(HttpClient).mockImplementation(
  () => ({ get: mockGet }) as unknown as InstanceType<typeof HttpClient>
);
```

#### Test Coverage Best Practices

1. **Test all code paths** - if/else branches, switch cases, error handling
2. **Test version resolution** - lts/*, version ranges (20.x), exact versions
3. **Test platform differences** - Linux (tar) vs Windows (zip) extraction
4. **Test error scenarios** - Network failures, extraction errors, missing files
5. **Test edge cases** - Empty inputs, malformed data, missing environment variables

### Fixture-Based Testing

In addition to unit tests, the action uses real-world fixture tests in GitHub Actions workflows:

```yaml
- name: Create test project
  run: |
    # Backup action files
    mkdir -p /tmp/action-backup
    cp -r dist action.yml /tmp/action-backup/

    # Create test project
    rm -rf ./*
    cat > package.json <<'EOF'
    {
      "name": "test-project",
      "packageManager": "pnpm@10.20.0"
    }
    EOF

    # Restore action files
    cp -r /tmp/action-backup/* .

- name: Run action
  uses: ./
```

This approach:

* Tests real-world scenarios
* Verifies cross-platform compatibility
* Catches integration issues early
* Tests actual GitHub Actions environment

### Updating Integration Tests

The integration tests use a backup/restore pattern to create isolated test environments. When adding or modifying integration tests, follow these guidelines:

#### Test Workflow Structure

Integration tests are organized in `.github/workflows/`:

* **`test-node.yml`** - Node.js runtime tests (npm, pnpm, yarn)
* **`test-bun.yml`** - Bun runtime tests (installation, caching, workspaces)
* **`test-deno.yml`** - Deno runtime tests (installation, caching, multi-runtime)
* **`test-features.yml`** - Feature tests (Biome, Turbo, caching, skip-deps)
* **`demo-bun.yml`** - Bun demo workflows (minimal, workspace, multi-PM)
* **`demo-deno.yml`** - Deno demo workflows (minimal, multi-runtime)

#### Standard Test Pattern

Each test scenario follows this pattern:

```yaml
- name: Create test project
  run: |
    # 1. Backup action files (only dist and action.yml)
    mkdir -p /tmp/action-backup
    cp -r dist action.yml /tmp/action-backup/

    # 2. Remove all files in working directory
    rm -rf ./*

    # 3. CRITICAL: Explicitly remove lockfiles to prevent conflicts
    rm -f pnpm-lock.yaml pnpm-workspace.yaml yarn.lock package-lock.json bun.lockb deno.lock .pnpmfile.cjs

    # 4. Create minimal test project
    npm init -y
    cat > package.json <<'EOF'
    {
      "name": "test-project",
      "packageManager": "pnpm@10.20.0"
    }
    EOF

    # 5. Restore action files
    cp -r /tmp/action-backup/* .

- name: Run action
  id: setup
  uses: ./
```

#### Why Explicit Lockfile Removal is Critical

**Problem:** The repository contains real lockfiles (`pnpm-lock.yaml`, `pnpm-workspace.yaml`) from development. When tests create minimal projects, these lockfiles don't match the simplified `package.json`, causing errors:

```text
ERR_PNPM_OUTDATED_LOCKFILE: Cannot install with "frozen-lockfile"
because pnpm-lock.yaml is not up to date with package.json
```

**Solution:** Always include the explicit lockfile removal step after `rm -rf ./*`:

```bash
rm -f pnpm-lock.yaml pnpm-workspace.yaml yarn.lock package-lock.json bun.lockb deno.lock .pnpmfile.cjs
```

This ensures:

* No leftover lockfiles from the repository
* Clean test environment for each scenario
* Package managers can create appropriate lockfiles for test projects
* No conflicts between real dependencies and test dependencies

#### Adding New Test Scenarios

When adding a new test scenario:

1. **Choose the appropriate workflow file** based on what you're testing
2. **Copy an existing test job** as a template
3. **Update the test project creation** to match your scenario
4. **Always include lockfile removal** after `rm -rf ./*`
5. **Verify the action outputs** match expected values
6. **Add verification steps** to ensure the scenario works

Example - Adding a new Bun workspace test:

```yaml
test-bun-workspace-custom:
  name: Bun - Custom workspace config
  runs-on: ubuntu-latest
  steps:
    - name: Checkout
      uses: actions/checkout@v6

    - name: Create Bun workspace
      run: |
        mkdir -p /tmp/action-backup
        cp -r dist action.yml /tmp/action-backup/
        rm -rf ./*
        rm -f pnpm-lock.yaml pnpm-workspace.yaml yarn.lock package-lock.json bun.lockb deno.lock .pnpmfile.cjs

        # Create workspace root
        cat > package.json <<'EOF'
        {
          "name": "bun-workspace-custom",
          "workspaces": ["packages/*"],
          "packageManager": "bun@1.1.42"
        }
        EOF

        # Create workspace package
        mkdir -p packages/custom-pkg
        cat > packages/custom-pkg/package.json <<'EOF'
        {
          "name": "@workspace/custom-pkg",
          "dependencies": {
            "lodash": "^4.17.21"
          }
        }
        EOF

        cp -r /tmp/action-backup/* .

    - name: Setup Bun
      id: setup
      uses: ./
      with:
        runtime: bun
        bun-version: "1.1.42"

    - name: Verify workspace setup
      run: |
        echo "## Custom Bun Workspace Test" >> $GITHUB_STEP_SUMMARY
        echo "- Runtime: \`${{ steps.setup.outputs.runtime }}\`" >> $GITHUB_STEP_SUMMARY
        echo "- Bun Version: \`${{ steps.setup.outputs.bun-version }}\`" >> $GITHUB_STEP_SUMMARY

        # Verify Bun is installed
        bun --version

        # Verify dependencies in workspace package
        test -d packages/custom-pkg/node_modules/lodash

        echo "✅ Custom workspace test passed" >> $GITHUB_STEP_SUMMARY
```

#### Common Test Patterns

**Testing cache effectiveness:**

```yaml
- name: First run (cache miss)
  id: setup1
  uses: ./

- name: Clear node_modules
  run: rm -rf node_modules

- name: Second run (cache hit expected)
  id: setup2
  uses: ./

- name: Verify cache hit
  run: |
    if [ "${{ steps.setup2.outputs.cache-hit }}" == "false" ]; then
      echo "❌ Expected cache hit"
      exit 1
    fi
```

**Testing multi-runtime scenarios:**

```yaml
- name: Create multi-runtime project
  run: |
    mkdir -p /tmp/action-backup
    cp -r dist action.yml /tmp/action-backup/
    rm -rf ./*
    rm -f pnpm-lock.yaml pnpm-workspace.yaml yarn.lock package-lock.json bun.lockb deno.lock .pnpmfile.cjs

    # Create Node.js package
    cat > package.json <<'EOF'
    {
      "packageManager": "pnpm@10.20.0"
    }
    EOF

    # Create Deno config
    cat > deno.json <<'EOF'
    {
      "tasks": {
        "dev": "deno run main.ts"
      }
    }
    EOF

    cp -r /tmp/action-backup/* .

- name: Setup (should detect multi-runtime)
  uses: ./
```

**Testing version detection:**

```yaml
- name: Create project with version file
  run: |
    mkdir -p /tmp/action-backup
    cp -r dist action.yml /tmp/action-backup/
    rm -rf ./*
    rm -f pnpm-lock.yaml pnpm-workspace.yaml yarn.lock package-lock.json bun.lockb deno.lock .pnpmfile.cjs

    echo "20.11.0" > .nvmrc
    npm init -y

    cp -r /tmp/action-backup/* .

- name: Setup (should use .nvmrc)
  id: setup
  uses: ./

- name: Verify Node.js version
  run: |
    if [ "${{ steps.setup.outputs.node-version }}" != "20.11.0" ]; then
      echo "❌ Expected Node.js 20.11.0"
      exit 1
    fi
```

#### Test Workflow Best Practices

1. **Always use the backup/restore pattern** - Don't modify files in place
2. **Always remove lockfiles explicitly** - Prevents conflicts with repository lockfiles
3. **Use heredocs for multi-line files** - Easier to read and maintain
4. **Verify action outputs** - Check that outputs match expected values
5. **Add meaningful summaries** - Use `$GITHUB_STEP_SUMMARY` for results
6. **Test cross-platform** - Use `runs-on: [ubuntu-latest, macos-latest, windows-latest]` for critical tests
7. **Keep tests focused** - One scenario per job for clarity
8. **Use clear job names** - Describe what's being tested

#### Debugging Test Failures

If integration tests fail:

1. **Check the GitHub Actions logs** for error messages
2. **Look for lockfile conflicts** - Most common issue
3. **Verify the backup/restore** - Ensure `dist/` and `action.yml` are restored
4. **Check platform-specific issues** - Windows paths, binary permissions
5. **Verify version availability** - Ensure requested versions exist upstream
6. **Test locally with act** - Use [nektos/act](https://github.com/nektos/act) to run workflows locally

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| `ERR_PNPM_OUTDATED_LOCKFILE` | Lockfile doesn't match package.json | Add explicit `rm -f pnpm-lock.yaml` |
| `ENOENT: no such file or directory` | Incorrect platform binary name | Check platform mapping in install-*.ts |
| `Unexpected HTTP response: 404` | Version doesn't exist | Verify version exists on GitHub releases |
| `deno install: required arguments missing` | Using Deno 1.x install incorrectly | Skip install for Deno (caches automatically) |

## Release Process

Uses Changesets for versioning:

1. **Create changeset:**

   ```bash
   pnpm changeset
   ```

2. **Changesets workflow automatically:**
   * Creates release PR
   * Updates `package.json` version
   * Updates `CHANGELOG.md`
   * Creates GitHub release with tags

3. **Users reference by tag:**

   ```yaml
   - uses: savvy-web/workflow-runtime-action@v1
   - uses: savvy-web/workflow-runtime-action@v1.2.3
   - uses: savvy-web/workflow-runtime-action@main
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

### Lock file errors in tests

**Issue:** Tests fail with "lockfile would have been created"

**Solution:** The action now handles this automatically with `--no-immutable` for Yarn

### Version resolution fails

**Issue:** "Could not find version matching X"

**Solution:**

1. Check if version exists at [https://nodejs.org/dist/](https://nodejs.org/dist/)
2. Verify version spec format (lts/*, 20.x, 24.11.0)

### PATH issues

**Issue:** Node.js installed but not in PATH

**Solution:** The action extracts the nested directory and adds it to PATH correctly

## Important Notes

1. **Always commit dist/** - The compiled JavaScript must be committed for GitHub Actions to work
2. **Build before pushing** - Run `pnpm build` after any source changes
3. **Test with fixtures** - Push to test real-world scenarios
4. **Changesets for versioning** - Use changesets for version management
5. **Biome is authoritative** - All formatting decisions defer to Biome
6. **Yarn 4+ CI behavior** - Yarn automatically enables immutable mode in CI
7. **Lock files are optional** - The action gracefully handles projects without lock files

## Contributing

When contributing:

1. Modify TypeScript source in `src/`
2. Run `pnpm build` to compile
3. Commit both source and dist
4. Create changeset with `pnpm changeset`
5. Push and verify fixture tests pass
6. Update documentation if needed
