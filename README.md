# Personal Copilot plugin

`oskar-tools` is a personal [Agent Plugins 1.0](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) plugin, distributed through the `oskar-personal` marketplace in this repository.

It currently ships one feature: [git conventions hooks](#git-conventions) that make agents write correct commit messages, PR titles, and branch names in every repository. It contains no skills, agent definitions, instructions, or MCP servers yet. A `.gitkeep` file only keeps an otherwise empty directory in Git; it is not a Copilot component.

## Git conventions

The rules apply globally, whether you load the plugin at user level or use the [global development mappings](#global-development-mappings-on-windows). The hook commands resolve their scripts from `${PLUGIN_ROOT}` when loaded as a plugin, and from the user-level hooks directory otherwise. The rules text lives in `com.github.copilot\hooks\scripts\git-conventions.md`.

- **Commit messages and PR titles:** `<type>(<optional scope>): <Capitalized description>`, where type is one of `feat`, `fix`, `perf`, `docs`, `style`, `refactor`, `test`, or `build`. The first line is at most 72 characters.
- **Language and tone:** English, plain and concise (based on [`bro`](https://github.com/cursor/plugins/tree/main/pstack/skills/bro)). Messages containing `åäöæø` are rejected as a heuristic for non-English text.
- **Branches:** `feature/<kebab-case>` or `release/<name>`.

Two mechanisms enforce this:

1. `sessionStart` and `subagentStart` hooks inject the rules into the agent's context.
2. A `preToolUse` hook denies tool calls that break them. It checks:
   - `git commit` (`-m`, `--message`, `-F`, heredocs, and PowerShell here-strings), and branch creation via `git checkout`, `git switch`, `git branch`, and `git worktree add`, in bash and PowerShell tool calls.
   - `gh pr create`, `gh pr edit`, and `gh pr merge` (GitHub and GHE), and `az repos pr create` and `az repos pr update` (Azure DevOps).
   - GitHub and Azure DevOps MCP tools that create or update pull requests or create branches.

The hooks only affect agent tool calls, not commands you run yourself. Messages that cannot be resolved statically, such as `$variable` values, are allowed. `fixup!`, `squash!`, and `amend!` commits are skipped. The scripts require PowerShell 7 (`pwsh`) on `PATH`. If the validator fails internally, it allows the call.

Run the tests with:

```powershell
pwsh -NoProfile -File tests\git-conventions-hooks.tests.ps1
```

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

Do not use `.github\hooks` for distributable plugin hooks: that location configures the repository itself.

Agent Plugins 1.0 fixes these component locations. Do not add legacy `skills`, `agents`, or `hooks` path fields to `plugin.json`. No MCP configuration is needed unless you separately choose to add a server.

### Instructions and plugin rules

For the global development mapping, add real `*.instructions.md` files to `instructions`. Files without `applyTo` provide general instructions; use YAML frontmatter with an `applyTo` glob for file-scoped instructions. Keep one source file per instruction: the junction exposes the same files globally without copying them.

The current [plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference#components) documents Copilot-specific plugin rules in `com.github.copilot\rules`. However, that route was not functional in our isolated checks with CLI **1.0.101-0**:

- An enabled installed fixture and a `--plugin-dir` fixture did not expose `*.instructions.md` through `instruction list --json`.
- A mounted fixture containing both `*.instructions.md` and plain `*.md` rules supplied none of their markers to a prompt.
- Mapping the same directory to an isolated personal `instructions` directory discovered both `*.instructions.md` files, preserved `applyTo: "**/*.ts"`, and ignored plain `*.md`. A prompt with no file operations received the general instruction marker, not the file-scoped one.

Consequently, this repository uses `instructions` for verified local personal instructions and does not claim equivalent plugin-rule behavior. Installing the plugin alone does **not** load these files. The fixture checks did not establish full equivalence for every file-scoped matching case or other Copilot clients.

Recheck support with your installed CLI before adopting plugin rules. Do not rename, copy, or relocate instructions automatically, remove `applyTo`, or enable another loading route without checking scope and duplicate behavior.

## Reference

- [Creating plugins](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
- [Creating marketplaces](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace)
- [Plugin commands and manifest formats](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
