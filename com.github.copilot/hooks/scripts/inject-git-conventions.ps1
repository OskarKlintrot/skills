#Requires -Version 7
# sessionStart / subagentStart hook: injects the git conventions as additional context.
$ErrorActionPreference = 'Stop'
try {
    [Console]::In.ReadToEnd() | Out-Null
    $text = Get-Content -Raw -Encoding utf8 (Join-Path $PSScriptRoot 'git-conventions.md')
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    @{ additionalContext = $text } | ConvertTo-Json -Compress
}
catch {
    '{}'
}
exit 0
