# Personal Copilot plugin

`oskar-tools` is a personal [Agent Plugins 1.0](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) plugin, distributed through the `oskar-personal` marketplace in this repository.

The plugin provides [skills](#git-conventions), [engineering commands](#engineering-workflow-commands), [specialist agents](#agents), and [dynamic workflows](#dynamic-workflows).

## Git conventions

The `git-conventions` skill and hook apply these conventions to agent Git operations:

- **Commit messages and PR titles:** `<type>(<optional scope>): <Capitalized imperative>`, where type is one of `feat`, `fix`, `perf`, `docs`, `style`, `refactor`, `test`, or `build`. The first line is at most 72 characters.
- **Language and tone:** English, plain and concise (based on [`bro`](https://github.com/cursor/plugins/tree/main/pstack/skills/bro)). Messages containing `åäöæø` are rejected as a heuristic for non-English text.
- **Branches:** `feature/<kebab-case>` or `release/<name>`.

The hook checks supported agent calls involving commits, branches, and GitHub or Azure DevOps pull requests, including PR edits and merges. It does not check commands you run yourself or messages it cannot resolve, such as variable values. `fixup!`, `squash!`, and `amend!` commits are excluded. The hook requires PowerShell 7 (`pwsh`) on `PATH`; if validation fails internally, the call is allowed.

## README conventions

The `readme-conventions` skill treats README files as maintained references. It follows the existing language and style, checks claims against the project, and keeps session status and one-time rollout details elsewhere.

## C# 15

The `csharp-15` skill provides guidance on C# 15 and .NET 11 features. Its preview memory-safety guidance is used only when requested.

## Plan change

Use `/oskar-tools:plan-change` to make a concise plan with evidence, test cases, out-of-scope items, and merge risks. It uses the native plan presentation in Plan mode, returns the full plan to a workflow or subagent caller, and otherwise saves it in the session's files. You can request a file or text output. Creating a plan does not approve its implementation.

## Engineering workflow commands

The engineering commands and `addy-lifecycle` use the separately installed [agent-skills](https://github.com/addyosmani/agent-skills) plugin:

```powershell
copilot plugin marketplace add addyosmani/agent-skills
copilot plugin install agent-skills@addy-agent-skills
copilot skill list
```

Copilot registers plugin commands with the plugin name as a prefix. Use the full names below; bare `/plan` and `/review` remain Copilot's built-in commands.

| Command | Workflow |
| --- | --- |
| `/oskar-tools:spec <feature>` | Clarify requirements and write a spec. |
| `/oskar-tools:addy-lifecycle <feature or spec>` | Start the standalone workflow, which owns requirements, spec, plan, implementation, verification, review and launch-readiness gates. |
| `/oskar-tools:plan <scope>` | Break a spec into tasks without implementing it. |
| `/oskar-tools:build [auto\|all]` | Implement the next task or the approved whole plan. |
| `/oskar-tools:test <feature or bug>` | Run TDD or the Prove-It bug-fix workflow. |
| `/oskar-tools:review <scope>` | Review changes without editing or posting to GitHub. |
| `/oskar-tools:code-simplify <scope>` | Simplify changed code without changing behavior. |
| `/oskar-tools:constraints [check\|guard\|ratchet]` | Set up or operate the quality bar. |
| `/oskar-tools:webperf <URL, report, or scope>` | Audit browser-facing performance. |
| `/oskar-tools:ship <scope>` | Assess launch readiness and provide a rollback plan; does not deploy. |

Arguments follow the command in chat. `/oskar-tools:build` includes a commit after each verified task; `build auto` also commits newly generated planning documents separately after plan approval. `/oskar-tools:spec` follows the upstream skill's instruction to commit the spec. `/oskar-tools:addy-lifecycle` commits the approved spec, approved plan/task artifacts, and each verified task separately. These workflows do not switch Copilot's runtime mode or bypass tool permissions and repository instructions. Commits do not authorize pushing, merging, or deploying.

Live browser measurements require suitable configured tools, such as Chrome DevTools MCP. Unavailable measurements are reported as such.

Some commands and agents are adapted from [Addy's agent-skills](https://github.com/addyosmani/agent-skills). Their MIT license notices are in `com.github.copilot\commands\LICENSE` and `com.github.copilot\agents\LICENSE`.

## Install

Use a GitHub Copilot CLI with Agent Plugins 1.0 support:

```powershell
copilot plugin marketplace add OskarKlintrot/skills
copilot plugin marketplace browse oskar-personal
copilot plugin install oskar-tools@oskar-personal
copilot plugin list
```

Installation registers the marketplace and installs the plugin in your user-level Copilot configuration. It does not enable automatic updates for this marketplace.

### Optional automatic updates

You can opt in during installation or later. In your user-level `%USERPROFILE%\.copilot\settings.json`, find `extraKnownMarketplaces` and its `oskar-personal` entry, then add:

```json
"autoUpdate": true
```

Add this property to the existing marketplace entry without replacing its source information or other settings. If `COPILOT_HOME` is set, use its `settings.json` instead. Automatic updates depend on the client and its settings, policies, and trust requirements; see the [configuration reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference#configuration-file-settings).

## Update

To update manually:

```powershell
copilot plugin marketplace update oskar-personal
copilot plugin update oskar-tools
```

The first command refreshes the marketplace catalog; the second updates the installed plugin. Start a new session to use updated content.

When publishing content changes, increment `version` in `plugin.json`. During `0.x` development, use a minor version for additions or breaking changes and a patch version for compatible fixes. After `1.0.0`, follow [Semantic Versioning](https://semver.org/).

## Develop locally

The recommended local workflow is to register this clone as a marketplace. From the repository root:

```powershell
copilot plugin marketplace add .
copilot plugin marketplace browse oskar-personal
copilot plugin install oskar-tools@oskar-personal
copilot plugin list
```

Use either the local or GitHub marketplace source for `oskar-personal`, not both at once. Path-sourced plugins in a local directory marketplace load live from their source directory; restart or start a new session after edits rather than running `plugin update`.

For a direct local installation instead, use the absolute path:

```powershell
copilot plugin install (Get-Location).Path
```

Direct local installations are cached. Run that install command again after changes, then start a new session.

### Global development mappings on Windows

As an alternative to loading the plugin, directory junctions can expose a stable clone as personal CLI customizations. Plugin installation does not create these mappings:

| Global directory under `%USERPROFILE%\.copilot` | Source relative to the clone |
| --- | --- |
| `skills` | `skills` |
| `agents` | `com.github.copilot\agents` |
| `hooks` | `com.github.copilot\hooks` |
| `instructions` | `instructions` |

If `COPILOT_HOME` is set, its directory replaces `%USERPROFILE%\.copilot`. These mappings do not expose plugin commands or dynamic workflows.

Use this fail-fast, idempotent setup procedure:

1. Confirm all four source directories exist in the stable clone. Stop on a missing source; do not create an empty substitute or map a cache directory.
2. Inspect every destination before changing anything. An existing junction to the exact intended source is already correct: leave it unchanged. Compare resolved absolute targets, ignoring Windows path casing and trailing separators.
3. Stop on any conflicting destination: a regular file or directory, a symbolic link, or a junction to a different or missing target. Preserve it and resolve the conflict explicitly. Never delete, overwrite, or move existing customizations automatically.
4. After all preflight checks pass, create junctions only for missing destinations, using PowerShell `New-Item -ItemType Junction` with explicit absolute paths. Check each result and surface any error; rerunning the procedure must preserve all correct existing mappings.
5. Leave the existing global `copilot-instructions.md` file untouched. It is a separate instruction source, not the destination of the `instructions` mapping. Preserve unrelated settings and customizations.

Edits through a junction change files in the clone. Global hook mappings also execute hook definitions locally, so review hook changes before starting a new session.

### Reload and duplicate sources

When using global mappings, keep `oskar-tools@oskar-personal` disabled:

```powershell
copilot plugin disable oskar-tools@oskar-personal
copilot plugin list
```

Also avoid mounting the same plugin with `--plugin-dir` or keeping an enabled direct installation alongside the mappings. Inspect `plugin list` for those separate installs. Choose one loading route for skills, agents, and hooks: plugin loading or global mappings. Do not rely on deduplication; duplicate hook sources can execute the same command more than once.

Start a new CLI session after changing mappings or content; use `/restart` where supported. Inspect instruction discovery in the intended working directory:

```powershell
copilot instruction list --json
```

Check the paths and `applyTo` values, not just the presence of a filename. This lists what that CLI process discovers; it is not proof of what an already-running desktop or SDK session has loaded. An existing session can retain its previous state.

## Agents

The plugin provides four specialist agents:

| Copilot agent ID | Role | Used by |
| --- | --- | --- |
| `oskar-tools:code-reviewer` | Five-axis code review | `/oskar-tools:ship`, lifecycle Review |
| `oskar-tools:security-auditor` | Security and trust-boundary review | `/oskar-tools:ship`, lifecycle Review |
| `oskar-tools:test-engineer` | Test strategy and coverage analysis | `/oskar-tools:ship`, lifecycle Review |
| `oskar-tools:web-performance-auditor` | Sourced web-performance assessment | `/oskar-tools:webperf` |

These agents use skills from the separately installed `agent-skills` plugin.

## Dynamic workflows

[Dynamic workflows](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-dynamic-workflows) require experimental features. They can use multiple agents and AI credits.

The `hello-world` workflow uses no agents or AI credits:

```powershell
copilot --experimental workflow run hello-world --args '{"name":"Oskar"}'
```

In an interactive session, enable experimental features and ask Copilot to run `hello-world`.

### Battle plan

`battle-plan` creates and reviews three plans in parallel. A judge compares the plans and their investigation findings with the request and available code, chooses the best plan, and selects useful additions from the others. The final plan includes those additions and reports remaining review findings. It does not implement the plan.

Start with `/oskar-tools:battle-plan <question>`. The workflow requires the installed `plan-change` skill. It runs up to three reviews per plan by default; specify another positive number to change the limit.

Investigation findings are not passed directly to Review or Synthesize. This is not a confidentiality guarantee: agents share tools and can repeat information in their responses. The workflow asks agents to plan, but does not enforce read-only access or worktree isolation; include task-specific boundaries in the request.

The skill sets a soft, post-paid credit limit of `100 + 60 * iterations` for the whole workflow. Direct calls default to 160 credits unless overridden through the SDK. Parallel work can settle above the limit.

To start the workflow directly, provide a non-empty `question`, three `plan` models and one `judge` model. The optional `iterations` defaults to 3. Replace the model placeholders with IDs available in your session:

```powershell
copilot --experimental workflow run battle-plan --args '{"question":"Compare approaches to this problem. Plan and review only; do not edit files.","iterations":1,"models":{"plan":["<model-1>","<model-2>","<model-3>"],"judge":"<judge-model>"}}'
```

### Exhaustive tasks

Start `/oskar-tools:exhaustive-task <task>` for broad searches or repeated changes across files or repositories. It reviews results in rounds and performs a final check. Completion means the agents stopped finding new results, not that completeness is proven.

Before launch, agree on the goal, acceptance criteria, scope, findings ledger, models, optional round ceiling, and whether workers may commit. Choose `findings` coverage for unique kinds of result or `occurrences` for every instance. The skill requests explicit launch approval.

Modes:

| Mode | Units | `paths` |
| --- | --- | --- |
| `files` | Tracked and non-ignored untracked files in the current repository | Repository-relative files/directories; `["."]` for the whole repository. Run from the worktree root. |
| `repos` | Git repositories under `paths`, up to four levels deep | Absolute directories |
| `search` | None; only review rounds | Optional absolute directories containing the repositories that may change. Defaults to the current directory. |

Use `search` for discovery, such as finding integrations or comparing a design with code; export material from a canvas to a file first. Use `files` for explicit file-by-file coverage. `files` excludes symlinked or junctioned directories. `repos` skips hidden directories and `node_modules`, `bin`, `obj`, `dist`, `build`, and `packages`.

```powershell
copilot --experimental workflow run exhaustive-task --args '{"goal":"Find every occurrence of an Azure DevOps integration","acceptance":"Each integration lists every source occurrence, purpose, authentication and API used, verified against the source.","mode":"search","coverage":"occurrences","ledgerPath":"C:\\session-artifacts\\ado-integrations.md"}'
```

Arguments: `goal`, `acceptance`, `mode` and an absolute `ledgerPath` are required. Optional `coverage` (`findings` or `occurrences`; defaults to `findings`), `paths` (required for `files` and `repos`), `batchSize` (default 5 files, 1 repository or 5 changes per review round), `quietRounds` (default 2), `maxRounds` (no default), `model` (workers) and `verifyModel` (verification; defaults to `model`). The skill selects coverage from the agreed goal. Without models the runtime preferences apply. Direct invocation skips the skill's preparation; the caller must select appropriate coverage and arrange equivalent approval.

The ledger records findings and progress. To continue a task, use the same `ledgerPath`, goal, acceptance criteria, mode, coverage, and repository or paths. Choose a new ledger for a different task or coverage. Keep the ledger outside the repository unless it is a deliverable.

Changes remain uncommitted unless the goal explicitly asks workers to commit. Requested commits require a feature branch and happen before verification. Files dirty before the run are user work and must not be reverted or committed by workers. Review any edits left by a blocked run before deciding whether to keep or undo them.

Optional `maxRounds` pauses the run after that many rounds while work remains; resuming requires approval. Edits made while paused block the resumed round. If a run is blocked, resolve its reported cause before starting a new run with the same ledger.

Findings-only rounds are checked at final verification rather than individually. Agents share the working tree and cannot distinguish your edits from theirs during a round, so avoid editing in-scope files while it runs. The workflow does not authorize pushing, merging, deployment, or destructive Git operations.

### Addy lifecycle

The `addy-lifecycle` workflow follows [Addy's lifecycle](https://skills.addy.ie/lifecycle/): **Define -> Plan -> Build -> Verify -> Review -> Ship**. It requires the separately installed `agent-skills` plugin.

Start an experimental interactive session and provide a feature idea or existing specification:

```text
/oskar-tools:addy-lifecycle Describe the feature here
```

The workflow can also be started directly with a `goal` argument. It pauses for approval of the spec and plan before building, and commits approved artifacts and verified tasks. Ship assesses readiness and provides a rollback plan; it does not push, merge, or deploy.

Approval messages include a revision request path under `tasks\`. While paused, write feedback such as `{ "plan": "Split the first task into smaller slices" }` or `{ "define": "Include the offline use case" }` to that file and resume the same run. Keep prior feedback fields when adding more feedback. The optional `revisionPath` argument selects a different repository-root-relative path; leave the file absent when starting. A revised spec or plan requires fresh approval.

If the workflow needs a decision, review the reported `needsInput` questions and provide feedback before resuming. A paused checkpoint is not approval; resume without new feedback only after approving the displayed spec or plan. Inspect the worktree and Git state before retrying an interrupted or blocked run, and preserve unrelated user work.

Verification and review depend on agent reports and are not independent proof of every claim.

## Checks

Run the plugin checks from the repository root:

```powershell
pwsh -NoProfile -File tests\git-conventions-hooks.tests.ps1
pwsh -NoProfile -File tests\commands.tests.ps1
node --test tests\lifecycle.tests.mjs tests\exhaustive-task.tests.mjs tests\battle-plan.tests.mjs
```

Add `-Runtime` to `tests\commands.tests.ps1` to check installed component registration; this requires Copilot CLI. These checks do not establish live model compliance.

## Reference

- [Creating plugins](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
- [Creating marketplaces](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace)
- [Plugin commands and manifest formats](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
