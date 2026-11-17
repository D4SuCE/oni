# Run the second half of ym-watch on Windows with the user's ChatGPT sign-in.
# Install: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/oni-codex-watch.ps1 -Install
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Smoke,
    [ValidatePattern('^[a-zA-Z0-9_.-]+$')]
    [string]$VpnProfile
)

$ErrorActionPreference = 'Stop'
if ($Install -and $Smoke) { throw 'Use -Install or -Smoke separately.' }

$taskName = 'Oni - Codex watch'
$data = Join-Path $env:LOCALAPPDATA 'Oni\codex-watch'
New-Item -ItemType Directory -Path $data -Force | Out-Null

if ($Install) {
    $runner = Join-Path $data 'oni-codex-watch.ps1'
    if ($PSCommandPath -ne $runner) { Copy-Item -LiteralPath $PSCommandPath -Destination $runner -Force }
    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $runner
    $triggers = @(New-ScheduledTaskTrigger -Daily -At ([DateTime]::Today.AddHours(23)))
    if ($VpnProfile) {
        $arguments += " -VpnProfile $VpnProfile"
        $networkLog = 'Microsoft-Windows-NetworkProfile/Operational'
        $subscription = @"
<QueryList><Query Id="0" Path="$networkLog"><Select Path="$networkLog">*[System[EventID=10000] and EventData[Data[@Name='Name']='$VpnProfile']]</Select></Query></QueryList>
"@
        $eventTrigger = New-CimInstance -Namespace Root/Microsoft/Windows/TaskScheduler -ClassName MSFT_TaskEventTrigger `
            -ClientOnly -Property @{ Enabled = $true; Subscription = $subscription; Delay = 'PT30S' }
        $eventTrigger.PSObject.TypeNames.Add('Microsoft.Management.Infrastructure.CimInstance#MSFT_TaskTrigger')
        $triggers += $eventTrigger
    }
    $action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') `
        -Argument $arguments -WorkingDirectory $data
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value) `
        -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Description 'Review pending Oni Yandex Music watch reports with Codex.' `
        -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Force | Out-Null
    Write-Output "Installed $taskName. Logs: $data"
    return
}

$origin = 'https://github.com/D4SuCE/oni.git'
$log = Join-Path $data ('watch-{0:yyyy-MM-dd}.log' -f (Get-Date))
$mirror = Join-Path $data 'mirror.git'
$lastReview = Join-Path $data 'last-reviewed-report.txt'
$checkout = $null
$exitCode = 0
$env:GCM_INTERACTIVE = 'Never'
$env:GIT_TERMINAL_PROMPT = '0'

function Write-WatchLog([string]$Message) {
    Add-Content -LiteralPath $log -Encoding UTF8 -Value ('{0:HH:mm:ss} {1}' -f (Get-Date), $Message)
}

function Invoke-WatchGit {
    $result = & git.exe @args
    if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed with exit code $LASTEXITCODE." }
    $result
}

try {
    if (!$Smoke -and $VpnProfile -and !(Get-NetAdapter -Name $VpnProfile -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up')) {
        Write-WatchLog "VPN adapter $VpnProfile is down. Report check skipped."
        return
    }
    if (!(Test-Path -LiteralPath (Join-Path $mirror 'HEAD'))) {
        Invoke-WatchGit clone --quiet --bare --no-tags --single-branch --branch main $origin $mirror
    }
    Invoke-WatchGit -C $mirror fetch --quiet --no-tags origin `
        '+refs/heads/main:refs/heads/main' '+refs/heads/ym-watch:refs/heads/ym-watch'

    if (!$Smoke) {
        $pending = Invoke-WatchGit -C $mirror ls-tree refs/heads/ym-watch -- codex-pending.md
        if (!$pending) { Write-WatchLog 'No pending report.'; return }
        $reportId = Invoke-WatchGit -C $mirror rev-parse 'refs/heads/ym-watch:codex-pending.md'
        if ((Test-Path -LiteralPath $lastReview) -and (Get-Content -Raw -LiteralPath $lastReview).Trim() -eq $reportId -and
            (Get-Item -LiteralPath $lastReview).LastWriteTimeUtc -gt [DateTime]::UtcNow.AddHours(-24)) {
            Write-WatchLog 'Codex already completed a review of this report in the last 24 hours.'
            return
        }
    }

    foreach ($key in 'OPENAI_API_KEY', 'CODEX_API_KEY') { [Environment]::SetEnvironmentVariable($key, $null, 'Process') }
    $ErrorActionPreference = 'Continue'
    try {
        $auth = & codex.exe login status 2>&1 | Out-String
        $authExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = 'Stop'
    }
    if ($authExit -ne 0 -or $auth -notmatch 'Logged in using ChatGPT') { throw 'Codex needs a ChatGPT sign-in on this PC.' }
    $githubToken = & gh.exe auth token --hostname github.com
    if ($LASTEXITCODE -ne 0 -or !$githubToken) { throw 'GitHub CLI needs a github.com sign-in on this PC.' }
    $yandexToken = [Environment]::GetEnvironmentVariable('YANDEX_MUSIC_TOKEN', 'User')
    if (!$yandexToken) { $yandexToken = $env:YANDEX_MUSIC_TOKEN }
    if (!$yandexToken) { throw 'YANDEX_MUSIC_TOKEN is missing from the user environment.' }

    $checkout = Join-Path $data ("run-{0:yyyyMMdd-HHmmss}-{1}" -f (Get-Date), $PID)
    Invoke-WatchGit clone --quiet --shared $mirror $checkout
    Invoke-WatchGit -C $checkout remote set-url origin $origin
    $env:GH_TOKEN = $githubToken
    $env:YANDEX_MUSIC_TOKEN = $yandexToken
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
    # MXC runs without the Administrators group. Trust only this run's own checkout.
    $env:GIT_CONFIG_COUNT = '2'
    $env:GIT_CONFIG_KEY_0 = 'safe.directory'
    $env:GIT_CONFIG_VALUE_0 = $checkout.Replace('\', '/')
    # Git for Windows credential helpers use MSYS, which cannot start in the MXC sandbox.
    # Supply the credential in memory for this repository's HTTPS URL only.
    $gitAuth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$githubToken"))
    $env:GIT_CONFIG_KEY_1 = "http.$origin.extraHeader"
    $env:GIT_CONFIG_VALUE_1 = "Authorization: Basic $gitAuth"
    $scratch = Join-Path $checkout '.git\oni-tmp'
    New-Item -ItemType Directory -Path $scratch | Out-Null
    $env:TEMP = $scratch
    $env:TMP = $scratch
    $env:npm_config_cache = Join-Path $scratch 'npm-cache'
    $gitDir = (Join-Path $checkout '.git').Replace('\', '/')
    $permissionPaths = "permissions.oni-watch.filesystem={ ':root'='read', ':workspace_roots'={ '.'='write', '.git'='write' }, '$gitDir'='write' }"

    $prompt = 'You are Oni''s Codex watcher. Read and follow watch/AGENT.md in this checkout. Use the installed gh.exe and npm.cmd on Windows. Write the report in Russian.'
    if ($Smoke) {
        $prompt = 'Connection test only. Run gh api repos/D4SuCE/oni --jq .permissions.push and verify it returns true. Run git config --local oni.watchSmoke passed to verify local Git writes. Run git push --dry-run origin HEAD:refs/heads/chore/oni-codex-watch-probe. Check that YANDEX_MUSIC_TOKEN is set without showing its value. Do not modify anything on GitHub or Yandex. If all four checks pass, reply with exactly ONI_CODEX_WATCH_OK.'
    }

    Write-WatchLog "Starting Codex in $checkout (smoke: $Smoke)."
    $flags = @('--ignore-user-config', '--ignore-rules', '--ephemeral', '--json', '--color', 'never', '-C', $checkout,
        '-c', 'windows.sandbox=mxc', '-c', 'default_permissions=oni-watch', '-c', $permissionPaths,
        '-c', 'permissions.oni-watch.network.enabled=true')
    $smokePassed = $false
    $ErrorActionPreference = 'Continue'
    try {
        & codex.exe -a never exec @flags $prompt 2>&1 | ForEach-Object {
            $line = $_.ToString().Replace($githubToken, '***').Replace($yandexToken, '***').Replace($gitAuth, '***')
            Write-WatchLog $line
            if ($Smoke -and $line.Contains('ONI_CODEX_WATCH_OK')) {
                $event = ConvertFrom-Json -InputObject $line -ErrorAction SilentlyContinue
                if ($event.type -eq 'item.completed' -and $event.item.type -eq 'agent_message' -and
                    $event.item.text.Trim() -eq 'ONI_CODEX_WATCH_OK') { $smokePassed = $true }
            }
        }
        $codexExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = 'Stop'
    }
    if ($codexExit -ne 0) { throw "Codex exited with status $codexExit." }
    if ($Smoke -and !$smokePassed) { throw 'Codex did not confirm the connection test.' }
    if (!$Smoke) { Set-Content -LiteralPath $lastReview -Encoding ASCII -Value $reportId }
    Write-WatchLog 'Codex finished.'
    if ($Smoke) { Write-Output 'ONI_CODEX_WATCH_OK' }
} catch {
    Write-WatchLog $_.Exception.Message
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    $exitCode = 1
} finally {
    if ($checkout) { Write-WatchLog "Checkout: $checkout" }
}

exit $exitCode
