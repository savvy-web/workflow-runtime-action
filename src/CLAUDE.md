# src/CLAUDE.md

Source code architecture, build process, and development guidelines for the workflow-runtime-action.

**See also:** [Root CLAUDE.md](../CLAUDE.md) for repository overview.

## Source Code Architecture

This is a **compiled TypeScript GitHub Action** that bundles TypeScript to JavaScript using `@vercel/ncc`.

### Entry Points

The action has three lifecycle hooks defined in [action.yml](../action.yml):

```yaml
runs:
  using: "node24"
  pre: "dist/pre.js"      # Pre-execution hook
  main: "dist/main.js"    # Main action logic
  post: "dist/post.js"    # Post-execution hook (cache saving)
```

**Source files:**

* **[pre.ts](pre.ts)** → `dist/pre.js` - Logs action inputs (pre-execution)
* **[main.ts](main.ts)** → `dist/main.js` - Main setup logic
* **[post.ts](post.ts)** → `dist/post.js` - Cache saving (post-execution)

### Core Modules

Located in [utils/](utils/):

#### [install-node.ts](utils/install-node.ts)

Node.js version resolution and installation.

* Queries `https://nodejs.org/dist/index.json` for version specs
* Downloads and extracts Node.js tarballs from `https://nodejs.org/dist/v{version}/`
* Handles version files (`.nvmrc`, `.node-version`)
* Supports version specs:
  * `lts/*` → Latest LTS version
  * `20.x` or `20` → Latest 20.x version
  * `24.11.0` → Exact version

**Key functions:**

* `installNode({ version, versionFile })` - Main entry point
* `resolveVersion(versionSpec)` - Resolves version specs to exact versions
* `downloadAndExtract(version)` - Downloads and caches Node.js

#### [install-bun.ts](utils/install-bun.ts)

Bun runtime installation.

* Downloads from GitHub releases (`oven-sh/bun`)
* Extracts platform-specific zip archives
* Cross-platform support (Linux, macOS, Windows)
* Version detection from `package.json` `packageManager` field

**Platform binaries:**

* Linux x64: `bun-linux-x64.zip`
* macOS ARM64: `bun-darwin-aarch64.zip`
* Windows x64: `bun-windows-x64.zip`

#### [install-deno.ts](utils/install-deno.ts)

Deno runtime installation.

* Downloads from GitHub releases (`denoland/deno`)
* Uses Rust target triples for platform detection
* Cross-platform support (Linux, macOS, Windows)
* Version detection from `deno.json`/`deno.jsonc` or `package.json`

**Platform binaries:**

* Linux x64: `deno-x86_64-unknown-linux-gnu.zip`
* macOS ARM64: `deno-aarch64-apple-darwin.zip`
* Windows x64: `deno-x86_64-pc-windows-msvc.zip`

#### [install-biome.ts](utils/install-biome.ts)

Biome CLI installation.

* Downloads binaries from GitHub releases (`biomejs/biome`)
* Detects version from `biome.jsonc` `$schema` field:

  ```json
  {
    "$schema": "https://biomejs.dev/schemas/2.3.6/schema.json"
  }
  ```

* Cross-platform binary selection

**Platform binaries:**

* Linux x64: `biome-linux-x64`
* macOS ARM64: `biome-darwin-arm64`
* Windows x64: `biome-win32-x64.exe`

#### [cache-utils.ts](utils/cache-utils.ts)

Dependency caching with `@actions/cache`.

* Platform-specific cache paths
* Lock file hashing for cache keys
* Restore and save operations
* Supports npm, pnpm, yarn, bun, deno

**Cache paths by package manager:**

* **npm:** `~/.npm`, `**/node_modules`
* **pnpm:** `~/.local/share/pnpm/store`, `**/node_modules`
* **yarn:** `~/.yarn/cache`, `**/.yarn/cache`, `**/node_modules`
* **bun:** `~/.bun/install/cache`, `**/node_modules`
* **deno:** `~/.cache/deno`, `~/.deno`

**Cache key format:**

```text
{packageManager}-{platform}-{arch}-{lockfileHash}
```

### Action Workflow

The main action follows this workflow:

```typescript
// 1. Detect configuration (package.json, version files, configs)
const config = await detectConfiguration();

// 2. Install all detected runtimes (Node.js, Bun, Deno)
for (const runtime of config.runtimes) {
  if (runtime === "node") await installNode({ version, versionFile });
  if (runtime === "bun") await installBun({ version });
  if (runtime === "deno") await installDeno({ version });
}

// 3. Setup package manager (corepack for pnpm/yarn)
await setupPackageManager(packageManager);

// 4. Restore dependency cache
await restoreCache(packageManager);

// 5. Install dependencies (with lockfile detection)
await installDependencies(packageManager);

// 6. Install Biome (optional, from config)
await installBiome(version);

// Post-action: Save cache for next run
await saveCache();
```

## Build Process

### Why @vercel/ncc?

`@vercel/ncc` bundles TypeScript and all dependencies into a single JavaScript file:

* **No node_modules required** - All dependencies bundled
* **Faster action startup** - No dependency installation
* **Deterministic builds** - Same code produces same output
* **ES module support** - Outputs ES2022 with import/export

### Build Script

The build is orchestrated by [../lib/scripts/build.ts](../lib/scripts/build.ts):

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

### Running the Build

```bash
# Build all entry points (pre/main/post)
pnpm build

# This runs: tsx lib/scripts/build.ts
# Which uses @vercel/ncc to bundle TypeScript → JavaScript
```

**Important:** The `dist/` directory is committed to git (required for GitHub Actions).

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

See [../tsconfig.json](../tsconfig.json):

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
import { installNode } from "./utils/install-node.js";
import type { InstallOptions } from "./utils/types.js";

// ❌ Incorrect
import { installNode } from "./utils/install-node";
import type { InstallOptions } from "./utils/types";
```

This ensures imports work correctly with ES modules.

### Node.js Import Protocol

Built-in Node.js modules **must** use the `node:` protocol (enforced by Biome):

```typescript
// ✅ Correct
import { readFile } from "node:fs/promises";
import { platform, arch } from "node:os";
import { join, resolve } from "node:path";

// ❌ Incorrect
import { readFile } from "fs/promises";
import { platform, arch } from "os";
import { join, resolve } from "path";
```

### Type Imports

Separate type imports from value imports (enforced by Biome):

```typescript
// ✅ Correct
import { installNode } from "./install-node.js";
import type { InstallOptions } from "./types.js";

// ❌ Incorrect
import { installNode, InstallOptions } from "./install-node.js";
```

## Development Workflow

### 1. Make Changes

Edit TypeScript files in `src/` or `src/utils/`:

```bash
vim src/utils/install-node.ts
```

### 2. Run Type Checking

```bash
pnpm typecheck
```

### 3. Run Tests

See [../**tests**/CLAUDE.md](../__tests__/CLAUDE.md) for testing documentation.

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

Push to trigger GitHub Actions workflows (see [../**fixtures**/CLAUDE.md](../__fixtures__/CLAUDE.md)):

```bash
git push
```

Watch the workflow runs to verify the changes work in the real GitHub Actions environment.

## Lockfile Intelligence

The action checks for lock files before using frozen/immutable flags:

```typescript
case "npm":
  command = existsSync("package-lock.json") ? ["ci"] : ["install"];
  break;

case "pnpm":
  command = existsSync("pnpm-lock.yaml")
    ? ["install", "--frozen-lockfile"]
    : ["install"];
  break;

case "yarn":
  command = existsSync("yarn.lock")
    ? ["install", "--immutable"]
    : ["install", "--no-immutable"];  // Yarn 4+ needs explicit flag
  break;

case "bun":
  command = existsSync("bun.lockb")
    ? ["install", "--frozen-lockfile"]
    : ["install"];
  break;
```

**Important:** Yarn 4+ automatically enables immutable mode in CI environments, so we must explicitly use `--no-immutable` when no lock file exists.

## Package Manager Setup

* **npm** - Already included with Node.js
* **pnpm** - Installed via corepack (`corepack prepare pnpm@latest`)
* **yarn** - Installed via corepack (`corepack prepare yarn@stable`)
* **bun** - Installed via [install-bun.ts](utils/install-bun.ts)
* **deno** - Installed via [install-deno.ts](utils/install-deno.ts)

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

Or rely on pre-commit hooks (automatically run by Husky).

### 4. Use Explicit Types

Always export functions with explicit return types:

```typescript
// ✅ Correct
export async function installNode(options: InstallOptions): Promise<void> {
  // ...
}

// ❌ Incorrect (implicit return type)
export async function installNode(options: InstallOptions) {
  // ...
}
```

### 5. Prefer `type` Over `interface`

Use `type` for type definitions (enforced by Biome):

```typescript
// ✅ Correct
export type InstallOptions = {
  version: string;
  versionFile: string;
};

// ❌ Incorrect
export interface InstallOptions {
  version: string;
  versionFile: string;
}
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

### Platform-specific issues

**Cause:** Platform detection or binary naming mismatch

**Solution:** Check platform mappings in `install-*.ts` files:

* Verify OS detection: `process.platform` → `linux`, `darwin`, `win32`
* Verify arch detection: `process.arch` → `x64`, `arm64`
* Check binary naming conventions for each runtime

## Related Documentation

* [Root CLAUDE.md](../CLAUDE.md) - Repository overview
* [**tests**/CLAUDE.md](../__tests__/CLAUDE.md) - Unit testing strategy
* [**fixtures**/CLAUDE.md](../__fixtures__/CLAUDE.md) - Integration testing
* [@vercel/ncc Documentation](https://github.com/vercel/ncc) - Bundler documentation
* [GitHub Actions Documentation](https://docs.github.com/en/actions/creating-actions/creating-a-javascript-action) - Creating JavaScript actions
