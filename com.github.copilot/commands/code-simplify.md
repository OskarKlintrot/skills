---
description: Simplify code for clarity and maintainability - reduce complexity without changing behavior
---

Invoke the installed `agent-skills:code-simplification` skill. If that skill is unavailable, stop and report the missing dependency; do not silently substitute a generic workflow.

Use the text following this command as the target scope; default to recently changed code.

Simplify that code while preserving exact behavior:

1. Read applicable repository instructions (`AGENTS.md`, `.github/copilot-instructions.md`, and relevant path-specific instructions) and study project conventions
2. Identify the target code - recent changes unless a broader scope is specified
3. Understand the code's purpose, callers, edge cases, and test coverage before touching it
4. Scan for simplification opportunities:
   - Deep nesting -> guard clauses or extracted helpers
   - Long functions -> split by responsibility
   - Nested ternaries -> if/else or switch
   - Generic names -> descriptive names
   - Duplicated logic -> shared functions
   - Dead code -> remove only after confirming it is unused
5. Apply each simplification incrementally - run relevant tests after each change
6. Verify all applicable tests pass, the build succeeds, and the diff contains only intended simplifications

If tests fail after a simplification, undo only your failing edit, preserving pre-existing user work, and reconsider. Do not reset the working tree. Invoke the installed `agent-skills:code-review-and-quality` skill to review the result; if that skill is unavailable, stop and report the missing dependency. Do not commit or push unless explicitly authorized.
