[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Destination,
    [string]$EnvFile = ".env.docker"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\")).Path
$destinationPath = (New-Item -ItemType Directory -Force -Path $Destination).FullName
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

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $archiveName = "whylowdps-data-$stamp.tgz"
    $mount = "type=bind,source=$destinationPath,target=/backup"
    & docker @compose stop app
    if ($LASTEXITCODE -ne 0) {
        throw "Could not stop the app cleanly."
    }
    try {
        & docker run --rm --volumes-from $appId --mount $mount busybox:1.36 tar -czf "/backup/$archiveName" -C /data .
        if ($LASTEXITCODE -ne 0) {
            throw "The Docker volume archive failed."
        }
        $archivePath = Join-Path $destinationPath $archiveName
        $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath
        Write-Output "Created: $archivePath"
        Write-Output "SHA256: $($hash.Hash)"
    }
    finally {
        & docker @compose start app | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Error "The app could not be restarted after backup."
        }
    }
}
finally {
    Pop-Location
}
