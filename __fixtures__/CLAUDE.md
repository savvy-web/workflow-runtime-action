# **fixtures**/CLAUDE.md

Test fixtures for integration testing with GitHub Actions workflows.

**See also:** [Root CLAUDE.md](../CLAUDE.md) | [**tests**/CLAUDE.md](../__tests__/CLAUDE.md) for unit testing | [.github/workflows/CLAUDE.md](../.github/workflows/CLAUDE.md) for workflow testing patterns.

## Overview

This directory contains isolated test project setups for integration testing. Each fixture is a complete, self-contained project configuration used to test the runtime action with different package managers, runtimes, and features.

**For testing approach and workflow patterns, see [.github/workflows/CLAUDE.md](../.github/workflows/CLAUDE.md).**

## Available Fixtures

### Node.js Fixtures

* **node-minimal** - Minimal Node.js project with npm (devEngines configuration)
* **node-pnpm** - Node.js project with pnpm (devEngines: `packageManager.name: "pnpm"`)
* **node-yarn** - Node.js project with Yarn (devEngines: `packageManager.name: "yarn"`)

### Bun Fixtures

* **bun-minimal** - Basic Bun project with simple TypeScript and test files
* **bun-workspace** - Bun monorepo with workspace packages
* **bun-deps** - Bun project with external dependency (lodash)
* **bun-lockfile** - Bun project with committed `bun.lockb` lockfile

### Deno Fixtures

* **deno-minimal** - Basic Deno project with `deno.json` configuration
* **deno-deps** - Deno project with npm: imports (uses npm dependencies)
* **deno-lockfile** - Deno project with committed `deno.lock` lockfile

### Feature Fixtures

* **biome-auto** - Project with `biome.jsonc` for auto-detection testing
* **turbo-monorepo** - Turborepo configuration for monorepo detection
* **cache-test** - Project with dependencies (lodash) for cache effectiveness testing
* **multi-runtime** - Multi-runtime project with both Node.js (pnpm) and Deno

## Fixture Structure

Each fixture contains the minimal files needed to test a specific configuration:

### Example: node-pnpm

```text
node-pnpm/
└── package.json
```

```json
{
  "name": "test-node-pnpm",
  "packageManager": "pnpm@10.20.0"
}
```

### Example: bun-minimal

```text
bun-minimal/
├── package.json
├── index.ts
└── test.js
```

### Example: deno-minimal

```text
deno-minimal/
├── deno.json
└── main.ts
```

## How Fixtures Are Used

Fixtures are used by the [setup-fixture](../.github/actions/setup-fixture/action.yml) composite action:

1. **Remove repository config** - Deletes conflicting files (package.json, lockfiles, etc.)
2. **Copy fixture files** - Copies all files from the fixture directory to the repository root
3. **Run action** - The runtime action runs with the fixture configuration
4. **Verify outputs** - The [verify-setup](../.github/actions/verify-setup/action.yml) action validates results

**See [.github/workflows/CLAUDE.md](../.github/workflows/CLAUDE.md) for detailed testing patterns.**

## Creating New Fixtures

### 1. Create Fixture Directory

```bash
mkdir -p __fixtures__/my-new-fixture
```

### 2. Add Configuration Files

Add the minimal files needed for your test:

```bash
# For Node.js with pnpm
cat > __fixtures__/my-new-fixture/package.json <<'EOF'
{
  "name": "test-my-fixture",
  "packageManager": "pnpm@10.20.0",
  "dependencies": {
    "lodash": "^4.17.21"
  }
}
EOF
```

### 3. Add to Test Workflow

Reference the fixture in [../.github/workflows/test.yml](../.github/workflows/test.yml):

```yaml
matrix:
  include:
    - name: My Test
      fixture: my-new-fixture
      expected-runtime: node
      expected-package-manager: pnpm
      test-command: "pnpm --version"
      title: "🧪 My Test Results"
```

### 4. Commit Fixture

```bash
git add __fixtures__/my-new-fixture/
git commit -m "feat: add my-new-fixture test scenario"
```

## Fixture Best Practices

1. **Keep it minimal** - Only include files necessary for the test
2. **Use realistic configurations** - Match real-world project setups
3. **Document purpose** - Add fixture description to this file
4. **Test locally** - Manually test fixture configuration before committing
5. **Version control** - Always commit fixture files
6. **No secrets** - Never include sensitive data
7. **Platform-agnostic** - Ensure fixtures work on Linux, macOS, and Windows

## Common Fixture Patterns

### Package Manager Auto-Detection

Use `packageManager` field in package.json:

```json
{
  "name": "test-project",
  "packageManager": "pnpm@10.20.0"
}
```

### Lockfile Testing

Commit a lockfile to test lockfile handling:

```bash
# Create test project
cd /tmp/test-project
pnpm init
pnpm add lodash

# Copy lockfile to fixture
cp pnpm-lock.yaml __fixtures__/my-fixture/
```

### Multi-Runtime Testing

Include both Node.js and Deno configurations:

```bash
# package.json
{
  "name": "test-multi-runtime",
  "packageManager": "pnpm@10.20.0"
}

# deno.json
{
  "version": "1.46.3"
}
```

### Feature Detection Testing

Include feature configuration files:

```bash
# biome.jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.3.6/schema.json"
}

# turbo.json
{
  "$schema": "https://turbo.build/schema.json"
}
```

## Fixture Naming Conventions

* **runtime-packageManager** - `node-pnpm`, `bun-minimal`, `deno-minimal`
* **runtime-feature** - `bun-lockfile`, `deno-lockfile`
* **feature-purpose** - `biome-auto`, `turbo-monorepo`, `cache-test`
* **multi-runtime** - For fixtures with multiple runtimes

## Testing Fixtures Locally

You can test a fixture locally by copying it to a temporary directory:

```bash
# Copy fixture to temp directory
mkdir -p /tmp/test-fixture
cp -r __fixtures__/node-pnpm/* /tmp/test-fixture/
cd /tmp/test-fixture

# Test manually
node --version
pnpm --version
pnpm install
```

## Fixture Validation

Before committing a fixture, verify:

* [ ] Files are minimal (only what's needed for the test)
* [ ] Configuration is valid (package.json parses correctly)
* [ ] No sensitive data included
* [ ] Works on all platforms (if using shell scripts)
* [ ] Documented in this file
* [ ] Referenced in test workflow

## Related Documentation

* [Root CLAUDE.md](../CLAUDE.md) - Repository overview
* [.github/workflows/CLAUDE.md](../.github/workflows/CLAUDE.md) - Workflow testing patterns ⭐
* [**tests**/CLAUDE.md](../__tests__/CLAUDE.md) - Unit testing
* [src/CLAUDE.md](../src/CLAUDE.md) - Source code architecture
