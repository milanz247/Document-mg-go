$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $repositoryRoot 'frontend'
$backendRoot = Join-Path $repositoryRoot 'backend'
$releaseRoot = Join-Path $repositoryRoot 'release'
$outputFile = Join-Path $releaseRoot 'atlas-wiki.exe'

Write-Host 'Building the Vue application for embedding...'
Push-Location $frontendRoot
try {
    npm ci
    npm run build
}
finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

Write-Host 'Building the standalone Atlas Wiki executable...'
Push-Location $backendRoot
try {
    go build -trimpath -ldflags '-s -w' -o $outputFile ./cmd/server
}
finally {
    Pop-Location
}

Write-Host "Created $outputFile"
