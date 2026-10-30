#Requires -Version 7
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot
$plugin = $root
$scripts = Join-Path $plugin 'com.github.copilot\hooks\scripts'
$cases = Get-Content -Raw (Join-Path $PSScriptRoot 'git-conventions-cases.json') | ConvertFrom-Json
$count = 0

function Assert-That([bool]$Condition, [string]$Name) {
    if (-not $Condition) { throw "FAIL: $Name" }
    $script:count++
}

function Invoke-Hook([string]$Script, [string]$Json) {
    $output = ($Json | pwsh -NoProfile -NonInteractive -File $Script) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Hook exited with $LASTEXITCODE" }
    return $output
}

function Assert-Decision([string]$Output, [bool]$Deny, [string]$Name) {
    $denied = $false
    if ($Output.Trim()) {
        $response = $Output | ConvertFrom-Json
        $denied = $response.permissionDecision -eq 'deny'
        Assert-That ($response.permissionDecisionReason.StartsWith('Git conventions: ')) "$Name reason"
    }
    Assert-That ($denied -eq $Deny) $Name
}

$temp = Join-Path ([IO.Path]::GetTempPath()) "oskar-hook-tests-O'Connor-$([guid]::NewGuid())"
$oldHome = $env:COPILOT_HOME
$oldPluginRoot = $env:OSKAR_TOOLS_PLUGIN_ROOT
New-Item -ItemType Directory $temp | Out-Null
try {
    Set-Content -LiteralPath (Join-Path $temp 'good.txt') -Value "# comment`nfeat: Add file support`n`nBody" -Encoding utf8
    Set-Content -LiteralPath (Join-Path $temp 'bad.txt') -Value 'added file support' -Encoding utf8
    $nested = Join-Path $temp 'repo\sub'
    $sibling = Join-Path $temp 'sub'
    New-Item -ItemType Directory -Path $nested, $sibling -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $nested 'msg.txt'), (Join-Path $sibling 'good.txt') -Value 'invalid subject' -Encoding utf8
    Set-Content -LiteralPath (Join-Path $nested 'good.txt'), (Join-Path $sibling 'msg.txt') -Value 'build: Update hooks' -Encoding utf8
    Set-Content -LiteralPath (Join-Path $temp 'msg.txt') -Value 'invalid subject' -Encoding utf8
    Set-Content -LiteralPath (Join-Path $temp 'repo\msg.txt') -Value 'build: Update hooks' -Encoding utf8
    foreach ($case in $cases) {
        $json = ($case.payload | ConvertTo-Json -Compress -Depth 10).Replace('{{CWD}}', ($temp | ConvertTo-Json -Compress).Trim('"'))
        $out = Invoke-Hook (Join-Path $scripts 'enforce-git-conventions.ps1') $json
        Assert-Decision $out $case.deny $case.name
    }
    Assert-That (-not (Invoke-Hook (Join-Path $scripts 'enforce-git-conventions.ps1') 'not json').Trim()) 'Malformed JSON allows'

    $git = Get-Content -Raw -Encoding utf8 (Join-Path $plugin 'skills\git-conventions\SKILL.md')
    Assert-That ($git -match '\A---\r?\nname: git-conventions\r?\ndescription: [^\r\n]+\r?\n---\r?\n' -and
        $git -notmatch '(?m)^disable-model-invocation:\s*true\s*$') 'Git skill is discoverable'
    foreach ($rule in 'feature/<short-descriptive-info>', 'release/*', '<type>(<scope>): <Subject>', 'imperative', '72 characters', 'preToolUse') {
        Assert-That ($git.Contains($rule)) "Git skill includes $rule"
    }
    $readme = Get-Content -Raw -Encoding utf8 (Join-Path $plugin 'skills\readme-conventions\SKILL.md')
    Assert-That ($readme -match '\A---\r?\nname: readme-conventions\r?\ndescription: [^\r\n]*creating or editing README\.md[^\r\n]*\r?\n---\r?\n' -and
        $readme -notmatch '(?m)^disable-model-invocation:\s*true\s*$' -and
        $readme.Contains('only when creating or editing a file named README.md')) 'README skill is discoverable and scoped'
    foreach ($ruleName in 'git', 'readme') {
        foreach ($name in "inject-$ruleName-conventions.ps1", "inject-$ruleName-conventions.sh", "$ruleName-conventions.md") {
            Assert-That (-not (Test-Path -LiteralPath (Join-Path $scripts $name))) "No legacy $name"
        }
    }

    $package = Join-Path $temp "plugin O'Connor & `$()"
    New-Item -ItemType Directory -Path $package | Out-Null
    foreach ($component in 'plugin.json', 'skills', 'com.github.copilot') {
        Copy-Item -LiteralPath (Join-Path $plugin $component) -Destination $package -Recurse
    }
    $testHome = Join-Path $temp "home O'Connor with spaces"
    $copilot = Join-Path $testHome '.copilot'
    New-Item -ItemType Directory -Path $copilot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $plugin 'com.github.copilot\hooks') -Destination $copilot -Recurse
    $hooks = Get-Content -Raw (Join-Path $plugin 'com.github.copilot\hooks\hooks.json') | ConvertFrom-Json
    Assert-That ($hooks.version -eq 1) 'Hook schema version'
    Assert-That ((@($hooks.hooks.PSObject.Properties.Name) -join ',') -ceq 'preToolUse') 'Only tool-call hook is configured'
    Assert-That ($hooks.hooks.preToolUse.Count -eq 1) 'One validation hook is configured'
    foreach ($event in 'sessionStart', 'subagentStart') {
        Assert-That (-not $hooks.hooks.PSObject.Properties[$event]) "$event startup injection is absent"
    }
    foreach ($event in 'preToolUse') {
        $definition = $hooks.hooks.$event[0]
        Assert-That ($definition.bash -notmatch 'pwsh|\.ps1') "$event Bash has no PowerShell dependency"
        Assert-That ($definition.env.OSKAR_TOOLS_PLUGIN_ROOT -ceq '${PLUGIN_ROOT}') "$event plugin root environment"
        Assert-That (($definition.bash + $definition.powershell) -notmatch '\$\{PLUGIN_ROOT\}') "$event root is not shell source"
        foreach ($route in 'plugin', 'copilot-home', 'home') {
            $command = $definition.powershell
            $env:OSKAR_TOOLS_PLUGIN_ROOT = switch ($route) {
                'plugin' { $definition.env.OSKAR_TOOLS_PLUGIN_ROOT.Replace('${PLUGIN_ROOT}', $package) }
                'copilot-home' { $definition.env.OSKAR_TOOLS_PLUGIN_ROOT }
                'home' { $null }
            }
            $env:COPILOT_HOME = switch ($route) {
                'plugin' { Join-Path $temp 'missing copilot home' }
                'copilot-home' { $copilot }
                'home' { $null }
            }
            $commandHome = if ($route -eq 'home') { $testHome } else { Join-Path $temp 'missing home' }
            $escapedHome = $commandHome.Replace("'", "''")
            $command = "Set-Variable -Name HOME -Value '$escapedHome' -Force; $command"
            foreach ($title in 'build: Update tools', 'Invalid title') {
                $inputJson = @{ toolName = 'create_pull_request'; toolArgs = @{ title = $title } } | ConvertTo-Json -Compress
                $out = ($inputJson | pwsh -NoProfile -NonInteractive -Command $command) -join "`n"
                Assert-That ($LASTEXITCODE -eq 0) "$event $route command exit"
                Assert-Decision $out ($title -eq 'Invalid title') "$event $route $title"
            }
        }
    }
    $manifest = Get-Content -Raw (Join-Path $plugin 'plugin.json') | ConvertFrom-Json
    $marketplace = Get-Content -Raw (Join-Path $root '.github\plugin\marketplace.json') | ConvertFrom-Json
    Assert-That ($manifest.name -ceq 'oskar-tools') 'Plugin identity'
    Assert-That ($marketplace.name -ceq 'oskar-personal') 'Marketplace identity'
    $entries = @($marketplace.plugins | Where-Object name -eq $manifest.name)
    Assert-That ($entries.Count -eq 1) 'One marketplace entry for the plugin'
    $entry = $entries[0]
    Assert-That ($entry.source -ceq '.') 'Marketplace uses the root plugin'
    Assert-That (-not $entry.PSObject.Properties['version']) 'Marketplace does not duplicate the plugin version'
    Write-Host "$count assertions passed (PowerShell)"
}
finally {
    $env:COPILOT_HOME = $oldHome
    $env:OSKAR_TOOLS_PLUGIN_ROOT = $oldPluginRoot
    Remove-Item -LiteralPath $temp -Recurse -Force
}
