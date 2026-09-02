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

## 2. Run completion — the turn never ends mid-workflow

`/ship:go` does its heavy work in two Workflow-engine scripts: the plan loop and the build→verify spine. **The Workflow tool does not return the workflow's result.** It launches the workflow in the background and returns a Task ID immediately; the result arrives later as a completion notification.

Interactively that is correct and stays unchanged — the session outlives the turn, progress is visible in `/workflows`, and the notification lands back in the same session. Headlessly there is no session to come back to: `claude -p` exits when the model's turn ends. A turn that ends while a workflow is in flight kills or orphans it, and the run reports "the workflow is running, I'll report when it completes" as its final message — a clean exit that produced no outcome, left `CONTEXT.md` mid-flight, and can leave agent processes still writing to the worktree after the caller believes the run is over.

**The guarantee.** Under `--headless`, go does not end its turn while a workflow it launched is still running. Every Workflow invocation — the plan loop and the build→verify spine alike — is awaited to a terminal state before go reconciles and reports. What a caller can rely on:

- **A headless run that returns has finished.** Its final message reflects a terminal state, `OUTCOME.json` is on disk, and no agent process is still writing to the worktree.
- **The ceiling is 2 hours per workflow.** On reaching it, go stops the task *first* and then terminates as `error` with a detail naming the cap. It never abandons a running task — that is precisely what leaves an orphan.
- **A caller's own timeout should exceed 2 hours** if it wants the ceiling to be what fires, rather than its own kill.

The mechanism — which tool blocks, its timeout maximum, how many times it repeats, how the result is read back — belongs to the skill, and is specified in the **Headless workflow wait** section of `skills/go/SKILL.md`. Callers do not implement it; they depend only on the guarantee above.

This changes only *when* the final message is produced. The outcome vocabulary, `OUTCOME.json`, and the fenced block are identical, so no caller needs to change to benefit from it.

## 3. Outcome vocabulary

Every headless run terminates with exactly one of these 11 outcomes. Build-stop cases stay distinct (not collapsed into `blocked`) so callers can distinguish "needs a human answer" from "needs smaller tasks".

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
| `infrastructure` | A sustained transport outage — several consecutive agents died on connection errors (`ENOTFOUND`, `ECONNRESET`, a 5xx, an overload) having done no work. Distinct from `exhausted`: `exhausted` means the tasks need to be smaller, `infrastructure` means nothing is wrong with the plan and no work was lost. Fully resumable by re-running `/ship:go`. | `building` |
| `checkpoint` | Builder hit an architectural conflict or persistent verification failure. | `building` |
| `error` | Unrecoverable skill-level failure: workflow crash, unresolvable feature name, a null verdict with nothing stopped, or the 2-hour headless wait ceiling reached on a workflow (task stopped via `TaskStop` before terminating). | unchanged |

## 4. OUTCOME.json

**Path:** `.planning/features/{name}/OUTCOME.json`

**Lifecycle:** deleted as the run's first act, written as its last. A missing file after the process exits therefore means the run died mid-flight — itself a classifiable signal.

**Schema** (all fields required unless noted):

| Field | Type | Description |
|-------|------|-------------|
| `schema_version` | integer | Currently `1`. Callers check this before parsing the rest. |
| `feature` | string | The feature slug. |
| `outcome` | string | One of the 11 outcome words above. |
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

## 5. Fenced outcome block

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

## 6. QUESTIONS.md

**Path:** `.planning/features/{name}/QUESTIONS.md`

Written only when the plan loop returns NEEDS_INPUT under `--headless` (interactive runs never write it). Format:

- YAML frontmatter: `feature` (string), `roundOffset` (integer — the workflow's `nextRoundOffset`: the total number of `### Round n` labels consumed across all invocations so far, which includes an apply-answers step; when an older workflow returns no `nextRoundOffset`, the summed `rounds`), `created` (ISO date).
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

## 7. Answer round-trip

The caller (or a human) fills each `**Answer:**` line and re-invokes `/ship:go --headless {name}`. Go checks for the file **before** running the plan loop:

- **Every `**Answer:**` line non-empty** → build the Q/A transcript for `args.answers` — one `Q: {question}` / `A: {answer}` pair per question section — pass the frontmatter `roundOffset` to the plan workflow (`findings` are optional on resume — the workflow reads the open findings from the latest `## Plan Review` round in PLAN.md when none are passed, and applies the answers in a `replan:answers` step before its first review), then, once the workflow has been invoked, rename the file to `QUESTIONS-{roundOffset}.answered.md` (the `roundOffset` from its own frontmatter — strictly increasing across re-invocations, so the archive name is collision-free and deterministic), and continue the loop.
- **Any answer still empty** → terminate immediately as `needs-input` again, with `detail` "QUESTIONS.md awaiting answers" and `questions_file` set, without re-running the loop. Re-invoking with an unanswered file is idempotent.
- **File absent** → run the loop normally.

**Cap:** answered-file resumes count against the existing 2-re-invocation cap. A resume is identifiable from the files alone — one exists iff an archived file's `roundOffset` is greater than 0 — so the rounds-spent count never depends on session memory. A 3rd NEEDS_INPUT terminates as `needs-input` with a cap-reached `detail` ("re-invocation cap reached — escalate to a human"); the new QUESTIONS.md is still written so the questions are not lost. The caller escalates to a human.

## 8. Never-headless actions

- **`/ship:finish` is never invoked.** Routing on status `done` reports a `done` outcome instead of finishing; after a passing verify, the post-verify finish offer is suppressed and the run terminates as `done` with a `detail` noting `/ship:finish` is the manual next step. PR/merge is outward-facing and stays human-gated.
- **Verify FAIL terminates as `verify-fail`.** Fix tasks are already in PLAN.md; go never auto-retries a FAIL — the caller owns the retry decision.

## 9. Compatibility

- Interactive (non-headless) runs never write OUTCOME.json or QUESTIONS.md — behavior without `--headless` is byte-identical to a Ship without this contract.
- Callers' prompt-level contracts (e.g. solo-core's wrapper-prompt park instructions) remain the fallback for older Ship versions; this contract supersedes them when present. Ship-side changes must not require a lockstep caller release.
