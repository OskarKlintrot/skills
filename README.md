# Personal Copilot plugin

`oskar-tools` is a personal [Agent Plugins 1.0](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) plugin, distributed through the `oskar-personal` marketplace in this repository.

The plugin ships a [git conventions skill and validation hook](#git-conventions) for commit messages, PR titles, and branch names, and a [README conventions skill](#readme-conventions) for maintained documentation. Both are available through plugin installation without development mappings. It contains no agent definitions, standalone instructions, or MCP servers yet. A `.gitkeep` file only keeps an otherwise empty directory in Git; it is not a Copilot component.

## Git conventions

The rules live in `skills\git-conventions\SKILL.md`. The skill is available globally through user-level plugin installation or the [global skills mapping](#global-development-mappings-on-windows). Its name and description let agents discover it before creating branches, writing commits or PRs, or merging PRs. Full instructions load when the skill is activated, not at session or subagent startup. You can also invoke `git-conventions` explicitly.

- **Commit messages and PR titles:** `<type>(<optional scope>): <Capitalized description>`, where type is one of `feat`, `fix`, `perf`, `docs`, `style`, `refactor`, `test`, or `build`. The first line is at most 72 characters.
- **Language and tone:** English, plain and concise (based on [`bro`](https://github.com/cursor/plugins/tree/main/pstack/skills/bro)). Messages containing `åäöæø` are rejected as a heuristic for non-English text.
- **Branches:** `feature/<kebab-case>` or `release/<name>`.

Skill activation depends on the agent or an explicit request. Independently, a `preToolUse` hook denies tool calls that break the checkable rules. It checks:

- `git commit` (`-m`, `--message`, `-F`, heredocs, and PowerShell here-strings), and branch creation via `git checkout`, `git switch`, `git branch`, and `git worktree add`, in bash and PowerShell tool calls.
- `gh pr create`, `gh pr edit`, and `gh pr merge` (GitHub and GHE), and `az repos pr create` and `az repos pr update` (Azure DevOps).
- GitHub and Azure DevOps MCP tools that create or update pull requests or create branches.

The hook loads through plugin installation or the global `hooks` mapping. Plugin commands receive `${PLUGIN_ROOT}` through the `OSKAR_TOOLS_PLUGIN_ROOT` environment value, rather than inserting the path into shell source. For user-level loading, the validator resolves from `$COPILOT_HOME/hooks/scripts`, or `$HOME/.copilot/hooks/scripts` when `COPILOT_HOME` is unset. Validation does not depend on skill activation. No rules are injected at session or subagent startup.

Literal Bash heredoc bodies are treated as data, not commands. Message files support `-F path`, `-Fpath`, `--file path`, and `--file=path`, including repeated relative `git -C` options. After a shell directory change, relative message-file paths are skipped rather than resolved against a potentially incorrect directory; an absolute `git -C` restores a known directory. Inline messages and absolute message-file paths remain checked.

The hook only affects agent tool calls, not commands you run yourself. Messages that cannot be resolved statically, such as `$variable` values, are allowed. `fixup!`, `squash!`, and `amend!` commits are skipped. If the validator fails internally, it allows the call. These are static format checks, not a security boundary or full language detection.

The client selects the `powershell` or `bash` command in `hooks.json`:

| Route | Requirements |
| --- | --- |
| PowerShell | PowerShell 7 (`pwsh`) on `PATH` |
| Bash | Bash 3.2 or later and `jq` on `PATH`; no PowerShell required |

A missing `jq` produces an explicit error. On macOS with Homebrew, install it with `brew install jq`. Git Bash/Cygwin uses `jq --binary` so native `jq.exe` preserves LF output. The Bash scripts parse submitted tool commands as data; they never execute them.

Run the tests for each available runtime from the repository root:

```powershell
pwsh -NoProfile -File tests\git-conventions-hooks.tests.ps1
```

For Bash, including Git Bash on Windows:

```powershell
bash (Resolve-Path tests\git-conventions-hooks.tests.sh).Path
```

Both runners use `tests\git-conventions-cases.json` for shared expected decisions and check packaged hook commands through plugin and personal-hook loading, including paths with spaces and shell metacharacters. Test payloads do not execute Git commands or PR operations.

[Tests](.github/workflows/tests.yml) runs both suites on Windows, Linux, and macOS for every pull request, push to `master`, and manual dispatch. The GitHub-hosted runners provide PowerShell 7, Bash, and jq; Windows uses Git Bash. A failing suite or platform does not cancel the remaining checks.

## README conventions

`skills\readme-conventions\SKILL.md` applies when creating or editing a file named `README.md` in any directory, and follows each README's existing language and concise style. It treats README files as maintained references: descriptions must match current code and configuration, claims need evidence, and operational procedures must remain useful beyond a particular change. Session summaries, task status and one-time rollout or migration instructions belong elsewhere; change-specific rollout details and cross-PR dependencies belong in PR descriptions.

The skill's name and description let agents discover it for README work, including documentation updates prompted by code or configuration changes. Its full instructions load when the skill is activated, rather than through session or subagent startup hooks. You can also invoke `readme-conventions` explicitly. Activation depends on the agent or an explicit request; it is not enforced by a file-matching loader, and no hook blocks README edits based on their content.

Plugin installation needs no global directory mappings. For local development, the [global skills mapping](#global-development-mappings-on-windows) exposes the same skill without copying it; the `hooks` and `instructions` mappings are not needed for README conventions.

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

Create `com.github.copilot\agents\<agent-name>.agent.md` with the appropriate frontmatter and instructions.

See [creating custom agents](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli). Agent definitions are Copilot-specific; they are not portable Agent Plugins 1.0 components.

### Hooks

Hooks execute external commands. They are configured in `com.github.copilot\hooks\hooks.json` using the version `1` format in the [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference). Put scripts in `com.github.copilot\hooks\scripts\`. Plugin hooks expand `${PLUGIN_ROOT}`, but user-level hooks leave it as literal text, so hook commands must also work through the global `hooks` mapping. Follow the fallback in the existing `hooks.json`. Because `preToolUse` command hooks deny the call when they fail, a wrong script path blocks every tool call.

Do not use `.github\hooks` for distributable plugin hooks: that location configures the repository itself. Preserve LF endings for Bash and jq files as specified in `.gitattributes`.

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
