---
description: Uninstall Ship from the current project, removing all framework files and hook registrations while preserving .planning/ data.
allowed-tools: Bash
---

Run the Ship uninstall command:

```bash
npx github:dilhanz/ship --uninstall
```

After the script completes, report what was removed. Confirm that `.planning/` data has been preserved and that the user can reinstall Ship at any time by running `npx github:dilhanz/ship`.

$ARGUMENTS
