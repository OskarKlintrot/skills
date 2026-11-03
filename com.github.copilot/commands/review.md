---
description: Conduct a five-axis code review - correctness, readability, architecture, security, performance
---

Invoke the installed `agent-skills:code-review-and-quality` skill. If that skill is unavailable, stop and report the missing dependency; do not silently substitute a generic workflow.

Use the text following this command as the review scope. Otherwise review the current staged and unstaged changes; if the working tree is clean, review the most recent commit and state that scope. Read applicable repository instructions and the relevant spec.

Review across all five axes:

1. **Correctness** - Does it match the spec? Edge cases handled? Tests adequate?
2. **Readability** - Clear names? Straightforward logic? Well-organized?
3. **Architecture** - Follows existing patterns? Clean boundaries? Right abstraction level?
4. **Security** - Input validated? Secrets safe? Auth checked? (Invoke `agent-skills:security-and-hardening` when relevant.)
5. **Performance** - No N+1 queries? No unbounded ops? (Invoke `agent-skills:performance-optimization` when relevant.)

If a required skill is unavailable, stop and report the missing dependency. Do not fabricate measurements or claim checks that were not run.

Categorize findings as Critical, Required, Optional, or Nit. Output a structured review with specific file:line references and fix recommendations; state explicitly when no actionable findings are found.

This command is review-only: do not edit code, commit, post GitHub review comments, approve a PR, or merge unless the user separately authorizes that action.
