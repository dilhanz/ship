---
description: Uninstall Ship from the current project, removing all framework files and hook registrations while preserving .planning/ data.
allowed-tools: Bash
---

Run the Ship uninstall script:

```bash
node .claude/ship/uninstall.js
```

After the script completes, report what was removed. Confirm that `.planning/` data has been preserved and that the user can reinstall Ship at any time by running `node install.js` from the Ship repository.

If the script is not found (Ship may be partially installed), inform the user they can clone the Ship repository and run `node uninstall.js` from there instead.

$ARGUMENTS
