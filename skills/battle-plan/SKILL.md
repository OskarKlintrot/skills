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

Each Plan branch keeps an accumulated findings ledger in workflow memory, not
in files. Findings include stable branch-local IDs, evidence sources, status and
reasons for changes; earlier rounds remain available to that branch and Judge.
These investigation findings are separate from Review's correction feedback.
Review receives only the question and its branch's complete plan, not the ledger.

Judge receives all three complete plans, reviews, stop reasons and ledgers. It
checks the evidence against available code and documentation, chooses the best
plan, and decides which concrete additions to take from each alternative, or why
nothing should be taken. Its structured decision references sections of the plans
without reproducing raw ledger entries or history.

Synthesize receives all three complete plans, reviews and stop reasons alongside
Judge's decision, but no ledgers. It uses the chosen plan as the base, incorporates
the selected additions and reports conflicts it cannot reconcile without changing
the decision. It does not choose the winner again. The final output is a complete
Markdown plan, not an implementation or approval.

The workflow validates Plan findings and Judge's decision before proceeding.
Ledger separation applies to workflow inputs; it is not tool or filesystem
isolation and cannot prevent an agent from copying ledger text into a plan.
Ledgers do not persist across separate runs, and their growing history consumes
part of the existing credit budget.

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