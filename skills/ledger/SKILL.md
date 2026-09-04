---
name: ledger
description: Use when asking what to work on next, what is planned, or when adding, reordering, or dropping planned features — reads and edits .planning/LEDGER.md, the ordered index of planned features
effort: low
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
argument-hint: "[add <idea> | <slug> now|next|someday|top | drop <slug> | (empty to show)]"
---

Read and edit `.planning/LEDGER.md` — the project's ordered index of planned features.

The ledger holds **ordering and one-liners, nothing else**. Everything else about a feature lives in `.planning/features/{slug}/`. Never duplicate a feature's status, criteria, plan, or findings here.

## Format

`.planning/LEDGER.md`, four fixed sections, in this order:

```markdown
# Ledger

## Now
- [ ] **worktree-flow** — brainstorm in main, build in worktrees

## Next
- [ ] **plan-cache** — reuse exploration across replans
- [ ] **verify-speed** — make the anti-pattern scan opt-in

## Someday
- [ ] **multi-repo** — features spanning two repos

## Shipped
- [x] pm-evidence-layer → .planning/archive/pm-evidence-layer/
```

Rules that make the file worth having:

- **Position is priority.** The top line of `## Now` is the next thing to do. There is no priority column, no size, no dates, no dependency graph — reordering is moving a line, which the user can do in any editor without telling anyone.
- **One line per feature.** `- [ ] **{slug}** — {one-liner}`. The slug is bold and kebab-case; it is the `.planning/features/{slug}/` directory name when a folder exists, and the name that folder will get when one doesn't.
- **A row does not require a folder.** An idea can sit in `## Next` for months with nothing but its line. `/ship:start {slug}` is what gives it a folder.
- **The four headings always exist**, even when a section is empty. An empty section reads as `_(empty)_` on its own line.
- **`## Shipped` is append-at-top history.** `- [x] {slug} → .planning/archive/{slug}/`, newest first. It is written by `/ship:finish`, and is the only section where order means recency rather than priority.
- **No status cells.** Status is read live from `.planning/features/{slug}/CONTEXT.md` frontmatter every time the ledger is displayed — wherever that folder lives, since `/ship:start` moves it into the feature's worktree. A cell would drift; a lookup cannot.

A missing `.planning/LEDGER.md` is not an error — it means nothing has been planned yet. Create it with the four empty headings the first time something needs a row.

## Locate the ledger

There is exactly one ledger, and it lives at the **main worktree root**. Resolve it before any read or edit:

```bash
MAIN_ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" 2>/dev/null) || MAIN_ROOT=$(pwd)
[ -n "$MAIN_ROOT" ] && [ "$MAIN_ROOT" != "." ] || MAIN_ROOT=$(pwd)
LEDGER="$MAIN_ROOT/.planning/LEDGER.md"
```

Every read and every edit in this skill targets `$LEDGER`. In the main checkout it is the local `.planning/LEDGER.md`; from a linked worktree it is the main checkout's file, which is why the ledger does not look empty after `/ship:go` has moved the session into a worktree. From a linked worktree the skill must **never create `.planning/LEDGER.md` in the worktree** — a second copy is a second ordering, and the user owns exactly one. Not a git repo → `MAIN_ROOT` is the cwd, today's behavior.

## Show the ledger (no arguments)

1. Read `$LEDGER`. If it is absent, say the ledger is empty and offer `/ship:ledger add "{idea}"`.

2. Resolve every feature's status with the shared helper rather than a bare Glob `.planning/features/*/CONTEXT.md` of the current checkout, which cannot see a feature whose directory `/ship:start` moved into a worktree:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/ship/find-features.cjs"
   ```

   It prints one line of JSON. `features` is a map keyed by slug; each entry carries `status` (the frontmatter value, unfiltered — `done` included), `location` (`main` | `worktree` | `archive`), `branch`, `here` (true when the copy sits in the current checkout), `owner` (`sole` | `branch` | `cwd` | `ambiguous`), `copies`, and `alsoArchived`. It derives every location from `git worktree list --porcelain` on this call — nothing is stored. If `warning` is non-null, surface it verbatim before the listing. Match entries by slug against the row slugs.

3. Render each section in file order, annotating rows that have an entry:

   ```
   ## Now
   1. worktree-flow — brainstorm in main, build in worktrees   [building · feature/worktree-flow]
   2. kill-pm — rip the PM layer out                           [planned]

   ## Next
   3. plan-cache — reuse exploration across replans
   4. verify-speed — make the anti-pattern scan opt-in

   ## Someday
   5. multi-repo — features spanning two repos
   ```

   Markers, from the entry:
   - `location: archive` → **no marker, in any section**. Checked first: an archived entry's `here` and `branch` describe the archive copy at the main root, not live work, so the rules below must never see it. A `## Shipped` row already carries `→ .planning/archive/{slug}/`; an archived slug still sitting under `## Now`/`## Next`/`## Someday` is the orphan reported by step 4, not something to mark inline.
   - `here` true → `[{status}]`, exactly as before.
   - `here` false and `owner` is not `ambiguous` → `[{status} · {branch}]` — the branch, not the path, because a path wraps the row. Use `detached` when `branch` is null.
   - `owner: ambiguous` → `[{status} · {copies} copies]`, with `status unknown` in place of a null status. Several checkouts hold the folder and no branch or cwd rule picks one; say so rather than guess.
   - A slug absent from the map gets no status marker — that is what "not started" looks like, and it needs no word for it.
   - `status: unknown` (a folder whose frontmatter `status:` is missing) → `[status unknown]`, never guessed.

4. Report, in at most three lines: what is in flight (entries at a non-terminal status), the top of `## Now`, and any **orphan** — a live entry (`location` `main` or `worktree`) with no ledger row, or a row in `## Now`/`## Next`/`## Someday` whose entry has `location: archive` or `alsoArchived: true`, meaning the slug is already in `.planning/archive/`. Both come from the same helper call; there is no separate archive lookup. Offer to fix each orphan; never fix one silently.

5. End with the Ship command for the top of `## Now`: `/ship:start "{slug}"` when it has no entry, `/ship:go {slug}` or `/ship:resume` when it does.

## Edit the ledger

Parse `$ARGUMENTS`. Every edit is a line move or a line rewrite in one file — read `$LEDGER`, do it with Edit, write `$LEDGER` back, preserve every other line byte-for-byte, and report the one-line result.

- **`add {text}`** — append `- [ ] **{slug}** — {one-liner}` to the **bottom of `## Next`**. Derive the kebab-case slug from the text the way `/ship:start` does. New work is never assumed urgent: the user promotes it if it is. Refuse a slug that already has a row and say where that row sits.
- **`{slug} now` / `next` / `someday`** — move the row to the bottom of that section.
- **`{slug} top`** — move the row to the top of `## Now`. This is the "do this next" gesture.
- **`drop {slug}`** — delete the row. If the helper resolves `{slug}` to a live entry, say where it lives and ask first; dropping the row does not delete the folder, and the folder without a row is an orphan.
- **Anything else** — treat it as a free-text reorder instruction ("put verify-speed above plan-cache", "move the auth stuff to someday") and carry it out as line moves. Read the file, apply the moves, write it back, and show the new order.

Never reorder rows the user did not name. The ordering is theirs.

## Hard rules

- **Write only `.planning/LEDGER.md`.** — at the main root, `$LEDGER`, never a copy in a linked worktree. Never a feature's CONTEXT.md, never source, never git. `/ship:finish` writes the `## Shipped` row; this skill writes the other three sections.
- **Never invent a row.** A ledger row comes from the user or from `/ship:start`. A feature directory found without a row is reported as an orphan and offered, not added.
- **No time concepts.** No deadlines, no estimates, no sprints. Position carries the priority and that is the whole point.
- **Never start implementation.** Every answer ends with a Ship command.

$ARGUMENTS
