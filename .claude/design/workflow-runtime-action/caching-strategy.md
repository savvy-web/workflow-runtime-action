---
status: current
module: workflow-runtime-action
category: performance
created: 2026-03-21
updated: 2026-03-21
last-synced: 2026-03-21
completeness: 90
related:
  - ./architecture.md
  - ./effect-service-model.md
dependencies: []
---

# Caching Strategy

Dependency and runtime caching: key generation, multi-package-manager support, lockfile detection,
cache path resolution, and cross-phase state management.

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

The action provides automatic dependency caching that works across all supported package managers
(npm, pnpm, yarn, bun, deno) and runtimes (Node.js, Bun, Deno). Cache keys are deterministic,
based on runtime versions, package manager version, branch, and lockfile contents. The system uses
the GitHub Actions V2 Twirp cache protocol via `ActionCache` and persists cache state between
the main and post actions via `ActionState`.

**Key Features:**

- Automatic lockfile detection per package manager
- Dynamic cache path detection by querying installed package managers
- Platform-specific fallback paths when detection fails
- Tool cache inclusion for installed runtimes
- Multi-package-manager deduplication for multi-runtime setups
- Restore key fallback chain (branch-specific, then version-only)
- User-extensible via `additional-lockfiles` and `additional-cache-paths` inputs
- Cache bust mode for testing

**When to reference this document:**

- When debugging cache key generation or cache misses
- When adding support for a new package manager
- When understanding the restore/save lifecycle
- When modifying lockfile detection or cache path logic

---

## Current State

### Cache Key Format

```text
{platform}-{versionHash}-{branchHash}-{lockfileHash}
```

Example: `linux-abc12345-def67890-ghi11223`

**Components:**

| Component | Source | Hash Length |
| --- | --- | --- |
| `platform` | `node:os` `platform()` | Literal (linux, darwin, win32) |
| `versionHash` | SHA256 of sorted runtime versions + PM version + cacheBust | 8 hex chars |
| `branchHash` | SHA256 of branch name | 8 hex chars |
| `lockfileHash` | SHA256 of concatenated lockfile contents | 8 hex chars |

### Restore Key Fallback Chain

| Priority | Pattern | Matches |
| --- | --- | --- |
| 1 (primary) | `{plat}-{versionHash}-{branchHash}-{lockfileHash}` | Exact match |
| 2 (branch) | `{plat}-{versionHash}-{branchHash}-` | Same branch, any lockfile content |
| 3 (version) | `{plat}-{versionHash}-` | Any branch, same runtime versions |

When `cacheBust` is set, restore keys are empty (forces exact match for testing).

### Lockfile Patterns by Package Manager

| Package Manager | Patterns |
| --- | --- |
| npm | `**/package-lock.json`, `**/npm-shrinkwrap.json` |
| pnpm | `**/pnpm-lock.yaml`, `**/pnpm-workspace.yaml`, `**/.pnpmfile.cjs` |
| yarn | `**/yarn.lock`, `**/.pnp.cjs`, `**/.yarn/install-state.gz` |
| bun | `**/bun.lock`, `**/bun.lockb` |
| deno | `**/deno.lock` |

### Cache Paths by Package Manager

Each package manager has:

1. **Global cache directory** (detected dynamically, with platform-specific fallback)
2. **Additional dependency paths** (`**/node_modules`, Yarn-specific PnP paths)
3. **Tool cache paths** for installed runtimes (`/opt/hostedtoolcache/{runtime}/{version}`)

Detection commands:

| PM | Command | Fallback (Linux/macOS) | Fallback (Windows) |
| --- | --- | --- | --- |
| npm | `npm config get cache` | `~/.npm` | `~/AppData/Local/npm-cache` |
| pnpm | `pnpm store path` | `~/.local/share/pnpm/store` | `~/AppData/Local/pnpm/store` |
| yarn | `yarn config get cacheFolder` | `~/.yarn/cache` | `~/AppData/Local/Yarn/Cache` |
| bun | `bun pm cache` | `~/.bun/install/cache` | `~/AppData/Local/bun/install/cache` |
| deno | `deno info --json` (denoDir) | `~/.cache/deno` | `~/AppData/Local/deno` |

---

## Rationale

### Why Not @actions/cache

The `@actions/cache` package has heavy transitive dependencies and version conflicts.
`@savvy-web/github-action-effects` implements the V2 Twirp cache protocol natively with Azure Blob
Storage, providing the same functionality without the dependency burden.

### Why Not PackageManagerAdapter

The `PackageManagerAdapter` from `github-action-effects` detects from the `packageManager` field
in `package.json`, not `devEngines`. Since this action reads from `devEngines.packageManager`
exclusively, using the adapter would create a detection mismatch. Instead, `cache.ts` implements
its own cache path resolution and lockfile detection.

### Why 8-Character Hash Truncation

Full SHA256 hashes are 64 characters, making cache keys unwieldy in logs. 8 hex characters provide
4.3 billion possibilities (16^8). The birthday paradox gives 50% collision probability at ~65,000
entries -- negligible for a single repository's cache.

### Why Branch in Cache Key

Including the branch hash prevents cache pollution between branches. A feature branch with
modified dependencies should not restore a stale cache from `main`. The fallback chain still
allows version-only matching (priority 3) when no branch-specific cache exists.

### Why Separate Restore Keys for Testing

When `cacheBust` is set, restore keys are empty. This forces exact-match-only cache behavior,
ensuring each test run creates a fresh cache entry rather than restoring a partial match from
a previous test. The `cacheBust` value is also included in the version hash, making each test
run's primary key unique.

---

## Implementation Details

### Active Package Manager Detection

`getActivePackageManagers()` determines which package managers to cache for:

- If a runtime is `node`, the primary package manager (from `devEngines.packageManager`) is active
- If a runtime is `bun`, `bun` is active as a package manager
- If a runtime is `deno`, `deno` is active as a package manager

For multi-runtime setups (e.g., Node + Deno), cache paths from both package managers are merged
and deduplicated.

### Cache Path Merging

`getCombinedCacheConfig()` merges cache configurations:

1. For each active package manager, run `getCacheConfig(pm)` to get dynamic cache path + lockfiles
2. Deduplicate all paths using a `Set`
3. Add tool cache paths for all installed runtimes (including Biome if detected)
4. Sort paths: absolute paths first, then glob patterns
5. Merge additional user-specified paths from `additional-cache-paths` input
6. Add `**/.turbo` if Turbo is detected

### Lockfile Detection

`findLockFiles()` does not use `@actions/glob`. Instead, it:

1. Takes glob patterns (e.g., `**/pnpm-lock.yaml`)
2. Strips the `**/` prefix to get the concrete filename
3. Checks each filename at the workspace root via `FileSystem.access()`
4. Returns the list of existing filenames

This simple approach works because lockfiles are always at the repository root for standard
projects. The glob patterns are preserved in the configuration for documentation and potential
future deep-scanning.

### Cross-Phase State

The main action saves cache state via `ActionState.save("CACHE_STATE", data, CacheStateSchema)`:

```typescript
{
  hit: "exact" | "partial" | "none",
  key: string,        // The primary cache key
  paths: string[],    // The cache paths
}
```

The post action reads this via `ActionState.get("CACHE_STATE", CacheStateSchema)`:

- If `hit === "exact"`, skip saving (cache is already up to date)
- If `key` or `paths` is missing, skip saving (no cache to save)
- Otherwise, save via `ActionCache.save(paths, key)`

### Multi-Value Input Parsing

The `additional-lockfiles` and `additional-cache-paths` inputs support multiple formats:

1. Newline-separated
2. Bullet lists (`* item` or `- item`)
3. Comma-separated
4. JSON arrays
5. Single values

`parseMultiValueInput()` in `main.ts` handles all formats uniformly.

---

## Testing Strategy

### Unit Tests (`__test__/cache.test.ts`)

Uses `ActionCache`, `ActionState`, `ActionEnvironment`, `CommandRunner`, and `FileSystem` mock
layers:

- `generateCacheKey` produces correct format and varies by input
- `generateRestoreKeys` produces fallback chain and empty when cacheBust set
- `restoreCache` calls `ActionCache.restore` and saves state
- `restoreCache` returns correct hit status ("exact", "partial", "none")
- `saveCache` reads state and calls `ActionCache.save`
- `saveCache` skips on exact hit
- `getCombinedCacheConfig` merges and deduplicates paths
- `findLockFiles` detects existing lockfiles

### Integration Tests

Fixture tests in `.github/workflows/test.yml` validate cache behavior across:

- **Create cache** jobs: first run creates cache
- **Restore cache** jobs: second run restores from cache
- Matrix includes npm, pnpm, yarn, bun, and multi-runtime configurations

---

## Future Enhancements

### Short-term

- Support lockfile-less caching by hashing `package.json` when no lockfile exists
- Add cache size reporting in debug logs

### Medium-term

- Workspace-aware lockfile detection (scan subdirectories for monorepos)
- Cache eviction strategies (LRU, time-based)

### Long-term

- Parallel cache restore for multi-package-manager setups
- Cache compression optimization

---

## Related Documentation

**Internal Design Docs:**

- [Architecture](./architecture.md) - Overall system architecture
- [Effect Service Model](./effect-service-model.md) - Service layer patterns

**User Documentation:**

- `docs/CACHING.md` - User-facing caching guide with examples

**Source Files:**

- `src/cache.ts` - All cache logic
- `src/main.ts` - `parseMultiValueInput`, `getActivePackageManagers`

---

**Document Status:** Current -- reflects the implemented caching system with V2 Twirp protocol
and cross-phase state management.

**Next Steps:** Update when cache key format changes or new package managers are added.
