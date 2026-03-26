---
name: ship-uninstall
description: Use when removing Ship from the current project — removes framework files and hooks while preserving .planning/ data
effort: medium
allowed-tools: Bash
---

Run the Ship uninstall command:

```bash
npx github:dilhanz/ship --uninstall
```

After the script completes, report what was removed. Confirm that `.planning/` data has been preserved and that the user can reinstall Ship at any time by running `npx github:dilhanz/ship`.

$ARGUMENTS
