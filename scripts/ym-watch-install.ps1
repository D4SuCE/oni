# Registers the daily watch on Yandex Music in the Task Scheduler (run once; again to change the time).
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ym-watch-install.ps1 [-At 12:00]
# It runs as this user, only while signed in (Claude's sign-in and the notifications need that),
# and catches up at the next sign-in when the computer was off at the time.
param([string]$At = '12:00')
$script = Join-Path $PSScriptRoot 'ym-watch.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Oni - Yandex Music watch' -Action $action -Trigger $trigger -Settings $settings -Description 'Oni: daily check of the official Yandex Music app and the API (scripts/ym-watch.ps1)' -Force | Out-Null
Get-ScheduledTask -TaskName 'Oni - Yandex Music watch' | Select-Object TaskName, State
