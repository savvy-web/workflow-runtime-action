# Test Fixtures

This directory contains isolated test project setups for integration testing.
Each fixture is a complete, self-contained project that can be copied to a
temporary directory for testing the action.

## Available Fixtures

- **node-minimal** - Basic Node.js project with npm
- **node-pnpm** - Node.js project with pnpm package manager
- **node-yarn** - Node.js project with Yarn package manager
- **bun-minimal** - Basic Bun project
- **bun-workspace** - Bun workspace with multiple packages
- **deno-minimal** - Basic Deno project with deno.json
- **biome-auto** - Project with Biome config for auto-detection testing
- **turbo-monorepo** - Turborepo monorepo setup
- **cache-test** - Project with dependencies for cache effectiveness testing
- **multi-runtime** - Project with both Node.js (pnpm) and Deno configurations

## Usage in Workflows

Test workflows should:
1. Copy the fixture to an isolated temp directory
2. Copy `dist/` and `action.yml` into that directory
3. Run the action from within the isolated directory
4. Verify the expected behavior

This approach ensures true isolation and prevents conflicts with the repository's
own configuration files, lockfiles, and .git directory.
