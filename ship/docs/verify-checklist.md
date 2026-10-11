# Verify Checklist Contract

The contract of record for the optional repo checklist the ship-verifier runs on every verification. The verifier agent (`agents/ship-verifier.md`) conforms to this document; repos write their checklist against it. It is versioned with Ship — contract changes are visible in one diff to this file.

---

## 1. Location

`.planning/verify-checklist.md` at the repo root of the checkout being verified, beside `LEDGER.md`. The file is **optional**.

## 2. Format

Plain Markdown.

- **Every line starting with `- `** (after optional indentation) is one checklist item. Nested bullets are separate items — a sub-bullet is its own row, not part of its parent.
- **Headings and prose are ignored.** Use them freely to group and explain items; only bullets become rows.
- **An optional `Build:` line** — a single line of the form ``Build: `<command>` `` (backticked command) — names the build/test command the trial merge runs. The first matching line wins; any later `Build:` line is ignored.

## 3. Semantics

- The verifier gives **every bullet its own row** in VERIFY.md's Verify Checklist table, with source `repo`.
- Every row is decided: `PASS`, `FAIL`, or `N/A`, plus evidence (a command, or `file:line`). There is no empty or skipped row.
- An `N/A` row needs a one-line reason.
- A `FAIL` row is also recorded in Bug Findings at **medium severity or above, never low** — and any `Open` bug fails the verify.
- The repo checklist runs at **every verification depth, including criteria-only**. Like carried review findings and the trial merge, it is a gate, not discretionary testing.

## 4. When the file is absent

- The verifier runs the generic items only, and the Verify Checklist section states "No repo checklist".
- The trial-merge command is the build/test command Stage 2a discovers.

## 5. Example

```markdown
# Verify checklist

## Data
- Every new migration has a matching down migration
- New database queries on list endpoints are paginated

## Release
- CHANGELOG has an entry for any user-visible change

Build: `npm test`
```

This yields three `repo` rows, and the trial merge runs `npm test` inside the throwaway worktree.

## 6. Generic items

Independently of this file, the verifier carries three built-in items (source `generic`): (1) docs, manual, and user-facing claims in the diff match the code; (2) tests that depend on the current date or time zone; (3) concurrency on write paths. They are the verifier's own, need no configuration, and are skipped at criteria-only — unlike the repo checklist and the trial merge, which still run there.
