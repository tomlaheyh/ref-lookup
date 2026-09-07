<#
  verify.ps1 -- pre-commit integrity check.

  STANDARD ACROSS ALL REPOS. Copy this and verify.cmd to any repo root unchanged
  and they work: nothing here names a folder that only one repo has.

  Exists because of 12 Jul 2026: a bad mount truncated five committed pages and
  padded a .js with 502 NUL bytes, and it all shipped. A truncated HTML page
  STILL RENDERS in a browser -- browsers close tags for you -- so "it looked
  fine" is not evidence. The closing tag is.

  Assumes local-only working files live in Exclude-DIR\, which is skipped along
  with .git\ and node_modules\. A repo without an Exclude-DIR is the repo to fix,
  not this script.

  Run from the repo root. Exit code 0 = safe to commit, 1 = do not push.
#>

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$skip = '\\(node_modules|Exclude-DIR|\.git)\\'
$fail = @()
$ok   = 0

function Fail($msg) { $script:fail += $msg; Write-Host "  FAIL  $msg" -ForegroundColor Red }
function Pass($msg) { $script:ok++;         Write-Host "  ok    $msg" -ForegroundColor DarkGray }
function Head($msg) { Write-Host ""; Write-Host $msg -ForegroundColor Cyan }

# ---------------------------------------------------------------- 1. truncation
Head "1. Closing </html> tag  (truncation check)"
$pages = Get-ChildItem -Path . -Filter *.html -File -Recurse |
         Where-Object { $_.FullName -notmatch $skip } |
         Where-Object { $_.Name -notmatch '^google[0-9a-f]+\.html$' }   # Search Console verification files are a single line, not HTML

if (-not $pages) { Fail "no .html files found -- wrong directory?" }
foreach ($p in $pages) {
    $rel = Resolve-Path -Relative $p.FullName
    if ($p.Length -eq 0) { Fail "$rel is EMPTY (0 bytes)"; continue }
    $txt = Get-Content -LiteralPath $p.FullName -Raw
    if ($txt -match '(?is)</html>\s*$') { Pass $rel }
    else { Fail "$rel -- no closing </html>. TRUNCATED." }
}

# ---------------------------------------------------------------- 2. NUL bytes
# [Array]::IndexOf is a compiled scan. A PowerShell per-byte loop is not: it is
# millions of interpreted iterations per file and will appear to hang.
Head "2. NUL bytes  (silent corruption check)"
$targets = Get-ChildItem -Path . -File -Recurse -Include *.html,*.js,*.css,*.csv,*.json,*.md |
           Where-Object { $_.FullName -notmatch $skip }

$nulBad = 0
foreach ($f in $targets) {
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $at    = [Array]::IndexOf($bytes, [byte]0)
    if ($at -ge 0) {
        $rel = Resolve-Path -Relative $f.FullName
        $nulBad++
        Fail "$rel -- NUL byte at offset $at. CORRUPT."
    }
}
if ($nulBad -eq 0) { Pass "$($targets.Count) file(s) scanned, no NUL bytes" }

# ---------------------------------------------------------------- 3. JS syntax
Head "3. JavaScript syntax  (node --check)"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Fail "node not on PATH -- cannot syntax-check the scripts"
} else {
    $scripts = Get-ChildItem -Path . -Filter *.js -File -Recurse |
               Where-Object { $_.FullName -notmatch $skip }
    foreach ($s in $scripts) {
        $rel = Resolve-Path -Relative $s.FullName
        & node --check $s.FullName 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Pass $rel }
        else {
            Fail "$rel -- syntax error"
            & node --check $s.FullName 2>&1 | ForEach-Object { Write-Host "        $_" -ForegroundColor DarkRed }
        }
    }
}

# ---------------------------------------------------------------- 4. inline JS
# Pages that keep their logic inline are missed by node --check on *.js alone.
#
# Only blocks that are actually JavaScript are checked. A <script> with no type,
# or type text/javascript, application/javascript or module, is JS. Anything else
# -- application/ld+json structured data, importmap, text/template -- is not, and
# feeding it to node produces a syntax error that means nothing. That false
# positive is real: schema.org JSON-LD in an index page trips it every time.
Head "4. Inline <script> syntax  (pages that keep their JS in the HTML)"
if ($node) {
    $jsTypes = @('text/javascript', 'application/javascript', 'module')
    $tmp = Join-Path $env:TEMP "repo-inline-check"
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    foreach ($p in $pages) {
        $rel  = Resolve-Path -Relative $p.FullName
        $txt  = Get-Content -LiteralPath $p.FullName -Raw
        $ms   = [regex]::Matches($txt, '(?is)<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>')
        $i    = 0
        $skipped = 0
        $bad  = $false
        foreach ($m in $ms) {
            $attrs = $m.Groups[1].Value
            $body  = $m.Groups[2].Value
            if ($body.Trim().Length -eq 0) { continue }
            if ($attrs -match '(?i)\btype\s*=\s*["'']?([^"''\s>]+)') {
                if ($jsTypes -notcontains $Matches[1].ToLower()) { $skipped++; continue }
            }
            $i++
            $f = Join-Path $tmp ("{0}_{1}.js" -f $p.BaseName, $i)
            [System.IO.File]::WriteAllText($f, $body, [System.Text.UTF8Encoding]::new($false))
            & node --check $f 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                $bad = $true
                Fail "$rel -- inline <script> #$i has a syntax error"
                & node --check $f 2>&1 | ForEach-Object { Write-Host "        $_" -ForegroundColor DarkRed }
            }
        }
        if (-not $bad -and ($i -gt 0 -or $skipped -gt 0)) {
            $note = "$i inline script(s)"
            if ($skipped -gt 0) { $note += ", $skipped non-JS block(s) skipped" }
            Pass "$rel ($note)"
        }
    }
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- 5. data files
# Every published CSV, wherever it lives -- not a named folder, because repos put
# them in different places and some have none at all. A header-only CSV means a
# pipeline half-ran and shipped an empty answer.
Head "5. CSV files  (present and non-trivial)"
$csvs = Get-ChildItem -Path . -Filter *.csv -File -Recurse |
        Where-Object { $_.FullName -notmatch $skip }
if (-not $csvs) {
    Pass "no CSVs outside Exclude-DIR -- nothing to check"
} else {
    # only need to know a data row EXISTS -- don't read 800KB to find that out
    $csvBad = 0
    foreach ($c in $csvs) {
        $n = 0
        foreach ($line in [System.IO.File]::ReadLines($c.FullName)) {
            if ($line.Trim().Length -gt 0) { $n++ }
            if ($n -ge 2) { break }
        }
        if ($n -lt 2) {
            $rel = Resolve-Path -Relative $c.FullName
            $csvBad++
            Fail "$rel -- header only. Pipeline output is missing."
        }
    }
    if ($csvBad -eq 0) { Pass "$($csvs.Count) CSV(s) checked, all have rows" }
}

# ---------------------------------------------------------------- verdict
Write-Host ""
if ($fail.Count -eq 0) {
    Write-Host "PASS -- $ok check(s) clean. Safe to commit." -ForegroundColor Green
    exit 0
} else {
    Write-Host "FAILED -- $($fail.Count) problem(s). DO NOT PUSH." -ForegroundColor Red
    $fail | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}
