# @savvy-web/workflow-runtime-action

## 0.1.6

### Bug Fixes

* [`7f4fb75`](https://github.com/savvy-web/workflow-runtime-action/commit/7f4fb753ce138a762c2c1511d74662fed2973051) Supports @savvy-web/vitest

## 0.1.5

### Patch Changes

* 33ff69f: ## Dependencies
  * @savvy-web/commitlint: ^0.3.1 → ^0.3.2

## 0.1.4

### Patch Changes

* d8b212c: Update dependencies:

  **Dependencies:**

  * @savvy-web/github-action-builder: ^0.1.1 → ^0.1.2
  * @savvy-web/lint-staged: ^0.3.1 → ^0.4.0

## 0.1.3

### Patch Changes

* 667b520: Update dependencies:

  **Dependencies:**

  * @savvy-web/commitlint: ^0.3.0 → ^0.3.1
  * @savvy-web/github-action-builder: ^0.1.0 → ^0.1.1

## 0.1.2

### Patch Changes

* f83278c: Fix pnpm setup hanging when `configDependencies` present in `pnpm-workspace.yaml`

  Run corepack and package manager setup commands from `os.tmpdir()` instead of the
  project directory to prevent pnpm from eagerly resolving `configDependencies` during
  setup, which can hang indefinitely on first CI run for each ref.

## 0.1.1

### Patch Changes

* 8c5570b: Switch to github-action-builder
