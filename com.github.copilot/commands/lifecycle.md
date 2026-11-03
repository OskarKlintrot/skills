---
description: Prepare a spec interactively, then coordinate the approved engineering lifecycle dynamic workflow
---

This command runs in the **main conversation**, not a subagent. Use the text following
the command as the feature or existing spec to work on. The main conversation owns
all questions, interviews, confirmations, risk decisions and workflow approvals.

Use the installed `agent-skills:spec-driven-development` skill for the specification
phase only. When intent is unclear, invoke `agent-skills:interview-me` here, not inside
the dynamic workflow. If a required skill is unavailable, stop and report the missing
dependency; do not silently substitute a generic workflow.

## Prepare with the user

Read repository instructions and relevant context. Respect current permissions and
preserve pre-existing work and the index. Do not commit, push, merge, or deploy.

Ask clarifying questions one at a time using `ask_user` in this main conversation.
Do not delegate requirements discovery or assume that a workflow worker can ask the
user. If interactive input is unavailable, stop and explain that preparation requires
a live user. An unattended invocation cannot substitute assumptions for decisions.

If `interview-me` is needed, follow its hypothesis, question, restatement and explicit
confirmation process. Respect its terminal-turn rule: after confirming intent, stop
that turn and let the user choose specification as the next step. Do not write a spec
or launch the workflow in the same turn as intent confirmation.

Once intent is concrete, write or review an actual spec in the current worktree, at
the repository's established spec location (default `SPEC.md`, never a README).
Handle any capability-map approval in this main conversation before writing module
specs. Select one concrete module spec per workflow run; do not merge unrelated scope.
Do not overwrite a spec or unfinished plan for other work without asking the user.
Keep specification questions and approvals here; do not advance through the skill's
Plan, Tasks or Implement phases.

Present the spec and get explicit user approval using `ask_user`. Do not treat
delegation, silence, hedged agreement or approval of intent as approval of the spec.
Record agreed requirements, boundaries and decisions in the spec without secrets.

## Run and coordinate

Only after preparation and spec approval, run the `engineering-lifecycle` dynamic
workflow with `{ "goal": "<confirmed scope>", "specPath": "<worktree-relative spec path>" }`.
If dynamic workflows are unavailable, stop and report that limitation.

The workflow validates the existing spec without conducting another interview, then
pauses at `approve-spec`. Inspect the logged report and actual spec. If the prior
explicit approval covers this exact unchanged spec, that approval may authorize
resuming this checkpoint; otherwise obtain approval with `ask_user` first. Never
infer approval just because a checkpoint is paused or a worker claims it was approved.

At `approve-plan`, inspect the full plan, dependencies, acceptance criteria and
verification commands. Explain that approval runs the finite task set sequentially
without between-task checkpoints and leaves all changes uncommitted. Get explicit
user approval using `ask_user`, then resume that exact run. Rejected or revised spec
or plan requires a new run, not resume of stale journaled output. Do not auto-approve.

Each worker is non-interactive. For **every phase** (Define, Plan, Build, Verify,
Review and Ship), inspect the workflow result and its reports. If `needsInput`
contains questions, ask them one at a time with `ask_user` here, keeping the source
phase and context. If a blocked report omits a usable question, explain its blocker
and ask for the specific missing decision when one is needed. A missing skill,
failed test or unavailable measurement is a blocker, not automatically a user decision.
Do not accept risks or grant permissions on the user's behalf.

Persist relevant answers in the spec or existing plan/task artifacts, preserving
unrelated work, and get renewed approval when scope or the plan changes. A completed
NO-GO result is not resumable: start a new run after the blocker is resolved. Its
plan must reconcile completed tasks and current evidence rather than repeat work
blindly. Runtime-paused/error runs may be resumed only after inspecting their actual
status and approved scope; do not blindly retry cancelled runs or partially edited tasks.

Review final verification and specialist findings with the user. GO means a
launch-readiness assessment only, never approval to commit, push, merge, deploy,
change feature flags, accept risk or execute rollback. Missing evidence is not a pass.
