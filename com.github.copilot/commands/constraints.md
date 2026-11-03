---
description: Define and enforce this project's quality bar - interview, sane defaults, CONSTRAINTS.md
---

Invoke the installed `agent-skills:constraint-driven-development` skill. If that skill is unavailable, stop and report the missing dependency; do not silently substitute a generic workflow.

Use the text following this command to select an operation:
- `check` - run the current constraints against this branch and report; do not change thresholds or configuration
- `guard` - inspect the diff for a weakened bar: lowered thresholds, skipped or deleted tests, new suppression comments, unfinished stubs, new exceptions; report without editing
- `ratchet` - measure today's values and record improvements as the floor that must not fall; never lower an existing bar
- No operation - set up constraints for this repository

For `check`, `guard`, or `ratchet`, read the existing `CONSTRAINTS.md` first. If it is missing, stop and report that setup is required; do not silently run setup instead. Ask about unknown or ambiguous operations.

For setup:

1. **Detect first.** Read the dependency/build manifest, test runner, lint configs, available coverage output, CI workflows, and Copilot repository instructions. Report what you found in two lines. Never ask for anything you can read.
2. **Interview, at most four questions.** One at a time, using Copilot's question tool when available, each with your best guess and a usable default:
   - Which dimensions beyond the floor (coverage, security, performance, accessibility, architecture)
   - Block or warn when a check fails mid-task
   - Target numbers, or measure today's values and hold them
   - Slowest check tolerated before handing work back
3. **Write `CONSTRAINTS.md`** at the repo root with a Floor section, enforced numbers, measured-only metrics with today's values, and an exceptions table with owners and expiry dates. Every number needs a stated reason. Preserve existing constraints unless the user explicitly approves a change.
4. **Wire the chosen dimensions to real tools.** Reuse existing tools/configuration; add missing dependencies only for the agreed dimensions and within session permissions. Examples: Semgrep for code scanning, gitleaks (always `--redact`) for secrets, osv-scanner for dependencies, axe-core for accessibility, Lighthouse for web vitals, size-limit for bundles, dependency-cruiser for boundaries, Stryker for assertion quality. Record the exact command next to each rule. Accessibility and performance need a running URL; if there is none, report that the check cannot be enforced and resolve scope with the user. Add fast/task/full commands using this repository's build system, not an assumed `package.json`.
5. **Place each check by cost.** Types, lint and secrets in the edit loop (seconds). Related tests and changed-line coverage at task end (under 90s). Everything else at review or in CI. Scope checks to the diff where the chosen tooling supports it.
6. **Point Copilot at it.** Add a concise instruction to the existing `.github/copilot-instructions.md` or `AGENTS.md` telling agents to read `CONSTRAINTS.md` and never weaken it to make a change pass. If neither exists, create `AGENTS.md`. Preserve unrelated instructions.
7. **Verify.** Run the constraints against the current branch and report real results. If a gate does not reflect the user's agreed bar, discuss and correct it explicitly; never lower thresholds merely to get green.

Honor the session's write permissions. Do not commit, push, or deploy unless explicitly authorized.
