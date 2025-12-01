# 🚀 JavaScript Runtime Setup Action

Automatically detect and setup JavaScript runtime environments in GitHub Actions
from your `package.json` or explicit configuration. One action for Node.js,
Bun, and Deno with intelligent package manager detection and dependency caching.

## ✨ Why This Action?

Setting up JavaScript environments in CI should be simple. This action:

* 🔍 **Detects your environment** from `package.json` `devEngines` configuration
* 📌 **Installs exact versions** of runtimes and package managers
* ⚡ **Caches dependencies** automatically for faster builds
* 🎯 **Supports multiple runtimes** simultaneously (Node.js + Deno, Node.js + Bun)
* 🛠️ **Works with explicit inputs** when you don't have a `package.json`

**No configuration needed** - just add the action and it figures everything out!

## 🚀 Quick Start

### 🔮 Auto-Detect from package.json

The simplest setup - let the action detect everything:

```yaml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: savvy-web/workflow-runtime-action@v1
      - run: pnpm test
      - run: pnpm build
```

### ⚙️ Explicit Configuration

Use explicit inputs when you don't have or want to override `package.json`:

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    node-version: '24.10.0'
    package-manager: pnpm
    package-manager-version: '10.20.0'
```

## 🎯 How It Works

### 🔍 Auto-Detection Mode

The action reads configuration from your `package.json` `devEngines` field:

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

**Requirements:**

* Versions must be **exact** (e.g., `24.10.0`, not `^24.0.0`)
* `onFail` must be set to `"error"` for strict validation
* Supports single or multiple runtimes

### 📦 What Gets Installed

1. ⚡ **Runtime(s)** - Node.js, Bun, and/or Deno at specified versions
2. 📦 **Package Manager** - pnpm, yarn, npm, bun, or deno at specified version
3. 🔧 **Dependencies** - Automatically installs with appropriate lockfile flags
4. 💾 **Caching** - Sets up dependency caching optimized for your package manager

## 📥 Inputs

All inputs are optional. The action uses auto-detection if not provided.

| Input | Description | Default |
| ----- | ----------- | ------- |
| `node-version` | Node.js version (e.g., `24.10.0`) | Auto-detect from `devEngines.runtime` |
| `bun-version` | Bun version (e.g., `1.3.3`) | Auto-detect from `devEngines.runtime` |
| `deno-version` | Deno version (e.g., `2.5.6`) | Auto-detect from `devEngines.runtime` |
| `package-manager` | Package manager (`npm` \| `pnpm` \| `yarn` \| `bun` \| `deno`) | Auto-detect from `devEngines.packageManager` |
| `package-manager-version` | Package manager version | Auto-detect from `devEngines.packageManager` |
| `install-deps` | Install dependencies (`true` \| `false`) | `"true"` |

## 📤 Outputs

| Output | Description |
| ------ | ----------- |
| `node-version` | Installed Node.js version or empty |
| `node-enabled` | Whether Node.js was installed (`true` \| `false`) |
| `bun-version` | Installed Bun version or empty |
| `bun-enabled` | Whether Bun was installed (`true` \| `false`) |
| `deno-version` | Installed Deno version or empty |
| `deno-enabled` | Whether Deno was installed (`true` \| `false`) |
| `package-manager` | Package manager name |
| `package-manager-version` | Package manager version |
| `cache-hit` | Cache status (`true` \| `partial` \| `false` \| `n/a`) |

## 💡 Usage Examples

### 🟢 Basic Node.js Project

```yaml
# Automatically detects Node.js version and pnpm from package.json
- uses: savvy-web/workflow-runtime-action@v1
- run: pnpm ci:test
```

### 🎭 Multi-Runtime Project

```yaml
# Sets up both Node.js and Deno from package.json devEngines
- uses: savvy-web/workflow-runtime-action@v1

- name: Test with Node.js
  run: npm ci:test

- name: Test with Deno
  run: deno ci:test
```

### 🛠️ Custom Dependency Installation

```yaml
# Skip automatic installation
- uses: savvy-web/workflow-runtime-action@v1
  with:
    install-deps: false

# Install with custom flags
- run: pnpm install --no-frozen-lockfile --prefer-offline
```

### 📊 Using Outputs

```yaml
- name: Setup runtime
  id: setup
  uses: savvy-web/workflow-runtime-action@v1

- name: Display environment
  run: |
    echo "Node.js: ${{ steps.setup.outputs.node-version }}"
    echo "Package Manager: ${{ steps.setup.outputs.package-manager }} v${{ steps.setup.outputs.package-manager-version }}"
    echo "Cache Hit: ${{ steps.setup.outputs.cache-hit }}"
```

### ⚡ Explicit Configuration (No package.json Required)

```yaml
# Perfect for projects without package.json
- uses: savvy-web/workflow-runtime-action@v1
  with:
    node-version: '24.10.0'
    package-manager: npm
    package-manager-version: '11.0.0'
```

## 📦 Supported Package Managers

### 📦 pnpm

* Installed via corepack with exact version
* Install command: `pnpm install --frozen-lockfile` (or `pnpm install` without
  lockfile)

### 🧶 Yarn

* Installed via corepack with exact version
* Supports Yarn Classic (1.x) and Berry (2.x+)
* Install command: `yarn install --immutable` (or `yarn install --no-immutable`
  without lockfile)

### 📦 npm

* Installed via corepack with exact version
* Install command: `npm ci` (or `npm install` without lockfile)

### 🥟 bun

* Downloaded from official releases
* Install command: `bun install --frozen-lockfile` (or `bun install` without
  lockfile)

### 🦕 deno

* Downloaded from official releases
* Install command: `deno install` (respects `deno.lock` automatically)

## 💾 Dependency Caching

The action automatically caches dependencies based on your package manager and
lockfile:

* 🔑 **Cache key** includes lockfile hash for invalidation on changes
* 🖥️ **Platform-specific** cache paths for each package manager
* 🔄 **Restore keys** for partial cache hits
* ⚡ **Automatic setup** - no configuration needed
* 🦀 **Polyglot support** - Cache Rust, Python, Go dependencies alongside JavaScript

Cache hit status is available in the `cache-hit` output.

📚 **See [Caching Strategy Documentation](docs/CACHING.md)** for:

* How cache keys are generated
* Default lockfiles and cache paths for each package manager
* Caching Rust/Cargo, Python, and Go dependencies
* Advanced caching strategies for monorepos
* Debugging cache issues

## 🔧 Troubleshooting

### ❌ Missing devEngines Configuration

**Error:** `devEngines.runtime or devEngines.packageManager not found`

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

Or use explicit inputs:

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    node-version: '24.10.0'
    package-manager: pnpm
    package-manager-version: '10.20.0'
```

### ⚠️ Version Must Be Exact

**Error:** `Must be an absolute version, not a semver range`

**Solution:** Use exact versions (e.g., `24.10.0`) instead of ranges (e.g.,
`^24.0.0`):

```json
{
  "devEngines": {
    "runtime": {
      "name": "node",
      "version": "24.10.0",  // ✅ Exact version
      // NOT: "version": "^24.0.0"  // ❌ Semver range
      "onFail": "error"
    }
  }
}
```

### 💥 Dependency Installation Fails

**Solution:** Skip automatic installation and install manually:

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    install-deps: false

- run: pnpm install --no-frozen-lockfile
```

## 🎭 Multiple Runtimes

You can set up multiple runtimes simultaneously by specifying an array in
`devEngines.runtime`:

```json
{
  "devEngines": {
    "runtime": [
      {
        "name": "node",
        "version": "24.10.0",
        "onFail": "error"
      },
      {
        "name": "deno",
        "version": "2.5.6",
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

The action will install all specified runtimes and make them available in your
workflow.

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for development
setup, testing, and contribution guidelines.

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

## 💬 Support

* 🐛 **Issues:** [GitHub Issues](https://github.com/savvy-web/workflow-runtime-action/issues)
* 💭 **Discussions:** [GitHub Discussions](https://github.com/savvy-web/workflow-runtime-action/discussions)

---

**Made with ❤️ by [Savvy Web Systems](https://github.com/savvy-web)**
