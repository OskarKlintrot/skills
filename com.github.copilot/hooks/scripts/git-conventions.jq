# Shell text is parsed as data, not evaluated.
def finish_token:
  if .active then .tokens += [.token] | .token = "" | .active = false else . end;
def finish_segment:
  finish_token | if (.tokens | length) > 0 then .segments += [.tokens] | .tokens = [] else . end;
def append($s): .token += $s | .active = true;
def consume_heredocs($command; $n):
  reduce .heredocs[] as $h (.;
    .found = false |
    until(.i >= $n or .found;
      .i as $start |
      ($command[$start:] | index("\n") // ($n - $start)) as $length |
      ($command[$start:$start+$length] | sub("\r$"; "") |
        if $h.stripTabs then sub("^\t*"; "") else . end) as $line |
      .i = $start + $length + 1 | .found = ($line == $h.delimiter)
    )
  ) | .heredocs = [] | del(.found);
def tokenize($command; $ps):
  ($command | length) as $n |
  (if $ps then "`" else "\\" end) as $escape |
  {i: 0, token: "", active: false, tokens: [], segments: [], heredocs: []} |
  until(.i >= $n;
    .i as $i | $command[$i:$i+1] as $c |
    if ($ps | not) and $command[$i:$i+2] == "<<" and
       ($i == 0 or $command[$i-1:$i] != "<") and $command[$i+2:$i+3] != "<" then
      "^<<(?<tabs>-?)[ \\t]*(?:'(?<single>[^']*)'|\"(?<double>[^\"]*)\"|(?<bare>[A-Za-z_][A-Za-z0-9_]*))(?=$|[\\s;|&<>)])" as $pattern |
      if $command[$i:] | test($pattern) then
        ($command[$i:] | match($pattern)) as $m |
        ($command[$i:] | capture($pattern)) as $header |
        .heredocs += [{delimiter: ($header.single // $header.double // $header.bare), stripTabs: ($header.tabs == "-")}] |
        .i += $m.length
      else .i = $n | .segments = [] | .tokens = [] | .token = "" | .active = false end
    elif $ps and (.active | not) and $c == "@" and
       ($command[$i+1:$i+2] == "\"" or $command[$i+1:$i+2] == "'") and
       ($command[$i:] | test("^@[\"'][^\n]*\n.*?\r?\n[\"']@"; "m")) then
      $command[$i+1:$i+2] as $q |
      ($command[$i:] | match("^@" + $q + "[^\n]*\n(.*?)\r?\n" + $q + "@"; "m")) as $m |
      append($m.captures[0].string) | .i += $m.length
    elif $c == "'" then
      ($command[$i+1:] | index("'") // ($n - $i - 1)) as $end |
      append($command[$i+1:$i+1+$end]) | .i = $i + $end + 2
    elif $c == "\"" then
      .active = true | .i += 1 |
      until(.i >= $n or $command[.i:.i+1] == "\"";
        .i as $j | $command[$j:$j+1] as $d |
        if $d == $escape and $j+1 < $n then
          $command[$j+1:$j+2] as $next |
          append(if $ps then
            if $next == "n" then "\n" elif $next == "r" then ""
            elif $next == "t" then "\t" else $next end
          elif (["\"", "\\", "$", "`"] | index($next)) != null then $next
          else $d + $next end) | .i += 2
        else append($d) | .i += 1 end
      ) | .i += 1
    elif $c == $escape and $i+1 < $n then
      $command[$i+1:$i+2] as $next |
      (if $next == "\n" or $next == "\r" then . else append($next) end) | .i += 2
    elif ([" ", "\t", "\r"] | index($c)) != null then finish_token | .i += 1
    elif (["\n", ";", "&", "|", "(", ")"] | index($c)) != null then
      finish_segment | .i += 1 |
      if $c == "\n" and (.heredocs | length) > 0 then consume_heredocs($command; $n) else . end
    else append($c) | .i += 1 end
  ) | finish_segment | .segments[];

def option($args; $long; $short):
  [range(0; $args | length) as $i | $args[$i] as $t |
    if (($long + $short) | index($t)) != null and $i+1 < ($args | length) then
      {value: $args[$i+1]}
    else $long[] as $o | select($t | startswith($o + "=")) |
      {value: $t[($o | length)+1:]}
    end][0];
def literal:
  . as $v |
  if test("^\\s*\\$\\(\\s*cat\\s+<<-?\\s*['\"]?(\\w+)['\"]?\\s*\\r?\\n(.*?)\\r?\\n\\s*\\1\\s*\\r?\\n?\\s*\\)\\s*$"; "m") then
    capture("^\\s*\\$\\(\\s*cat\\s+<<-?\\s*['\"]?(?<marker>\\w+)['\"]?\\s*\\r?\\n(?<body>.*?)\\r?\\n\\s*\\k<marker>\\s*\\r?\\n?\\s*\\)\\s*$"; "m") | .body
  elif startswith("$") then null else $v end;
def message($value; $what):
  ($value | literal) as $v | select($v != null) | {kind: "message", value: $v, what: $what};
def branch($value): {kind: "branch", value: $value};
def rooted: test("^(/|[A-Za-z]:[/\\\\]|\\\\)");
def join_path($cwd; $path):
  if $path | rooted then $path elif $cwd == null then null else $cwd + "/" + $path end;
def basename: gsub("\\\\"; "/") | split("/")[-1] | sub("\\.exe$"; ""; "i") | ascii_downcase;

def git_checks($args; $cwd):
  {i: 0, cwd: $cwd} |
  until(.i >= ($args | length) or ($args[.i] | startswith("-") | not);
    .i as $i |
    if $args[$i] == "-C" and $i+1 < ($args | length) then
      .cwd = join_path(.cwd; $args[$i+1]) | .i += 2
    elif (["-c", "--git-dir", "--work-tree", "--namespace"] | index($args[$i])) != null and
         $i+1 < ($args | length) then .i += 2
    else .i += 1 end
  ) |
  .cwd as $dir | $args[.i] as $sub | $args[.i+1:] as $rest |
  if $sub == "commit" then
    if any($rest[]; test("^--(fixup|squash)(=|$)|^--(reuse|reedit)-message") or . == "-C" or . == "-c") then empty
    else
      [range(0; $rest | length) as $j | $rest[$j] as $t |
        if ($t | test("^-[a-zA-Z]*m$|^--message$")) and $j+1 < ($rest | length) then
          {kind: "message", value: $rest[$j+1]}
        elif $t | startswith("--message=") then {kind: "message", value: $t[10:]}
        elif $t | test("^-m.+$") then {kind: "message", value: $t[2:]}
        elif ($t | test("^-[a-zA-Z]*F$|^--file$")) and $j+1 < ($rest | length) then
          {kind: "file", value: $rest[$j+1]}
        elif $t | startswith("--file=") then {kind: "file", value: $t[7:]}
        elif $t | test("^-F.+$") then {kind: "file", value: $t[2:]}
        else empty end][0] |
      select(. != null) |
      if .kind == "file" then
        select(.value != "-" and (.value | startswith("$") | not)) |
        .value = join_path($dir; .value) | select(.value != null) | .what = "Commit message"
      else message(.value; "Commit message") end
    end
  elif $sub == "checkout" then option($rest; ["--orphan"]; ["-b", "-B"]) | select(. != null) | branch(.value)
  elif $sub == "switch" then option($rest; ["--create", "--force-create", "--orphan"]; ["-c", "-C"]) | select(. != null) | branch(.value)
  elif $sub == "worktree" and $rest[0] == "add" then option($rest; []; ["-b", "-B"]) | select(. != null) | branch(.value)
  elif $sub == "branch" then
    ["-d", "-D", "--delete", "-l", "--list", "-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose",
     "--show-current", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--sort", "--format",
     "--edit-description", "-u", "--set-upstream-to", "--unset-upstream"] as $list |
    [$rest[] | select(startswith("-")) | split("=")[0]] as $flags |
    [$rest[] | select(startswith("-") | not)] as $names |
    if any($flags[]; . as $f | $list | index($f)) or ($names | length) == 0 then empty
    elif any($flags[]; . as $f | ["-m", "-M", "--move", "-c", "-C", "--copy"] | index($f)) then branch($names[-1])
    else branch($names[0]) end
  else empty end;

def segment_checks($tokens; $cwd):
  $tokens |
  .[0] as $exe | .[1:] as $args | select($exe != null) |
  ($exe | basename) as $name |
  if $name == "git" then git_checks($args; $cwd)
  elif $name == "gh" and $args[0] == "pr" then
    (if (["create", "new", "edit"] | index($args[1])) != null then
      option($args[2:]; ["--title"]; ["-t"])
    elif $args[1] == "merge" then option($args[2:]; ["--subject"]; ["-t"])
    else null end) |
    select(. != null) | message(.value; if $args[1] == "merge" then "Merge commit subject" else "Pull request title" end)
  elif $name == "az" and $args[0:2] == ["repos", "pr"] and
       (["create", "update"] | index($args[2])) != null then
    (option($args[3:]; ["--title"]; []) | select(. != null) | message(.value; "Pull request title")),
    (option($args[3:]; ["--merge-commit-message"]; []) | select(. != null) | message(.value; "Merge commit message"))
  else empty end;

def shell_checks($command; $ps; $cwd):
  foreach tokenize($command; $ps) as $segment
    ({cwd: $cwd, checks: []};
      ($segment | map(select(test("^[A-Za-z_][A-Za-z0-9_]*=") | not))) as $tokens |
      ($tokens[0] // "" | basename) as $name |
      if (["cd", "chdir", "set-location", "sl", "pushd", "popd", "push-location", "pop-location"] | index($name)) != null then
        .cwd = null | .checks = []
      else .checks = [segment_checks($tokens; .cwd)] end;
      .checks[]);

def arg_string($args; $names):
  [$names[] as $n | $args[$n] | select(type == "string" and test("\\S"))][0];
def checks($default_cwd):
  (.toolName // .tool_name // "") as $name |
  (.toolArgs // .tool_input // null |
    if type == "string" then try fromjson catch null else . end) as $args |
  (.cwd // $default_cwd | if . == "" then $default_cwd else . end) as $cwd |
  select(($args | type) == "object" and ($name | type) == "string") |
  (if $name | test("^(bash|powershell|pwsh|shell)$"; "i") then
    arg_string($args; ["command"]) | select(. != null) |
    shell_checks(.; $name | test("^(powershell|pwsh)$"; "i"); $cwd)
  else empty end),
  (if $name | test("pull_request"; "i") then
    (arg_string($args; ["title"]) | select(. != null) | {kind: "message", value: ., what: "Pull request title"}),
    (arg_string($args; ["commit_title", "commitTitle", "mergeCommitMessage", "merge_commit_message"]) |
      select(. != null) | {kind: "message", value: ., what: "Merge commit message"})
  elif $name | test("create_branch"; "i") then
    arg_string($args; ["branchName", "branch", "branch_name"]) | select(. != null) | branch(.)
  else empty end);

# Match PowerShell's .NET string length, including surrogate pairs.
def subject_length: explode | map(if . > 65535 then 2 else 1 end) | add // 0;
def problems:
  if .kind == "branch" then
    (.value | sub("^refs/heads/"; "")) as $name |
    select($name | test("^(feature|release)/[a-z0-9]+([._-][a-z0-9]+)*(/[a-z0-9]+([._-][a-z0-9]+)*)*$") | not) |
    "Branch name '\($name)' must be 'feature/<short-descriptive-info>' in lowercase English kebab-case (for example 'feature/add-payment-card-name'), or 'release/*' when explicitly asked."
  elif .kind == "message" then
    .value as $value | .what as $what |
    ($value | split("\n")[0] | gsub("^\\s+|\\s+$"; "")) as $subject |
    select($subject | test("^(fixup|squash|amend)! "; "i") | not) |
    (if $subject | test("^(feat|fix|perf|docs|style|refactor|test|build)(\\([a-z0-9][a-z0-9._/-]*\\))?: \\p{Lu}") then empty
     else "\($what) '\($subject)' must match '<type>: <Subject>' or '<type>(<scope>): <Subject>' where <type> is one of feat, fix, perf, docs, style, refactor, test, build, <type>/<scope> are lowercase, and the subject starts with an uppercase letter in imperative form (for example 'feat: Add name to payment card')." end),
    (if ($subject | subject_length) > 72 then
      "\($what) first line is \($subject | subject_length) characters; keep it at most 72. Say it simply and concisely, like one human talking to another."
     else empty end),
    (if $value | test("[åäöÅÄÖæøÆØ]") then "\($what) must be written in English." else empty end)
  else empty end;

if $mode == "checks" then checks($ARGS.named.cwd // ".")
elif $mode == "validate" then
  [ .[] | problems ] |
  if length > 0 then
    {permissionDecision: "deny", permissionDecisionReason: ("Git conventions: " + join(" ") + " Fix it and try again.")}
  else empty end
else error("Unknown git conventions mode") end
