---
description: Run TDD workflow - write failing tests, implement, verify. For bugs, use the Prove-It pattern.
---

Invoke the installed `agent-skills:test-driven-development` skill. If that skill is unavailable, stop and report the missing dependency; do not silently substitute a generic workflow.

Use the text following this command as the feature or bug description and test scope. Discover the repository's actual runner and focused/full test commands first; do not assume `npm test`.

For new features:
1. Write tests that describe the expected behavior (they should FAIL)
2. Confirm the failure is caused by the missing behavior, not broken setup
3. Implement the code to make them pass
4. Refactor while keeping tests green
5. Run the repository's regression suite and applicable build/type/lint checks

For bug fixes (Prove-It pattern):
1. Write a test that reproduces the bug (must FAIL)
2. Confirm the test fails for the reported bug
3. Implement the fix
4. Confirm the test passes
5. Run the full test suite for regressions and applicable build/type/lint checks

For browser-related issues, also invoke the installed `agent-skills:browser-testing-with-devtools` skill. If that skill is unavailable, stop and report the missing dependency. Discover the configured browser tools before using them. If Chrome DevTools MCP or the required browser is unavailable, report the runtime-validation blocker; do not claim that unit tests prove browser behavior.

Preserve existing user changes and session permissions. Do not commit or push unless explicitly authorized.
