[CmdletBinding()]
param(
    [string]$EnvFile = ".env.docker"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\")).Path
Push-Location $repoRoot
try {
    $compose = @("compose", "--env-file", $EnvFile)
    $appIdOutput = & docker @compose ps -q app
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose could not be queried."
    }
    $appId = ([string]$appIdOutput).Trim()
    if (-not $appId) {
        throw "The app service is not running."
    }

    $inspect = (& docker inspect $appId | ConvertFrom-Json)[0]
    if ($inspect.State.Status -ne "running") {
        throw "The app container status is $($inspect.State.Status)."
    }
    if ($inspect.State.Health.Status -ne "healthy") {
        throw "The app container health is $($inspect.State.Health.Status)."
    }

    $hostIp = "127.0.0.1"
    $hostIpLine = Get-Content $EnvFile | Where-Object { $_ -match '^WHYLOWDPS_HOST_IP=' } | Select-Object -First 1
    if ($hostIpLine) {
        $configuredIp = ($hostIpLine -split "=", 2)[1].Trim()
        if ($configuredIp -and $configuredIp -notin @("0.0.0.0", "::")) {
            $hostIp = $configuredIp
        }
    }
    $hostPort = 8000
    $hostPortLine = Get-Content $EnvFile | Where-Object { $_ -match '^WHYLOWDPS_PORT=' } | Select-Object -First 1
    if ($hostPortLine) {
        $hostPort = [int](($hostPortLine -split "=", 2)[1].Trim())
    }
    $baseUrl = "http://${hostIp}:${hostPort}"

    $health = Invoke-RestMethod -Uri "$baseUrl/health" -TimeoutSec 15
    if ($health.status -ne "ok") {
        throw "The health endpoint returned status '$($health.status)'."
    }
    $data = Invoke-RestMethod -Uri "$baseUrl/api/data/status" -TimeoutSec 15
    if ($data.status -ne "ready") {
        throw "Data sync status is '$($data.status)'."
    }

    $runtime = & docker exec $appId sh -lc 'test -x /data/simc-runtime/simc && /data/simc-runtime/simc --version 2>&1 | tail -1'
    if ($LASTEXITCODE -ne 0) {
        throw "The persisted SimC runtime is unavailable."
    }
    $disk = (& docker exec $appId sh -lc 'df -P /data | tail -1').Trim()
    $recentErrors = @(& docker logs --since 15m $appId 2>&1 | Select-String -Pattern 'error|panic|fatal' -CaseSensitive:$false)

    Write-Output "Hosted app: healthy"
    Write-Output "Address: $baseUrl"
    Write-Output "Data: ready"
    Write-Output "SimC: $($runtime -join ' ')"
    Write-Output "Data volume: $disk"
    Write-Output "Recent error-level log lines: $($recentErrors.Count)"
}
finally {
    Pop-Location
}
