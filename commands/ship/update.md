---
description: Update Ship to the latest version from GitHub.
allowed-tools: Bash
---

Update Ship to the latest version:

1. Read the current installed version:
```bash
cat .claude/ship/VERSION 2>/dev/null || echo "(unknown)"
```

2. Clone the latest Ship and re-install:
```bash
rm -rf /tmp/ship-update && \
git clone --depth 1 https://github.com/dilhancarsales/ship /tmp/ship-update && \
node /tmp/ship-update/install.js && \
rm -rf /tmp/ship-update
```

3. Read the new version:
```bash
cat .claude/ship/VERSION 2>/dev/null || echo "(unknown)"
```

Report the before and after versions. If they differ, confirm the update succeeded. If they are the same, note that Ship was already up to date.

If the install fails:
- If `git` is not found, tell the user to install git and retry.
- If the clone fails (network error or repo not found), show the error and suggest they check their internet connection.
- Otherwise show the error output and suggest re-running `/ship:update`.

$ARGUMENTS
