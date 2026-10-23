# The daily watch on Yandex Music (Task Scheduler "Oni - Yandex Music watch"; registered by
# scripts/ym-watch-install.ps1). Runs scripts/ym-watch.mjs and says what it found by a Windows
# notification: a new official app that changed what it asks of the API (exit 4), or the API tests
# failing on the account (exit 5). The report is %LOCALAPPDATA%/oni-watch/report.md; a Claude
# session takes it from there ("look at the watch's report").
# node runs through cmd with plain redirection: Windows PowerShell 5.1 would re-encode its output.
$repo = Split-Path $PSScriptRoot -Parent
$data = Join-Path $env:LOCALAPPDATA 'oni-watch'
New-Item -ItemType Directory -Force $data | Out-Null
$log = Join-Path $data ('watch-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')
$report = Join-Path $data 'report.md'
$notify = Join-Path $HOME '.claude\notify.ps1'
function Say($title, $text) { & powershell -NoProfile -ExecutionPolicy Bypass -File $notify -Title $title -Text $text }
function Log($line) { [IO.File]::AppendAllText($log, (Get-Date -Format 's') + " $line`r`n") }

Log 'watch started'
Push-Location $repo
& cmd /c "node scripts\ym-watch.mjs >> `"$log`" 2>&1"
$code = $LASTEXITCODE
Pop-Location
Log "watch exit $code"

# The report's own first lines say it best: the version and what changed.
$version = ''
$changed = ''
if (Test-Path $report) {
  $text = [IO.File]::ReadAllText($report)
  if ($text -match '\*\*([\d.]+)\*\*') { $version = $Matches[1] }
  if ($text -match 'изменились разделы: ([^\r\n]+)') { $changed = $Matches[1] }
}
switch ($code) {
  0 { }
  3 { Log "Yandex Music ${version}: nothing Oni looks at changed" }
  4 { Say "Яндекс Музыка ${version}: есть изменения" "Изменилось: $changed. Отчёт: $report — попроси Claude разобрать" }
  5 { Say 'Oni может сломаться' "Тесты API на аккаунте падают. Отчёт: $report — попроси Claude разобрать" }
  default { Say 'Oni: сторож не смог проверить' "Журнал: $log" }
}
