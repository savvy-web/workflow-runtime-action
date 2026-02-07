# @savvy-web/workflow-runtime-action

## 0.1.2

### Patch Changes

- f83278c: Fix pnpm setup hanging when `configDependencies` present in `pnpm-workspace.yaml`

  Run corepack and package manager setup commands from `os.tmpdir()` instead of the
  project directory to prevent pnpm from eagerly resolving `configDependencies` during
  setup, which can hang indefinitely on first CI run for each ref.

## 0.1.1

### Patch Changes

- 8c5570b: Switch to github-action-builder
