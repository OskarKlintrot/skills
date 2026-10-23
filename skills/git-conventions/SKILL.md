---
name: git-conventions
description: Use before creating branches, writing commit messages or pull request titles and descriptions, or merging pull requests. Apply English naming and message conventions for GitHub, GitHub Enterprise, and Azure DevOps.
---

# Git conventions

Follow these rules for every commit message, pull request title, squash/merge commit message, and branch you create. They apply to Azure DevOps, GitHub, and GitHub Enterprise alike. A `preToolUse` hook rejects tool calls that break the checkable rules.

## Language and tone

- Write commit messages, pull request titles, pull request descriptions, and branch names in **English**.
- Use plain human language. Skip jargon, say it simply and concisely, like one human talking to another (from the [`bro` skill](https://github.com/cursor/plugins/blob/main/pstack/skills/bro/SKILL.md)).
- Keep the first line at most 72 characters.

## Commit messages and pull request titles

Every commit message and every pull request title uses this format. The pull request title becomes the commit message on the default branch when it is squash merged.

```
<type>: <Subject>
<type>(<scope>): <Subject>
```

- `<type>` and `<scope>` are lowercase. `<scope>` is optional; use it in larger repositories (for example infrastructure or library repositories) to say which part is affected.
- The subject starts with an uppercase letter and uses the imperative, present tense: "Change", not "Changed" or "Changes".
- An optional body can follow after a blank line. Write it in the same plain language.

### Allowed types

- **feat** - a new feature for the user, not a new feature for a build script.
- **fix** - a bug fix for the user, not a fix to a build script. Only use it when production code behaves incorrectly. "Fixing" something by adding it (for example a missing button) is a **feat**.
- **perf** - performance improvements.
- **docs** - documentation changes.
- **style** - formatting, missing semicolons, and similar.
- **refactor** - refactoring production code, such as renaming a variable or updating packages, that is not a bug fix or feature but still affects runtime.
- **test** - adding or refactoring tests; no production code change.
- **build** - build configuration, pipelines, development tools, AI tool configuration, and other changes that do not affect runtime.

### Examples

- `feat: Add name to payment card`
- `fix: Add null check for payment card`
- `perf: Use HashSet<T> instead of List<T>`
- `docs: Explain how to run the project locally`
- `style: Change to file scoped namespaces`
- `refactor: Upgrade to .NET 8`
- `test: Add integration tests for stop parking`
- `build: Upgrade task in build pipeline`
- `feat(detection): Add hitech namespace in config`

## Branches

- The default branch (`master` or `main`) is always deployable. Merge nothing that is not ready for production.
- Start every change on a new branch named `feature/<short-descriptive-info>` from the latest default branch, using lowercase kebab-case, for example `feature/add-payment-card-name`. `feature/*` is for all changes, not only new features, and should be short lived.
- `release/*` exists in a few repositories; only create one when asked.
- Keep changes small, push, open a pull request against the default branch, and squash merge it.
