# Decisions

## 2026-08-23 — Dogfood blocks read a committed fixture

The gated blocks read `tests/fixtures/pm-state/` instead of gitignored local state, so they run on a clean checkout.

## 2026-08-20 — Authored prose renders code spans

`inline()` escapes first and then converts backtick pairs, so attributes and machine-derived values keep plain escaping.
