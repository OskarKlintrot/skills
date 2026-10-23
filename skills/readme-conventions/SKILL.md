---
name: readme-conventions
description: Use when creating or editing README.md files in any directory, including README updates needed after code or configuration changes. Keep documentation accurate, lasting, and grounded in the current repository.
---

# README conventions

Apply these rules only when creating or editing a file named README.md, in any
directory. For other files, follow their applicable instructions.

Treat README.md as a maintained reference for the repository, not as a record of
an AI session, implementation plan, or deployment.

- Follow the README's existing language and concise style.
- Verify statements against the current code, configuration, scripts and
  workflows. Do not copy assumptions from plans or earlier sessions.
- Respect actual architecture and responsibility boundaries. Describe components
  and resource ownership according to their implemented roles, not assumptions
  based only on names or technology choices.
- Distinguish declared configuration from implemented, deployed and verified
  behavior. Claim deployment or verification only when supported by evidence.
- Describe the resulting architecture and behavior directly. Avoid change
  narration such as "we added", "now", "previously" or "instead of the old solution"
  when understanding it would require knowing an earlier version.
- Include lasting information: ownership, configuration, dependencies, normal
  workflows, repeatable operational procedures, recovery and relevant limitations.
- Keep session summaries, task status, test-result counts, temporary package
  hashes, pending PRs, rollout progress and instructions to merge or deploy a
  particular change outside README.md.
- Keep one-time handover gates, migration checklists, first-deployment acceptance
  checks and instructions to remove temporary code after deployment outside
  README.md. Put change-specific rollout instructions and cross-PR dependencies
  in PR descriptions.
- Describe actual monitoring and approvals. Do not present planned alerts,
  notifications or safety checks as implemented features.
- Keep commands and paths accurate. Paths are repository-relative unless the
  README states that they are relative to its own directory. Operational and
  deployment instructions must follow the repository's established delivery
  workflow and approval requirements.
- When relevant code changes, update or remove the corresponding description.
  Preserve useful ongoing procedures; do not rewrite unrelated sections.

Before finishing a README edit, check that each changed passage is understandable
without conversation history and remains useful after the current change,
deployment and cleanup are complete. Remove unsupported claims and transient
instructions rather than adding explanations of why the document was changed.
