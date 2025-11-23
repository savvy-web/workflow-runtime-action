# Node.js Runtime Setup Action

A comprehensive GitHub Action for setting up Node.js development environments with automatic package manager detection, dependency caching, and Turbo build cache configuration.

## Features

* **Multi-runtime support** - Node.js, Bun, and Deno with single action
* **Exact version installation** from `devEngines` specification in `package.json`
* **Strict validation** with `onFail: "error"` requirement for all runtimes and package managers
* **Dependency caching** optimized for each package manager
* **Turbo remote cache support** with optional Vercel integration
* **Optional dependency installation** - skip if you want to control installation timing
* **Rich output information** including installed versions and cache status
* **Smart defaults** that work out of the box

## Quick Start

### Basic Usage

```yaml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: savvy-web/workflow-runtime-action@v1
      - run: pnpm test
      - run: pnpm build
```

### Explicit Runtime Setup (No package.json Required)

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    node-version: '24.10.0'
    package-manager: pnpm
    package-manager-version: '10.20.0'
```

### With Turbo Remote Cache

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    turbo-token: ${{ secrets.TURBO_TOKEN }}
    turbo-team: ${{ vars.TURBO_TEAM }}
```

### Skip Dependency Installation

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    install-deps: false

# Install dependencies later with custom options
- run: pnpm install --frozen-lockfile
```

## Inputs

All inputs are **optional**. The action can work in two modes:

1. **Explicit mode**: Provide runtime and package manager inputs directly
2. **Auto-detect mode**: Read configuration from `package.json` `devEngines`

If at least one runtime version AND package manager are specified via inputs, the action skips `package.json` parsing and uses the provided values.

| Input | Description | Default |
| ------- | ------------- | --------- |
| `node-version` | Node.js version (e.g., `24.10.0`) | Auto-detect from `devEngines.runtime` |
| `bun-version` | Bun version (e.g., `1.1.42`) | Auto-detect from `devEngines.runtime` |
| `deno-version` | Deno version (e.g., `2.5.6`) | Auto-detect from `devEngines.runtime` |
| `package-manager` | Package manager name (`npm` \| `pnpm` \| `yarn` \| `bun` \| `deno`) | Auto-detect from `devEngines.packageManager` |
| `package-manager-version` | Package manager version (e.g., `10.20.0`) | Auto-detect from `devEngines.packageManager` |
| `biome-version` | Biome version (e.g., `2.3.6`) | Auto-detect from config or skip |
| `turbo-token` | Turbo remote cache token | `""` |
| `turbo-team` | Turbo team slug | `""` |
| `install-deps` | Install dependencies (`true` \| `false`) | `"true"` |

## Outputs

| Output | Description |
| -------- | ------------- |
| `node-version` | Installed Node.js version (e.g., `24.10.0` or empty) |
| `node-enabled` | Whether Node.js was installed (`true` \| `false`) |
| `bun-version` | Installed Bun version (e.g., `1.1.42` or empty) |
| `bun-enabled` | Whether Bun was installed (`true` \| `false`) |
| `deno-version` | Installed Deno version (e.g., `2.5.6` or empty) |
| `deno-enabled` | Whether Deno was installed (`true` \| `false`) |
| `package-manager` | Package manager name (`npm` \| `pnpm` \| `yarn` \| `bun` \| `deno`) |
| `package-manager-version` | Package manager version (e.g., `10.20.0`) |
| `biome-version` | Installed Biome version (e.g., `2.3.6` or empty) |
| `biome-enabled` | Whether Biome was installed (`true` \| `false`) |
| `turbo-enabled` | Whether Turbo was detected (`true` \| `false`) |
| `cache-hit` | Cache status (`true` \| `partial` \| `false` \| `n/a`) |

## How It Works

### 1. Runtime Configuration

The action reads runtime configuration from `package.json` `devEngines` field:

```json
{
  "devEngines": {
    "runtime": [
      {
        "name": "node",
        "version": "24.10.0",
        "onFail": "error"
      }
    ],
    "packageManager": {
      "name": "pnpm",
      "version": "10.20.0",
      "onFail": "error"
    }
  }
}
```

**Requirements:**

* All runtime and package manager configurations **must** set `onFail: "error"` for strict validation
* Versions must be exact (no semver ranges like `^`, `~`, or `.x`)
* Supports multiple runtimes simultaneously (Node.js + Bun, Node.js + Deno, etc.)

### 2. Package Manager Setup

The action automatically:

* Installs the specified package manager version using corepack (for pnpm/yarn)
* Configures the package manager for the project
* Detects and respects lockfiles for frozen installations

### 3. Dependency Caching

Each package manager gets optimized caching based on lockfiles and platform-specific cache directories.

### 4. Turbo Configuration

If `turbo.json` is detected:

* Automatically recognizes Turbo-enabled projects
* Configures remote caching if `turbo-token` and `turbo-team` are provided
* Sets up telemetry opt-out for CI environments

### 5. Dependency Installation

By default, the action runs the appropriate install command for your package manager with lockfile validation:

* **pnpm**: `pnpm install --frozen-lockfile` (if lockfile exists) or `pnpm install`
* **yarn**: `yarn install --immutable` (if lockfile exists) or `yarn install --no-immutable`
* **npm**: `npm ci` (if lockfile exists) or `npm install`
* **bun**: `bun install --frozen-lockfile` (if lockfile exists) or `bun install`
* **deno**: `deno install` (respects deno.lock if present)

Set `install-deps: false` to skip this step and control installation yourself.

## Usage Examples

### Monorepo with Turbo

```yaml
name: CI

on: [push, pull_request]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: savvy-web/workflow-runtime-action@v1
        with:
          turbo-token: ${{ secrets.TURBO_TOKEN }}
          turbo-team: ${{ vars.TURBO_TEAM }}

      - name: Build packages
        run: pnpm turbo build

      - name: Run tests
        run: pnpm turbo test

      - name: Lint code
        run: pnpm turbo lint
```

### Multi-Runtime Project

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      # Automatically sets up both Node.js and Deno from package.json devEngines
      - uses: savvy-web/workflow-runtime-action@v1

      - name: Test with Node.js
        run: npm test

      - name: Test with Deno
        run: deno test
```

### Using Action Outputs

```yaml
- name: Setup runtime
  id: setup
  uses: savvy-web/workflow-runtime-action@v1

- name: Display environment
  run: |
    echo "Node.js enabled: ${{ steps.setup.outputs.node-enabled }}"
    echo "Node.js version: ${{ steps.setup.outputs.node-version }}"
    echo "Bun enabled: ${{ steps.setup.outputs.bun-enabled }}"
    echo "Bun version: ${{ steps.setup.outputs.bun-version }}"
    echo "Package manager: ${{ steps.setup.outputs.package-manager }} v${{ steps.setup.outputs.package-manager-version }}"
    echo "Turbo enabled: ${{ steps.setup.outputs.turbo-enabled }}"
    echo "Biome enabled: ${{ steps.setup.outputs.biome-enabled }}"
    echo "Cache hit: ${{ steps.setup.outputs.cache-hit }}"
```

### Custom Dependency Installation

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    install-deps: false

# Install with custom flags
- run: pnpm install --no-frozen-lockfile --prefer-offline

# Or install only specific workspaces
- run: pnpm install --filter ./packages/core
```

## Package Manager Support

All package managers are configured from `devEngines.packageManager` in `package.json`:

### pnpm

* Installed via corepack with exact version from `devEngines`
* Install command: `pnpm install --frozen-lockfile` (or `pnpm install` without lockfile)

### Yarn

* Installed via corepack with exact version from `devEngines`
* Supports both Yarn 1.x (Classic) and 2.x+ (Berry)
* Install command: `yarn install --immutable` (or `yarn install --no-immutable` without lockfile)

### npm

* Installed via corepack with exact version from `devEngines`
* Install command: `npm ci` (or `npm install` without lockfile)

### bun

* Downloaded and installed from official releases
* Install command: `bun install --frozen-lockfile` (or `bun install` without lockfile)

### deno

* Downloaded and installed from official releases
* Install command: `deno install` (respects deno.lock automatically)

## Turbo Remote Cache

If you're using [Turborepo](https://turbo.build/repo) for your monorepo, you can enable remote caching:

1. **Create a Turbo account** at [https://vercel.com/turborepo](https://vercel.com/turborepo)
2. **Get your token**: `npx turbo login`
3. **Add secrets to your repository**:
   * `TURBO_TOKEN`: Your Turbo token
   * `TURBO_TEAM`: Your team slug (or set as a variable)

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    turbo-token: ${{ secrets.TURBO_TOKEN }}
    turbo-team: ${{ vars.TURBO_TEAM }}
```

The action will automatically configure remote caching if:

* `turbo.json` exists in your repository
* Both `turbo-token` and `turbo-team` are provided

## Troubleshooting

### Missing devEngines configuration

**Error:** `devEngines.runtime or devEngines.packageManager not found in package.json`

**Solution:** Add `devEngines` to your `package.json`:

```json
{
  "devEngines": {
    "runtime": {
      "name": "node",
      "version": "24.10.0",
      "onFail": "error"
    },
    "packageManager": {
      "name": "pnpm",
      "version": "10.20.0",
      "onFail": "error"
    }
  }
}
```

### onFail validation error

**Error:** `devEngines.runtime.onFail must be "error"`

**Solution:** Ensure all runtime and package manager configurations set `onFail: "error"`:

```json
{
  "devEngines": {
    "runtime": {
      "name": "node",
      "version": "24.10.0",
      "onFail": "error"  // Required!
    }
  }
}
```

### Cache not working

**Possible causes:**

1. **Lockfile changed**: Cache is keyed to lockfile content hash
2. **Dependencies changed**: Cache invalidates when dependencies change
3. **Package manager changed**: Each package manager has separate cache

**Solution:** This is expected behavior. Cache will rebuild on first run after changes.

### Dependency installation fails

**Solution 1:** Check your lockfile is committed and up-to-date

**Solution 2:** Skip automatic installation and install manually:

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    install-deps: false

- run: pnpm install --no-frozen-lockfile
```

## Contributing

This action is part of Savvy Web Systems' open-source toolkit.

To contribute:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass: `pnpm test`
5. Submit a pull request

## Development

### Prerequisites

* Node.js 24+ (specified in `devEngines.runtime` in `package.json`)
* pnpm 10+ (specified in `devEngines.packageManager` in `package.json`)

### Setup

```bash
pnpm install
```

### Running Tests

```bash
pnpm test          # Run tests once
pnpm test --watch  # Run in watch mode
pnpm ci:test       # Run with CI reporter
```

### Linting

```bash
pnpm lint          # Check for issues
pnpm lint:fix      # Auto-fix issues
```

### Type Checking

```bash
pnpm typecheck
```

### Testing the Action

This repository includes workflows for testing the action in a real GitHub Actions environment:

#### Quick Demo (`.github/workflows/demo.yml`)

Demonstrates three usage patterns:

* **Auto-detect:** Let the action detect everything automatically
* **Explicit:** Specify all configuration explicitly
* **Skip deps:** Setup runtime but install dependencies manually

**To run:** Go to Actions → "Demo - Quick Test" → Run workflow

#### Comprehensive Test (`.github/workflows/test-action.yml`)

Full test suite with:

* **Manual test:** Trigger with custom inputs to test specific configurations
* **Matrix test:** Automatically tests across multiple OS (Ubuntu, macOS, Windows) and package managers (pnpm, yarn, npm)

**To run:** Go to Actions → "Test Runtime Action" → Run workflow

**Available inputs:**

* `package-manager`: Choose npm, pnpm, or yarn (or leave empty for auto-detect)
* `node-version`: Specify Node.js version (or leave empty to use `.nvmrc`)
* `biome-version`: Specify Biome version (or leave empty for auto-detect)
* `install-deps`: Enable/disable dependency installation
* `turbo-token`: Optional Turbo remote cache token
* `turbo-team`: Optional Turbo team slug

The test workflow provides detailed output including:

* Action outputs (runtime version, package manager, etc.)
* Environment verification (Node.js, package manager versions)
* Command tests (typecheck, lint, test)
* Beautiful summary in the GitHub Actions UI

## License

MIT License - See [LICENSE](LICENSE) for details

## Support

* **Issues**: [GitHub Issues](https://github.com/savvy-web/workflow-runtime-action/issues)
* **Discussions**: [GitHub Discussions](https://github.com/savvy-web/workflow-runtime-action/discussions)

---

**Made with ❤️ by [Savvy Web Systems](https://github.com/savvy-web)**
