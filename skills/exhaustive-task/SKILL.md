---
name: exhaustive-task
description: Run the exhaustive-task dynamic workflow for large tasks agents tend to stop early on, such as finding every integration, listing every design/implementation difference, or applying the same change across many files or repositories. Use when asked to run exhaustive-task or keep going in batches until nothing new is found.
---

# Exhaustive task

Coordinate in the **main conversation**. This skill owns preparation, user decisions,
round-checkpoint approval and recovery. Workers run autonomously after launch.
Run the workflow, not a hand-written approximation of its loop.

The workflow replaces asking an agent "did you find everything?" until it stops
finding things. It processes small batches and records results in a ledger it
owns: unit rounds (a batch of files or repositories each), then review rounds
with changing search strategies until `quietRounds` consecutive review rounds
find no new progress. New findings and changes always count as progress; new
locations on known findings also count when the goal requires every occurrence.
A final read-only verification then checks the ledger and can
reopen the search. Rounds that change files are verified; rounds that only
record findings are not, which keeps discovery cheap. The workflow has no commit
step: changes stay uncommitted unless the goal asks workers to commit them.

## Prepare

1. Read repository instructions and relevant context. Establish the exact goal
   and checkable acceptance criteria: what counts as a finding or a finished change,
   and which details each ledger entry needs. Choose `coverage` from the goal:
   - `findings`: unique kinds, for example a catalogue of UI component types.
     Another location of a known type is saved but does not extend the search.
   - `occurrences`: every instance, for example every button or replacing Y
     everywhere. Another distinct location extends the search. Require precise,
     consistent source anchors that distinguish occurrences within one file.
   Select this automatically when the goal is clear; ask only when the distinction
   is ambiguous. Explain it with the user's own task, not parameter names alone.
   Ask unresolved questions one at a time with `ask_user`; do not launch with
   ambiguous requirements.
2. Choose the mode and propose it to the user:
   - `files`: explicit file-by-file coverage of the current repository. `paths` are
     repository-relative (`["."]` for everything). Requires the worktree root as
     working directory.
   - `repos`: the same task per Git repository under absolute `paths`, for
     example "update packages in every repository under C:\repos".
   - `search`: semantic discovery, for example "find every integration", identify
     UI components in a design, or design versus implementation. Prefer this for
     discovery even when the sources are files: files are not the findings.
     Usually the cheapest choice for discovery.
     Sources workers cannot reach, such as a canvas, must first be exported to a
     file and named in the goal.
   A single scoped file still receives a full unit pass in `files` mode, followed
   by varied review rounds and final verification; one file never means one round.
3. Propose an absolute `ledgerPath` and ask the user to confirm or change it:
   in the repository when the ledger is a deliverable (every productive round
   then changes the files, which costs a Verify agent per productive round),
   otherwise in the session's `files/` folder. An existing ledger for the same
   goal, mode and coverage continues where it stopped; use a new path for a fresh
   start or different coverage. Legacy ledgers use `findings` coverage.
4. Use the user's batch size if supplied; otherwise use 5 for `files` and `search`
   and 1 for `repos`. Do not ask a separate batch-size question. Batch size is a
   workload setting, not a completeness limit: it controls files/repositories per
   unit round, or changes per review round. Findings are never capped. For
   read-only `search`, it has no effect; omit it from the launch summary instead
   of asking about files per batch.
5. Ask with `ask_user` which models to use, unless the user already said. Propose
   leaving both to runtime preferences, or a cheaper `model` for workers with an
   optional stronger `verifyModel` for verification. Never
   invent model names; use names the user gives or the runtime lists.
6. Ask with `ask_user` whether to use a round ceiling, unless the user already
   answered for this invocation. Offer the recommended ceiling first, marked
   "(Recommended)", then no ceiling and a custom positive integer. Recommend 10
   for `search`; for `files` and `repos`, the number of unit batches
   (units divided by `batchSize`, rounded up) plus 5 review rounds. The ceiling
   pauses the run for approval to continue rather than ending it, so it caps
   spend without losing work. Omit `maxRounds` for no ceiling. Explain that
   without a ceiling execution continues until completion, a blocker or a
   runtime limit.
   Set credit/time/agent limits only when the user specifies them.
7. If the task changes files, ask with `ask_user` whether workers should commit
   their changes or leave them uncommitted, unless the user already said; leaving
   them uncommitted is the default. Only a goal that explicitly asks for commits
   lets workers commit, and they do so in Work, before verification. When the
   user wants commits, say so in the goal, load the installed
   `agent-skills:git-workflow-and-versioning` skill and follow repository Git
   conventions; if unavailable, stop and report the dependency. Workers commit
   only on a short-lived feature branch or worktree, never on the default or a
   detached branch. For each affected repository on its default branch, propose
   a feature branch named by repository convention (for example
   `chore/update-packages`) and create it from the default branch only after the
   user approves; otherwise exclude that repository. Never switch a repository
   that has uncommitted changes without the user's decision.
8. Show `git status --porcelain` for affected repositories. The workflow records
   dirty files at start as user work that workers must not revert or commit; ask
   whether that is acceptable or whether the user wants to commit them first.
9. Present goal, acceptance, mode, coverage in plain language, paths, ledger,
   batch size when relevant (with its meaning and the option to override it),
   models, ceiling and the commit choice for explicit launch approval using
   `ask_user`. No pushes,
   merges or deployments are authorized. If approval cannot be obtained
   interactively, stop.

## Launch and coordinate

After approval, run the `exhaustive-task` dynamic workflow with:

```json
{
  "goal": "<agreed task>",
  "acceptance": "<concrete criteria and required checks>",
  "mode": "files",
  "coverage": "occurrences",
  "paths": ["."],
  "ledgerPath": "<absolute path>",
  "batchSize": 5,
  "maxRounds": 10
}
```

The numbers and coverage are illustrative. Always pass the coverage selected
from the agreed goal; direct invocation defaults to `findings` for compatibility.
Use the user's answers; omit `maxRounds` for no
ceiling and omit `model`/`verifyModel` to use runtime preferences. If dynamic
workflows are unavailable, report the limitation; do not silently substitute a
single agent.

Inspect the runtime envelope and result before acting:

- **Paused at `round-limit-v2:<round>`:** read the ledger and logged progress.
  Present findings so far and remaining units, then use `ask_user` to approve the
  next batch of rounds or stop. Only explicit approval authorizes resuming that
  exact run. Never auto-resume. Edits while paused block the resumed round.
- **Completed with `status: "blocked"`:** not complete. Inspect `reason`,
  `remainingUnits`, `report` and `needsInput`. A blocked round leaves its
  edits in place, unverified; do not let them pile up. Show `git status` and the diff
  since the run started, then ask whether to keep them for the next run or
  undo the workflow's own edits with a reverse patch, preserving
  pre-existing user work. Ask needed decisions one at a time.
  After resolving the cause, renew approval if scope or risk changed and start a
  new run with the same `ledgerPath`; it continues after the processed units.
- **Runtime error, limit or interruption:** inspect run state and partial edits
  before resuming. Obtain approval before raising a reached resource limit; raise
  only that limit. Never blindly retry or discard partial work.
- **Complete:** summarize findings, changes, `rejected` findings and the
  ledger location. Show `git status` for changed repositories; uncommitted
  changes and an in-repository ledger are left for the user to review and commit.
  Say that completion means agents stopped finding new results after varied
  searches and a final check, not proven completeness.

## Recovery boundaries

Rollback is not permission to overwrite user work. Workers may undo only their own
uncommitted edits, preferring a reverse patch over whole-file restoration. Never
blindly restore a file from the default branch: it can erase valid feature-branch
work as well as the failed attempt. Branch-wide resets, hard resets, history
rewrites and undoing committed or user work require explicit user direction.
