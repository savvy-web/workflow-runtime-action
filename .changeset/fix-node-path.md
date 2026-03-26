---
"@savvy-web/workflow-runtime-action": patch
---

## Bug Fixes

Fix Node.js not being available on PATH after installation. The Node tar archive extracts to a nested directory (e.g., `node-v24.11.0-linux-x64/`), so the `bin/` path added to PATH didn't contain the actual binary. Now passes `--strip 1` to tar during extraction to flatten the archive root, matching the pattern used by `actions/setup-node`. Also adds `streaming: true` to dependency install for visible error output on failure, and temporary runtime diagnostics logging.
