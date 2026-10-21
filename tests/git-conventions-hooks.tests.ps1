#Requires -Version 7
# Dependency-free tests for the git conventions hooks. Run: pwsh -NoProfile -File tests/git-conventions-hooks.tests.ps1
$ErrorActionPreference = 'Stop'
$scripts = Join-Path $PSScriptRoot '..' 'com.github.copilot' 'hooks' 'scripts'
$enforce = Join-Path $scripts 'enforce-git-conventions.ps1'
$inject = Join-Path $scripts 'inject-git-conventions.ps1'
$failures = 0
$count = 0

function Invoke-Hook {
    param([string]$Script, [string]$Json)
    $Json | pwsh -NoProfile -NonInteractive -File $Script
}

function Test-Case {
    param([string]$Name, [string]$ToolName, $ToolArgs, [bool]$ExpectDeny, [string]$Cwd = $PSScriptRoot, [switch]$VsCodeFormat)
    $script:count++
    $payload = if ($VsCodeFormat) {
        @{ hook_event_name = 'PreToolUse'; session_id = 's'; timestamp = '2026-01-01T00:00:00Z'; cwd = $Cwd; tool_name = $ToolName; tool_input = $ToolArgs }
    }
    else {
        @{ sessionId = 's'; timestamp = 0; cwd = $Cwd; toolName = $ToolName; toolArgs = ($ToolArgs | ConvertTo-Json -Compress -Depth 5) }
    }
    $out = (Invoke-Hook $enforce ($payload | ConvertTo-Json -Compress -Depth 5)) -join "`n"
    $denied = $false
    if ($out.Trim()) {
        $denied = ($out | ConvertFrom-Json).permissionDecision -eq 'deny'
    }
    if ($denied -ne $ExpectDeny) {
        $script:failures++
        Write-Host "FAIL: $Name (expected $(if ($ExpectDeny) { 'deny' } else { 'allow' })) output: $out" -ForegroundColor Red
    }
    else {
        Write-Host "ok:   $Name"
    }
}

function Sh([string]$Command) { @{ command = $Command; description = 'test' } }

# Commit messages (bash)
Test-Case 'bash valid commit' 'bash' (Sh 'git commit -m "feat: Add name to payment card"') $false
Test-Case 'bash valid commit with scope' 'bash' (Sh 'git add . && git commit -m "fix(api): Handle missing card"') $false
Test-Case 'bash invalid type' 'bash' (Sh 'git commit -m "feature: Add card"') $true
Test-Case 'bash lowercase subject' 'bash' (Sh 'git commit -m "feat: add card"') $true
Test-Case 'bash no type' 'bash' (Sh "git commit -m 'Add card'") $true
Test-Case 'bash uppercase type' 'bash' (Sh 'git commit -m "Feat: Add card"') $true
Test-Case 'bash swedish' 'bash' (Sh 'git commit -m "feat: Lägg till kort"') $true
Test-Case 'bash too long' 'bash' (Sh ('git commit -m "feat: ' + ('A' * 70) + '"')) $true
Test-Case 'bash -am' 'bash' (Sh 'git commit -am "docs: Explain setup"') $false
Test-Case 'bash -am invalid' 'bash' (Sh 'git commit -am "updated docs"') $true
Test-Case 'bash --message=' 'bash' (Sh 'git commit --message="test: Add tests"') $false
Test-Case 'bash --message= invalid' 'bash' (Sh 'git commit --message="wip"') $true
Test-Case 'bash git -C' 'bash' (Sh 'git -C /tmp/repo commit -m "wip"') $true
Test-Case 'bash heredoc valid' 'bash' (Sh "git commit -m `"`$(cat <<'EOF'`nbuild: Update pipeline`n`nLonger body.`nEOF`n)`"") $false
Test-Case 'bash heredoc invalid' 'bash' (Sh "git commit -m `"`$(cat <<'EOF'`nUpdate pipeline`nEOF`n)`"") $true
Test-Case 'bash multiple -m first checked' 'bash' (Sh 'git commit -m "refactor: Rename variable" -m "Body text"') $false
Test-Case 'bash amend no-edit' 'bash' (Sh 'git commit --amend --no-edit') $false
Test-Case 'bash fixup' 'bash' (Sh 'git commit --fixup HEAD~1') $false
Test-Case 'bash variable message' 'bash' (Sh 'git commit -m "$MSG"') $false
Test-Case 'bash chained invalid' 'bash' (Sh 'git status; git commit -m "oops" && git push') $true
Test-Case 'bash not git' 'bash' (Sh 'echo "git commit -m oops"') $false
Test-Case 'bash git log' 'bash' (Sh 'git --no-pager log --oneline -5') $false

# Commit messages (PowerShell)
Test-Case 'pwsh valid commit' 'powershell' (Sh 'git commit -m "perf: Use HashSet"') $false
Test-Case 'pwsh invalid commit' 'powershell' (Sh "git commit -m 'Fixed stuff'") $true
Test-Case 'pwsh backtick newline' 'powershell' (Sh 'git commit -m "style: Format code`n`nCo-authored-by: X <x@y>"') $false
Test-Case 'pwsh here-string valid' 'powershell' (Sh "git commit -m @`"`nfeat: Add thing`n`nBody`n`"@") $false
Test-Case 'pwsh here-string invalid' 'powershell' (Sh "git commit -m @'`nadd thing`n'@") $true
Test-Case 'pwsh git.exe' 'powershell' (Sh '& "C:\Program Files\Git\cmd\git.exe" commit -m "nope"') $true

# Commit message from file
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "gc-hook-tests-$PID"
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    Set-Content -LiteralPath (Join-Path $tmp 'good.txt') -Value "# comment`nfeat: Add file support`n`nBody" -Encoding utf8
    Set-Content -LiteralPath (Join-Path $tmp 'bad.txt') -Value "added file support" -Encoding utf8
    Test-Case 'commit -F valid' 'powershell' (Sh 'git commit -F good.txt') $false -Cwd $tmp
    Test-Case 'commit -F invalid' 'powershell' (Sh 'git commit -F bad.txt') $true -Cwd $tmp
    Test-Case 'commit -F missing' 'powershell' (Sh 'git commit -F missing.txt') $false -Cwd $tmp
}
finally {
    Remove-Item -Recurse -Force $tmp
}

# Branches
Test-Case 'checkout -b valid' 'bash' (Sh 'git checkout -b feature/add-payment-card') $false
Test-Case 'checkout -b invalid' 'bash' (Sh 'git checkout -b add-payment-card') $true
Test-Case 'checkout -b uppercase' 'bash' (Sh 'git checkout -b feature/AddCard') $true
Test-Case 'checkout -b swedish' 'bash' (Sh 'git checkout -b feature/lägg-till') $true
Test-Case 'checkout existing' 'bash' (Sh 'git checkout master') $false
Test-Case 'switch -c valid' 'powershell' (Sh 'git switch -c feature/fix-null-check') $false
Test-Case 'switch -c invalid' 'powershell' (Sh 'git switch -c bugfix/null') $true
Test-Case 'switch --create=' 'powershell' (Sh 'git switch --create=my-branch') $true
Test-Case 'branch create valid' 'bash' (Sh 'git branch feature/new-thing origin/master') $false
Test-Case 'branch create invalid' 'bash' (Sh 'git branch new-thing') $true
Test-Case 'branch delete' 'bash' (Sh 'git branch -D whatever') $false
Test-Case 'branch list' 'bash' (Sh 'git branch --list "feat*"') $false
Test-Case 'branch show-current' 'bash' (Sh 'git branch --show-current') $false
Test-Case 'branch rename invalid' 'bash' (Sh 'git branch -m old-name new_name') $true
Test-Case 'branch rename valid' 'bash' (Sh 'git branch -m feature/better-name') $false
Test-Case 'worktree add -b invalid' 'bash' (Sh 'git worktree add -b temp ../wt') $true
Test-Case 'release branch' 'bash' (Sh 'git checkout -b release/1.2.0') $false

# gh (GitHub and GitHub Enterprise) and az (Azure DevOps)
Test-Case 'gh pr create valid' 'bash' (Sh 'gh pr create --title "feat: Add card" --body "Adds it."') $false
Test-Case 'gh pr create invalid' 'bash' (Sh 'gh pr create --title "Add card" --body "x"') $true
Test-Case 'gh pr create -t invalid' 'powershell' (Sh 'gh pr create -t "add card"') $true
Test-Case 'gh pr create GHE' 'bash' (Sh 'GH_HOST=github.example.com gh pr create --title="WIP"') $true
Test-Case 'gh pr edit invalid' 'bash' (Sh 'gh pr edit 12 --title "Update"') $true
Test-Case 'gh pr merge subject invalid' 'bash' (Sh 'gh pr merge 12 --squash --subject "Merge it"') $true
Test-Case 'gh pr merge subject valid' 'bash' (Sh 'gh pr merge 12 --squash --subject "fix: Correct price"') $false
Test-Case 'gh pr view' 'bash' (Sh 'gh pr view 12') $false
Test-Case 'az pr create invalid' 'powershell' (Sh 'az repos pr create --title "Add card" --source-branch feature/x') $true
Test-Case 'az pr create valid' 'powershell' (Sh 'az repos pr create --title "feat: Add card" --source-branch feature/x') $false
Test-Case 'az pr update merge msg invalid' 'powershell' (Sh 'az repos pr update --id 1 --merge-commit-message "merged"') $true

# MCP / app tools
Test-Case 'ADO PR create invalid' 'azure-devops-repo_pull_request_write' @{ action = 'create'; title = 'Add card'; repositoryId = 'r' } $true
Test-Case 'ADO PR create valid' 'azure-devops-repo_pull_request_write' @{ action = 'create'; title = 'feat: Add card'; repositoryId = 'r' } $false
Test-Case 'ADO PR vote' 'azure-devops-repo_pull_request_write' @{ action = 'vote'; vote = 'Approved' } $false
Test-Case 'ADO merge commit invalid' 'azure-devops-repo_pull_request_write' @{ action = 'update'; mergeCommitMessage = 'squashed' } $true
Test-Case 'ADO branch invalid' 'azure-devops-repo_create_branch' @{ repositoryId = 'r'; branchName = 'my-branch' } $true
Test-Case 'ADO branch valid' 'azure-devops-repo_create_branch' @{ repositoryId = 'r'; branchName = 'feature/my-branch' } $false
Test-Case 'GitHub MCP PR create invalid' 'github-mcp-server-create_pull_request' @{ owner = 'o'; repo = 'r'; title = 'Update stuff' } $true
Test-Case 'GitHub MCP PR update valid' 'github-mcp-server-update_pull_request' @{ title = 'docs: Explain setup' } $false
Test-Case 'GitHub MCP merge invalid' 'github-mcp-server-merge_pull_request' @{ commit_title = 'Merge PR'; merge_method = 'squash' } $true
Test-Case 'GitHub MCP branch invalid' 'github-mcp-server-create_branch' @{ branch = 'Fix_Thing' } $true
Test-Case 'App create_pull_request invalid' 'create_pull_request' @{ title = 'Lägg till kort' } $true
Test-Case 'App update_pull_request valid' 'update_pull_request' @{ title = 'test: Cover edge case' } $false
Test-Case 'VS Code format deny' 'Bash' (Sh 'git commit -m "oops"') $true -VsCodeFormat
Test-Case 'unrelated tool' 'view' @{ path = 'x' } $false

# Robustness: garbage input must not deny
$script:count++
$out = (Invoke-Hook $enforce 'not json') -join ''
if ($out.Trim()) { $failures++; Write-Host "FAIL: garbage input produced output: $out" -ForegroundColor Red } else { Write-Host 'ok:   garbage input' }

# Inject hook
$script:count++
$ctx = ((Invoke-Hook $inject '{"sessionId":"s","timestamp":0,"cwd":".","source":"new"}') -join "`n") | ConvertFrom-Json
if ($ctx.additionalContext -notmatch 'Git conventions' -or $ctx.additionalContext -notmatch 'feature/') {
    $failures++; Write-Host 'FAIL: inject hook did not return conventions' -ForegroundColor Red
}
else { Write-Host 'ok:   inject hook' }

Write-Host "`n$($count - $failures)/$count passed"
exit [int]($failures -gt 0)
