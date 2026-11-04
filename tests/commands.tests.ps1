#Requires -Version 7
param([switch]$Runtime)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$directory = Join-Path $root 'com.github.copilot' 'commands'
$skills = [ordered]@{
    'build' = 'incremental-implementation'
    'code-simplify' = 'code-simplification'
    'constraints' = 'constraint-driven-development'
    'addy-lifecycle' = 'addy-lifecycle'
    'plan' = 'planning-and-task-breakdown'
    'review' = 'code-review-and-quality'
    'ship' = 'shipping-and-launch'
    'spec' = 'spec-driven-development'
    'test' = 'test-driven-development'
    'webperf' = 'performance-optimization'
}
$failures = 0
$descriptions = @{}
$packagedSkills = @('addy-lifecycle', 'exhaustive-task', 'git-conventions', 'readme-conventions')
$packagedAgents = @('code-reviewer', 'security-auditor', 'test-engineer', 'web-performance-auditor')

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
Assert-Check 'Exactly the ten documented commands are packaged' (
    $files.Count -eq $skills.Count -and
    -not (Compare-Object @($skills.Keys) @($files.BaseName))
)
$skillDirectories = @(Get-ChildItem -LiteralPath (Join-Path $root 'skills') -Directory)
Assert-Check 'Packaged skills contain both workflow coordinators and conventions skills' (
    -not (Compare-Object $packagedSkills @($skillDirectories.Name))
)
$agentDirectory = Join-Path $root 'com.github.copilot' 'agents'
$agentFiles = @(Get-ChildItem -LiteralPath $agentDirectory -Filter '*.agent.md' -File)
Assert-Check 'All four Addy personas are packaged as Copilot agents' (
    -not (Compare-Object @($packagedAgents | ForEach-Object { "$_.agent.md" }) @($agentFiles.Name))
)
foreach ($name in $packagedAgents) {
    $persona = Get-Content -LiteralPath (Join-Path $agentDirectory "$name.agent.md") -Raw
    Assert-Check "$name has discoverable metadata and Copilot integration boundaries" (
        $persona -match "\A---\r?\nname: $name\r?\ndescription: [^\r\n]+" -and
        $persona.Contains('## Copilot integration') -and
        $persona.Contains('agent-skills:') -and
        $persona.Contains('structured report') -and
        $persona -notmatch '\.\./docs/agents\.md|`skills/|`references/'
    )
}
Assert-Check 'Persona imports retain their upstream MIT license' (
    (Get-Content -LiteralPath (Join-Path $agentDirectory 'LICENSE') -Raw).Contains('Copyright (c) 2025 Addy Osmani')
)

foreach ($name in $skills.Keys) {
    $path = Join-Path $directory "$name.md"
    Assert-Check "$name command exists" (Test-Path -LiteralPath $path -PathType Leaf)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    $content = Get-Content -LiteralPath $path -Raw
    $header = [regex]::Match($content, '\A---\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n')
    Assert-Check "$name has description-only Copilot command frontmatter" $header.Success
    if ($header.Success) { $descriptions[$name] = $header.Groups[1].Value }
    $skillProvider = if ($name -eq 'addy-lifecycle') { 'oskar-tools' } else { 'agent-skills' }
    Assert-Check "$name invokes its installed skill" ($content.Contains("${skillProvider}:$($skills[$name])"))
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
Assert-Check 'Build records completion before its required task commit' (
    $build -match '7\. Record the verified task''s completion[\s\S]*8\. Commit ' -and
    $build.Contains('build -> record completion -> commit') -and
    $build.Contains('Every task still earns verification and its own commit.') -and
    $build -notmatch 'optional authorized commit|If explicitly authorized to commit|only if commits were explicitly authorized'
)
$spec = Get-Content -LiteralPath (Join-Path $directory 'spec.md') -Raw
Assert-Check 'Spec preserves its upstream skill commit workflow' (
    $spec.Contains('agent-skills:spec-driven-development') -and
    $spec -notmatch 'Do not commit|does not authorize Git operations|even if the invoked skill recommends committing'
)
$lifecycle = Get-Content -LiteralPath (Join-Path $root 'skills' 'addy-lifecycle' 'SKILL.md') -Raw
Assert-Check 'Addy lifecycle skill has discoverable metadata and starts its workflow' (
    $lifecycle -match '\A---\r?\nname: addy-lifecycle\r?\ndescription: [^\r\n]+' -and
    $lifecycle.Contains('run the `addy-lifecycle` dynamic') -and
    -not (Test-Path -LiteralPath (Join-Path $directory 'lifecycle.md'))
)
Assert-Check 'Lifecycle prepares requirements in the main conversation with interview terminal gate' (
    $lifecycle.Contains('agent-skills:interview-me') -and
    $lifecycle.Contains('`ask_user` in this main conversation') -and
    $lifecycle.Contains('terminal-turn rule') -and
    $lifecycle.Contains('Do not write a spec') -and
    $lifecycle.Contains('same turn as intent confirmation')
)
Assert-Check 'Plan feedback keeps execution paused and requires approval of revised output' (
    $lifecycle.Contains('choices to approve, request changes, or stop') -and
    $lifecycle.Contains('keep the old run paused and do not start building') -and
    $lifecycle.Contains('never resume the old run with changed files') -and
    $lifecycle.Contains('If it differs, present it again and obtain explicit approval')
)
Assert-Check 'Lifecycle passes a prepared spec and routes all worker input to the user' (
    $lifecycle.Contains('"specPath"') -and
    $lifecycle.Contains('`needsInput`') -and
    $lifecycle.Contains('Define, Plan, Build, Verify,') -and
    $lifecycle.Contains('Review and Ship') -and
    $lifecycle.Contains('Do not auto-approve.')
)
Assert-Check 'Lifecycle requires approved atomic commits with an explicit baseline handoff' (
    $lifecycle.Contains('agent-skills:git-workflow-and-versioning') -and
    $lifecycle.Contains('git diff --cached') -and
    $lifecycle.Contains('"baselinePath"') -and
    $lifecycle.Contains('commits each verified task separately') -and
    $lifecycle -notmatch 'leaves all changes uncommitted|Do not commit, push'
)

$exhaustive = Get-Content -LiteralPath (Join-Path $root 'skills' 'exhaustive-task' 'SKILL.md') -Raw
Assert-Check 'Exhaustive task skill starts its workflow after mode, ledger, batch size, models, round ceiling and launch approval' (
    $exhaustive -match '\A---\r?\nname: exhaustive-task\r?\ndescription: [^\r\n]+' -and
    $exhaustive.Contains('run the `exhaustive-task` dynamic workflow') -and
    $exhaustive.Contains('Choose the mode') -and
    $exhaustive.Contains('`ledgerPath`') -and
    $exhaustive.Contains('about the batch size') -and
    $exhaustive.Contains('which models to use') -and
    $exhaustive.Contains('whether to use a round ceiling') -and
    $exhaustive.Contains('Recommend 10') -and
    $exhaustive.Contains('explicit launch') -and
    $exhaustive.Contains('Never auto-resume.')
)
Assert-Check 'Exhaustive task coordinator protects user work and routes human decisions' (
    $exhaustive.Contains('agent-skills:git-workflow-and-versioning') -and
    $exhaustive.Contains('git status --porcelain') -and
    $exhaustive.Contains('`needsInput`') -and
    $exhaustive.Contains('same `ledgerPath`') -and
    $exhaustive.Contains('reverse patch') -and
    $exhaustive.Contains('leave them uncommitted') -and
    $exhaustive.Contains('no commit') -and
    $exhaustive.Contains('never on the') -and
    $exhaustive.Contains('do not let them pile up') -and
    $exhaustive.Contains('default branch')
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

    # Invalid arguments exercise extension loading without invoking any model task.
    $installedSkills = & copilot skill list 2>&1
    Assert-Check 'Installed plugin discovers the addy-lifecycle skill' (
        $LASTEXITCODE -eq 0 -and ($installedSkills -join "`n").Contains('addy-lifecycle')
    )
    Assert-Check 'Installed plugin discovers the exhaustive-task skill' (
        $LASTEXITCODE -eq 0 -and ($installedSkills -join "`n").Contains('exhaustive-task')
    )
    $workflowOutput = & copilot --experimental --disable-builtin-mcps --no-custom-instructions workflow run addy-lifecycle --args '{"goal":"A goal without a prepared spec"}' 2>&1
    Assert-Check 'Installed lifecycle workflow loads and enforces its argument schema' (
        $LASTEXITCODE -eq 2 -and
        ($workflowOutput -join "`n").Contains('Invalid arguments for dynamic workflow "addy-lifecycle".')
    )
    $exhaustiveOutput = & copilot --experimental --disable-builtin-mcps --no-custom-instructions workflow run exhaustive-task --args '{"goal":"No scope or acceptance"}' 2>&1
    Assert-Check 'Installed exhaustive-task workflow loads and enforces its argument schema without agents' (
        $LASTEXITCODE -eq 2 -and
        ($exhaustiveOutput -join "`n").Contains('Invalid arguments for dynamic workflow "exhaustive-task".')
    )
    $preflightOutput = & copilot --experimental --disable-builtin-mcps --no-custom-instructions workflow run addy-lifecycle --args '{"goal":"Preflight only","specPath":"tests\\fixtures\\nonexistent-lifecycle-spec.md","baselinePath":"session-baseline.json"}' 2>&1
    Assert-Check 'Installed workflow rejects a missing spec without spawning model tasks' (
        $LASTEXITCODE -eq 0 -and
        ($preflightOutput -join "`n").Contains('"verdict":"NO-GO"') -and
        ($preflightOutput -join "`n").Contains('"reports":{}') -and
        ($preflightOutput -join "`n").Contains('Cannot read specPath (ENOENT)')
    )

    # PowerShell resolves npm launchers as well as native CLI installations.
    $shellPath = Join-Path $PSHOME $(if ($IsWindows) { 'pwsh.exe' } else { 'pwsh' })
    $start = [System.Diagnostics.ProcessStartInfo]::new($shellPath)
    $start.WorkingDirectory = $testHome
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in @('-NoProfile', '-NonInteractive', '-Command', '& copilot --acp --no-auto-update --disable-builtin-mcps --no-custom-instructions')) {
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
        if ($message.id -eq 2) {
            $sessionCreated = $true
            $agentOptions = @($message.result.configOptions | Where-Object id -eq 'agent')
            foreach ($name in $packagedAgents) {
                Assert-Check "Installed plugin discovers the $name persona" (
                    @($agentOptions.options | Where-Object value -eq "$($manifest.name):$name").Count -eq 1
                )
            }
        }
    }

    foreach ($name in $skills.Keys) {
        $registered = @($commands | Where-Object name -eq "$($manifest.name):$name")
        $expectedDescription = $descriptions[$name]
        # CLI exposes the skill rather than the adapter when their names coincide.
        if ($name -eq 'addy-lifecycle') {
            $expectedDescription = [regex]::Match($lifecycle, '(?m)^description: ([^\r\n]+)').Groups[1].Value
        }
        Assert-Check "Installed plugin registers /$($manifest.name):$name with its description" (
            $registered.Count -eq 1 -and $registered[0].description -eq $expectedDescription
        )
    }
    foreach ($name in @('plan', 'review')) {
        Assert-Check "Built-in /$name remains separate" (@($commands | Where-Object name -eq $name).Count -eq 1)
    }
    $registeredSkills = @($commands | Where-Object {
        $_.name -like "$($manifest.name):*" -and
        $_.name -notin @($skills.Keys | ForEach-Object { "$($manifest.name):$_" })
    } | ForEach-Object { $_.name.Substring($manifest.name.Length + 1) })
    $skillOnlyCommands = @($packagedSkills | Where-Object { $_ -notin $skills.Keys })
    Assert-Check 'Isolated install registers skill commands without duplicating coordinator command' (
        -not (Compare-Object $skillOnlyCommands $registeredSkills)
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
