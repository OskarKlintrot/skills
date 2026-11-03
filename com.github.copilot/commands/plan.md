---
description: Break work into small verifiable tasks with acceptance criteria and dependency ordering
---

Invoke the installed `agent-skills:planning-and-task-breakdown` skill. If that skill is unavailable, stop and report the missing dependency; do not silently substitute a generic workflow.

Use the text following this command to select the spec or planning scope.

Read the existing spec (`SPEC.md` or its established equivalent) and the relevant codebase sections. If the spec is missing or ambiguous, stop and ask rather than inventing requirements. Then:

1. Work in a planning-only phase - no implementation changes
2. Identify the dependency graph between components
3. Slice work vertically (one complete path per task, not horizontal layers)
4. Write tasks with acceptance criteria and verification steps
5. Add checkpoints between phases
6. Present the plan for human review

Save the plan to `tasks/plan.md` and the task list to `tasks/todo.md`, unless the repository already uses another planning location. Planning documents are the only intended writes; respect the session's permissions and use its plan-approval surface when available. Do not claim that this prompt switches Copilot's runtime mode.

If either document already contains unfinished tasks for different work, stop and ask before writing - never silently overwrite an incomplete plan. Do not implement the plan until the user approves implementation.
