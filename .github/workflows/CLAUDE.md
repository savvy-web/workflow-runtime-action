# .github/workflows/CLAUDE.md

GitHub Actions workflow testing strategy and reusable composite actions.

**See also:** [Root CLAUDE.md](../../CLAUDE.md) |
[**fixtures**/CLAUDE.md](../../__fixtures__/CLAUDE.md) for available test
fixtures.

## Overview

This directory contains GitHub Actions workflows for testing the runtime action
using a **matrix-based testing approach** with a **unified test-fixture
composite action** that handles setup, execution, and verification.

## Test Workflows

### [test.yml](test.yml)

Main test workflow that runs on push and pull requests. Includes comprehensive
test coverage:

* **test-node-create-cache** - Node.js tests creating dependency cache
* **test-node-restore-cache** - Node.js tests restoring from cache
* **test-explicit-inputs** - Tests with explicit runtime version inputs and
  feature detection
* **summary** - Aggregates test results and reports overall status

## Reusable Composite Actions

### [test-fixture](../actions/test-fixture/action.yml)

Complete test workflow that sets up a fixture, runs the runtime action, and
verifies outputs - all in one action.

**Purpose:** Simplify testing by combining fixture setup, action execution,
and output validation into a single reusable action.

**How it works:**

1. **Setup fixture** (Python script):
   * Cleans workspace by removing all files except `.github`, `.git`, and
     `__fixtures__`
   * Copies all files from the fixture directory to the repository root
   * Removes `__fixtures__` directory to prevent glob pattern interference

2. **Run runtime action** - Executes the runtime setup action with provided
   inputs (supports cache testing mode with dual runs)

3. **Verify outputs** (Python script) - Compares actual vs expected values and
   generates summary:
   * ✅ Value matches expectation
   * ✔️ Value reported (no expectation to validate)
   * ❌ Value doesn't match expectation

4. **Fail if mismatches** - Exits with error if any validation fails

**Inputs:**

* `fixture` (required) - Name of the fixture directory in `__fixtures__/`
* `title` (required) - Title for the test results section (including emoji)
* Runtime action inputs (all optional):
  * `node-version`, `bun-version`, `deno-version`
  * `package-manager`, `package-manager-version`
  * `biome-version`, `install-deps`
  * `turbo-token`, `turbo-team`
* Expected values for validation (all optional):
  * `expected-node-version`, `expected-node-enabled`
  * `expected-bun-version`, `expected-bun-enabled`
  * `expected-deno-version`, `expected-deno-enabled`
  * `expected-package-manager`, `expected-package-manager-version`
  * `expected-biome-version`, `expected-biome-enabled`
  * `expected-turbo-enabled`
  * `expected-cache-hit`

**Example usage:**

```yaml
- name: Test PNPM
  uses: ./.github/actions/test-fixture
  with:
    fixture: node-pnpm
    title: "📦 PNPM Test Results"
    expected-package-manager: pnpm
    expected-node-enabled: "true"
```

**Output format:**

```markdown
## 📦 PNPM Test Results

node-version: 20.19.5 ✔️
node-enabled: true ✅
package-manager: pnpm ✅
cache-hit: false ✔️

✅ All validations passed
```

**Why this approach?**

* **Simple** - One action instead of three separate steps
* **Fast** - Files copied in-place, action runs in same directory
* **Isolated** - Repository config removed, only fixture config remains
* **Comprehensive** - Combines setup, execution, and validation
* **Works on all platforms** - No platform-specific path issues

## Matrix-Based Testing Pattern

All test jobs use a matrix strategy to test multiple configurations:

```yaml
test-node:
  name: Node.js - ${{ matrix.name }}
  runs-on: ubuntu-latest
  strategy:
    fail-fast: false
    matrix:
      include:
        - name: NPM
          fixture: node-minimal
          package-manager: npm
          expected-runtime: node
          expected-package-manager: npm
          test-command: "node --version && npm --version"
          title: "📦 NPM Test Results"

        - name: PNPM
          fixture: node-pnpm
          expected-runtime: node
          expected-package-manager: pnpm
          test-command: "node --version && pnpm --version"
          title: "📦 PNPM Test Results"

  steps:
    - name: Checkout
      uses: actions/checkout@v6

    - name: Test fixture
      uses: ./.github/actions/test-fixture
      with:
        fixture: ${{ matrix.fixture }}
        title: ${{ matrix.title }}
        package-manager: ${{ matrix.package-manager || '' }}
        expected-node-enabled: ${{ matrix.expected-node-enabled || '' }}
        expected-package-manager: ${{ matrix.expected-package-manager || '' }}

    - name: Test runtime
      if: matrix.test-command != ''
      run: ${{ matrix.test-command }}
```

## Standard Test Pattern

Every test follows this pattern:

1. **Checkout** - Check out the repository
2. **Test fixture** - Use `test-fixture` action to setup environment, run
   action, and verify outputs
3. **Test runtime** - Run commands to verify runtime is working (optional)
4. **Additional verification** - Custom verification steps (optional)

## Test Scenarios

### Node.js Cache Tests

Tests are split into two jobs that share cache state:

* **Create Cache** (`test-node-create-cache`) - Tests npm, pnpm, yarn, and
  multi-runtime on all platforms (Ubuntu, macOS, Windows). First run creates
  dependency cache.
* **Restore Cache** (`test-node-restore-cache`) - Same tests but restores from
  cache created in previous job. Validates cache effectiveness.

### Explicit Inputs Tests

Tests explicit runtime version inputs and feature detection
(`test-explicit-inputs`):

* **Node.js + Biome** - Biome auto-detected from `biome.jsonc`
* **Node.js + Turbo** - Turbo detection with explicit Biome installation
* **Bun + Biome** - Bun runtime with Biome auto-detection
* **Bun + Turbo** - Bun runtime with Turbo and explicit Biome
* **Deno + Biome** - Deno runtime with Biome auto-detection
* **Deno + Turbo** - Deno runtime with Turbo and explicit Biome

All explicit input tests run on all platforms (Ubuntu, macOS, Windows).

### Cache Testing Mode

The `test-fixture` action supports a special cache testing mode via the
`test-cache: "true"` input:

1. **First run** - Installs dependencies, saves to cache
2. **Verify dependencies** - Checks that dependencies were installed
3. **Clear node_modules** - Removes installed dependencies
4. **Second run** - Should restore from cache
5. **Verify cache** - Checks that cache was restored correctly

This mode is used internally by the action and can be enabled for custom
tests that need to validate cache effectiveness.

## Adding New Tests

### Option 1: Add to Existing Matrix

Add a new entry to an existing matrix:

```yaml
matrix:
  include:
    # ... existing entries ...

    - name: My New Test
      fixture: my-fixture
      expected-runtime: node
      expected-package-manager: npm
      test-command: "npm test"
      title: "🧪 My New Test Results"
```

### Option 2: Create New Test Job

Create a new test job for complex scenarios:

```yaml
test-my-feature:
  name: My Feature Test
  runs-on: ubuntu-latest
  steps:
    - name: Checkout
      uses: actions/checkout@v6

    - name: Test fixture
      uses: ./.github/actions/test-fixture
      with:
        fixture: my-fixture
        title: "🧪 My Feature Test Results"
        # ... runtime inputs ...
        # ... expected values ...

    - name: Custom verification
      run: |
        # ... custom verification logic ...
```

### Option 3: Create New Fixture

If you need a new configuration, create a fixture in [../../**fixtures**/](../../__fixtures__/):

```bash
mkdir -p __fixtures__/my-new-fixture
cat > __fixtures__/my-new-fixture/package.json <<'EOF'
{
  "name": "my-test-project",
  "packageManager": "pnpm@10.20.0"
}
EOF
```

Then reference it in the workflow:

```yaml
- name: Test my new fixture
  uses: ./.github/actions/test-fixture
  with:
    fixture: my-new-fixture
    title: "🧪 My New Test Results"
```

## Debugging Test Failures

### View GitHub Actions Logs

1. Go to the Actions tab in GitHub
2. Click on the failing workflow run
3. Click on the failing job
4. Expand the failing step to see details

### Common Issues

| Error | Cause | Solution |
| ----- | ----- | -------- |
| `Fixture 'X' not found` | Fixture doesn't exist | Create in `__fixtures__/` |
| `Expected X but got Y` | Output mismatch | Check action or update expected |
| `Command not found` | Runtime not installed | Check runtime installation |
| `Permission denied` | File permissions | Check fixture permissions |

### Local Testing with act

You can run workflows locally using [nektos/act](https://github.com/nektos/act):

```bash
# Install act
brew install act

# Run all tests
act -j test-node

# Run specific matrix entry
act -j test-node -e <(echo '{"matrix":{"name":"NPM"}}')

# Run with verbose output
act -j test-node -v
```

## Matrix Strategy Best Practices

1. **Use fail-fast: false** - Continue testing other matrix entries even if one
   fails
2. **Use descriptive names** - Make matrix entry names clear and specific
3. **Group related tests** - Keep similar tests in the same matrix job
4. **Use conditional steps** - Use `if` conditions for optional verification
   steps
5. **Provide clear titles** - Use emojis and descriptive titles for summaries
6. **Validate outputs** - Always verify action outputs match expectations
7. **Test edge cases** - Include tests for unusual configurations
8. **Keep fixtures simple** - Minimal configuration needed for the test

## Action Development Best Practices

Based on lessons learned building the `test-fixture` action:

### Use Python for Complex Operations

**Why:** Python provides a more robust standard library compared to Bash,
especially for:

* **JSON handling** - Native `json` module for parsing/generating complex JSON
  structures
* **File operations** - `pathlib` and `shutil` for cross-platform file
  operations
* **Error handling** - Structured exception handling with traceback support
* **String manipulation** - Better escaping and formatting for GitHub Actions
  outputs

**Example from test-fixture:**

```yaml
- name: Setup fixture
  shell: python
  run: |
    import json
    import os
    from pathlib import Path

    # Complex JSON generation
    output = {"test": "data", "nested": {"key": "value"}}
    with open(Path(os.environ["GITHUB_OUTPUT"]), "a") as f:
        f.write(f"results={json.dumps(output)}\n")
```

### Always Trap and Report Errors

**Critical:** Never swallow errors! Always capture full error details including
tracebacks.

**Why this matters:**

* Debugging GitHub Actions runs is hard - you can't SSH in or attach a debugger
* Swallowed errors make it impossible to diagnose issues
* Users need to see the full context of what went wrong

**Best Practice Pattern:**

```python
import sys
import traceback
from pathlib import Path

try:
    # Your action logic here
    result = do_something()

    # Write success outputs
    with open(Path(os.environ["GITHUB_OUTPUT"]), "a") as f:
        f.write(f"success=true\n")
        f.write(f"result={result}\n")

except Exception as e:
    # 1. Print error with GitHub Actions annotation
    error_msg = f"Action failed: {str(e)}"
    print(f"::error::{error_msg}")

    # 2. Print full traceback to logs
    traceback.print_exc()

    # 3. Write error to outputs for programmatic access
    with open(Path(os.environ["GITHUB_OUTPUT"]), "a") as f:
        f.write("success=false\n")
        # Escape special characters for GitHub Actions
        escaped_error = str(e).replace("\n", " ").replace("'", "''")
        f.write(f"error={escaped_error}\n")

    # 4. Exit with error code (or sys.exit(0) if you want to continue)
    sys.exit(1)
```

**Key elements:**

1. **GitHub Actions annotation** - `::error::` makes errors visible in UI
2. **Full traceback** - `traceback.print_exc()` shows where error occurred
3. **Structured outputs** - Write errors to `GITHUB_OUTPUT` for downstream
   steps
4. **Proper escaping** - Escape newlines and quotes for GitHub Actions output
   format

### Error Handling in test-fixture

The `test-fixture` action demonstrates this pattern throughout:

* **Setup step** - Catches file operation errors, reports to `setup-error`
  output
* **Verification step** - Catches validation errors, reports to `test-results`
  output
* **Always provides context** - Every error includes what was being attempted

**Result:** When tests fail, developers can immediately see:

* What step failed
* The exact error message
* Full Python traceback
* Structured error data in JSON outputs

This approach transformed debugging from "why did this fail?" to "here's exactly
what went wrong and where."

## Test Summary Job

The `summary` job aggregates results from all test jobs:

```yaml
summary:
  name: Test Summary
  runs-on: ubuntu-latest
  needs: [test-node, test-bun, test-deno, test-features, test-cache]
  if: always()
  steps:
    - name: Generate summary
      run: |
        echo "## 🧪 Test Results" >> $GITHUB_STEP_SUMMARY

        if [ "${{ needs.test-node.result }}" == "success" ] && \
           [ "${{ needs.test-bun.result }}" == "success" ] && \
           [ "${{ needs.test-deno.result }}" == "success" ] && \
           [ "${{ needs.test-features.result }}" == "success" ] && \
           [ "${{ needs.test-cache.result }}" == "success" ]; then
          echo "### ✅ All tests passed!" >> $GITHUB_STEP_SUMMARY
        else
          echo "### ❌ Some tests failed" >> $GITHUB_STEP_SUMMARY
          # ... list failures ...
        fi
```

**Key features:**

* **Runs always** - `if: always()` ensures summary runs even if tests fail
* **Depends on all tests** - `needs:` lists all test jobs
* **Reports overall status** - Shows which test suites passed/failed
* **Uses step summary** - Generates markdown summary visible in GitHub UI

## Related Documentation

* [Root CLAUDE.md](../../CLAUDE.md) - Repository overview
* [**fixtures**/CLAUDE.md](../../__fixtures__/CLAUDE.md) - Available test fixtures
* [**tests**/CLAUDE.md](../../__tests__/CLAUDE.md) - Unit testing
* [GitHub Actions Documentation](https://docs.github.com/en/actions) - GitHub
  Actions reference
* [nektos/act](https://github.com/nektos/act) - Run GitHub Actions locally
