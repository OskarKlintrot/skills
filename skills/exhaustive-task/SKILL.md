---
name: exhaustive-task
description: Run the exhaustive-task dynamic workflow for large tasks agents tend to stop early on, such as finding every integration, listing every design/implementation difference, or applying the same change across many files or repositories. Use when asked to run exhaustive-task or keep going in batches until nothing new is found.
---

# Exhaustive task

Coordinate in the **main conversation**. This skill owns preparation, user decisions,
round-checkpoint approval and recovery. Workers run autonomously after launch.
Run the workflow, not a hand-written approximation of its loop.

The workflow processes small batches and records results in a ledger it owns:
unit rounds (a batch of files or repositories each), then review rounds with
changing search strategies until `quietRounds` consecutive review rounds find
nothing new. Every round is Work -> independent read-only Verify -> Commit when
files changed.

## Prepare

1. Read repository instructions and relevant context. Establish the exact goal
   and checkable acceptance criteria: what counts as a finding or a finished change,
   and which details each ledger entry needs. Ask unresolved questions one at a
   time with `ask_user`; do not launch with ambiguous requirements.
2. Choose the mode and propose it to the user:
   - `files`: work lives in files of the current repository. `paths` are
     repository-relative (`["."]` for everything). Requires the worktree root as
     working directory.
   - `repos`: the same task per Git repository under absolute `paths`, for
     example "update packages in every repository under C:\repos".
   - `search`: no enumerable units, for example design versus implementation.
     Sources workers cannot reach, such as a canvas, must first be exported to a
     file and named in the goal.
3. Propose an absolute `ledgerPath` and ask the user to confirm or change it:
   in the repository when the ledger is a deliverable (it is committed with each
   round), otherwise in the session's `files/` folder. An existing ledger for the
   same goal and mode continues where it stopped; use a new path for a fresh start.
4. Ask with `ask_user` about the batch size: propose 5 for `files` and `search`
   and 1 for `repos`, or the user's own number.
5. Ask with `ask_user` whether to use a round ceiling, unless the user already
   answered for this invocation: no ceiling or a user-chosen positive integer.
   Omit `maxRounds` for no ceiling. Never invent a default. Explain that without a
   ceiling execution continues until completion, a blocker or a runtime limit.
   Set credit/time/agent limits only when the user specifies them.
6. Load the installed `agent-skills:git-workflow-and-versioning` skill and follow
   repository Git conventions. If unavailable, stop and report the dependency.
   Confirm each affected repository is on a non-default feature branch or worktree
   the user accepts for commits. Do not switch branches yourself.
7. Show `git status --porcelain` for affected repositories. The workflow records
   dirty files at start as user work that workers must not revert or commit; ask
   whether that is acceptable or whether the user wants to commit them first.
8. Present goal, acceptance, mode, paths, ledger, batch size and ceiling for
   explicit launch approval using `ask_user`. Explain that each round with changed
   files gets local commits on the current branch; no pushes, merges or
   deployments are authorized. If approval cannot be obtained interactively, stop.

## Launch and coordinate

After approval, run the `exhaustive-task` dynamic workflow with:

```json
{
  "goal": "<agreed task>",
  "acceptance": "<concrete criteria and required checks>",
  "mode": "files",
  "paths": ["."],
  "ledgerPath": "<absolute path>",
  "batchSize": 5,
  "maxRounds": 10
}
```

The numbers are illustrative. Use the user's answers; omit `maxRounds` for no
ceiling. If dynamic workflows are unavailable, report the limitation; do not
silently substitute a single agent. Leave model selection to runtime preferences.

Inspect the runtime envelope and result before acting:

- **Paused at `round-limit-v2:<round>`:** read the ledger and logged progress.
  Present findings so far and remaining units, then use `ask_user` to approve the
  next batch of rounds or stop. Only explicit approval authorizes resuming that
  exact run. Never auto-resume. Edits while paused block the resumed round.
- **Completed with `status: "blocked"`:** not complete. Inspect `reason`,
  `remainingUnits`, `report` and `needsInput`. Ask needed decisions one at a time.
  After resolving the cause, renew approval if scope or risk changed and start a
  new run with the same `ledgerPath`; it continues after the processed units.
- **Runtime error, limit or interruption:** inspect run state and partial edits
  before resuming. Obtain approval before raising a reached resource limit; raise
  only that limit. Never blindly retry or discard partial work.
- **Complete:** summarize findings, changes, commits and the ledger location.
  Say that completion means agents stopped finding new results after varied
  searches, not proven completeness.

## Recovery boundaries

Rollback is not permission to overwrite user work. Workers may undo only their own
uncommitted edits, preferring a reverse patch over whole-file restoration. Never
blindly restore a file from the default branch: it can erase valid feature-branch
work as well as the failed attempt. Branch-wide resets, hard resets, history
rewrites and undoing committed or user work require explicit user direction.
