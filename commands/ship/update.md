---
description: Update Ship to the latest version from the repository.
allowed-tools: Bash
---

Run the Ship installer to update all files to the latest version:

```bash
node /c/src/ship/install.js
```

If the install script is not found at that path, try to find it:

```bash
find ~ -name "install.js" -path "*/ship/*" 2>/dev/null | head -5
```

After running, output:
```
Ship updated. Run /ship:help to see available commands.
```

If the install fails, show the error and suggest the user re-clone the Ship repository.
