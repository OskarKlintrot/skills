#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
    printf '%s\n' 'Git conventions: jq is required for Bash hooks. Install jq and retry.' >&2
    exit 1
fi

scripts=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
case "$OSTYPE" in
    msys*|cygwin*)
        scripts=$(cygpath -m "$scripts")
        jq() { command jq --binary "$@"; }
        ;;
esac
payload=$(cat)
if ! printf '%s' "$payload" | jq -e 'type == "object"' >/dev/null 2>&1; then
    exit 0
fi

# Resolve only literal message-file paths. Tool command text is never executed.
resolve_files() {
    local check kind path message
    while IFS= read -r check; do
        kind=$(printf '%s' "$check" | jq -r '.kind') || return
        if [ "$kind" = file ]; then
            path=$(printf '%s' "$check" | jq -r '.value') || return
            path=${path//\\//}
            if [ -f "$path" ]; then
                case "$OSTYPE" in
                    msys*|cygwin*) path=$(cygpath -m "$path");;
                esac
                message=$(jq -Rn --rawfile text "$path" \
                    '$text | split("\n") | map(select(startswith("#") | not)) | join("\n")') || return
                printf '%s' "$check" | jq -c --argjson message "$message" \
                    '.kind = "message" | .value = $message' || return
            fi
        else
            printf '%s\n' "$check"
        fi
    done
}

if result=$(printf '%s' "$payload" |
    jq -c --arg mode checks --arg cwd "$PWD" -f "$scripts/git-conventions.jq" |
    resolve_files |
    jq -cs --arg mode validate -f "$scripts/git-conventions.jq"); then
    if [ -n "$result" ]; then printf '%s\n' "$result"; fi
else
    printf '%s\n' 'Git conventions: validation failed internally; allowing the tool call.' >&2
fi
exit 0
