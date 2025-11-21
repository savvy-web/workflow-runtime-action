# Compiled TypeScript GitHub Actions

This document explains how this repository builds and tests a compiled TypeScript GitHub Action.

## Table of Contents

* [Overview](#overview)
* [Architecture](#architecture)
* [Build Process](#build-process)
* [TypeScript Configuration](#typescript-configuration)
* [Testing](#testing)
* [Development Workflow](#development-workflow)
* [Best Practices](#best-practices)

## Overview

This repository implements a **compiled TypeScript GitHub Action** that:

1. **Uses TypeScript** for type-safe development in `src/`
2. **Compiles to JavaScript** using `@vercel/ncc` bundler
3. **Runs on node24** runtime directly (not github-script)
4. **Bundles all dependencies** into standalone JavaScript files
5. **Commits compiled output** to `dist/` for GitHub Actions to execute

## Architecture

### Entry Points

The action has three lifecycle hooks defined in [action.yml](action.yml):

```yaml
runs:
  using: "node24"
  pre: "dist/pre.js"      # Pre-execution hook
  main: "dist/main.js"    # Main action logic
  post: "dist/post.js"    # Post-execution hook (cache saving)
```

### Source Structure

```text
src/
├── pre.ts              # Pre-action hook (logs inputs)
├── main.ts             # Main action logic
├── post.ts             # Post-action hook (saves cache)
└── utils/
    ├── install-node.ts    # Node.js version resolution & installation
    ├── install-biome.ts   # Biome CLI installation
    └── cache-utils.ts     # Dependency caching logic
```

### Build Output

```text
dist/
├── pre.js              # Bundled pre-action
├── main.js             # Bundled main action (1.3MB)
├── post.js             # Bundled post-action
└── package.json        # ES module marker ({"type": "module"})
```

**Important:** The `dist/` directory is committed to git (required for GitHub Actions).

## Build Process

### Build Script

The build is orchestrated by [lib/scripts/build.ts](lib/scripts/build.ts):

```typescript
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require: NodeJS.Require = createRequire(import.meta.url);
const ncc: NccFunction = require("@vercel/ncc");

const entries: BuildEntry[] = [
  { entry: "src/pre.ts", output: "dist/pre.js" },
  { entry: "src/main.ts", output: "dist/main.js" },
  { entry: "src/post.ts", output: "dist/post.js" },
];

async function buildEntry({ entry, output }: BuildEntry): Promise<void> {
  const { code } = await ncc(resolve(entry), {
    minify: true,
    target: "es2022",
    externals: [],
  });

  await mkdir("dist", { recursive: true });
  await writeFile(output, code);
}

// Build all entries
for (const entry of entries) {
  await buildEntry(entry);
}

// Create package.json to mark dist files as ES modules
await writeFile("dist/package.json", JSON.stringify({ type: "module" }, null, "\t"));
```

### Why @vercel/ncc?

`@vercel/ncc` bundles TypeScript and all dependencies into a single JavaScript file:

* **No node_modules required** - All dependencies bundled
* **Faster action startup** - No dependency installation
* **Deterministic builds** - Same code produces same output
* **ES module support** - Outputs ES2022 with import/export

### ES Module Configuration

The bundled files use ES module syntax (`import`/`export`). To ensure Node.js recognizes them as ES modules, the build script creates `dist/package.json`:

```json
{
  "type": "module"
}
```

Without this file, Node.js emits a warning about module type detection.

## TypeScript Configuration

### Base Configuration

[tsconfig.json](tsconfig.json):

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  }
}
```

**Key Settings:**

* `module: "ESNext"` - Use ES modules
* `moduleResolution: "bundler"` - Resolve imports for bundler (ncc)
* `target: "ES2022"` - Match ncc target
* `noEmit: true` - Don't emit JS (ncc handles compilation)
* `strict: true` - Enable all strict type checking

### Import Extensions

All imports **must** use `.js` extensions (enforced by Biome):

```typescript
// ✅ Correct
import { installNode } from "../src/utils/install-node.js";

// ❌ Incorrect
import { installNode } from "../src/utils/install-node";
```

This ensures imports work correctly with ES modules.

### Node.js Import Protocol

Built-in Node.js modules **must** use the `node:` protocol (enforced by Biome):

```typescript
// ✅ Correct
import { readFile } from "node:fs/promises";
import { platform } from "node:os";

// ❌ Incorrect
import { readFile } from "fs/promises";
import { platform } from "os";
```

## Testing

### Unit Tests with Vitest

All utility modules have comprehensive unit tests using Vitest. See [CLAUDE.md#testing-strategy](CLAUDE.md#testing-strategy) for detailed testing documentation.

#### Test Setup

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import { installNode } from "../src/utils/install-node.js";

// Mock all external dependencies
vi.mock("@actions/core");
vi.mock("@actions/tool-cache");

describe("installNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(core.info).mockImplementation(() => {});
    vi.mocked(tc.find).mockReturnValue("");
  });

  it("should install Node.js", async () => {
    vi.mocked(tc.find).mockReturnValue("/cached/node");

    await installNode({ version: "20.11.0", versionFile: "" });

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining("Found Node.js 20.11.0")
    );
  });
});
```

#### Type-Safe Mocking

**Never use `any` types.** Always use `as unknown as Type`:

```typescript
// ✅ Correct - Type-safe mock
vi.mocked(readdirSync).mockReturnValue(
  ["node-v20.11.0-linux-x64"] as unknown as ReturnType<typeof readdirSync>
);

// ✅ Correct - Class instance mock
vi.mocked(HttpClient).mockImplementation(
  () => ({ get: mockGet }) as unknown as InstanceType<typeof HttpClient>
);

// ❌ Incorrect - Using 'any'
vi.mocked(readdirSync).mockReturnValue(["file.txt"] as any);
```

#### Running Tests

```bash
# Run all tests with coverage
pnpm test

# Run specific test file
pnpm test __tests__/install-node.test.ts

# Watch mode
pnpm test --watch

# View coverage
open coverage/index.html
```

#### Coverage Thresholds

```json
{
  "branches": 85,
  "functions": 90,
  "lines": 90,
  "statements": 90
}
```

Current coverage: **88% branches, ~95%+ functions/lines/statements** ✅

### Integration Tests

In addition to unit tests, the action uses fixture-based integration tests that run in GitHub Actions workflows:

* [.github/workflows/test-fixtures.yml](.github/workflows/test-fixtures.yml) - Tests with different package managers and configurations
* [.github/workflows/test-action.yml](.github/workflows/test-action.yml) - Original test workflow

## Development Workflow

### 1. Make Changes

Edit TypeScript files in `src/`:

```bash
vim src/utils/install-node.ts
```

### 2. Run Type Checking

```bash
pnpm typecheck
```

### 3. Run Tests

```bash
pnpm test
```

### 4. Run Linting

```bash
pnpm lint

# Auto-fix issues
pnpm lint:fix
```

### 5. Build the Action

**Critical:** Always build after making changes:

```bash
pnpm build
```

This compiles TypeScript to `dist/` using @vercel/ncc.

### 6. Commit Source AND Dist

**Both source and compiled output must be committed:**

```bash
git add src/utils/install-node.ts dist/main.js
git commit -m "feat: add version resolution"
```

### 7. Test in CI

Push to trigger GitHub Actions workflows:

```bash
git push
```

Watch the workflow runs to verify the changes work in the real GitHub Actions environment.

## Best Practices

### 1. Always Build Before Committing

**If you forget to build, the action won't work in CI:**

```bash
# Make changes
vim src/main.ts

# Build (REQUIRED!)
pnpm build

# Commit source AND dist
git add src/main.ts dist/main.js
git commit -m "fix: update main logic"
```

### 2. Never Edit dist/ Directly

The `dist/` directory is generated. Always edit `src/` and rebuild:

```bash
# ❌ WRONG
vim dist/main.js

# ✅ CORRECT
vim src/main.ts
pnpm build
```

### 3. Test Before Pushing

Run the full test suite before pushing:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Or use the pre-commit hooks (automatically run by Husky).

### 4. Use Type-Safe Mocking

In tests, always use `as unknown as Type` instead of `any`:

```typescript
// ✅ Type-safe
vi.mocked(tc.find).mockReturnValue("/path" as unknown as ReturnType<typeof tc.find>);

// ❌ Unsafe
vi.mocked(tc.find).mockReturnValue("/path" as any);
```

### 5. Import with Extensions

Always use `.js` extensions in imports:

```typescript
// ✅ Correct
import { installNode } from "./install-node.js";

// ❌ Incorrect
import { installNode } from "./install-node";
```

### 6. Use node: Protocol

Always use `node:` protocol for built-in modules:

```typescript
// ✅ Correct
import { readFile } from "node:fs/promises";

// ❌ Incorrect
import { readFile } from "fs/promises";
```

## Common Issues

### "Changes don't take effect in CI"

**Cause:** You didn't rebuild or commit `dist/`

**Solution:**

```bash
pnpm build
git add dist/
git commit --amend --no-edit
git push --force-with-lease
```

### "Module type warning in CI"

**Cause:** Missing or incorrect `dist/package.json`

**Solution:** Rebuild - the build script creates this file automatically:

```bash
pnpm build
git add dist/package.json
git commit -m "fix: add dist/package.json"
```

### "Import not found" errors

**Cause:** Missing `.js` extension in import

**Solution:**

```typescript
// Add .js extension
import { myFunction } from "./my-module.js";
```

### "Type errors in tests"

**Cause:** Using `any` instead of proper type assertions

**Solution:**

```typescript
// Use as unknown as Type
vi.mocked(myFunc).mockReturnValue(value as unknown as ReturnType<typeof myFunc>);
```

## Additional Resources

* [CLAUDE.md](CLAUDE.md) - Repository overview and development guidelines
* [@vercel/ncc Documentation](https://github.com/vercel/ncc) - Bundler documentation
* [GitHub Actions Documentation](https://docs.github.com/en/actions/creating-actions/creating-a-javascript-action) - Creating JavaScript actions
* [Vitest Documentation](https://vitest.dev/) - Testing framework
