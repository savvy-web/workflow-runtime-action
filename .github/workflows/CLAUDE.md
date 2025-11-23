# .github/workflows/CLAUDE.md

GitHub Actions workflow testing strategy and reusable composite actions.

**See also:** [Root CLAUDE.md](../../CLAUDE.md) | [**fixtures**/CLAUDE.md](../../__fixtures__/CLAUDE.md) for available test fixtures.

## Overview

This directory contains GitHub Actions workflows for testing the runtime action using a **matrix-based testing approach** with **reusable composite actions** for setup and verification.

## Test Workflows

### [test.yml](test.yml)

Main test workflow that runs on push and pull requests. Includes comprehensive test coverage:

* **test-node** - Node.js runtime tests (npm, pnpm, yarn, version files, LTS)
* **test-bun** - Bun runtime tests (auto-detect, explicit version, lockfile)
* **test-deno** - Deno runtime tests (auto-detect, package.json, explicit version, lockfile)
* **test-features** - Feature tests (Biome auto-detect, Turbo detection, skip dependencies)
* **test-cache** - Cache effectiveness testing (cache miss → cache hit)
* **summary** - Aggregates test results and reports overall status

## Reusable Composite Actions

### [setup-fixture](../actions/setup-fixture/action.yml)

Prepares the test environment by removing repository config files and copying fixture files.

**Purpose:** Isolate tests by replacing repository configuration with fixture configuration.

**How it works:**

1. **Remove conflicting files** - Deletes repository config files that would interfere with tests:
   * `package.json`, `pnpm-workspace.yaml`
   * `biome.jsonc`, `turbo.json`
   * Lock files: `pnpm-lock.yaml`, `deno.lock`
   * Version files: `.nvmrc`, `.node-version`

2. **Copy fixture files** - Copies all files from the specified fixture directory (including hidden files):

   ```bash
   cp -r __fixtures__/${{ inputs.fixture }}/. .
   ```

**Inputs:**

* `fixture` (required) - Name of the fixture directory in `__fixtures__/`

**Example usage:**

```yaml
- name: Setup test fixture
  uses: ./.github/actions/setup-fixture
  with:
    fixture: node-pnpm
```

**Why this approach?**

* **Simple** - No complex /tmp directory management
* **Fast** - Files copied in-place, action runs in same directory
* **Isolated** - Repository config removed, only fixture config remains
* **Works on all platforms** - No platform-specific path issues

### [verify-setup](../actions/verify-setup/action.yml)

Validates action outputs against expected values and generates formatted test results.

**Purpose:** Report action outputs and verify they match expectations.

**How it works:**

1. **Parse outputs** - Receives action outputs as JSON string
2. **Validate each output** - Compares actual vs expected values
3. **Generate summary** - Creates formatted markdown summary with emojis:
   * ✅ Value matches expectation
   * ✔️ Value reported (no expectation to validate)
   * ❌ Value doesn't match expectation
4. **Fail if mismatches** - Exits with error if any validation fails

**Inputs:**

* `title` (required) - Title for the test results section (including emoji)
* `outputs` (required) - JSON string of all setup outputs from `steps.setup.outputs`
* `expected-runtime` - Expected runtime value (`node`, `bun`, `deno`)
* `expected-package-manager` - Expected package manager (`npm`, `pnpm`, `yarn`, `bun`, `deno`)
* `expected-node-version` - Expected Node.js version
* `expected-node-version-file` - Expected version file (`.nvmrc`, `.node-version`)
* `expected-bun-version` - Expected Bun version
* `expected-deno-version` - Expected Deno version
* `expected-biome-enabled` - Expected biome-enabled value (`true`, `false`)
* `expected-biome-version` - Expected Biome version
* `expected-biome-config-file` - Expected Biome config file path
* `expected-turbo-enabled` - Expected turbo-enabled value (`true`, `false`)
* `expected-turbo-config-file` - Expected Turbo config file path
* `expected-cache-hit` - Expected cache hit status (`true`, `partial`, `false`)

**Example usage:**

```yaml
- name: Setup runtime
  id: setup
  uses: ./
  with:
    package-manager: pnpm

- name: Verify setup
  uses: ./.github/actions/verify-setup
  with:
    title: "📦 PNPM Test Results"
    outputs: ${{ toJSON(steps.setup.outputs) }}
    expected-runtime: node
    expected-package-manager: pnpm
```

**Output format:**

```markdown
## 📦 PNPM Test Results

runtime: node ✅
package-manager: pnpm ✅
node-version: 20.19.5 ✔️
cache-hit: false ✔️

✅ All validations passed
```

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

    - name: Setup test fixture
      uses: ./.github/actions/setup-fixture
      with:
        fixture: ${{ matrix.fixture }}

    - name: Setup runtime
      id: setup
      uses: ./
      with:
        package-manager: ${{ matrix.package-manager || '' }}

    - name: Verify setup
      uses: ./.github/actions/verify-setup
      with:
        title: ${{ matrix.title }}
        outputs: ${{ toJSON(steps.setup.outputs) }}
        expected-runtime: ${{ matrix.expected-runtime || '' }}
        expected-package-manager: ${{ matrix.expected-package-manager || '' }}

    - name: Test runtime
      if: matrix.test-command != ''
      run: ${{ matrix.test-command }}
```

## Standard Test Pattern

Every test follows this pattern:

1. **Checkout** - Check out the repository
2. **Setup fixture** - Use `setup-fixture` action to prepare test environment
3. **Run action** - Execute the runtime action with test inputs
4. **Verify outputs** - Use `verify-setup` action to validate results
5. **Test runtime** - Run commands to verify runtime is working (optional)
6. **Additional verification** - Custom verification steps (optional)

## Test Scenarios

### Node.js Tests

* **NPM** - Default npm package manager
* **PNPM** - Auto-detected from `package.json` `packageManager` field
* **Yarn** - Auto-detected from `package.json` `packageManager` field
* **.nvmrc** - Node.js version from `.nvmrc` file
* **.node-version** - Node.js version from `.node-version` file
* **LTS** - Latest LTS version resolution

### Bun Tests

* **Auto-detect** - Detect Bun from `package.json` `packageManager` field
* **Explicit Version** - Install specific Bun version
* **Lockfile** - Verify `bun.lockb` handling

### Deno Tests

* **Auto-detect** - Detect Deno from `deno.json`
* **package.json** - Detect Deno from `package.json` `packageManager` field
* **Explicit Version** - Install specific Deno version
* **Lockfile** - Verify `deno.lock` handling

### Feature Tests

* **Biome Auto-detect** - Detect Biome version from `biome.jsonc` `$schema`
* **Biome Explicit Version** - Install specific Biome version
* **Turbo Detection** - Detect Turborepo from `turbo.json`
* **Skip Dependencies** - Verify `install-deps: false` skips dependency installation

### Cache Test

* **First run** - Cache miss, installs dependencies
* **Second run** - Cache hit, restores from cache
* **Verification** - Ensures dependencies restored correctly

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

    - name: Setup test fixture
      uses: ./.github/actions/setup-fixture
      with:
        fixture: my-fixture

    - name: Setup runtime
      id: setup
      uses: ./
      with:
        # ... custom inputs ...

    - name: Verify setup
      uses: ./.github/actions/verify-setup
      with:
        title: "🧪 My Feature Test Results"
        outputs: ${{ toJSON(steps.setup.outputs) }}
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
- name: Setup test fixture
  uses: ./.github/actions/setup-fixture
  with:
    fixture: my-new-fixture
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
| `Fixture 'X' not found` | Fixture doesn't exist | Create fixture in `__fixtures__/` |
| `Expected X but got Y` | Output mismatch | Check action logic or update expected value |
| `Command not found` | Runtime not installed | Check runtime installation in action |
| `Permission denied` | File permissions issue | Check fixture file permissions |

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

1. **Use fail-fast: false** - Continue testing other matrix entries even if one fails
2. **Use descriptive names** - Make matrix entry names clear and specific
3. **Group related tests** - Keep similar tests in the same matrix job
4. **Use conditional steps** - Use `if` conditions for optional verification steps
5. **Provide clear titles** - Use emojis and descriptive titles for summaries
6. **Validate outputs** - Always verify action outputs match expectations
7. **Test edge cases** - Include tests for unusual configurations
8. **Keep fixtures simple** - Minimal configuration needed for the test

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
* [GitHub Actions Documentation](https://docs.github.com/en/actions) - GitHub Actions reference
* [nektos/act](https://github.com/nektos/act) - Run GitHub Actions locally
