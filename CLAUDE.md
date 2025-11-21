# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This repository provides a **comprehensive Node.js runtime setup GitHub Action** that handles environment configuration, package manager detection, dependency caching, and Turbo build cache setup.

**Primary purpose:** Simplify Node.js CI/CD workflows with a single, well-tested action that works out of the box with smart defaults.

**Technical stack:**

* **Package manager:** pnpm 10.20.0 (enforced via `packageManager` field)
* **Build system:** Turborepo with strict environment mode
* **Node.js version:** 24.11.0 (specified in `.nvmrc`)
* **Linting:** Biome 2.3.6 with strict rules
* **Testing:** Vitest 4.0.8 with globals enabled
* **Type checking:** TypeScript with native preview build (`@typescript/native-preview`)
* **Action type:** Traditional GitHub Composite Action (uses `action.yml` in root)

## Action Structure

This is a **traditional GitHub Action** with the main `action.yml` at the repository root. Users reference it like:

```yaml
- uses: savvy-web/workflow-runtime-action@v1
```

The action internally delegates to modular sub-actions in `.github/actions/`:

* **`node/`** - Main Node.js setup orchestration
* **`biome/`** - Biome linter version detection and installation
* **`detect-runtime/`** - JavaScript runtime detection (node/bun/deno)
* **`detect-turbo/`** - Turbo configuration detection
* **`shared/`** - Shared TypeScript types

## Common Commands

### Linting and Formatting

```bash
# Run Biome checks (no auto-fix)
pnpm lint

# Run Biome with auto-fix (safe fixes only)
pnpm lint:fix

# Run Biome with unsafe fixes (use with caution)
pnpm lint:fix:unsafe

# Lint markdown files
pnpm lint:md

# Fix markdown files
pnpm lint:md:fix
```

### Type Checking

```bash
# Run type checking
pnpm typecheck

# This runs: turbo run typecheck:all --log-prefix=none
# Which executes: tsgo --noEmit
```

**Note:** `tsgo` is a wrapper for the TypeScript native preview build. It's invoked via Turbo for caching.

### Testing

```bash
# Run tests once
pnpm test

# Run tests with CI reporter
pnpm ci:test

# Run in watch mode
pnpm test --watch
```

### Git Workflow

```bash
# Prepare changeset for release
pnpm ci:version
# This runs: changeset version && biome format --write .
```

### Pre-commit Hooks

The repository uses Husky with lint-staged for pre-commit validation. When you commit:

1. **Staged files are automatically processed:**
   * `package.json` files are sorted with `sort-package-json` and formatted with Biome
   * TypeScript/JavaScript files are checked and fixed with Biome
   * Markdown files are linted and fixed with `markdownlint-cli2`
   * Shell scripts have executable bits removed (`chmod -x`)
   * YAML files are formatted with Prettier and validated with `yaml-lint`
   * TypeScript changes trigger a full typecheck with `tsgo --noEmit`

2. **Hooks are skipped in:**
   * CI environments (`GITHUB_ACTIONS=1`)
   * During rebase/squash operations (except final commit)

3. **Git client compatibility:**
   * Pre-commit hook re-execs with zsh for GUI clients (GitKraken)
   * Sources `.zshenv` and NVM to ensure pnpm is available

## Code Quality Standards

### Biome Configuration

The project enforces strict Biome rules (see `biome.jsonc`):

* **Indentation:** Tabs, width 2
* **Line width:** 120 characters
* **Import organization:** Lexicographic order with `source.organizeImports`
* **Import extensions:** Forced `.js` extensions (`useImportExtensions`)
* **Import types:** Separated type imports (`useImportType` with `separatedType` style)
* **Node.js imports:** Must use `node:` protocol (`useNodejsImportProtocol`)
* **Type definitions:** Prefer `type` over `interface` (`useConsistentTypeDefinitions`)
* **Explicit types:** Required for exports (`useExplicitType` - except in tests/scripts)
* **No import cycles:** Enforced (`noImportCycles`)
* **No unused variables:** Error level with `ignoreRestSiblings: true`

### TypeScript Configuration

Base `tsconfig.json` settings:

* **Module system:** ESNext with bundler resolution
* **Target:** ES2022
* **Strict mode:** Enabled
* **Library:** ES2022
* **JSON imports:** Enabled (`resolveJsonModule`)
* **Global types:** Vitest globals available

### Markdown Linting

* Uses `markdownlint-cli2` with `.markdownlint.json` config
* Excludes `node_modules` and `dist` directories

### Commit Message Standards

* **Format:** Conventional Commits (enforced via commitlint)
* **Config:** `@commitlint/config-conventional` with extended body length (300 chars)
* **Validation:** Both PR titles and individual commit messages are validated in CI

## File Naming Conventions

Based on Biome configuration and common patterns:

* **Lowercase filenames:** Preferred (inferred from strict linting)
* **Extensions:** Always use explicit `.js` extensions in imports
* **Config files:** `.jsonc` for JSON with comments (e.g., `biome.jsonc`)
* **TypeScript:** `.ts` for source, `.test.ts` for tests

## Turborepo Configuration

From `turbo.json`:

* **Daemon:** Enabled for faster builds
* **Environment mode:** Strict (only declared env vars are available)
* **Global passthrough env vars:** `GITHUB_ACTIONS`, `GITHUB_OUTPUT`
* **Tasks:**
  * `//#typecheck:all` - Root-level typecheck task (cached, errors-only logs)
  * `typecheck` - Package-level task (depends on root typecheck, not cached)

## Project Structure

```text
.
├── .github/                 # GitHub configuration
│   ├── actions/            # Modular sub-actions
│   │   ├── biome/         # Biome version detection
│   │   ├── detect-runtime/ # Runtime detection
│   │   ├── detect-turbo/  # Turbo detection
│   │   ├── node/          # Main Node.js setup
│   │   └── shared/        # Shared TypeScript types
│   └── workflows/          # CI/CD workflows
│       ├── claude.yml     # Claude Code integration
│       ├── release.yml    # Release automation
│       └── validate.yml   # PR validation
├── __tests__/              # Vitest test files
│   ├── detect-biome-version.test.ts
│   ├── detect-runtime.test.ts
│   ├── detect-turbo.test.ts
│   ├── setup-node.test.ts
│   └── utils/             # Test utilities
├── action.yml              # Main action definition (root)
├── biome.jsonc             # Biome linter/formatter config
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── turbo.json              # Turborepo configuration
└── vitest.config.ts        # Vitest test configuration
```

## TypeScript Action Development

This action uses TypeScript for detection logic, leveraging `actions/github-script@v8` for execution. This approach provides:

* Type safety via TypeScript
* No compilation step needed (TypeScript runs directly)
* Access to GitHub context and APIs
* Better testability with Vitest

### Action Structure Pattern

Each sub-action follows this pattern:

```text
.github/actions/action-name/
├── action.yml              # Action definition with inputs/outputs
├── script-name.ts         # TypeScript logic
├── CLAUDE.md              # Claude-specific guidance
└── README.md              # User documentation
```

### TypeScript Script Pattern

Scripts use a default export function:

```typescript
import type { Core } from "../shared/types.js";

export default async function myAction({ core }: { core: Core }) {
  // Action logic here
  core.setOutput("result", "value");
}
```

### Action YAML Pattern

Actions call TypeScript via `actions/github-script@v8`:

```yaml
runs:
  using: "composite"
  steps:
    - name: Run detection logic
      id: detect
      uses: actions/github-script@v8
      with:
        script: |
          const { default: myAction } = await import('./src/script-name.ts');
          await myAction({ core });
```

### Testing Pattern

Tests use Vitest with mocked GitHub context:

```typescript
import { describe, expect, it, vi } from "vitest";
import myAction from "../.github/actions/action-name/script-name.js";
import { createMockCore } from "./utils/github-mocks.js";

describe("myAction", () => {
  it("should detect configuration", async () => {
    const core = createMockCore();
    await myAction({ core });
    expect(core.setOutput).toHaveBeenCalledWith("result", "value");
  });
});
```

## Running Single Tests

```bash
# Run specific test file
pnpm test __tests__/setup-node.test.ts

# Run tests with watch mode
pnpm test --watch

# Run tests with coverage
pnpm test --coverage
```

## Modifying Actions

When modifying the action:

1. **Read relevant files first** - Understand existing code before making changes
2. **Update TypeScript scripts** in `.github/actions/*/` directories
3. **Update action.yml** if inputs/outputs change
4. **Add/update tests** in `__tests__/` directory
5. **Run tests** to ensure nothing breaks: `pnpm test`
6. **Update documentation** (README.md, action READMEs, CLAUDE.md)
7. **Test in a real workflow** before releasing

### Example: Adding a New Input

1. Add input to `action.yml`:

```yaml
inputs:
  new-option:
    description: "Description of new option"
    required: false
    default: "default-value"
```

1. Update TypeScript script to read the input:

```typescript
const newOption = process.env.INPUT_NEW_OPTION || "default-value";
```

1. Add tests for new functionality
2. Update README with new input documentation

## Environment Variables

The repository uses strict environment mode in Turbo. When adding new environment variables:

1. Declare them in `turbo.json` under `globalPassThroughEnv` or task-specific `env`
2. Document them in README if user-facing

## Custom Claude Commands

Available slash commands in `.claude/commands/`:

* `/lint` - Fix linting errors
* `/typecheck` - Fix TypeScript errors
* `/tsdoc` - Add/update TSDoc documentation

## Important Notes

1. **Never commit secrets:** The repository excludes `.env` and credentials files from git
2. **Shell scripts are not executable:** `chmod -x` is enforced via lint-staged to prevent permission issues
3. **Biome is authoritative:** All formatting decisions defer to Biome configuration
4. **Changesets for versioning:** Use changesets for version management
5. **Action path references:** Sub-actions use relative paths (e.g., `./../detect-turbo`) since this is a single repository
6. **Traditional action structure:** The root `action.yml` makes this action easy to consume from other repositories
7. **Test all changes:** Always run `pnpm test` before committing
8. **Dependency installation is optional:** The action supports `install-deps: false` for custom installation workflows

## Release Process

This action uses Changesets for release management:

1. **Create a changeset** when making changes:

```bash
pnpm changeset
```

1. **Changesets workflow** automatically:
   * Creates/updates release PR
   * Updates version in `package.json`
   * Updates `CHANGELOG.md`
   * Creates GitHub releases with tags

2. **Users reference by tag:**

```yaml
- uses: savvy-web/workflow-runtime-action@v1
- uses: savvy-web/workflow-runtime-action@v1.2.3
- uses: savvy-web/workflow-runtime-action@main
```

## Testing the Action

### Local Testing

```bash
# Run all tests
pnpm test

# Run specific test
pnpm test __tests__/setup-node.test.ts

# Run with coverage
pnpm test --coverage
```

### Testing in CI

The action tests itself via `.github/workflows/validate.yml`:

* Runs on every PR
* Validates code quality, types, and tests
* Uses the action itself to set up the environment

### Testing in Another Repository

Reference your branch when testing:

```yaml
- uses: savvy-web/workflow-runtime-action@your-branch-name
```

## Common Issues and Solutions

### Action path errors

**Issue:** `Error: Unable to resolve action`

**Solution:** Ensure relative paths in sub-actions are correct (e.g., `./../detect-turbo`)

### TypeScript import errors

**Issue:** `Cannot find module`

**Solution:** Ensure imports use `.js` extensions even for `.ts` files (ESM requirement)

### Test failures

**Issue:** Tests fail after modifying action logic

**Solution:**

1. Check mocked outputs match actual implementation
2. Verify `createMockCore()` provides expected methods
3. Run `pnpm typecheck` to catch type errors

### Biome formatting

**Issue:** Pre-commit hook fails with formatting errors

**Solution:** Run `pnpm lint:fix` before committing

## Contributing

This action is part of Savvy Web Systems' open-source toolkit and will eventually be open-sourced.

When contributing:

1. Follow existing code patterns
2. Add comprehensive tests
3. Update documentation
4. Create a changeset for version tracking
5. Ensure all CI checks pass
