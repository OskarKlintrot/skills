# Addy lifecycle skill and persona dependencies

The original Addy lifecycle does not require implementations to avoid other
skills. Its [official lifecycle page](https://skills.addy.ie/lifecycle/)
describes commands that load the right skills automatically and says users may
use a skill directly or use the meta-skill to route the work.

The first-party [getting-started guide](https://github.com/addyosmani/agent-skills/blob/main/docs/getting-started.md#using-commands)
maps lifecycle commands to skills: `/spec` to
`spec-driven-development`, `/plan` to `planning-and-task-breakdown`, `/build`
to `incremental-implementation` and `test-driven-development`, and `/ship` to
`shipping-and-launch`. The first-party
[meta-skill](https://github.com/addyosmani/agent-skills/blob/main/skills/using-agent-skills/SKILL.md#skill-rules)
calls skills workflows rather than suggestions, while noting that not every
task needs every skill.

Personas are specialist roles, not a required component of every lifecycle
phase. The first-party [agent guide](https://github.com/addyosmani/agent-skills/blob/main/docs/agents.md#how-personas-relate-to-skills-and-commands)
distinguishes personas from skills. Its prescribed `/ship` workflow explicitly
fans out to `code-reviewer`, `security-auditor`, and `test-engineer` ([source
command](https://github.com/addyosmani/agent-skills/blob/main/.claude/commands/ship.md#phase-a--parallel-fan-out)).

**Conclusion:** independence from installed skills is not an upstream
requirement. A trigger-only lifecycle skill can start a workflow that composes
the upstream phase skills; the lifecycle's Review phase should use the
specialist personas where available/required by the chosen shipping process.
