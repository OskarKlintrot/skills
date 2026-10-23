#Requires -Version 7
# sessionStart / subagentStart hook: injects git conventions as additional context.
$ErrorActionPreference = 'Stop'
try {
    [Console]::In.ReadToEnd() | Out-Null
    $git = Get-Content -Raw -Encoding utf8 (Join-Path $PSScriptRoot 'git-conventions.md')
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    @{ additionalContext = $git } | ConvertTo-Json -Compress
}
catch {
    [Console]::Error.WriteLine("Could not load git conventions: $($_.Exception.Message)")
    '{}'
}
exit 0
