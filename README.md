# Personal Copilot plugin

`oskar-tools` is a personal [Agent Plugins 1.0](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) plugin, distributed through the `oskar-personal` marketplace in this repository.

This is an installable starting point. It contains no skills, agent definitions, active hooks, or MCP servers yet. Installing it does not add any capabilities until real content is added.

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

## Add content

The plugin lives at the repository root. The marketplace's `source` points to that root.

```text
plugin.json
.github\plugin\marketplace.json
skills\
com.github.copilot\
  agents\
  hooks\
```

The empty component directories are tracked with `.gitkeep` files. Keep repository content and instructions in English.

### Skills

Create `skills\<skill-name>\SKILL.md`. Each skill must be an immediate subdirectory of `skills` and include YAML frontmatter with `name` and `description`, followed by its instructions.

See [adding agent skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills). Add only skills you actually intend to use; this repository does not ship example skills.

### Agents

Create `com.github.copilot\agents\<agent-name>.agent.md` with the appropriate frontmatter and instructions.

See [creating custom agents](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli). Agent definitions are Copilot-specific; they are not portable Agent Plugins 1.0 components.

### Hooks

Hooks execute external commands. Adding one is a deliberate, separate change: create `com.github.copilot\hooks\hooks.json` using the version `1` format in the [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference).

There is no hook configuration or hook script in this starting point. Do not use `.github\hooks` for distributable plugin hooks: that location configures the repository itself.

Agent Plugins 1.0 fixes these component locations. Do not add legacy `skills`, `agents`, or `hooks` path fields to `plugin.json`. No MCP configuration is needed unless you separately choose to add a server.

## Reference

- [Creating plugins](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
- [Creating marketplaces](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace)
- [Plugin commands and manifest formats](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
