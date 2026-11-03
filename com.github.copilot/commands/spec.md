---
description: Start spec-driven development - write a structured specification before writing code
---

Invoke the installed `agent-skills:spec-driven-development` skill. If that skill is unavailable, stop and report the missing dependency; do not silently substitute a generic workflow.

Use the text following this command as the feature description and scope.

Begin by understanding what the user wants to build. Read existing project context first, then ask remaining clarifying questions one at a time using Copilot's question tool when available:
1. The objective and target users
2. Core features and acceptance criteria
3. Tech stack preferences and constraints
4. Known boundaries (what to always do, ask first about, and never do)

Then generate a structured spec covering all six core areas: objective, commands, project structure, code style, testing strategy, and boundaries.

If the request bundles several independently testable capabilities, first propose a capability map (module ids, dependency direction, build order) per the skill's Phase 0 and get it approved, then spec each module in dependency order.

Save the spec as `SPEC.md` in the project root, or the repository's established spec location. If an existing spec covers different or unfinished work, ask before replacing it. Confirm the spec with the user before proceeding to implementation.

Do not commit or push unless explicitly authorized, even if the invoked skill recommends committing the spec. Approval of the spec does not authorize Git operations.
