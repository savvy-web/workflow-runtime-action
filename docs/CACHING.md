<!-- markdownlint-disable MD033 -->

# Caching Strategy

This document explains how dependency caching works in the
`workflow-runtime-action` and how to customize it for your specific needs.

## Overview

The action provides **intelligent, automatic dependency caching** that:

- ✅ Automatically detects lockfiles for cache key generation
- ✅ Caches dependencies for all detected package managers
- ✅ Caches runtime installations (Node.js, Bun, Deno)
- ✅ Supports custom lockfiles and cache paths for polyglot projects
- ✅ Uses short 8-character hashes for readable cache keys
- ✅ Deduplicates paths across multiple package managers
- ✅ Dynamically detects cache directories from package managers

**Zero configuration required** – the action automatically:

1. Detects your package manager from `package.json`
2. Queries the package manager for its cache directory
3. Finds all relevant lockfiles in your repository
4. Generates a stable cache key from versions + lockfile contents
5. Restores/saves cache automatically

## Table of Contents

- [How Cache Keys Are Generated](#how-cache-keys-are-generated)
  - [Step-by-Step Cache Key Generation](#step-by-step-cache-key-generation)
  - [Why 8-Character Hashes?](#why-8-character-hashes)
- [Default Lockfiles by Package Manager](#default-lockfiles-by-package-manager)
- [Default Cache Paths by Package Manager](#default-cache-paths-by-package-manager)
- [Runtime Tool Cache Paths](#runtime-tool-cache-paths)
- [Path Sorting Order](#path-sorting-order)
- [Adding Custom Lockfiles and Cache Paths](#adding-custom-lockfiles-and-cache-paths)
  - [Example: Caching Rust/Cargo Dependencies](#example-caching-rustcargo-dependencies)
  - [Example: Caching Python Dependencies](#example-caching-python-dependencies)
  - [Example: Caching Go Dependencies](#example-caching-go-dependencies)
  - [Example: Caching Build Artifacts](#example-caching-build-artifacts)
- [Input Format Support](#input-format-support)
- [Cache Behavior](#cache-behavior)
  - [First Run (Cache Miss)](#first-run-cache-miss)
  - [Second Run (Cache Hit)](#second-run-cache-hit)
  - [Partial Cache Hit](#partial-cache-hit)
- [Cache Key Stability](#cache-key-stability)
- [Debugging Cache Issues](#debugging-cache-issues)
  - [Styled Action Logs](#styled-action-logs)
  - [View Cache Key Components](#view-cache-key-components)
  - [Enable Debug Logging](#enable-debug-logging)
  - [Force Cache Refresh](#force-cache-refresh)
- [Multi-Runtime Caching](#multi-runtime-caching)
- [Best Practices](#best-practices)
- [Action Outputs](#action-outputs)
- [Advanced: Monorepo Caching](#advanced-monorepo-caching)
- [Questions?](#questions)

## How Cache Keys Are Generated

Cache keys follow this format:

```text
{platform}-{version-hash}-{lockfile-hash}
```

**Example:**

```text
linux-abc12345-def67890
```

Where:

- **platform**: `linux`, `darwin`, or `win32`
- **version-hash**: 8-char hash of runtime versions + package manager version
- **lockfile-hash**: 8-char hash of all lockfile contents

### Step-by-Step Cache Key Generation

Here's exactly how the action generates cache keys:

#### 1. Collect Runtime and Package Manager Info

The action gathers:

- All installed runtime versions (Node.js, Bun, Deno)
- Package manager name and version
- Optional cache hash for testing

**Example:**

```json
{
  "node": "24.11.0",
  "packageManager": "pnpm",
  "packageManagerVersion": "10.20.0"
}
```

#### 2. Generate Version Hash

Creates a SHA256 hash from sorted runtime versions and package manager:

```typescript
// Pseudo-code
hash = sha256(
  "node:24.11.0" +
  "pnpm:10.20.0"
)
versionHash = hash.substring(0, 8) // First 8 characters
// Result: "abc12345"
```

#### 3. Find and Hash Lockfiles

Searches for lockfiles using glob patterns (see [Default Lockfiles](#default-lockfiles-by-package-manager)):

```bash
# For pnpm, searches for:
**/pnpm-lock.yaml
**/pnpm-workspace.yaml
**/.pnpmfile.cjs

# Found: ["pnpm-lock.yaml"]
```

Then hashes all found lockfile contents:

```typescript
// Pseudo-code
hash = sha256(
  readFile("pnpm-lock.yaml")
)
lockfileHash = hash.substring(0, 8)
// Result: "def67890"
```

#### 4. Combine into Final Key

```text
{platform}-{versionHash}-{lockfileHash}
linux-abc12345-def67890
```

### Why 8-Character Hashes?

Full SHA256 hashes are 64 characters long, making cache keys unwieldy:

```text
linux-abc123def456abc123def456-abc123def456abc123def456abc123def456  ❌ Too long!
```

We truncate to 8 characters for better readability:

```text
linux-abc12345-def67890  ✅ Much better!
```

**Collision safety:**

- 8 hex characters = 4.3 billion possibilities (16^8)
- Birthday paradox: 50% collision at ~65,000 cache entries
- For a single repository: **collision risk is negligible**

## Default Lockfiles by Package Manager

The action automatically searches for these lockfiles to generate cache keys:

<details>
<summary><strong>📦 npm</strong></summary>

```bash
# Primary lockfile
**/package-lock.json
# Alternative lockfile
**/npm-shrinkwrap.json
```

</details>

<details>
<summary><strong>📦 pnpm</strong></summary>

```bash
# Primary lockfile with dependency versions
**/pnpm-lock.yaml
# Workspace configuration (affects dependencies)
**/pnpm-workspace.yaml
# Hooks that can modify dependency resolution
**/.pnpmfile.cjs
```

</details>

<details>
<summary><strong>🧶 Yarn</strong></summary>

```bash
# Classic Yarn lockfile
**/yarn.lock
# Yarn Berry Plug'n'Play manifest
**/.pnp.cjs
# Yarn Berry install state
**/.yarn/install-state.gz
```

</details>

<details>
<summary><strong>🥟 Bun</strong></summary>

```bash
# New style lockfile
**/bun.lock
# Older style lockfile
**/bun.lockb
```

</details>

<details>
<summary><strong>🦕 Deno</strong></summary>

```bash
# Deno lockfile
**/deno.lock
```

</details>

## Default Cache Paths by Package Manager

<details>
<summary><strong>📦 npm</strong></summary>

```bash
# Detected dynamically via: npm config get cache

# Fallback paths:
~/.npm                           # Linux/macOS
~/AppData/Local/npm-cache        # Windows

# Additional paths:
**/node_modules
# Tool cache paths for Node.js runtime
```

</details>

<details>
<summary><strong>📦 pnpm</strong></summary>

```bash
# Detected dynamically via: pnpm store path

# Fallback paths:
~/.local/share/pnpm/store        # Linux/macOS
~/AppData/Local/pnpm/store       # Windows

# Additional paths:
**/node_modules
# Tool cache paths for Node.js runtime
```

</details>

<details>
<summary><strong>🧶 Yarn</strong></summary>

```bash
# Detected dynamically via:
#   yarn config get cacheFolder  (Yarn Berry)
#   yarn cache dir               (Yarn Classic fallback)

# Fallback paths:
~/.yarn/cache                            # Linux/macOS
~/.cache/yarn                            # Linux alternative
~/AppData/Local/Yarn/Cache               # Windows
~/AppData/Local/Yarn/Berry/cache         # Windows Berry

# Additional paths:
**/.yarn/cache
**/.yarn/unplugged
**/.yarn/install-state.gz
**/node_modules
# Tool cache paths for Node.js runtime
```

</details>

<details>
<summary><strong>🥟 Bun</strong></summary>

```bash
# Detected dynamically via: bun pm cache

# Fallback paths:
~/.bun/install/cache                     # Linux/macOS
~/AppData/Local/bun/install/cache        # Windows

# Additional paths:
**/node_modules
# Tool cache paths for Bun runtime
```

</details>

<details>
<summary><strong>🦕 Deno</strong></summary>

```bash
# Detected dynamically via: deno info --json (reads denoDir field)

# Fallback paths:
~/.cache/deno                    # Linux/macOS
~/AppData/Local/deno             # Windows

# Additional paths:
# Tool cache paths for Deno runtime
```

</details>

## Runtime Tool Cache Paths

When runtimes are installed, their binaries are cached at:

```text
/opt/hostedtoolcache/{runtime}/{version}
/opt/hostedtoolcache/{runtime}/{version}/*
```

**Example for Node.js 24.11.0:**

```text
/opt/hostedtoolcache/node/24.11.0
/opt/hostedtoolcache/node/24.11.0/*
```

**Why two paths?**

- First path: Caches the version directory itself
- Second path with `/*`: Caches architecture-specific subdirectories (x64,
  arm64)

This ensures runtime installations are cached between workflow runs, avoiding
repeated downloads!

## Path Sorting Order

Cache paths are sorted for consistency with **absolute paths first, then
globs:**

```text
/home/user/.npm
/opt/hostedtoolcache/node/24.11.0
/opt/hostedtoolcache/node/24.11.0/*
**/node_modules
```

This logical ordering:

- ✅ Makes logs easier to read
- ✅ Groups related paths together
- ✅ Ensures consistent cache key generation

## Adding Custom Lockfiles and Cache Paths

Use the `additional-lockfiles` and `additional-cache-paths` inputs to extend
caching for additional tools or polyglot projects.

### Example: Caching Rust/Cargo Dependencies

If your JavaScript project also builds Rust code (e.g., via WASM, native
modules, or embedded Rust tools), you'll want to cache Cargo dependencies
alongside your JavaScript dependencies:

```yaml
steps:
  - uses: actions/checkout@v6

  - uses: savvy-web/workflow-runtime-action@v1
    with:
      # Add Cargo.lock to cache key generation
      # This ensures cache invalidates when Rust dependencies change
      additional-lockfiles: |
        **/Cargo.lock

      # Cache Cargo's registry, git dependencies, and build artifacts
      # These directories can be large (100s of MB) and expensive to
      # rebuild
      additional-cache-paths: |
        ~/.cargo/registry
        ~/.cargo/git
        **/target

  - run: pnpm install
  - run: pnpm build  # May invoke cargo build for WASM/native modules
```

**What happens:**

1. **Cache key generation** includes both `Cargo.lock` and `pnpm-lock.yaml`:

   ```text
   linux-abc12345-def67890
                   ^^^^^^^^
                   Hash includes BOTH lockfiles
   ```

2. **Cache restoration** includes:

   ```text
   ~/.local/share/pnpm/store     # pnpm dependencies
   ~/.cargo/registry              # Cargo crate registry
   ~/.cargo/git                   # Cargo git dependencies
   **/node_modules                # Installed Node modules
   **/target                      # Rust build artifacts
   /opt/hostedtoolcache/node/24.11.0  # Node.js runtime
   ```

3. **Cache invalidation** happens when **either** lockfile changes:
   - Change `pnpm-lock.yaml` → New cache key, re-download JS dependencies
   - Change `Cargo.lock` → New cache key, re-download Rust dependencies
   - Both unchanged → Cache hit, skip all downloads! ⚡

**Why this works:**

- JavaScript and Rust dependencies have independent lifecycles
- Caching both together avoids unnecessary rebuilds
- Single cache key means one restore operation instead of two

### Example: Caching Python Dependencies

For projects using both Node.js and Python (e.g., tools, scripts, ML
models):

```yaml
steps:
  - uses: actions/checkout@v6

  - uses: savvy-web/workflow-runtime-action@v1
    with:
      # Support multiple Python lockfile formats
      additional-lockfiles: |
        **/requirements.txt
        **/poetry.lock
        **/Pipfile.lock

      # Cache pip and poetry directories, plus virtual environments
      additional-cache-paths: |
        ~/.cache/pip
        ~/.cache/pypoetry
        **/.venv

  - run: pnpm install
  - run: pip install -r requirements.txt
  - run: pnpm build  # May call Python scripts
```

### Example: Caching Go Dependencies

For projects using Go alongside JavaScript:

```yaml
steps:
  - uses: actions/checkout@v6

  - uses: savvy-web/workflow-runtime-action@v1
    with:
      additional-lockfiles: |
        **/go.sum
        **/go.mod

      additional-cache-paths: |
        ~/go/pkg/mod
        **/.go-build-cache

  - run: pnpm install
  - run: go build
  - run: pnpm build
```

### Example: Caching Build Artifacts

Cache build outputs to speed up subsequent runs:

```yaml
steps:
  - uses: actions/checkout@v6

  - uses: savvy-web/workflow-runtime-action@v1
    with:
      # No additional lockfiles needed - JavaScript lockfiles already tracked

      # Cache expensive build outputs
      additional-cache-paths: |
        **/dist
        **/build
        **/.next/cache
        **/.turbo
        **/.cache/webpack

  - run: pnpm build
```

**⚠️ Important:** Only cache deterministic build outputs! Don't cache:

- Outputs with timestamps or random values
- Platform-specific binaries (unless runner OS is fixed)
- Outputs that depend on environment variables not in cache key

## Input Format Support

The `additional-lockfiles` and `additional-cache-paths` inputs support
**multiple formats**:

### 1. Plain Newlines

```yaml
additional-lockfiles: |
  **/Cargo.lock
  **/go.sum
  **/requirements.txt
```

### 2. Markdown Bullets

```yaml
additional-lockfiles: |
  * **/Cargo.lock
  * **/go.sum
  * **/requirements.txt
```

### 3. Markdown Dashes

```yaml
additional-lockfiles: |
  - **/Cargo.lock
  - **/go.sum
  - **/requirements.txt
```

### 4. Comma-Separated

```yaml
additional-lockfiles: '**/Cargo.lock, **/go.sum, **/requirements.txt'
```

### 5. JSON Array

```yaml
additional-lockfiles: '[\"**/Cargo.lock\", \"**/go.sum\", \"**/requirements.txt\"]'
```

### 6. Single Item

```yaml
additional-lockfiles: '**/Cargo.lock'
```

All formats are equivalent and parsed identically!

## Cache Behavior

### First Run (Cache Miss)

1. Action generates cache key from lockfile hashes
2. Attempts to restore from cache → **miss**
3. Installs runtimes and dependencies
4. Saves cache for future runs

**Output:** `cache-hit: "false"`

**Example logs:**

```text
Cache not found
Primary key: linux-abc12345-def67890
Restore keys: linux-abc12345-
```

### Second Run (Cache Hit)

1. Action generates same cache key (lockfiles unchanged)
2. Restores from cache → **hit** ⚡
3. Skips installation (everything cached!)

**Output:** `cache-hit: "true"`

**Example logs:**

```text
Cache restored from key: linux-abc12345-def67890
```

### Partial Cache Hit

If the lockfile hash changed but runtime versions match:

1. Restores from fallback key (matches runtime versions)
2. Reuses runtime installations ⚡
3. Installs dependencies (lockfiles changed)

**Output:** `cache-hit: "partial"`

**Example logs:**

```text
Cache restored from key: linux-abc12345-
Primary key: linux-abc12345-def67890
```

**What got cached:**

- ✅ Runtime installations (Node.js/Bun/Deno)
- ❌ Dependencies (lockfile changed)

## Cache Key Stability

Cache keys remain stable when:

- ✅ Lockfiles are unchanged
- ✅ Runtime versions are unchanged (`package.json` `devEngines.runtime`)
- ✅ Package manager version is unchanged (`devEngines.packageManager`)

Cache keys change when:

- ❌ Any lockfile content changes
- ❌ Runtime versions change in `devEngines.runtime`
- ❌ Package manager version changes in `devEngines.packageManager`
- ❌ Additional lockfiles change (if using `additional-lockfiles`)

## Debugging Cache Issues

### Styled Action Logs

The action provides **beautifully formatted logs** with emojis and grouped
output to make it easy to understand what's happening:

**Cache restoration logs:**

```text
📦 Restoring 📦 npm cache
  ℹ Detected npm cache path: /home/runner/.npm
  ℹ Found lock files: package-lock.json
  ℹ Cache paths (3 total): /home/runner/.npm, **/node_modules, ...
  ℹ Primary key: linux-abc12345-def67890
  ℹ Restore keys: linux-abc12345-
  ✅ Cache restored from key: linux-abc12345-def67890
```

**Cache save logs:**

```text
💾 Saving dependencies cache
  ℹ Package managers: npm
  ℹ Cache key: linux-abc12345-def67890
  ℹ Cache paths (3 total):
    - /home/runner/.npm
    - /opt/hostedtoolcache/node/24.11.0
    - **/node_modules
  ✅ Cache saved successfully with key: linux-abc12345-def67890
```

These logs make it immediately clear:

- Which package manager is being cached
- What lockfiles were found
- Which paths are being cached/restored
- Whether the cache was hit or saved successfully

### View Cache Key Components

Check action outputs to see what was used for caching:

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  id: setup

- name: Debug cache
  run: |
    echo "Cache hit: ${{ steps.setup.outputs.cache-hit }}"
    echo "Lockfiles: ${{ steps.setup.outputs.lockfiles }}"
    echo "Cache paths: ${{ steps.setup.outputs.cache-paths }}"
```

### Enable Debug Logging

Set `ACTIONS_STEP_DEBUG` secret to `true` in your repository settings to see
detailed cache operations:

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  env:
    ACTIONS_STEP_DEBUG: true
```

This shows:

- Detected cache paths from package managers
- All glob patterns being searched
- Exact cache key generation logic
- Which files matched lockfile patterns

### Force Cache Refresh

To invalidate the cache, change any lockfile:

```bash
# For npm
npm install --package-lock-only

# For pnpm
pnpm install --lockfile-only

# For yarn
yarn install --mode update-lockfile

# For bun
bun install --frozen-lockfile=false

# For deno
deno cache --reload
```

Or use the `cache-hash` input for testing:

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    cache-hash: 'test-${{ github.run_id }}'  # Unique per run
```

**⚠️ Only use `cache-hash` for testing!** It creates new cache entries on every run.

## Multi-Runtime Caching

When using multiple runtimes, cache paths are **combined and deduplicated**:

```yaml
- uses: savvy-web/workflow-runtime-action@v1
  with:
    # Using both Node.js (via pnpm) and Deno
    # No explicit config needed - auto-detected from package.json
```

**Cached paths include:**

```text
/home/runner/.local/share/pnpm/store
/home/runner/.cache/deno
/opt/hostedtoolcache/node/24.11.0
/opt/hostedtoolcache/node/24.11.0/*
/opt/hostedtoolcache/deno/2.1.0
/opt/hostedtoolcache/deno/2.1.0/*
**/node_modules
```

**Cache key includes both lockfiles:**

```text
linux-abc12345-def67890
         ↓         ↓
     versions   pnpm-lock.yaml + deno.lock
```

## Best Practices

### ✅ DO

- Use the action's automatic caching for JavaScript/TypeScript projects
- Add custom lockfiles for additional languages (Rust, Go, Python)
- Cache build artifacts that are expensive to regenerate
- Use glob patterns (`**/*.lock`) to match files in any subdirectory
- Keep lockfiles committed to version control
- Use absolute versions in `devEngines` for reproducible caching

### ❌ DON'T

- Don't cache `.env` files or secrets
- Don't cache OS-specific build artifacts across different OS runners
- Don't use `cache-hash` in production (testing only!)
- Don't cache `node_modules` separately (action handles it!)
- Don't manually manage Node.js/npm/pnpm/yarn caches (action handles it!)
- Don't cache non-deterministic build outputs

## Action Outputs

Use these outputs to verify caching behavior:

| Output | Description | Example |
| ------ | ----------- | ------- |
| `cache-hit` | Cache status | `"true"`, `"false"`, `"partial"` |
| `lockfiles` | Detected lockfiles | `"pnpm-lock.yaml,Cargo.lock"` |
| `cache-paths` | Paths cached | `"/home/runner/.npm,**/node_modules"` |
| `node-version` | Node.js version | `"24.11.0"` |
| `package-manager` | Package manager | `"pnpm"` |
| `package-manager-version` | PM version | `"10.20.0"` |

## Advanced: Monorepo Caching

For monorepos with multiple lockfiles:

```yaml
steps:
  - uses: actions/checkout@v6

  - uses: savvy-web/workflow-runtime-action@v1
    with:
      # Glob patterns match all lockfiles in workspace
      additional-lockfiles: |
        **/packages/*/Cargo.lock
        **/apps/*/requirements.txt

      additional-cache-paths: |
        **/packages/*/target
        **/apps/*/.venv

  - run: pnpm install  # Installs all workspace dependencies
```

The action automatically finds **all lockfiles** matching the patterns and
includes them in the cache key!

## Questions?

- See [GitHub Actions Cache Documentation](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows)
- Check [action outputs](#action-outputs) to debug caching behavior
- File issues at [github.com/savvy-web/workflow-runtime-action](https://github.com/savvy-web/workflow-runtime-action/issues)
