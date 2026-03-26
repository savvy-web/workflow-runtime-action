---
"@savvy-web/workflow-runtime-action": patch
---

## Bug Fixes

Retry `corepack enable` after removing stale shims when it fails with EEXIST. This handles the case where a cached Node installation contains symlinks from a previous corepack setup, causing `corepack enable` to fail when trying to create them again.
