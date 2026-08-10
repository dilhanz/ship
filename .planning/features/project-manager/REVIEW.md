# Review — project-manager

## Phase 3 — Sync nudge hook, tests, and docs (round 1)

Status: APPROVED

- [low] hooks/pm-sync-nudge.cjs:78: Recorded status cells are compared case-sensitively (e.g. recorded !== 'done'); a hand-edited row using 'Done' or 'Pending' is misclassified as drift or silently missed. The pm-state format mandates lowercase statuses, so this only affects hand-edited roadmaps. — recorded
