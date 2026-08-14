# Headless Mode Contract

The contract of record for `/ship:go --headless`. The go skill conforms to this document; external callers (e.g. solo-core spawning `claude -p`) classify runs by this contract instead of scraping prose. It is versioned with Ship — contract changes are visible in one diff to this file.

---

## 1. Invocation

```
/ship:go --headless [feature-name]
```

- **Explicit flag only.** There is no environment-variable detection (`SHIP_HEADLESS` does not exist). The caller controls its own invocation and passes the flag deliberately.
- **`--headless` implies `--auto`.** A run with nobody present cannot answer "Ready to build?" either; one flag expresses the whole unattended contract.
- **Any argument order.** `--headless`, `--auto`, and the feature name may appear in any order; flags are stripped before the feature name is resolved.
- **`--auto` alone keeps its attended-but-hands-off meaning**: the build gate is skipped but NEEDS_INPUT is still asked interactively. Only `--headless` degrades the interactive points.

## 2. Outcome vocabulary

Every headless run terminates with exactly one of these 10 outcomes. Build-stop cases stay distinct (not collapsed into `blocked`) so callers can distinguish "needs a human answer" from "needs smaller tasks".

| Outcome | Meaning | CONTEXT.md status left behind |
|---------|---------|-------------------------------|
| `done` | Verify passed (PASS or INCONCLUSIVE), or the feature was already done at routing. Finish is never attempted headlessly. | `done` |
| `needs-input` | Plan loop hit NEEDS_INPUT — questions parked in QUESTIONS.md awaiting answers (or the re-invocation cap was reached). | `planned` |
| `stuck` | Plan loop convergence guard fired — a round's CRITICAL set repeated. | `planned` |
| `unresolved` | Plan loop exhausted its 5 rounds without approval. | `planned` |
| `blocked` | Plan loop reviewer returned BLOCKED. | `planned` |
| `verify-fail` | Verifier verdict FAIL — fix tasks are already in PLAN.md; go never auto-retries. | `plan-verified` |
| `needs-context` | Builder stopped with NEEDS_CONTEXT — a task needs information not in the plan or codebase. | `building` |
| `exhausted` | Builder rounds exhausted with no forward progress — tasks likely need to be smaller. | `building` |
| `checkpoint` | Builder hit an architectural conflict or persistent verification failure. | `building` |
| `error` | Unrecoverable skill-level failure: workflow crash, unresolvable feature name, or a null verdict with nothing stopped. | unchanged |

## 3. OUTCOME.json

**Path:** `.planning/features/{name}/OUTCOME.json`

**Lifecycle:** deleted as the run's first act, written as its last. A missing file after the process exits therefore means the run died mid-flight — itself a classifiable signal.

**Schema** (all fields required unless noted):

| Field | Type | Description |
|-------|------|-------------|
| `schema_version` | integer | Currently `1`. Callers check this before parsing the rest. |
| `feature` | string | The feature slug. |
| `outcome` | string | One of the 10 outcome words above. |
| `status` | string | The settled CONTEXT.md status. |
| `timestamp` | string | ISO 8601 UTC at write time. |
| `head` | string | `git rev-parse HEAD` at write time. |
| `detail` | string | One-line human note (e.g. cap-reached, criteria counts). |
| `questions_file` | string (optional) | Present only on `needs-input`: repo-relative path to QUESTIONS.md. |

Example:

```json
{
  "schema_version": 1,
  "feature": "user-auth",
  "outcome": "needs-input",
  "status": "planned",
  "timestamp": "2026-08-14T03:12:45Z",
  "head": "8595e71c2f0a4b1d9e3f6a7b8c9d0e1f2a3b4c5d",
  "detail": "plan loop parked 2 questions for a human",
  "questions_file": ".planning/features/user-auth/QUESTIONS.md"
}
```

## 4. Fenced outcome block

The run's final message ends with a fenced block tagged `ship_outcome` whose body is the exact OUTCOME.json content. The channel is dual on purpose: the file survives output truncation; the block is convenient for `claude -p` callers reading the transcript. Both carry the same JSON, so consumers parse one shape.

Example (the run's last output):

````
```ship_outcome
{
  "schema_version": 1,
  "feature": "user-auth",
  "outcome": "done",
  "status": "done",
  "timestamp": "2026-08-14T04:02:10Z",
  "head": "9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c",
  "detail": "verify PASS — 6/6 criteria met; /ship:finish is the manual next step"
}
```
````

## 5. QUESTIONS.md

**Path:** `.planning/features/{name}/QUESTIONS.md`

Written only when the plan loop returns NEEDS_INPUT under `--headless` (interactive runs never write it). Format:

- YAML frontmatter: `feature` (string), `roundOffset` (integer — total plan-loop rounds spent across all invocations so far), `created` (ISO date).
- One `### Q{n}: {question}` section per `needs_input` entry, each with its `**Why blocking:**` line, an `Options:` bullet list, and an empty `**Answer:**` line.
- The raw replanner `needs_input` JSON array in a fenced `json` block at the end.

Full example:

```markdown
---
feature: "user-auth"
roundOffset: 2
created: "2026-08-14"
---

# Questions — plan loop needs input

### Q1: Which session store should tokens use?

**Why blocking:** The plan's task 3 schema depends on whether tokens are opaque (server-side store) or JWTs (stateless).

Options:
- Redis-backed opaque tokens
- Signed JWTs, no store
- Database sessions table

**Answer:**

### Q2: Should password reset reuse the mailer from notifications?

**Why blocking:** Task 5 either imports the existing mailer or introduces a second SMTP client.

Options:
- Reuse notifications mailer
- Standalone reset mailer

**Answer:**

```json
[
  {
    "question": "Which session store should tokens use?",
    "options": ["Redis-backed opaque tokens", "Signed JWTs, no store", "Database sessions table"],
    "why_blocking": "The plan's task 3 schema depends on whether tokens are opaque (server-side store) or JWTs (stateless)."
  },
  {
    "question": "Should password reset reuse the mailer from notifications?",
    "options": ["Reuse notifications mailer", "Standalone reset mailer"],
    "why_blocking": "Task 5 either imports the existing mailer or introduces a second SMTP client."
  }
]
```
```

## 6. Answer round-trip

The caller (or a human) fills each `**Answer:**` line and re-invokes `/ship:go --headless {name}`. Go checks for the file **before** running the plan loop:

- **Every `**Answer:**` line non-empty** → build the Q/A transcript for `args.answers`, pass the frontmatter `roundOffset` to the plan workflow, rename the file to `QUESTIONS-{roundOffset}.answered.md` (the `roundOffset` from its own frontmatter — strictly increasing across re-invocations, so the archive name is collision-free and deterministic), and continue the loop.
- **Any answer still empty** → terminate immediately as `needs-input` again, without re-running the loop. Re-invoking with an unanswered file is idempotent.
- **File absent** → run the loop normally.

**Cap:** answered-file resumes count against the existing 2-re-invocation cap. A 3rd NEEDS_INPUT terminates as `needs-input` with a cap-reached `detail` ("re-invocation cap reached — escalate to a human"); the new QUESTIONS.md is still written so the questions are not lost. The caller escalates to a human.

## 7. Never-headless actions

- **`/ship:finish` is never invoked.** Routing on status `done` reports a `done` outcome instead of finishing; after a passing verify, the post-verify finish offer is suppressed and the run terminates as `done` with a `detail` noting `/ship:finish` is the manual next step. PR/merge is outward-facing and stays human-gated.
- **Verify FAIL terminates as `verify-fail`.** Fix tasks are already in PLAN.md; go never auto-retries a FAIL — the caller owns the retry decision.

## 8. Compatibility

- Interactive (non-headless) runs never write OUTCOME.json or QUESTIONS.md — behavior without `--headless` is byte-identical to a Ship without this contract.
- Callers' prompt-level contracts (e.g. solo-core's wrapper-prompt park instructions) remain the fallback for older Ship versions; this contract supersedes them when present. Ship-side changes must not require a lockstep caller release.
