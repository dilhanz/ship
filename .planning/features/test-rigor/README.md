# test-rigor (exemplar — DO NOT BUILD)

This feature directory is a frozen exemplar created by the pipeline-rigor feature. It exists to show, in one place, what a CONTEXT.md looks like when the new pipeline behaviours are exercised:

- Adaptive NFR probing (CLI-flavoured: skip rollout/observability, probe error handling).
- INCONCLUSIVE verdict on criteria that lack runnable verify commands.
- --accept-inconclusive operator override.
- The qa-failed status (referenced but not exercised here).

**Do not run `/ship:plan`, `/ship:build`, or any other Ship command on this feature.** Skills that scan `.planning/features/*` should treat the `exemplar: true` frontmatter field as a marker to skip — though enforcing that skip is OUT OF SCOPE for pipeline-rigor and may be a follow-up feature.

If you accidentally start a build, abort and revert.
