---
description: Update Ship to the latest version from the repository.
allowed-tools: Bash
---

Clone the latest Ship and re-install into the current project:

```bash
rm -rf /tmp/ship && git clone --depth 1 https://github.com/dilhancarsales/ship /tmp/ship && node /tmp/ship/install.js && rm -rf /tmp/ship
```

After running, output:
```
Ship updated. Run /ship:help to see available commands.
```

If the install fails, show the error and suggest the user re-clone the Ship repository.
