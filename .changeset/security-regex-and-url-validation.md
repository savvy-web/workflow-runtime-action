---
"@savvy-web/github-private": patch
---

security: fix regex injection and URL validation vulnerabilities

Fixed two security vulnerabilities in setup-release actions:

* **RegEx injection prevention**: Added proper escaping for all regex metacharacters when parsing version strings from CHANGELOG.md files. Previously only dots were escaped, which could lead to regex injection if version strings contained special characters like brackets, parentheses, or other metacharacters.

* **URL validation bypass**: Replaced insecure substring matching with proper URL parsing to validate GitHub Packages registry URLs. The previous `.includes()` check could be bypassed by malicious URLs like `https://evil.com/npm.pkg.github.com` or `npm.pkg.github.com.attacker.com`. Now validates the hostname exactly matches `npm.pkg.github.com`.
