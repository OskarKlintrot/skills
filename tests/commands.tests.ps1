#Requires -Version 7
param([switch]$Runtime)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$directory = Join-Path $root 'com.github.copilot' 'commands'
$skills = [ordered]@{
    'build' = 'incremental-implementation'
    'code-simplify' = 'code-simplification'
    'constraints' = 'constraint-driven-development'
    'plan' = 'planning-and-task-breakdown'
    'review' = 'code-review-and-quality'
    'ship' = 'shipping-and-launch'
    'spec' = 'spec-driven-development'
    'test' = 'test-driven-development'
    'webperf' = 'performance-optimization'
}
$failures = 0
$descriptions = @{}
$packagedSkills = @('git-conventions', 'readme-conventions')

function Assert-Check([string]$Name, [bool]$Condition) {
    if ($Condition) {
        Write-Host "ok:   $Name"
    }
    else {
        $script:failures++
        Write-Host "FAIL: $Name" -ForegroundColor Red
    }
}

$manifest = Get-Content -LiteralPath (Join-Path $root 'plugin.json') -Raw | ConvertFrom-Json
Assert-Check 'Agent Plugins 1.0 manifest uses fixed component paths' (
    $manifest.'$schema' -eq 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json' -and
    -not ($manifest.PSObject.Properties.Name | Where-Object { $_ -in @('commands', 'skills', 'agents', 'hooks') })
)
$files = @(Get-ChildItem -LiteralPath $directory -Filter '*.md' -File -ErrorAction SilentlyContinue)
Assert-Check 'Exactly the nine upstream commands are packaged' (
    $files.Count -eq $skills.Count -and
    -not (Compare-Object @($skills.Keys) @($files.BaseName))
)
$skillDirectories = @(Get-ChildItem -LiteralPath (Join-Path $root 'skills') -Directory)
Assert-Check 'Packaged skills contain only the plugin conventions skills' (
    -not (Compare-Object $packagedSkills @($skillDirectories.Name))
)

foreach ($name in $skills.Keys) {
    $path = Join-Path $directory "$name.md"
    Assert-Check "$name command exists" (Test-Path -LiteralPath $path -PathType Leaf)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    $content = Get-Content -LiteralPath $path -Raw
    $header = [regex]::Match($content, '\A---\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n')
    Assert-Check "$name has description-only Copilot command frontmatter" $header.Success
    if ($header.Success) { $descriptions[$name] = $header.Groups[1].Value }
    Assert-Check "$name invokes its installed skill" ($content.Contains("agent-skills:$($skills[$name])"))
    Assert-Check "$name reports missing skill dependencies" ($content -match '(?i)skill.*unavailable.*stop')
    Assert-Check "$name has no Claude runtime or plugin-cache assumptions" (
        $content -notmatch 'CLAUDE\.md|\.claude[/\\]|disable-model-invocation|subagent_type|Agent Teams|Agent tool|\$ARGUMENTS|installed-plugins[/\\]'
    )
}

$license = Join-Path $directory 'LICENSE'
Assert-Check 'Upstream MIT notice is retained' (
    (Test-Path -LiteralPath $license) -and
    (Get-Content -LiteralPath $license -Raw).Contains('Copyright (c) 2025 Addy Osmani')
)

$build = Get-Content -LiteralPath (Join-Path $directory 'build.md') -Raw
Assert-Check 'Build preserves the working-tree and index baseline in both modes' (
    $build.Contains('Before editing in either mode') -and $build.Contains('git diff --cached') -and
    $build.Contains("preserving the user's index and working tree")
)
Assert-Check 'Build records completion before its optional commit' (
    $build -match '7\. Record the verified task''s completion[\s\S]*8\. If explicitly authorized to commit' -and
    $build.Contains('build -> record completion -> optional authorized commit')
)
$spec = Get-Content -LiteralPath (Join-Path $directory 'spec.md') -Raw
Assert-Check 'Spec approval does not authorize commits recommended by its skill' (
    $spec.Contains('Do not commit or push unless explicitly authorized') -and
    $spec.Contains('even if the invoked skill recommends committing the spec')
)

if ($failures) { throw "$failures command checks failed." }
if (-not $Runtime) { return }

# ACP exposes actual registered commands without executing a model prompt.
$testHome = Join-Path ([System.IO.Path]::GetTempPath()) "oskar-command-tests-$([guid]::NewGuid())"
$previousHome = $env:COPILOT_HOME
$previousUpdate = $env:COPILOT_AUTO_UPDATE
$process = $null
New-Item -ItemType Directory -Path $testHome | Out-Null
try {
    $env:COPILOT_HOME = $testHome
    $env:COPILOT_AUTO_UPDATE = 'false'
    $installOutput = & copilot plugin install $root 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Isolated plugin installation failed: $installOutput" }

    $start = [System.Diagnostics.ProcessStartInfo]::new('copilot')
    $start.WorkingDirectory = $testHome
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in @('--acp', '--no-auto-update', '--disable-builtin-mcps', '--no-custom-instructions')) {
        $start.ArgumentList.Add($argument)
    }
    $process = [System.Diagnostics.Process]::Start($start)
    $stderr = $process.StandardError.ReadToEndAsync()
    $initialize = @{
        jsonrpc = '2.0'; id = 1; method = 'initialize'
        params = @{ protocolVersion = 1; clientCapabilities = @{}; clientInfo = @{ name = 'command-tests'; version = '1' } }
    }
    $process.StandardInput.WriteLine(($initialize | ConvertTo-Json -Compress -Depth 5))
    $process.StandardInput.Flush()

    $commands = @()
    $sessionCreated = $false
    $deadline = [datetime]::UtcNow.AddSeconds(60)
    while (-not $sessionCreated -or $commands.Count -eq 0) {
        $remaining = [math]::Max(0, [int]($deadline - [datetime]::UtcNow).TotalMilliseconds)
        $line = $process.StandardOutput.ReadLineAsync()
        if (-not $line.Wait($remaining)) { throw 'Timed out waiting for ACP command discovery.' }
        if ($null -eq $line.Result) { throw "Copilot ACP exited before discovery: $($stderr.GetAwaiter().GetResult())" }
        $message = $line.Result | ConvertFrom-Json
        if ($message.error) { throw "ACP failed: $($message.error | ConvertTo-Json -Compress)" }
        if ($message.id -eq 1) {
            $newSession = @{
                jsonrpc = '2.0'; id = 2; method = 'session/new'
                params = @{ cwd = $testHome; mcpServers = @() }
            }
            $process.StandardInput.WriteLine(($newSession | ConvertTo-Json -Compress -Depth 5))
            $process.StandardInput.Flush()
        }
        if ($message.params.update.sessionUpdate -eq 'available_commands_update') {
            $commands = @($message.params.update.availableCommands)
        }
        if ($message.id -eq 2) { $sessionCreated = $true }
    }

    foreach ($name in $skills.Keys) {
        $registered = @($commands | Where-Object name -eq "$($manifest.name):$name")
        Assert-Check "Installed plugin registers /$($manifest.name):$name with its description" (
            $registered.Count -eq 1 -and $registered[0].description -eq $descriptions[$name]
        )
    }
    foreach ($name in @('plan', 'review')) {
        Assert-Check "Built-in /$name remains separate" (@($commands | Where-Object name -eq $name).Count -eq 1)
    }
    $registeredSkills = @($commands | Where-Object {
        $_.name -like "$($manifest.name):*" -and
        $_.name -notin @($skills.Keys | ForEach-Object { "$($manifest.name):$_" })
    } | ForEach-Object { $_.name.Substring($manifest.name.Length + 1) })
    Assert-Check 'Isolated install registers only the plugin conventions skills' (
        -not (Compare-Object $packagedSkills $registeredSkills)
    )
}
finally {
    if ($process) {
        if (-not $process.HasExited) {
            $process.Kill($true)
            $process.WaitForExit()
        }
        $process.Dispose()
    }
    $env:COPILOT_HOME = $previousHome
    $env:COPILOT_AUTO_UPDATE = $previousUpdate
    Remove-Item -LiteralPath $testHome -Recurse -Force
}
if ($failures) { throw "$failures runtime command checks failed." }
