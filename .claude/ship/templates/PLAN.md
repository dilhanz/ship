---
feature: "{feature-name}"
goal: "[Goal from CONTEXT.md]"
---

## Research Notes

[Findings from codebase exploration or web research, or "Domain familiar — no research needed"]

## Decisions

- [Decision made during planning and rationale]

## Must Deliver

- [Observable outcome 1 — maps to an acceptance criterion]
- [Observable outcome 2]
- [Observable outcome 3]

## Acceptance Coverage Map

```
Criterion: "[Criterion text from CONTEXT.md]" → Task [N] ([brief description])
Criterion: "[Criterion text]" → Task [N] + Task [M]
```

---

<task id="1" status="pending">
  <name>Task name (imperative verb)</name>
  <files>path/to/file.ts, path/to/other.ts</files>
  <action>Specific description of what to implement. Include function signatures, field names, or schema details where relevant.</action>
  <verify>Command that proves this task is complete. Must be runnable.</verify>
</task>

<task id="2" status="pending">
  <name>Task name</name>
  <files>path/to/file.ts</files>
  <action>...</action>
  <verify>...</verify>
</task>

When the planner groups tasks into phases:

<phase id="1" name="Phase name describing focus" status="pending">

<task id="1" status="pending">
  <name>Task name</name>
  <files>path/to/file.ts</files>
  <action>...</action>
  <verify>...</verify>
</task>

<task id="2" status="pending">
  <name>Task name</name>
  <files>path/to/file.ts</files>
  <action>...</action>
  <verify>...</verify>
</task>

</phase>

<phase id="2" name="Next phase focus" status="pending">

<task id="3" status="pending">
  <name>Task name</name>
  <files>path/to/file.ts</files>
  <action>...</action>
  <verify>...</verify>
</task>

</phase>

## Risk Notes

- [Task N — what could go wrong and what to do about it. Optional section.]
