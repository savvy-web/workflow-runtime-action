---
"@savvy-web/github-private": minor
---

feat: implement Phase 1 of custom release workflow with TypeScript actions

Implements the foundation for a comprehensive release management workflow using TypeScript actions executed via `actions/github-script@v8`. This replaces portions of the standard `changesets/action` with more controlled, validated release flows.

## Phase 1: Release Branch Management Actions

* `detect-publishable-changes.ts` - Detects packages with valid `publishConfig.access` from changeset status
* `check-release-branch.ts` - Checks if release branch and open PR exist
* `create-release-branch.ts` - Creates release branch, runs changeset version, creates PR with retry logic
* `update-release-branch.ts` - Merges main into release branch, handles conflicts, updates versions
* `validate-builds.ts` - Runs master build command, parses errors, creates file-level annotations

## Key Features

* TypeScript-first architecture with full type safety
* GitHub Checks API integration for PR visibility
* GitHub Actions job summaries using `core.summary` API
* Exponential backoff retry logic for network operations
* Dry-run mode support for testing
* Comprehensive error handling with user-friendly messages
* Merge conflict detection with resolution instructions
* Package manager agnostic (pnpm, npm, yarn, bun)

## Testing

* 96% code coverage across all Phase 1 actions
* 167 total tests passing (58 new tests for Phase 1 actions)
* Comprehensive test suites for all 5 actions:
  * `detect-publishable-changes.ts` - 31 tests
  * `check-release-branch.ts` - 16 tests
  * `create-release-branch.ts` - 14 tests
  * `update-release-branch.ts` - 19 tests
  * `validate-builds.ts` - 25 tests
* Tests cover happy paths, error handling, edge cases, package managers, and dry-run mode

## Infrastructure Updates

* Fixed Turbo 2.x configuration compatibility (removed deprecated fields)
* Added comprehensive test suite with mocking patterns
