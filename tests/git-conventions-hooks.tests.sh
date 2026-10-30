#!/usr/bin/env bash
set -euo pipefail

command -v jq >/dev/null 2>&1 || { printf '%s\n' 'Tests require jq on PATH.' >&2; exit 1; }
root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
plugin="$root"
scripts="$plugin/com.github.copilot/hooks/scripts"
temp=$(mktemp -d "${TMPDIR:-/tmp}/oskar-hook-tests-O'Connor.XXXXXXXX")
trap 'rm -rf -- "$temp"' EXIT
# Native Windows tools such as jq.exe need a Windows-compatible fixture path.
case "$OSTYPE" in
    msys*|cygwin*)
        native_temp=$(cygpath -m "$temp")
        temp=$native_temp
        jq() { command jq --binary "$@"; }
        ;;
esac
count=0

raw=$(printf '%s\n' '{"deny":false,"text":"first\nsecond"}' | jq -r '.deny,.text')
if [ "$raw" != $'false\nfirst\nsecond' ]; then
    printf '%s\n' 'FAIL: jq raw booleans and multiline text must preserve LF output.' >&2
    exit 1
fi
count=$((count + 1))

assert_decision() {
    local output=$1 expected=$2 name=$3 denied=false
    if [ -n "$output" ]; then
        printf '%s' "$output" | jq -e \
            '.permissionDecision == "deny" and (.permissionDecisionReason | startswith("Git conventions: "))' >/dev/null
        denied=true
    fi
    if [ "$denied" != "$expected" ]; then
        printf 'FAIL: %s (expected deny=%s): %s\n' "$name" "$expected" "$output" >&2
        exit 1
    fi
    count=$((count + 1))
}

printf '# comment\nfeat: Add file support\n\nBody\n' >"$temp/good.txt"
printf 'added file support\n' >"$temp/bad.txt"
mkdir -p "$temp/repo/sub" "$temp/sub"
printf 'invalid subject\n' >"$temp/repo/sub/msg.txt"
printf 'build: Update hooks\n' >"$temp/repo/sub/good.txt"
printf 'build: Update hooks\n' >"$temp/sub/msg.txt"
printf 'invalid subject\n' >"$temp/sub/good.txt"
printf 'invalid subject\n' >"$temp/msg.txt"
printf 'build: Update hooks\n' >"$temp/repo/msg.txt"
jq -e 'type == "array" and length > 0' "$root/tests/git-conventions-cases.json" >/dev/null
while IFS= read -r test; do
    name=$(printf '%s' "$test" | jq -r '.name')
    expected=$(printf '%s' "$test" | jq -r '.deny')
    payload=$(printf '%s' "$test" | jq -c --arg cwd "$temp" \
        '.payload | .cwd = $cwd | walk(if type == "string" then split("{{CWD}}") | join($cwd) else . end)')
    output=$(printf '%s' "$payload" | bash "$scripts/enforce-git-conventions.sh" 2>"$temp/stderr")
    if [ -s "$temp/stderr" ]; then cat "$temp/stderr" >&2; exit 1; fi
    assert_decision "$output" "$expected" "$name"
done < <(jq -c '.[]' "$root/tests/git-conventions-cases.json")

output=$(printf 'not json' | bash "$scripts/enforce-git-conventions.sh")
assert_decision "$output" false 'Malformed JSON allows'

package="$temp/plugin O'Connor & "'$()'
mkdir -p "$package"
cp -R "$plugin/plugin.json" "$plugin/skills" "$plugin/com.github.copilot" "$package/"
home="$temp/home O'Connor with spaces"
copilot="$home/.copilot"
mkdir -p "$copilot"
cp -R "$plugin/com.github.copilot/hooks" "$copilot/hooks"
config="$plugin/com.github.copilot/hooks/hooks.json"
jq -e '.version == 1 and (.hooks.preToolUse | length) == 1' "$config" >/dev/null
if jq -e '.hooks | keys == ["preToolUse"]' "$config" >/dev/null; then
    count=$((count + 1))
else
    printf '%s\n' 'FAIL: only the preToolUse hook should be configured.' >&2
    exit 1
fi
for event in sessionStart subagentStart; do
    if jq -e --arg event "$event" '.hooks | has($event)' "$config" >/dev/null; then
        printf 'FAIL: startup hook %s must be absent.\n' "$event" >&2
        exit 1
    fi
    count=$((count + 1))
done
for event in preToolUse; do
    for route in plugin copilot-home home; do
        command=$(jq -r --arg event "$event" '.hooks[$event][0].bash' "$config")
        case "$command" in *pwsh*|*.ps1*) printf 'Bash hook invokes PowerShell\n' >&2; exit 1;; esac
        case "$command" in *'${PLUGIN_ROOT}'*) printf 'Plugin root must not be shell source\n' >&2; exit 1;; esac
        plugin_root=$(jq -r --arg event "$event" '.hooks[$event][0].env.OSKAR_TOOLS_PLUGIN_ROOT' "$config")
        [ "$plugin_root" = '${PLUGIN_ROOT}' ]
        if [ "$route" = plugin ]; then
            plugin_root=$package
        fi
        for expected in false true; do
            if [ "$expected" = true ]; then title='Invalid title'; else title='build: Update tools'; fi
            payload=$(jq -cn --arg title "$title" '{toolName: "create_pull_request", toolArgs: {title: $title}}')
            if [ "$route" = home ]; then
                output=$(printf '%s' "$payload" | HOME="$home" COPILOT_HOME= OSKAR_TOOLS_PLUGIN_ROOT= bash -c "$command")
            elif [ "$route" = plugin ]; then
                output=$(printf '%s' "$payload" | HOME="$temp/missing home" COPILOT_HOME="$temp/missing copilot home" OSKAR_TOOLS_PLUGIN_ROOT="$plugin_root" bash -c "$command")
            else
                output=$(printf '%s' "$payload" | HOME="$temp/missing home" COPILOT_HOME="$copilot" OSKAR_TOOLS_PLUGIN_ROOT="$plugin_root" bash -c "$command")
            fi
            assert_decision "$output" "$expected" "$event $route"
        done
    done
done
printf 'invalid jq filter' >"$package/com.github.copilot/hooks/scripts/git-conventions.jq"
output=$(printf '%s' "$payload" | bash "$package/com.github.copilot/hooks/scripts/enforce-git-conventions.sh" 2>"$temp/stderr")
[ -z "$output" ]
grep -q 'validation failed internally; allowing' "$temp/stderr"
count=$((count + 1))
for script in enforce-git-conventions.sh; do
    if output=$(printf '{}' | PATH="$temp/no-tools" "$BASH" "$scripts/$script" 2>"$temp/stderr"); then
        printf 'FAIL: missing jq did not fail: %s\n' "$script" >&2
        exit 1
    fi
    [ -z "$output" ]
    grep -q 'jq is required' "$temp/stderr"
    count=$((count + 1))
done
for script in "$scripts"/*.sh "$root/tests"/*.sh; do bash -n "$script"; done
jq -e --slurpfile manifest "$plugin/plugin.json" \
    '.name == "oskar-personal" and $manifest[0].name == "oskar-tools" and
     ([.plugins[] | select(.name == $manifest[0].name)] |
      length == 1 and .[0].source == "." and (.[0] | has("version") | not))' \
    "$root/.github/plugin/marketplace.json" >/dev/null
printf '%s assertions passed (Bash)\n' "$count"
