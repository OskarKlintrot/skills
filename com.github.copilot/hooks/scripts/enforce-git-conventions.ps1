#Requires -Version 7
# preToolUse hook: denies tool calls that create commits, pull request titles, merge commit messages,
# or branches that break the git conventions in git-conventions.md.
# Prints nothing (default permission flow) when the call is fine or cannot be parsed.
param(
    [string]$Payload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:AllowedTypes = 'feat', 'fix', 'perf', 'docs', 'style', 'refactor', 'test', 'build'
$script:MessagePattern = '^(' + ($script:AllowedTypes -join '|') + ')(\([a-z0-9][a-z0-9._/-]*\))?: \p{Lu}'
$script:BranchPattern = '^(feature|release)/[a-z0-9]+([._-][a-z0-9]+)*(/[a-z0-9]+([._-][a-z0-9]+)*)*$'
$script:NonEnglishPattern = '[åäöÅÄÖæøÆØ]'
$script:MaxSubjectLength = 72

function Get-MessageProblems {
    param([string]$Message, [string]$What)
    $subject = ($Message -split "`r?`n", 2)[0].Trim()

    if ($subject -match '^(fixup|squash|amend)! ') {
        return
    }
    if ($subject -cnotmatch $script:MessagePattern) {
        Write-Output ("$What '$subject' must match '<type>: <Subject>' or '<type>(<scope>): <Subject>' where <type> is one of $($script:AllowedTypes -join ', '), <type>/<scope> are lowercase, and the subject starts with an uppercase letter in imperative form (for example 'feat: Add name to payment card').")
    }
    if ($subject.Length -gt $script:MaxSubjectLength) {
        Write-Output ("$What first line is $($subject.Length) characters; keep it at most $($script:MaxSubjectLength). Say it simply and concisely, like one human talking to another.")
    }
    if ($Message -match $script:NonEnglishPattern) {
        Write-Output ("$What must be written in English.")
    }
}

function Get-BranchProblems {
    param([string]$Branch)
    $name = $Branch -replace '^refs/heads/', ''
    if ($name -cnotmatch $script:BranchPattern) {
        Write-Output ("Branch name '$name' must be 'feature/<short-descriptive-info>' in lowercase English kebab-case (for example 'feature/add-payment-card-name'), or 'release/*' when explicitly asked.")
    }
}

function Split-ShellCommand {
    # Rough shell tokenizer for bash and PowerShell. Returns an array of segments (token arrays),
    # split on newlines, ';', '&', '|', '(' and ')' outside quotes.
    param([string]$Command, [bool]$IsPowerShell)

    $escape = if ($IsPowerShell) { '`' } else { '\' }
    $segments = [System.Collections.Generic.List[object]]::new()
    $tokens = [System.Collections.Generic.List[string]]::new()
    $sb = [System.Text.StringBuilder]::new()
    $hasToken = $false
    $i = 0
    $n = $Command.Length

    $endToken = {
        if ($hasToken) {
            $tokens.Add($sb.ToString())
            [void]$sb.Clear()
            $hasToken = $false
        }
    }
    # Dot-sourced so they update this function's variables.
    $endSegment = {
        . $endToken
        if ($tokens.Count -gt 0) {
            $segments.Add($tokens.ToArray())
            $tokens.Clear()
        }
    }

    while ($i -lt $n) {
        $c = $Command[$i]

        if ($IsPowerShell -and -not $hasToken -and $c -eq '@' -and $i + 1 -lt $n -and ($Command[$i + 1] -eq '"' -or $Command[$i + 1] -eq "'")) {
            $q = $Command[$i + 1]
            $start = $Command.IndexOf("`n", $i)
            $endMarker = [regex]::Match($Command.Substring([Math]::Max($start, 0)), "\r?\n$q@")
            if ($start -ge 0 -and $endMarker.Success) {
                $bodyStart = $start + 1
                $bodyEnd = $start + $endMarker.Index
                [void]$sb.Append($Command.Substring($bodyStart, [Math]::Max(0, $bodyEnd - $bodyStart)))
                $hasToken = $true
                $i = $start + $endMarker.Index + $endMarker.Length
                continue
            }
        }

        if ($c -eq "'") {
            $close = $Command.IndexOf("'", $i + 1)
            if ($close -lt 0) { $close = $n }
            [void]$sb.Append($Command.Substring($i + 1, $close - $i - 1))
            $hasToken = $true
            $i = $close + 1
            continue
        }

        if ($c -eq '"') {
            $hasToken = $true
            $i++
            while ($i -lt $n -and $Command[$i] -ne '"') {
                $d = $Command[$i]
                if ($d -eq $escape -and $i + 1 -lt $n) {
                    $next = $Command[$i + 1]
                    if ($IsPowerShell) {
                        switch -CaseSensitive ($next) {
                            'n' { [void]$sb.Append("`n") }
                            'r' { }
                            't' { [void]$sb.Append("`t") }
                            default { [void]$sb.Append($next) }
                        }
                    }
                    elseif ($next -in '"', '\', '$', '`') {
                        [void]$sb.Append($next)
                    }
                    else {
                        [void]$sb.Append($d).Append($next)
                    }
                    $i += 2
                    continue
                }
                [void]$sb.Append($d)
                $i++
            }
            $i++
            continue
        }

        if ($c -eq $escape -and $i + 1 -lt $n) {
            $next = $Command[$i + 1]
            if ($next -ne "`n" -and $next -ne "`r") {
                [void]$sb.Append($next)
                $hasToken = $true
            }
            $i += 2
            continue
        }

        if ($c -eq ' ' -or $c -eq "`t" -or $c -eq "`r") {
            . $endToken
            $i++
            continue
        }

        if ($c -in "`n", ';', '&', '|', '(', ')') {
            . $endSegment
            $i++
            continue
        }

        [void]$sb.Append($c)
        $hasToken = $true
        $i++
    }
    . $endSegment
    return , $segments.ToArray()
}

function Resolve-MessageValue {
    # Returns the literal message, or $null when it cannot be determined statically.
    param([string]$Value)

    $heredoc = [regex]::Match($Value, "(?s)^\s*\$\(\s*cat\s+<<-?\s*['""]?(\w+)['""]?\s*\r?\n(.*?)\r?\n\s*\1\s*\r?\n?\s*\)\s*$")
    if ($heredoc.Success) {
        return $heredoc.Groups[2].Value
    }
    if ($Value.StartsWith('$')) {
        return $null
    }
    return $Value
}

function Get-CommandBaseName {
    param([string]$Token)
    return ([System.IO.Path]::GetFileName($Token) -replace '\.exe$', '').ToLowerInvariant()
}

function Get-OptionValue {
    # Finds the value of the first matching option (supports '--opt value', '--opt=value', '-o value', '-ovalue').
    param([string[]]$Tokens, [string[]]$Long, [string[]]$Short)

    for ($k = 0; $k -lt $Tokens.Count; $k++) {
        $t = $Tokens[$k]
        foreach ($opt in $Long) {
            if ($t -eq $opt -and $k + 1 -lt $Tokens.Count) { return @{ Value = $Tokens[$k + 1] } }
            if ($t.StartsWith("$opt=")) { return @{ Value = $t.Substring($opt.Length + 1) } }
        }
        foreach ($opt in $Short) {
            if ($t -ceq $opt -and $k + 1 -lt $Tokens.Count) { return @{ Value = $Tokens[$k + 1] } }
        }
    }
    return $null
}

function Test-GitSegment {
    param([string[]]$CmdArgs, [string]$Cwd)
    $k = 0
    $workDir = $Cwd
    while ($k -lt $CmdArgs.Count -and $CmdArgs[$k].StartsWith('-')) {
        if ($CmdArgs[$k] -ceq '-C' -and $k + 1 -lt $CmdArgs.Count) {
            $workDir = if ([System.IO.Path]::IsPathRooted($CmdArgs[$k + 1])) { $CmdArgs[$k + 1] } else { Join-Path $Cwd $CmdArgs[$k + 1] }
            $k += 2
        }
        elseif ($CmdArgs[$k] -in '-c', '--git-dir', '--work-tree', '--namespace' -and $k + 1 -lt $CmdArgs.Count) {
            $k += 2
        }
        else {
            $k++
        }
    }
    if ($k -ge $CmdArgs.Count) { return }

    $sub = $CmdArgs[$k]
    $rest = @(if ($k + 1 -lt $CmdArgs.Count) { $CmdArgs[($k + 1)..($CmdArgs.Count - 1)] })

    switch ($sub) {
        'commit' {
            if ($rest | Where-Object { $_ -match '^--(fixup|squash)(=|$)' -or $_ -ceq '-C' -or $_ -ceq '-c' -or $_ -match '^--(reuse|reedit)-message' }) {
                break
            }
            $message = $null
            for ($j = 0; $j -lt $rest.Count; $j++) {
                $t = $rest[$j]
                if (($t -cmatch '^-[a-zA-Z]*m$' -or $t -eq '--message') -and $j + 1 -lt $rest.Count) {
                    $message = Resolve-MessageValue $rest[$j + 1]; break
                }
                if ($t -match '^--message=(.*)$') { $message = Resolve-MessageValue $Matches[1]; break }
                if ($t -cmatch '^-m(.+)$') { $message = Resolve-MessageValue $Matches[1]; break }
                if (($t -cmatch '^-[a-zA-Z]*F$' -or $t -eq '--file') -and $j + 1 -lt $rest.Count) {
                    $file = $rest[$j + 1]
                    if ($file -ne '-' -and -not $file.StartsWith('$')) {
                        $path = if ([System.IO.Path]::IsPathRooted($file)) { $file } else { Join-Path $workDir $file }
                        if (Test-Path -LiteralPath $path -PathType Leaf) {
                            $message = (Get-Content -LiteralPath $path -Encoding utf8 | Where-Object { $_ -notmatch '^#' }) -join "`n"
                        }
                    }
                    break
                }
            }
            if ($null -ne $message) {
                Get-MessageProblems -Message $message -What 'Commit message'
            }
        }
        'checkout' {
            $v = Get-OptionValue $rest @('--orphan') @('-b', '-B')
            if ($v) { Get-BranchProblems $v.Value }
        }
        'switch' {
            $v = Get-OptionValue $rest @('--create', '--force-create', '--orphan') @('-c', '-C')
            if ($v) { Get-BranchProblems $v.Value }
        }
        'worktree' {
            if ($rest.Count -gt 0 -and $rest[0] -eq 'add') {
                $v = Get-OptionValue $rest @() @('-b', '-B')
                if ($v) { Get-BranchProblems $v.Value }
            }
        }
        'branch' {
            $listFlags = '-d', '-D', '--delete', '-l', '--list', '-a', '--all', '-r', '--remotes', '-v', '-vv', '--verbose',
            '--show-current', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--sort', '--format',
            '--edit-description', '-u', '--set-upstream-to', '--unset-upstream'
            $moveFlags = '-m', '-M', '--move', '-c', '-C', '--copy'
            $flags = @($rest | Where-Object { $_.StartsWith('-') } | ForEach-Object { ($_ -split '=', 2)[0] })
            $positional = @($rest | Where-Object { -not $_.StartsWith('-') })
            if ($flags | Where-Object { $_ -cin $listFlags }) { break }
            if ($positional.Count -eq 0) { break }
            $newName = if ($flags | Where-Object { $_ -cin $moveFlags }) { $positional[-1] } else { $positional[0] }
            Get-BranchProblems $newName
        }
    }
}

function Test-GhSegment {
    param([string[]]$CmdArgs)
    if ($CmdArgs.Count -lt 2 -or $CmdArgs[0] -ne 'pr') { return }
    $rest = @($CmdArgs | Select-Object -Skip 2)
    $v = switch ($CmdArgs[1]) {
        { $_ -in 'create', 'new', 'edit' } { Get-OptionValue $rest @('--title') @('-t') }
        'merge' { Get-OptionValue $rest @('--subject') @('-t') }
    }
    if ($v) {
        $message = Resolve-MessageValue $v.Value
        if ($null -ne $message) {
            $what = if ($CmdArgs[1] -eq 'merge') { 'Merge commit subject' } else { 'Pull request title' }
            Get-MessageProblems -Message $message -What $what
        }
    }
}

function Test-AzSegment {
    param([string[]]$CmdArgs)
    if ($CmdArgs.Count -lt 3 -or $CmdArgs[0] -ne 'repos' -or $CmdArgs[1] -ne 'pr' -or $CmdArgs[2] -notin 'create', 'update') { return }
    $rest = @($CmdArgs | Select-Object -Skip 3)
    $title = Get-OptionValue $rest @('--title') @()
    if ($title) {
        $message = Resolve-MessageValue $title.Value
        if ($null -ne $message) { Get-MessageProblems -Message $message -What 'Pull request title' }
    }
    $merge = Get-OptionValue $rest @('--merge-commit-message') @()
    if ($merge) {
        $message = Resolve-MessageValue $merge.Value
        if ($null -ne $message) { Get-MessageProblems -Message $message -What 'Merge commit message' }
    }
}

function Test-ShellCommand {
    param([string]$Command, [bool]$IsPowerShell, [string]$Cwd)
    foreach ($segment in (Split-ShellCommand -Command $Command -IsPowerShell $IsPowerShell)) {
        $tokens = @($segment | Where-Object { $_ -notmatch '^[A-Za-z_][A-Za-z0-9_]*=' })
        if ($tokens.Count -eq 0) { continue }
        $rest = @(if ($tokens.Count -gt 1) { $tokens[1..($tokens.Count - 1)] })
        switch (Get-CommandBaseName $tokens[0]) {
            'git' { Test-GitSegment -CmdArgs $rest -Cwd $Cwd }
            'gh' { Test-GhSegment -CmdArgs $rest }
            'az' { Test-AzSegment -CmdArgs $rest }
        }
    }
}

function Get-ArgString {
    param($ToolArgs, [string[]]$Names)
    foreach ($name in $Names) {
        $prop = $ToolArgs.PSObject.Properties[$name]
        if ($prop -and $prop.Value -is [string] -and $prop.Value.Trim()) { return $prop.Value }
    }
    return $null
}

function Test-ToolCall {
    param([string]$ToolName, $ToolArgs, [string]$Cwd)
    if ($null -eq $ToolArgs) { return }

    if ($ToolName -match '^(?i)(bash|powershell|pwsh|shell)$') {
        $command = Get-ArgString $ToolArgs @('command')
        if ($command) {
            $isPowerShell = $ToolName -match '^(?i)(powershell|pwsh)$'
            Test-ShellCommand -Command $command -IsPowerShell $isPowerShell -Cwd $Cwd
        }
    }

    # MCP and app tools: Azure DevOps, GitHub and GitHub Enterprise.
    if ($ToolName -match '(?i)pull_request') {
        $title = Get-ArgString $ToolArgs @('title')
        if ($title) { Get-MessageProblems -Message $title -What 'Pull request title' }
        $merge = Get-ArgString $ToolArgs @('commit_title', 'commitTitle', 'mergeCommitMessage', 'merge_commit_message')
        if ($merge) { Get-MessageProblems -Message $merge -What 'Merge commit message' }
    }
    elseif ($ToolName -match '(?i)create_branch') {
        $branch = Get-ArgString $ToolArgs @('branchName', 'branch', 'branch_name')
        if ($branch) { Get-BranchProblems $branch }
    }
}

try {
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    if (-not $Payload) { $Payload = [Console]::In.ReadToEnd() }
    $data = $Payload | ConvertFrom-Json

    $props = $data.PSObject.Properties
    $toolName = if ($props['toolName']) { $data.toolName } elseif ($props['tool_name']) { $data.tool_name } else { '' }
    $toolArgs = if ($props['toolArgs']) { $data.toolArgs } elseif ($props['tool_input']) { $data.tool_input } else { $null }
    if ($toolArgs -is [string]) {
        try { $toolArgs = $toolArgs | ConvertFrom-Json } catch { $toolArgs = $null }
    }
    $cwd = if ($props['cwd'] -and $data.cwd) { $data.cwd } else { (Get-Location).Path }

    $problems = @(Test-ToolCall -ToolName $toolName -ToolArgs $toolArgs -Cwd $cwd)
    if ($problems.Count -gt 0) {
        $reason = "Git conventions: " + ($problems -join ' ') + " Fix it and try again."
        @{ permissionDecision = 'deny'; permissionDecisionReason = $reason } | ConvertTo-Json -Compress
    }
}
catch {
    # Never block a tool call because the hook itself failed.
}
exit 0
