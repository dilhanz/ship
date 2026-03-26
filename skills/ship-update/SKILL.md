---
name: ship-update
description: Use when Ship needs updating to the latest version from GitHub
effort: medium
allowed-tools: Bash
---

Update Ship to the latest version:

1. Read the current installed version:
```bash
cat .claude/ship/VERSION 2>/dev/null || echo "(unknown)"
```

2. Re-install from GitHub:
```bash
npx github:dilhanz/ship
```

3. Read the new version:
```bash
cat .claude/ship/VERSION 2>/dev/null || echo "(unknown)"
```

Report the before and after versions. If they differ, confirm the update succeeded. If they are the same, note that Ship was already up to date.

If the install fails:
- If `npx` or Node.js is not found, tell the user to install Node.js 18+ and retry.
- If the download fails (network error), show the error and suggest they check their internet connection.
- Otherwise show the error output and suggest re-running `/ship-update`.

$ARGUMENTS
