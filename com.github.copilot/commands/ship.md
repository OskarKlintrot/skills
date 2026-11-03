---
description: Run the pre-launch checklist via parallel specialist reviews, then synthesize a go/no-go decision
---

Invoke the installed `agent-skills:shipping-and-launch` skill. If that skill is unavailable, stop and report the missing dependency; do not silently substitute a generic workflow.

Use the text following this command as the change, release, or deployment target to assess.

This command assesses launch readiness and produces a decision and rollback plan. It does not authorize deployment, commits, pushes, PR approval, or merging. Respect repository instructions, existing user work, and session permissions.

## Phase A - Parallel specialist reviews

Establish the exact change scope (staged/unstaged changes or specified commits), relevant spec, and available verification commands before delegating.

Use Copilot's available subagent/delegation tool to launch three independent reviews in parallel, issuing the calls together:

1. **Code reviewer** - Invoke `agent-skills:code-review-and-quality` and review correctness, readability, architecture, security, and performance. Return specific file:line findings, categorized as Critical, Required, Optional, or Nit.
2. **Security auditor** - Invoke `agent-skills:security-and-hardening` and inspect OWASP Top 10, secrets handling, auth/authz, and available dependency vulnerability evidence. Return severity, confidence, file:line evidence, and remediations. Never print credentials.
3. **Test engineer** - Invoke `agent-skills:test-driven-development` for test strategy and analyze coverage of happy paths, edge cases, error paths, and concurrency. Return gaps, supporting test/file references, and actual verification results or checks not run. Do not implement tests or fixes during this assessment.

Use a matching custom agent only if Copilot actually exposes it; otherwise use an available general-purpose subagent with the role instructions above. Skills installed from the Addy plugin do not imply that its specialist agents are registered.

Give each subagent a complete, bounded assignment: exact scope, relevant spec paths, its role instructions, required skills, and expected report. They must preserve repository files, not delegate further, and return independently to the main session. Inherit the user's agent/model preferences; do not hardcode a model or tool name from another client.

If a required skill is unavailable, stop and report it. If delegation or parallel execution is unavailable, state the limitation and run the same checks directly and sequentially; label this as a single-context assessment, not independent parallel reviews.

## Phase B - Merge in main context

Once all three reports are back, the main agent synthesizes them:

1. **Code Quality** - Aggregate Critical/Required findings and any failing tests, lint, or build output. Resolve duplicates between reviewers.
2. **Security** - Promote Critical/High security findings to launch blockers. Cross-reference the code review's security axis.
3. **Performance** - Pull from the code review's performance axis; cross-check sourced Core Web Vitals if applicable. Do not invent metrics.
4. **Accessibility** - Verify keyboard navigation, screen reader support, and contrast when applicable; report unavailable browser evidence.
5. **Infrastructure** - Env vars, migrations, monitoring, feature flags. Verify directly without exposing secret values or performing deployments.
6. **Documentation** - README, ADRs, changelog. Verify directly.

Mark missing, failed, or incomplete checks explicitly. A missing report or required verification is not a passing result.

## Phase C - Decision and rollback

Produce a single output:

```markdown
## Ship Decision: GO | NO-GO

### Blockers (must fix before ship)
- [Source reviewer: finding + file:line, or required check without evidence]

### Recommended fixes (should fix before ship)
- [Source reviewer: finding + file:line]

### Acknowledged risks (accepted by the user)
- [Risk + mitigation + explicit acceptance, or none]

### Rollback plan
- Trigger conditions: [signals that would prompt rollback]
- Rollback procedure: [exact steps]
- Recovery time objective: [target, or not established]

### Specialist reports (full)
- [Code review report]
- [Security audit report]
- [Test coverage report]
```

## Rules

1. Run Phase A reviews independently in parallel when supported; disclose any single-context fallback.
2. Reviewers do not call each other. The main agent merges in Phase B.
3. A rollback plan is mandatory before a GO decision.
4. Critical/High security findings, Critical code findings, failing required checks, or missing required evidence default to NO-GO. Do not accept risks on the user's behalf.
5. Skip the fan-out only if all of the following are true: the change touches at most 2 files, the diff is under 50 lines, and it does not touch auth, payments, data access, or config/env. In that case perform the same checks directly and identify that scope in the report.
