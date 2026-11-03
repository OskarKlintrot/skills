---
description: Implement tasks incrementally - build, test, verify. Add "auto" to run the whole plan in one approved pass.
---

Invoke the installed `agent-skills:incremental-implementation` skill alongside `agent-skills:test-driven-development`. If either skill is unavailable, stop and report the missing dependency; do not silently substitute a generic workflow.

## Modes

- **`/oskar-tools:build`** - implement the next pending task, then stop (one slice at a time).
- **`/oskar-tools:build auto`** - generate the plan if needed, get a single approval, then implement every task without stopping between them.

Use the text following this command as the mode and task scope. Treat a first argument of `auto` (canonical) or `all` as whole-plan mode; anything else or empty selects single-task mode. This is a workflow instruction, not a switch to Copilot's runtime Autopilot mode or a permission override. Whole-plan mode removes human stepping between tasks, not verification.

Read the repository's instructions and respect existing session permissions. Do not create branches, stash, reset, commit, push, or deploy without explicit authorization for that action. Approval to implement a plan is not approval to commit it.

## Default: one task

Pick the next pending task from the plan. Then:

1. Read the task's acceptance criteria and confirm its dependencies are complete
2. Load relevant context (existing code, patterns, types)
3. Write a failing test for the expected behavior (RED)
4. Implement the minimum code to pass the test (GREEN)
5. Run the repository's regression test suite
6. Run the build and applicable type/lint checks
7. If explicitly authorized to commit, stage only this task's files and commit with a descriptive message; otherwise leave the verified changes uncommitted
8. Mark the task complete and stop

## Whole plan (`/oskar-tools:build auto`)

Use this once a spec exists and you want to collapse plan + build into one run. Every task still earns verification and, when explicitly authorized, its own commit.

1. **Require a spec.** Look for a spec at a known path: `SPEC.md` at the repo root, `docs/SPEC.md`, a file under `spec/`, or the repository's established spec location. A README or arbitrary doc does not count. If none exists, stop and tell the user to run `/oskar-tools:spec` first - do not invent requirements.
2. **Establish a baseline.** Inspect `git status --porcelain` and relevant diffs. Preserve existing work. If existing changes conflict with the plan, or cannot be separated safely for authorized per-task commits, stop and ask how to handle them. Do not stash, reset, or absorb unrelated files.
3. **Plan if needed.** Use the repository's existing plan and task list, defaulting to `tasks/plan.md` and `tasks/todo.md`. If no plan exists, invoke `agent-skills:planning-and-task-breakdown` to generate one. If a required skill is unavailable, stop and report it. Do not overwrite unfinished plans for different work.
4. **Single checkpoint.** Present the full plan and wait for an unambiguous affirmative (e.g. "approve", "go", "yes"), using the available question or plan-approval surface. Treat hedged responses as not approved. If the session's permissions do not permit implementation, stop for the user's mode or permission decision rather than bypassing it. Commit newly generated planning documents separately only if commits were explicitly authorized.
5. **Execute every task in dependency order.** Use declared dependencies; if missing or contradictory, resolve them before execution rather than inferring dependencies from list order. For each task, run the default loop above (RED -> GREEN -> regression -> build -> optional authorized commit -> mark complete). Stage only files for that task plus its status update; never blindly use `git add -A`.
6. **Stop and ask the user** when:
   - a test cannot be made to pass or the build breaks without an obvious fix - follow `agent-skills:debugging-and-error-recovery`
   - the spec is ambiguous, or a task needs a decision the spec does not cover
   - a task is high-risk or irreversible: auth/permission changes, destructive data migrations, payments, deletions, deploys, secrets, or anything that cannot be undone safely - follow `agent-skills:doubt-driven-development` and get explicit sign-off

   If a required skill is unavailable, stop and report it. After the user resolves a blocker, resume from the next pending task; do not repeat completed work.
7. **Summarize at the end:** tasks completed, tests added, commits made or changes left uncommitted, and anything skipped, flagged, or left for the user.

If any verification step fails, follow the installed `agent-skills:debugging-and-error-recovery` skill. If that skill is unavailable, stop and report the blocker.
