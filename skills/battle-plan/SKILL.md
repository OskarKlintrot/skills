---
name: battle-plan
description: Start the battle-plan dynamic workflow, which runs three parallel plan/review loops, judges the plans, and synthesizes the result.
---

# Battle plan

Use 3 iterations unless the user gives another number. `iterations` is the maximum
number of Plan/Review rounds per branch, including the first review. Each branch
stops early when Review finds no problems. Review checks the complete plan
against the original request and reports gaps, errors, contradictions, and
ambiguities for Plan to fix in the next round.

If findings remain at the iteration limit, continue to Judge and Synthesize with
the latest reviewed plans and report the remaining findings in the final result.

Pick each model from the model IDs available in this session, such as the
`model` options of the task tool, choosing the newest version in each family.
If a family has no available model, ask the user for a replacement with
`ask_user`.

Call `run_dynamic_workflow` with `name` set to `battle-plan` and these `args`:

```json
{
  "question": "<user request>",
  "iterations": <number>,
  "models": {
    "question": "<newest Claude Sonnet>",
    "plan": ["<newest GPT Luna>", "<newest MAI Code Flash>", "<newest Claude Haiku>"],
    "judge": "<newest GPT Sol>"
  }
}
```

The workflow also uses `models.plan[0]`, the newest available GPT Luna model,
for Synthesize after Judge.

Set the call's separate, top-level `limits.maxAiCredits` to the number
`100 + 60 * iterations`: 160 for one iteration, 220 for two, and 280 for the
default of three. This is a soft limit for the entire workflow, not a per-agent
limit.

If the dynamic workflow is unavailable, report that limitation rather than
substituting another workflow.