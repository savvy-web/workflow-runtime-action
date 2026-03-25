---
status: current
module: workflow-runtime-action
category: architecture
created: 2026-03-21
updated: 2026-03-21
last-synced: 2026-03-21
completeness: 90
related:
  - ./architecture.md
  - ./effect-service-model.md
dependencies: []
---

# Runtime Installation

The RuntimeInstaller service pattern, per-runtime descriptors, package manager setup, and Biome
binary installation.

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

Runtime installation is the core operation of the action: downloading, extracting, caching, and
verifying Node.js, Bun, and Deno runtimes. The design separates what-to-install (descriptors)
from how-to-install (the `RuntimeInstaller` service), keeping per-runtime logic minimal and shared
logic centralized.

**Key Features:**

- `RuntimeDescriptor` interface for pure data describing each runtime's download mechanics
- `makeRuntimeInstaller(descriptor)` factory that creates an installer from a descriptor
- Per-runtime layers (`NodeInstallerLive`, `BunInstallerLive`, `DenoInstallerLive`) for service
  injection
- Separate package manager setup step after all runtimes are installed
- Biome as a special case: single binary download, not the RuntimeInstaller pattern

**When to reference this document:**

- When adding support for a new runtime
- When modifying download URL patterns or archive handling
- When debugging runtime installation failures
- When understanding the package manager setup flow

---

## Current State

### RuntimeDescriptor Interface

```typescript
interface RuntimeDescriptor {
  readonly name: string
  readonly getDownloadUrl: (version: string, platform: string, arch: string) => string
  readonly getToolInstallOptions: (
    version: string, platform: string, arch: string
  ) => Partial<{ archiveType: "tar.gz" | "tar.xz" | "zip"; binSubPath: string }>
  readonly verifyCommand: readonly [string, ...string[]]
}
```

Descriptors are **pure data** with no side effects. They encode:

- How to construct the download URL given version/platform/arch
- What archive format to expect and where binaries live within the archive
- What command to run to verify the installation succeeded

### Descriptor Implementations

#### Node.js (`src/descriptors/node.ts`)

| Field | Value |
| --- | --- |
| URL pattern | `https://nodejs.org/dist/v{version}/node-v{version}-{platform}-{arch}.{ext}` |
| Archive type | `tar.gz` (Unix), `zip` (Windows) |
| Bin sub-path | `bin` (Unix), none (Windows) |
| Arch mapping | `x64` -> `x64`, `arm64` -> `arm64`, `arm` -> `armv7l` |
| Platform mapping | `win32` -> `win` |
| Verify command | `node --version` |

#### Bun (`src/descriptors/bun.ts`)

| Field | Value |
| --- | --- |
| URL pattern | `https://github.com/oven-sh/bun/releases/download/bun-v{version}/bun-{platform}-{arch}.zip` |
| Archive type | Always `zip` |
| Bin sub-path | `bun-{platform}-{arch}` (extracted directory name) |
| Arch mapping | `arm64` -> `aarch64`, `x64` -> `x64` |
| Platform mapping | `win32` -> `windows` (in archive name); always `x64` on Windows |
| Verify command | `bun --version` |

#### Deno (`src/descriptors/deno.ts`)

| Field | Value |
| --- | --- |
| URL pattern | `https://github.com/denoland/deno/releases/download/v{version}/deno-{target}.zip` |
| Archive type | Always `zip` |
| Bin sub-path | None (binary at archive root) |
| Target triples | `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `x86_64-apple-darwin`, `aarch64-apple-darwin`, `x86_64-pc-windows-msvc` |
| Verify command | `deno --version` |

#### Biome (`src/descriptors/biome.ts`)

Biome is **not** a `RuntimeDescriptor`. It exports a `binaryMap` (platform/arch to binary name)
used by `installBiome()` in `main.ts`:

| Platform | Arch | Binary Name |
| --- | --- | --- |
| linux | x64 | `biome-linux-x64` |
| linux | arm64 | `biome-linux-arm64` |
| darwin | x64 | `biome-darwin-x64` |
| darwin | arm64 | `biome-darwin-arm64` |
| win32 | x64 | `biome-win32-x64.exe` |
| win32 | arm64 | `biome-win32-arm64.exe` |

URL: `https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%40{version}/{binaryName}`

### RuntimeInstaller Service

```typescript
interface RuntimeInstaller {
  readonly install: (version: string) =>
    Effect<InstalledRuntime, RuntimeInstallError, ToolInstaller | CommandRunner | ActionOutputs>
}

const RuntimeInstaller = Context.GenericTag<RuntimeInstaller>("RuntimeInstaller")
```

The `install` method returns an `InstalledRuntime` on success:

```typescript
interface InstalledRuntime {
  readonly name: string
  readonly version: string
  readonly path: string
}
```

---

## Rationale

### Why Descriptors Are Pure Data

Descriptors contain no `postInstall` hook or side-effectful methods. Package manager setup
(corepack, npm global install) is handled as a separate `setupPackageManager` step in `main.ts`
after all runtimes are installed. This decision was made because:

1. Package manager setup depends on Node.js being on PATH (which requires the install to complete)
2. `corepack prepare` for pnpm must run from a temp directory to avoid workspace interference
3. Node >= 25 requires installing corepack globally via npm first (no longer bundled)
4. Bun and Deno are their own package managers and need no setup

### Why Biome Is Not a RuntimeDescriptor

Biome is a single binary download, not a compressed archive. The `RuntimeInstaller` pattern
uses `ToolInstaller.extractTar`/`extractZip` + `cacheDir`, which assumes archive content. Biome
uses `ToolInstaller.download` + `ToolInstaller.cacheFile` instead, which caches a single file.
This distinction justifies the separate `installBiome()` function.

### Why GenericTag + Effect.provide Per Runtime

The main pipeline installs multiple runtimes in sequence. Each needs a different descriptor.
Using `Context.GenericTag` with per-iteration `Effect.provide` swaps the installer implementation
cleanly:

```typescript
Effect.forEach(config.runtimes, (rt) =>
  RuntimeInstaller.pipe(
    Effect.flatMap((installer) => installer.install(rt.version)),
    Effect.provide(installerLayerFor(rt.name)),
  )
)
```

---

## Implementation Details

### makeRuntimeInstaller Factory

`makeRuntimeInstaller(descriptor)` creates a `RuntimeInstaller` implementation:

1. Yields `ToolInstaller`, `CommandRunner`, `ActionOutputs` from context
2. Computes download URL via `descriptor.getDownloadUrl(version, process.platform, process.arch)`
3. Computes options via `descriptor.getToolInstallOptions(...)`
4. Downloads the archive: `toolInstaller.download(url)`
5. Extracts based on `archiveType`:
   - `"zip"` -> `toolInstaller.extractZip(downloadedPath)`
   - `"tar.gz"` (default) -> `toolInstaller.extractTar(downloadedPath)`
6. Caches the extracted directory: `toolInstaller.cacheDir(extractedDir, name, version)`
7. Computes tool path with optional `binSubPath`
8. Adds to PATH: `outputs.addPath(toolPath)`
9. Verifies: `runner.exec(descriptor.verifyCommand[0], [...verifyCommand.slice(1)])`
10. Returns `{ name, version, path }` as `InstalledRuntime`
11. All errors caught via `Effect.catchAll` and wrapped in `RuntimeInstallError`

### Package Manager Setup (setupPackageManager)

Called in `main.ts` after all runtimes are installed:

**npm:**

- Compare current version (`npm --version`) with required version
- If different: `sudo npm install -g npm@{version}` on Linux/macOS, `npm install -g` on Windows
- Fix npm cache ownership after sudo (`chown -R` on `~/.npm`)

**pnpm/yarn:**

- Check Node.js major version; if >= 25, install corepack globally first
  (`sudo npm install -g --force corepack@latest`)
- Enable corepack: `corepack enable`
- Prepare package manager: `corepack prepare {pm}@{version} --activate`
- For pnpm: run from `tmpdir()` to avoid workspace interference

**bun/deno:**

- No setup needed (they are their own package manager)

### installBiome

Biome installation in `main.ts`:

1. Look up binary name from `binaryMap[platform][arch]`
2. Construct URL with URL-encoded scope: `%40biomejs%2Fbiome%40{version}`
3. Download: `toolInstaller.download(url)`
4. Cache single file: `toolInstaller.cacheFile(downloadedPath, finalName, "biome", version)`
5. Add to PATH: `outputs.addPath(cachedDir)`
6. Entire operation wrapped in `Effect.catchAll` for non-fatal behavior

### Dependency Installation (installDependencies)

Lockfile-aware install command per package manager:

| PM | Has Lockfile | Command |
| --- | --- | --- |
| npm | Yes | `npm ci` |
| npm | No | `npm install` |
| pnpm | Yes | `pnpm install --frozen-lockfile` |
| pnpm | No | `pnpm install` |
| yarn | Yes | `yarn install --immutable` |
| yarn | No | `yarn install --no-immutable` |
| bun | Yes | `bun install --frozen-lockfile` |
| bun | No | `bun install` |
| deno | -- | Skipped (Deno caches automatically) |

Lockfile existence is checked via `FileSystem.access()`.

---

## Testing Strategy

### Descriptor Tests (`__test__/descriptors.test.ts`)

Pure function tests (no Effect layers needed):

- Verify download URLs for each platform/arch combination
- Verify archive type and binSubPath values
- Verify error for unsupported platform (Deno)
- Verify Biome binary map completeness

### RuntimeInstaller Tests (`__test__/runtime-installer.test.ts`)

Uses `ToolInstaller` and `CommandRunner` mock layers:

- Successful install returns `InstalledRuntime` with correct fields
- Download failure wraps as `RuntimeInstallError`
- Extract failure wraps as `RuntimeInstallError`
- Verify command failure wraps as `RuntimeInstallError`
- `installerLayerFor` returns correct layers for known names
- `installerLayerFor` returns failure layer for unknown names

---

## Future Enhancements

### Short-term

- Add `onFail` field validation: emit a notice when `onFail` is not set on runtime entries
- Support Node.js nightly/canary builds via alternate URL patterns

### Medium-term

- Add support for additional runtimes (e.g., WinterJS, LLRT)
- Cache-aware installation: skip download if tool already in runner tool cache

### Long-term

- Plugin-based descriptor registration for user-defined runtimes
- Parallel runtime installation via `Effect.all` with concurrency

---

## Related Documentation

**Internal Design Docs:**

- [Architecture](./architecture.md) - Overall system design
- [Effect Service Model](./effect-service-model.md) - Service layer patterns

**Source Files:**

- `src/runtime-installer.ts` - Service definition and factory
- `src/descriptors/node.ts` - Node.js descriptor
- `src/descriptors/bun.ts` - Bun descriptor
- `src/descriptors/deno.ts` - Deno descriptor
- `src/descriptors/biome.ts` - Biome binary map
- `src/main.ts` - `setupPackageManager`, `installBiome`, `installDependencies`

---

**Document Status:** Current -- reflects the implemented RuntimeInstaller pattern and all
supported runtimes.

**Next Steps:** Update when new runtimes are added or the descriptor interface changes.
