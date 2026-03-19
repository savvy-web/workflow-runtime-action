---
"@savvy-web/workflow-runtime-action": minor
---

## Features 

Rewrite action internals from imperative TypeScript to Effect-based programs

- **Architecture**: Replace async/await with Effect services, layers, and typed error handling via `@savvy-web/github-action-effects`
- **RuntimeInstaller service**: Shared service with per-runtime descriptor layers (Node.js, Bun, Deno, Biome) replacing four separate install modules
- **Schema validation**: All `devEngines` configuration validated through Effect Schema with clear error messages for invalid versions
- **Cache module**: Preserve battle-tested cache key generation logic, now backed by `ActionCache` and `ActionState` services with typed cross-phase state transfer
- **Build toolchain**: Migrate from custom build script to `@savvy-web/github-action-builder` with `action.config.ts` configuration
- **Testing**: Replace manual `@actions/*` mocks with Effect test layers for all 160 unit tests
- **Breaking**: Remove explicit version inputs (`node-version`, `bun-version`, `deno-version`, `package-manager`, `package-manager-version`). All configuration now comes exclusively from `package.json` `devEngines` fields.
- **Breaking**: Remove `pre` action hook (collapsed into main)
