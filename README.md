# Node.js Runtime Setup Action

A comprehensive GitHub Action for setting up Node.js development environments with automatic package manager detection, dependency caching, and Turbo build cache configuration.

## Features

* **Automatic Node.js version detection** from `.nvmrc` or `.node-version` files
* **Package manager auto-detection** (pnpm, yarn, npm) from `package.json` or lockfiles
* **Dependency caching** optimized for each package manager
* **Turbo remote cache support** with optional Vercel integration
* **Optional dependency installation** - skip if you want to control installation timing
* **Rich output information** including detected versions and cache status
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

### With Custom Configuration

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    package-manager: pnpm
    node-version: '20.x'
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

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `package-manager` | Package manager to use (`npm` \| `pnpm` \| `yarn`). If omitted, will be auto-detected. | No | `""` (auto-detect) |
| `node-version` | Node.js version in SemVer notation. Supports aliases like `lts/*`, `latest`, `20.x`. | No | `"lts/*"` |
| `turbo-token` | Turbo remote cache token for Vercel Remote Cache (optional). | No | `""` |
| `turbo-team` | Turbo team slug for Vercel Remote Cache (optional). | No | `""` |
| `install-deps` | Whether to install dependencies (`true` \| `false`). Set to `false` to skip installation. | No | `"true"` |

## Outputs

| Output | Description |
|--------|-------------|
| `runtime-version` | The Node.js runtime version that was installed (e.g., `20.10.0`) |
| `node-version-manager-file` | The version manager file that was detected (`.nvmrc` \| `.node-version` \| empty if using input) |
| `package-manager` | The package manager that was detected or configured (`npm` \| `pnpm` \| `yarn`) |

## How It Works

### 1. Node.js Version Detection

The action determines which Node.js version to install using this priority:

1. **Input parameter** (`node-version`) if provided
2. **`.nvmrc` file** in repository root
3. **`.node-version` file** in repository root
4. **Default** (`lts/*`) if nothing else is specified

### 2. Package Manager Detection

The action auto-detects your package manager using this logic:

1. **Input parameter** (`package-manager`) if provided
2. **`packageManager` field** in `package.json` (e.g., `"packageManager": "pnpm@8.0.0"`)
3. **Lockfile detection**:
   * `pnpm-lock.yaml` → pnpm
   * `yarn.lock` → yarn
   * `package-lock.json` → npm
4. **Default** to npm if nothing is detected

### 3. Dependency Caching

Each package manager gets optimized caching:

* **pnpm**: Caches `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.pnpmfile.cjs`, `turbo.json`
* **yarn**: Caches `yarn.lock`, `turbo.json`
* **npm**: Caches `package-lock.json`, `turbo.json`

### 4. Turbo Configuration

If `turbo.json` is detected:

* Automatically recognizes Turbo-enabled projects
* Configures remote caching if `turbo-token` and `turbo-team` are provided
* Sets up telemetry opt-out for CI environments

### 5. Dependency Installation

By default, the action runs the appropriate install command for your package manager:

* **pnpm**: `pnpm install --frozen-lockfile`
* **yarn**: `yarn install --immutable`
* **npm**: `npm ci`

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
          package-manager: pnpm
          turbo-token: ${{ secrets.TURBO_TOKEN }}
          turbo-team: ${{ vars.TURBO_TEAM }}

      - name: Build packages
        run: pnpm turbo build

      - name: Run tests
        run: pnpm turbo test

      - name: Lint code
        run: pnpm turbo lint
```

### Matrix Testing Across Node Versions

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: ['18.x', '20.x', '22.x']
    steps:
      - uses: actions/checkout@v5

      - uses: savvy-web/workflow-runtime-action@v1
        with:
          node-version: ${{ matrix.node-version }}

      - run: pnpm test
```

### Using Action Outputs

```yaml
- name: Setup Node.js
  id: setup
  uses: savvy-web/workflow-runtime-action@v1

- name: Display environment
  run: |
    echo "Node.js version: ${{ steps.setup.outputs.runtime-version }}"
    echo "Package manager: ${{ steps.setup.outputs.package-manager }}"
    echo "Version file: ${{ steps.setup.outputs.node-version-manager-file }}"
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

### pnpm

* Automatically installed via `pnpm/action-setup@v4`
* Version detected from `package.json` `packageManager` field or uses latest
* Runs in standalone mode (no global installation required)
* Install command: `pnpm install --frozen-lockfile`

### Yarn

* Enabled via `corepack enable yarn`
* Supports both Yarn 1.x (Classic) and 2.x+ (Berry)
* Version controlled via `package.json` `packageManager` field
* Install command: `yarn install --immutable`

### npm

* Pre-installed with Node.js (no additional setup needed)
* Uses native npm caching from `actions/setup-node`
* Install command: `npm ci` (enforces clean install from lockfile)

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

### Package manager not detected correctly

**Solution:** Explicitly specify the package manager:

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    package-manager: pnpm
```

Or add `packageManager` to your `package.json`:

```json
{
  "packageManager": "pnpm@8.15.0"
}
```

### Node.js version mismatch

**Solution:** Add a `.nvmrc` or `.node-version` file to your repository:

```bash
echo "20.10.0" > .nvmrc
```

Or specify explicitly:

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    node-version: '20.x'
```

### Cache not working

**Possible causes:**

1. **Lockfile changed**: Cache is keyed to lockfile content
2. **Turbo configuration changed**: `turbo.json` is part of cache key
3. **Package manager changed**: Each PM has separate cache

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

* Node.js 20+ (specified in `.nvmrc`)
* pnpm 8+ (specified in `package.json`)

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
