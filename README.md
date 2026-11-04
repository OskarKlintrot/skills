# Personal Copilot plugin

`oskar-tools` is a personal [Agent Plugins 1.0](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) plugin, distributed through the `oskar-personal` marketplace in this repository.

The plugin ships a [git conventions skill and validation hook](#git-conventions) for commit messages, PR titles, and branch names, a [README conventions skill](#readme-conventions) for maintained documentation, [engineering workflow commands](#engineering-workflow-commands) that mostly use the separately installed Addy agent-skills plugin, a standalone Addy lifecycle workflow, four [specialist personas](#agents), and a no-agent `hello-world` example. These components are available through plugin installation without development mappings. It contains no standalone instructions or MCP servers yet. A `.gitkeep` file only keeps an otherwise empty directory in Git; it is not a Copilot component.

## Git conventions

The rules live in `skills\git-conventions\SKILL.md`. The skill is available globally through user-level plugin installation or the [global skills mapping](#global-development-mappings-on-windows). Its name and description let agents discover it before creating branches, writing commits or PRs, or merging PRs. Full instructions load when the skill is activated, not at session or subagent startup. You can also invoke `git-conventions` explicitly.

- **Commit messages and PR titles:** `<type>(<optional scope>): <Capitalized description>`, where type is one of `feat`, `fix`, `perf`, `docs`, `style`, `refactor`, `test`, or `build`. The first line is at most 72 characters.
- **Language and tone:** English, plain and concise (based on [`bro`](https://github.com/cursor/plugins/tree/main/pstack/skills/bro)). Messages containing `åäöæø` are rejected as a heuristic for non-English text.
- **Branches:** `feature/<kebab-case>` or `release/<name>`.

Skill activation depends on the agent or an explicit request. Independently, a `preToolUse` hook denies tool calls that break the checkable rules. It checks:

- `git commit` (`-m`, `--message`, `-F`, heredocs, and PowerShell here-strings), and branch creation via `git checkout`, `git switch`, `git branch`, and `git worktree add`, in bash and PowerShell tool calls.
- `gh pr create`, `gh pr edit`, and `gh pr merge` (GitHub and GHE), and `az repos pr create` and `az repos pr update` (Azure DevOps).
- GitHub and Azure DevOps MCP tools that create or update pull requests or create branches.

The hook loads through plugin installation or the global `hooks` mapping. Its commands resolve the validator from `${PLUGIN_ROOT}` when loaded as a plugin, and from the user-level hooks directory otherwise. Validation does not depend on skill activation.

The hook only affects agent tool calls, not commands you run yourself. Messages that cannot be resolved statically, such as `$variable` values, are allowed. `fixup!`, `squash!`, and `amend!` commits are skipped. The script requires PowerShell 7 (`pwsh`) on `PATH`. If the validator fails internally, it allows the call.

Run the tests with:

```powershell
pwsh -NoProfile -File tests\git-conventions-hooks.tests.ps1
```

## README conventions

`skills\readme-conventions\SKILL.md` applies when creating or editing a file named `README.md` in any directory, and follows each README's existing language and concise style. It treats README files as maintained references: descriptions must match current code and configuration, claims need evidence, and operational procedures must remain useful beyond a particular change. Session summaries, task status and one-time rollout or migration instructions belong elsewhere; change-specific rollout details and cross-PR dependencies belong in PR descriptions.

The skill's name and description let agents discover it for README work, including documentation updates prompted by code or configuration changes. Its full instructions load when the skill is activated, rather than through session or subagent startup hooks. You can also invoke `readme-conventions` explicitly. Activation depends on the agent or an explicit request; it is not enforced by a file-matching loader, and no hook blocks README edits based on their content.

Plugin installation needs no global directory mappings. For local development, the [global skills mapping](#global-development-mappings-on-windows) exposes the same skill without copying it; the `hooks` and `instructions` mappings are not needed for README conventions.

## Engineering workflow commands

`com.github.copilot\commands\*.md` contains nine Copilot CLI command adapters based on the `.claude\commands` files shipped with [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills), version `0.6.14`, plus a standalone `addy-lifecycle` dynamic workflow with a skill and command as launch adapters. `com.github.copilot\commands\LICENSE` retains the unchanged upstream MIT license and copyright notice, with a separate attribution clarification. That notice identifies the upstream material; the Copilot adaptations and additional workflow changes belong to this repository's history and are not attributed to or endorsed by Addy Osmani.

The engineering commands and the `addy-lifecycle` workflow use skills from the separately installed, enabled `agent-skills` plugin; they do not bundle or install those skills. Install it to use these workflows:

```powershell
copilot plugin marketplace add addyosmani/agent-skills
copilot plugin install agent-skills@addy-agent-skills
copilot skill list
```

Copilot registers plugin commands with the plugin name as a prefix. Use the full names below; bare `/plan` and `/review` remain Copilot's built-in commands.

| Command | Workflow |
| --- | --- |
| `/oskar-tools:spec <feature>` | Clarify requirements and write a spec using `spec-driven-development`. |
| `/oskar-tools:addy-lifecycle <feature or spec>` | Start the standalone workflow, which owns requirements, spec, plan, implementation, verification, review and launch-readiness gates. |
| `/oskar-tools:plan <scope>` | Break the spec into tasks using `planning-and-task-breakdown`; no implementation. |
| `/oskar-tools:build [auto\|all]` | Implement the next task, or the approved whole plan, using `incremental-implementation` and `test-driven-development`. |
| `/oskar-tools:test <feature or bug>` | Run TDD or the Prove-It bug-fix workflow using `test-driven-development`. |
| `/oskar-tools:review <scope>` | Review changes across five axes using `code-review-and-quality`; no edits or GitHub posting. |
| `/oskar-tools:code-simplify <scope>` | Simplify changed code without changing behavior using `code-simplification`. |
| `/oskar-tools:constraints [check\|guard\|ratchet]` | Set up or operate the quality bar using `constraint-driven-development`. |
| `/oskar-tools:webperf <URL, report, or scope>` | Audit browser-facing performance using `performance-optimization`; distinguish measured Deep mode from unmeasured Quick mode. |
| `/oskar-tools:ship <scope>` | Assess launch readiness using `shipping-and-launch`; produce specialist findings, a GO/NO-GO decision, and a rollback plan, not a deployment. |

Arguments follow the command in chat. `/oskar-tools:build` includes a commit after each verified task; `build auto` also commits newly generated planning documents separately after plan approval. `/oskar-tools:spec` follows the upstream skill's instruction to commit the spec. `/oskar-tools:addy-lifecycle` commits the approved spec, approved plan/task artifacts, and each verified task separately. These workflows do not switch Copilot's runtime mode or bypass tool permissions and repository instructions. Commits do not authorize pushing, merging, or deploying.

The adapters use Copilot instruction sources, installed skill names, and available question/delegation tools rather than Claude-specific frontmatter, instruction paths, or agent APIs. The lifecycle workflow owns its phase gates and orchestration, composes the applicable skills from the separately installed `agent-skills` plugin, and uses this plugin's code, security and test personas for its independent Review assignments. `ship` also uses those three personas; `webperf` prefers this plugin's performance persona. Addy's separately installed plugin supplies skills for the commands and lifecycle workflow; this plugin supplies the Copilot persona definitions. Live browser checks require suitable configured tools, such as Chrome DevTools MCP, and unavailable measurement evidence is reported rather than invented.

Commands load through plugin installation or a session-scoped `--plugin-dir` mount; the global development mappings below do not expose them. Choose plugin loading instead of mappings for the complete component set, avoiding duplicate hook sources. Command loading and argument forwarding are verified in Copilot CLI; other Copilot clients can have different component support.

Run the command checks with:

```powershell
pwsh -NoProfile -File tests\commands.tests.ps1
pwsh -NoProfile -File tests\commands.tests.ps1 -Runtime
```

The first command checks command/persona packaging, descriptions, skill dependencies, and incompatible runtime assumptions. `-Runtime` also requires an installed Copilot CLI: it installs this plugin into a temporary isolated `COPILOT_HOME` and checks actual namespaced command and persona registration through ACP, without executing a model prompt. It restores the environment and removes the temporary installation.

The `Tests` GitHub Actions workflow runs both test scripts on Windows for pull requests, pushes to `master`, and manual runs. It installs a pinned Copilot CLI and uses a local-provider configuration for discovery-only runtime checks, without Copilot credentials or model requests.

## Install

Use a current GitHub Copilot CLI with Agent Plugins 1.0 support. Once these files are merged into the repository's default branch:

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

This is a property to add to the existing marketplace entry, not a complete settings file. Preserve its source information and all other settings. If `COPILOT_HOME` is set, use `settings.json` in that directory instead.

Copilot CLI 1.0.101-0 has no automatic-update flag for `plugin install` or `plugin marketplace add`. The plugin cannot enable this user setting itself. See the [configuration reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference#configuration-file-settings) for `extraKnownMarketplaces`.

The opt-in updates the marketplace's installed plugins at session start in interactive CLI and `-p` sessions, subject to CLI update settings, policies, and trust requirements. It does not apply to SDK or server sessions. Automatic updates in the Copilot desktop app are not guaranteed. Repository-level settings cannot enable this marketplace's automatic updates.

## Update

To update manually:

```powershell
copilot plugin marketplace update oskar-personal
copilot plugin update oskar-tools
```

The first command refreshes the marketplace catalog; the second updates the installed plugin. Start a new session to use updated content.

When publishing content changes, increment `version` in `plugin.json` and merge the changes into the branch used by the marketplace. The marketplace entry deliberately omits a duplicate plugin version.

We follow [Semantic Versioning](https://semver.org/): after `1.0.0`, increment the major version for breaking changes, the minor version for backward-compatible additions, and the patch version for backward-compatible bug fixes. During `0.x` development, compatibility is not guaranteed; use minor versions for additions or breaking changes and patch versions for backward-compatible fixes.

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

Direct local installations are cached. Run that install command again after changes, then start a new session. CLI 1.0.101-0 rejects a bare `.` for direct installation and warns that direct installs are deprecated; prefer the marketplace workflow.

### Global development mappings on Windows

As an alternative to loading the plugin, directory junctions can expose the working clone as personal CLI customizations. They are explicit local setup, not something plugin installation creates. Use a stable clone, not a temporary session worktree or an installed-plugin cache.

For a clone at `C:\repos\external\OskarKlintrot\skills`, use these mappings:

| Global directory under `%USERPROFILE%\.copilot` | Source relative to the clone |
| --- | --- |
| `skills` | `skills` |
| `agents` | `com.github.copilot\agents` |
| `hooks` | `com.github.copilot\hooks` |
| `instructions` | `instructions` |

If `COPILOT_HOME` is set, its directory replaces `%USERPROFILE%\.copilot`. The root `instructions` directory is for this local mapping only; it is not a portable plugin component.

Use this fail-fast, idempotent setup procedure:

1. Pull the merged changes, or integrate the reviewed local commit, into the stable clone first. Confirm all four source directories exist. Stop on a missing source; do not create an empty substitute or map a cache directory.
2. Inspect every destination before changing anything. An existing junction to the exact intended source is already correct: leave it unchanged. Compare resolved absolute targets, ignoring Windows path casing and trailing separators.
3. Stop on any conflicting destination: a regular file or directory, a symbolic link, or a junction to a different or missing target. Preserve it and resolve the conflict explicitly. Never delete, overwrite, or move existing customizations automatically.
4. After all preflight checks pass, create junctions only for missing destinations, using PowerShell `New-Item -ItemType Junction` with explicit absolute paths. Check each result and surface any error; rerunning the procedure must preserve all correct existing mappings.
5. Leave the existing global `copilot-instructions.md` file untouched. It is a separate instruction source, not the destination of the `instructions` mapping. Preserve unrelated settings and customizations.

Edits through a junction change files in the clone. Add actual content there deliberately; empty mapped directories still provide no capabilities. Global hook mappings also execute future hook definitions locally, so review any hook change before starting a new session.

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

## Add content

The plugin lives at the repository root. The marketplace's `source` points to that root.

```text
plugin.json
.github\plugin\marketplace.json
skills\
instructions\
com.github.copilot\
  agents\
  commands\
  extensions\
    hello-world\
      extension.mjs
    addy-lifecycle\
      extension.mjs
      workflow.mjs
  hooks\
    hooks.json
    scripts\
tests\
```

Empty component directories are tracked with `.gitkeep` files. Keep repository content and instructions in English.

### Skills

Create `skills\<skill-name>\SKILL.md`. Each skill must be an immediate subdirectory of `skills` and include YAML frontmatter with `name` and `description`, followed by its instructions.

See [adding agent skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills). Add only skills you actually intend to use; this repository does not ship example skills.

### Agents

The four personas in `com.github.copilot\agents` are adapted from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills), version `0.6.15`. Their MIT license is retained in `com.github.copilot\agents\LICENSE`; Copilot integration changes belong to this repository, not Addy Osmani. Original content is preserved in the initial import commit before local adaptations.

| Copilot agent ID | Role | Used by |
| --- | --- | --- |
| `oskar-tools:code-reviewer` | Five-axis code review | `/oskar-tools:ship` |
| `oskar-tools:security-auditor` | Security and trust-boundary review | `/oskar-tools:ship` |
| `oskar-tools:test-engineer` | Test strategy and coverage analysis | `/oskar-tools:ship` |
| `oskar-tools:web-performance-auditor` | Sourced web-performance assessment | `/oskar-tools:webperf`, not the lifecycle's global review fan-out |

Personas define specialist perspectives for commands that select them; separately installed `agent-skills:*` skills define those commands' methods. Caller scope, read-only assignments and structured workflow schemas take precedence over a persona's default Markdown template. Missing required skills are blockers for those commands and the lifecycle. The lifecycle uses the code, security and test personas during Review. No persona fixes a model, reasoning effort or context tier.

Create `com.github.copilot\agents\<agent-name>.agent.md` with the appropriate frontmatter and instructions.

See [creating custom agents](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli). Agent definitions are Copilot-specific; they are not portable Agent Plugins 1.0 components.

### Commands

Create `com.github.copilot\commands\<command-name>.md` with YAML `description` frontmatter followed by the prompt instructions. The CLI registers it as `/oskar-tools:<command-name>`. Do not add a `commands` path field to the Agent Plugins 1.0 manifest; the namespaced directory is its fixed Copilot-specific location.

Keep shared engineering workflows in upstream skills rather than duplicating them in command adapters. The standalone lifecycle is implemented in its dynamic workflow and is not an adapter for an upstream skill. Refer to installed skills by their discovered names, not hardcoded cache paths. Document new dependencies and retain upstream attribution when adapting third-party commands. See the [engineering workflow commands](#engineering-workflow-commands) for loading, arguments, and permission boundaries.

### Dynamic workflows

[Dynamic workflows](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-dynamic-workflows) are Copilot extensions. Create `com.github.copilot\extensions\<extension-name>\extension.mjs` that registers workflows with `defineWorkflow` and `joinSession` from `@github/copilot-sdk/extension`. The current docs do not list this location for Agent Plugins 1.0; it matches the plugins bundled with the Copilot app. Do not add an `extensions` path field to `plugin.json`; in Agent Plugins 1.0 that field holds namespaced client data, not paths. Extensions run local code, so review them like hooks.

The `hello-world` workflow spawns no subagents and uses no AI credits. Verified with CLI **1.0.105** after an isolated plugin installation:

```powershell
copilot --experimental workflow run hello-world --args '{"name":"Oskar"}'
```

It returns `{"greeting":"Hello, Oskar!","source":"oskar-tools plugin"}`. In an interactive session, enable experimental features and ask Copilot to run the `hello-world` dynamic workflow.

#### Addy lifecycle

The `addy-lifecycle` workflow implements the six stages in [Addy's lifecycle](https://skills.addy.ie/lifecycle/): **Define -> Plan -> Build -> Verify -> Review -> Ship**. The packaged skill and command only start the workflow; neither prepares artifacts nor runs lifecycle phases. The workflow owns the phase orchestration, but follows the upstream model of composing installed skills for specification, planning, implementation, testing and shipping. Its Review phase uses the packaged code, security and test personas, whose methods also require their documented `agent-skills:*` dependencies.

Start an experimental interactive session and provide a feature idea or existing specification:

```text
/oskar-tools:addy-lifecycle Describe the feature here
```

The dynamic workflow can also be started directly with only a `goal` argument. It creates a pre-edit Git baseline itself; callers do not need to prepare a spec or provide a baseline path. Git observations and returned spec paths are relative to the repository root, including when launched from a subdirectory. A newly initialized repository without an initial commit is supported.

Approval messages include a run-specific revision request path under `tasks\`. The optional `revisionPath` argument overrides it with a repository-root-relative path, for example `tasks\lifecycle-revisions.json`. Leave that file absent when starting. While paused, write feedback such as `{ "plan": "Split the first task into smaller slices" }` or `{ "define": "Include the offline use case" }` there and resume the **same run**. Keep prior feedback fields when adding more feedback. Each observed feedback transition receives a durable revision generation, including returning to earlier wording; unchanged feedback resumes the pending approval instead. The affected phase runs again with the original baseline and workflow-owned artifacts, then pauses for approval of the revised output. Spec revisions remain pinned to the original selected path. Revision requests do not authorize adopting unrelated user changes. The request file is control input, not a planning artifact to commit.

The stages operate as follows:

- **Define** reads repository guidance and relevant code, tests and docs. It clarifies scope from the goal, returns unresolved decisions as `needsInput`, and writes a spec without overwriting unrelated work. If the goal refers to an existing tracked spec, it can use that file read-only; requested revisions go to a run-specific copy under `tasks\`, pinned for subsequent revisions, while preserving the original. The workflow pauses at `approve-spec` and logs the actual spec for review; resuming approves that exact unchanged content.
- **Plan** creates the plan and task list at repository-standard paths (default `tasks\plan.md` and `tasks\todo.md`) and reports their repository-root-relative `artifactPaths`. Tasks include acceptance criteria, verification commands and explicit dependencies. The workflow validates the task graph, snapshots the planning artifacts and pauses at `approve-plan` before any implementation. Changed files cannot reuse the pending approval; submit revision feedback for a new checkpoint. Once approved, Build may record task-status updates without invalidating that approval on replay. Revised specs and plans receive distinct approval checkpoints.
- **Build** executes the approved finite task list sequentially in dependency order. Each task follows a test-first implementation cycle, records completion only after verification, and earns its own commit.
- **Verify** runs the integrated acceptance, test, build and applicable type/lint checks in a read-only assessment.
- **Review** runs independent code, security and test-coverage assessments in parallel. Missing evidence and Critical, High or Required findings block progress.
- **Ship** provides a read-only launch-readiness decision and rollback plan. It does not deploy, change flags, push or merge.

The lifecycle uses `git-workflow-and-versioning` for Git operations, including branch strategy, atomic save-point commits and pre-commit checks. Its spec/plan approval and verified Build gates coordinate with that skill; they do not prohibit appropriate feature branches or commits. The workflow captures the initial HEAD (or no HEAD for an unborn branch), working-tree status and dirty paths, content hashes and index entries before Define writes files. Define's validation detects changes to pre-existing worktree content or staged entries, rather than exempting paths that were already dirty. It also checks staged and unstaged diffs separately and rejects HEAD changes during Define, including a first commit on an unborn branch. These observations are journaled before later approved commits so replay does not misattribute those commits to Define. Workers preserve unrelated user work and the index, and stop if an assignment overlaps it rather than committing it. Push, merge and deployment still require an explicit user-approved Ship action and the necessary repository permissions.

Workflow workers cannot conduct a live interview. When a material decision is required, the phase returns a `NO-GO` report with `needsInput`. For spec or plan feedback, use the configured revision request file and resume the same run so the original baseline and artifact ownership remain intact; do not start a replacement run over uncommitted artifacts. A paused checkpoint is not approval: resume unchanged feedback only after the user approves the exact logged spec or plan. Resuming with new feedback requests a revision and another approval checkpoint, not approval of the previous output. A runtime exception or interrupted edit is distinct from a `NO-GO`; inspect the worktree and Git state before retrying.

Only initially staged, unstaged or untracked paths are protected from assignment edits. Build may modify clean tracked source files within its approved scope. The complete tracked-path inventory and protected-state fingerprints stay in the runtime journal, not in worker prompts.

These are report and execution gates, not independent proof of model claims. The workflow requires cited artifacts, actual command evidence for checks, full commit IDs and passing evidence. It does not independently verify every claim in an agent report, and unavailable measurements must be reported as unavailable. Its `Ship` phase is a readiness assessment, not Addy's deployment/rollout procedure.

##### Workflow checks

Run the workflow contract tests without model requests:

```powershell
node --test tests\lifecycle.tests.mjs
```

The tests cover goal-only invocation, spec creation and validation, approval/commit order, baseline capture, question routing, dependency ordering, resume replay, missing reports and failed verification using a simulated workflow context. `tests\commands.tests.ps1 -Runtime` checks installed command and skill registration and rejects invalid workflow arguments without starting model work. Neither check proves live model compliance or actual commit isolation.

### Hooks

Hooks execute external commands. They are configured in `com.github.copilot\hooks\hooks.json` using the version `1` format in the [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference). Put scripts in `com.github.copilot\hooks\scripts\`. Plugin hooks expand `${PLUGIN_ROOT}`, but user-level hooks leave it as literal text, so hook commands must also work through the global `hooks` mapping. Follow the fallback in the existing `hooks.json`. Because `preToolUse` command hooks deny the call when they fail, a wrong script path blocks every tool call.

Do not use `.github\hooks` for distributable plugin hooks: that location configures the repository itself.

Agent Plugins 1.0 fixes these component locations. Do not add legacy `skills`, `agents`, or `hooks` path fields to `plugin.json`. No MCP configuration is needed unless you separately choose to add a server.

### Instructions and plugin rules

For the global development mapping, add real `*.instructions.md` files to `instructions`. Files without `applyTo` provide general instructions; use YAML frontmatter with an `applyTo` glob for file-scoped instructions. Keep one source file per instruction: the junction exposes the same files globally without copying them.

The current [plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference#components) documents Copilot-specific plugin rules in `com.github.copilot\rules`. However, that route was not functional in our isolated checks with CLI **1.0.101-0**:

- An enabled installed fixture and a `--plugin-dir` fixture did not expose `*.instructions.md` through `instruction list --json`.
- A mounted fixture containing both `*.instructions.md` and plain `*.md` rules supplied none of their markers to a prompt.
- Mapping the same directory to an isolated personal `instructions` directory discovered both `*.instructions.md` files, preserved `applyTo: "**/*.ts"`, and ignored plain `*.md`. A prompt with no file operations received the general instruction marker, not the file-scoped one.

Isolated discovery checks with CLI **1.0.103-0** also returned no instruction sources for either an enabled installed plugin or a `--plugin-dir` fixture containing `*.instructions.md` and plain `*.md` rules. As a control, mapping that fixture's rules directory to an isolated personal `instructions` directory discovered both instruction files and preserved `applyTo: "**/README.md"`. These checks establish a discovery limitation, not prompt behavior for every client.

README conventions use a skill rather than plugin rules or a personal instruction file. The root `instructions` directory remains available for separate development-only personal instructions and currently contains only `.gitkeep`. Plugin-rule loading has not been verified for other CLI versions or clients.

Recheck support with your installed CLI before adopting plugin rules. Do not rename, copy, or relocate instructions automatically, remove `applyTo`, or enable another loading route without checking scope and duplicate behavior.

## Reference

- [Creating plugins](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
- [Creating marketplaces](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace)
- [Plugin commands and manifest formats](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
