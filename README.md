# Savvy Web Systems - GitHub Actions & Workflows

Private repository for shared GitHub Actions, reusable workflows, and project automation

This repository provides centralized GitHub automation tooling for all Savvy Web Systems projects, including:

* **Composite Actions** - Reusable setup and utility actions
* **Reusable Workflows** - Standardized CI/CD patterns
* **Project Automation** - Organization-wide issue/PR routing
* **Claude Integration** - AI-assisted code review and support

## Quick Start

### Using the Node.js Setup Action

The most commonly used action in this repository. It handles Node.js setup, package manager configuration, and dependency caching.

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: savvy-web/.github-private/.github/actions/node@main
        with:
          package_manager: pnpm
          turbo_token: ${{ secrets.TURBO_TOKEN }}
          turbo_team: ${{ vars.TURBO_TEAM }}

      - run: pnpm test
      - run: pnpm build
```

**Features:**

* Auto-detects Node.js version from `.nvmrc` or `.node-version`
* Configures package manager (pnpm, yarn, or npm) with caching
* Sets up Turbo remote caching (local + optional Vercel)
* Validates environment and provides debug info

**Common Input Configurations:**

```yaml
# Use default settings (pnpm, auto-detect Node version)
- uses: savvy-web/.github-private/.github/actions/node@main

# Specify package manager and Node version
- uses: savvy-web/.github-private/.github/actions/node@main
  with:
    package_manager: yarn
    node-version: '20.x'

# Enable Turbo remote caching
- uses: savvy-web/.github-private/.github/actions/node@main
  with:
    package_manager: pnpm
    turbo_token: ${{ secrets.TURBO_TOKEN }}
    turbo_team: ${{ vars.TURBO_TEAM }}
```

See [Node Action Documentation](./.github/actions/node/README.md) for all available inputs.

## Available Workflows

### PR Validation

Comprehensive pull request validation with linting, testing, and automated code review.

```yaml
# .github/workflows/validate.yml
name: Validate PR

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  validate:
    uses: savvy-web/.github-private/.github/workflows/validate.yml@main
    secrets: inherit
```

**What it checks:**

* PR title format (Conventional Commits)
* Commit message format
* Code quality (Biome linting)
* Type checking (TypeScript)
* Tests
* Automated Claude Code review

**Required Secrets:**

* `APP_ID` / `APP_PRIVATE_KEY` - GitHub App for check runs
* `CLAUDE_CODE_OAUTH_TOKEN` - Claude Code integration
* `CLAUDE_REVIEW_PAT` - Personal access token for review operations

### Claude Code Integration

Enable `@claude` mentions in issues and PRs for AI assistance.

```yaml
# .github/workflows/claude.yml
name: Claude Code

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  pull_request_review:
    types: [submitted]
  issues:
    types: [opened, assigned]

jobs:
  claude:
    uses: savvy-web/.github-private/.github/workflows/claude.yml@main
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

**Usage:** Mention `@claude` in any issue or PR comment to get assistance.

### Automated Release Management

Manage releases using Changesets with automatic versioning and changelog generation.

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  release:
    uses: savvy-web/.github-private/.github/workflows/release.yml@main
    secrets: inherit
```

**How it works:**

1. Detects changesets in `.changeset/*.md`
2. Creates/updates a release PR with version bumps
3. Generates changelog entries
4. Creates GitHub releases when PR is merged

**Required Secrets:**

* `APP_ID` / `APP_PRIVATE_KEY` - GitHub App for commits
* `NPM_TOKEN` - (Optional) For publishing to npm

### Organization Issue Routing

**For organization administrators:** Automatically route issues and PRs to GitHub Projects across all repositories.

**Setup (in `.github-private` repository):**

```yaml
# .github/workflows/org-issue-router.yml
name: Route Issues to Projects

on:
  issues:
    types: [opened, reopened]
  pull_request:
    types: [opened, reopened]

jobs:
  route:
    uses: savvy-web/.github-private/.github/workflows/org-issue-router.yml@main
    secrets: inherit
```

**Configure target repositories:**

Set custom properties on each repository:

* `project-tracking` (boolean) - Enable auto-routing: `true`
* `project-number` (string) - Organization project number: `"1"`
* `client-id` (string, optional) - For client-specific routing

**Access:** Settings → Custom properties (organization level)

### Project Listener (Reusable)

Alternative to org-issue-router for single-repository setups.

```yaml
jobs:
  add-to-project:
    uses: savvy-web/.github-private/.github/workflows/project-listener.yml@main
    secrets: inherit
```

## GitHub App Setup

Most workflows require a GitHub App for authentication (preferred over PATs).

**Required App Permissions:**

**Repository:**

* Actions: Read
* Checks: Read & Write
* Contents: Read & Write
* Issues: Read & Write
* Pull Requests: Read & Write

**Organization:**

* Projects: Read & Write

**Configure Secrets:**

```bash
# Organization or repository secrets
APP_ID=123456
APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
CLAUDE_CODE_OAUTH_TOKEN="oauth_token_here"
CLAUDE_REVIEW_PAT="github_pat_..."
TURBO_TOKEN="vercel_token_here"  # Optional
```

**Configure Variables:**

```bash
# Organization or repository variables
TURBO_TEAM="team-slug"  # Optional
```

## Common Patterns

### Basic CI Workflow

```yaml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: savvy-web/.github-private/.github/actions/node@main
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

### Monorepo CI with Turbo

```yaml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: savvy-web/.github-private/.github/actions/node@main
        with:
          package_manager: pnpm
          turbo_token: ${{ secrets.TURBO_TOKEN }}
          turbo_team: ${{ vars.TURBO_TEAM }}

      - name: Build
        run: pnpm turbo build

      - name: Test
        run: pnpm turbo test

      - name: Lint
        run: pnpm turbo lint
```

### Full PR Workflow

```yaml
name: PR Validation

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  # Use the shared validation workflow
  validate:
    uses: savvy-web/.github-private/.github/workflows/validate.yml@main
    secrets: inherit

  # Add custom checks
  custom:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: savvy-web/.github-private/.github/actions/node@main
      - run: pnpm custom-check
```

## Repository Structure

```text
.github/
├── actions/
│   └── node/              # Node.js setup action
│       ├── action.yml     # Action definition
│       └── README.md      # Detailed documentation
└── workflows/
    ├── claude.yml         # Claude Code integration
    ├── org-issue-router.yml  # Organization-wide routing
    ├── project-listener.yml  # Single-repo routing
    ├── release.yml        # Changesets release automation
    └── validate.yml       # PR validation reference
```

## Contributing

This is a private repository for Savvy Web Systems internal use.

**Adding new actions or workflows:**

1. Create in appropriate directory (`.github/actions/` or `.github/workflows/`)
2. Add comprehensive documentation
3. Test in a real repository
4. Create a changeset: `pnpm changeset`
5. Submit PR with examples

**Testing changes:**

Reference your branch when testing:

```yaml
- uses: savvy-web/.github-private/.github/actions/node@your-branch
```

## Support

* **Issues:** Report bugs or request features via GitHub Issues
* **Claude Assistance:** Mention `@claude` in issues/PRs (if enabled)
* **Internal:** Contact the DevOps team

## License

Private - Savvy Web Systems © 2024
