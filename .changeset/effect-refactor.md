---
"@savvy-web/workflow-runtime-action": minor
---

## Features

Rewrite action internals from imperative TypeScript to Effect-based programs using `@savvy-web/github-action-effects` 0.11.x.

- **Zero `@actions/*` dependencies**: The effects library implements the GitHub Actions runtime protocol natively (V2 Twirp caching, native process execution, workflow commands). No CJS/ESM interop issues, no bundler hacks.
- **Effect architecture**: Two entry points (main.ts, post.ts) as Effect pipelines with typed errors, dependency injection via layers, and schema-validated configuration.
- **RuntimeInstaller service**: Shared service with per-runtime descriptor layers (Node.js, Bun, Deno) using ToolInstaller primitives (download, extract, cache, addPath).
- **Biome binary install**: Direct download via ToolInstaller.cacheFile for raw binary tools.
- **Schema validation**: All `devEngines` configuration validated through Effect Schema with `RuntimeEntry`/`PackageManagerEntry` literal name types.
- **Cache module**: Battle-tested cache key generation with V2 Twirp protocol for save/restore, typed cross-phase state transfer via ActionState.
- **Inputs via Effect Config API**: `Config.string`, `Config.boolean`, `Config.withDefault` backed by the GitHub Actions input ConfigProvider.
- **Build toolchain**: rsbuild via `@savvy-web/github-action-builder` 0.5.0. Clean ESM output, no eval("require"), no CJS chunks.
- **Testing**: 203 unit tests with Effect test layers imported from `/testing` subpath. No `vi.mock` needed.
- **Multi-format input parsing**: `additional-lockfiles` and `additional-cache-paths` accept newlines, bullets, commas, or JSON arrays.
- **Platform support**: Full support for Ubuntu, macOS, and Windows runners with platform-aware PATH handling and tar extraction.

## Breaking Changes

- Remove explicit version inputs (`node-version`, `bun-version`, `deno-version`, `package-manager`, `package-manager-version`). All configuration now comes exclusively from `package.json` `devEngines` fields.
- Remove `pre` action hook (collapsed into main).
- Require `devEngines.packageManager` and `devEngines.runtime` in `package.json`.
