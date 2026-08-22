---
updated: "2026-08-23"
---

# Fixture Project — Status

## In flight

- Render the fixture dashboard from state — the shared fixture drives every dogfood block

## Live status

- Milestones, blockers and decisions all render from this committed fixture (unverified until the suite runs)
- Run `/ship:pm-sync` to settle anything this snapshot merely claims

## Blocked

- **Unblock the fixture upgrade path** — waiting on the shared fixture to be adopted by every dogfood block

## Recently shipped

- Adopt the shared pm-state fixture

## Repo hygiene

- The fixture uses undotted directory names so the repo `.gitignore` cannot swallow it
