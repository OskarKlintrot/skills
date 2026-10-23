#Requires -Version 7
# sessionStart / subagentStart hook: injects README conventions as additional context.
$ErrorActionPreference = 'Stop'
try {
    [Console]::In.ReadToEnd() | Out-Null
    $readme = Get-Content -Raw -Encoding utf8 (Join-Path $PSScriptRoot 'readme-conventions.md')
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    @{ additionalContext = $readme } | ConvertTo-Json -Compress
}
catch {
    [Console]::Error.WriteLine("Could not load README conventions: $($_.Exception.Message)")
    '{}'
}
exit 0
