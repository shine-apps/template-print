# Build NSIS installer (Electron 44 + better-sqlite3 13 N-API, no ABI switching needed).
# Usage: powershell -ExecutionPolicy Bypass -File ./scripts/dist.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
Set-Location $root

$env:ELECTRON_MIRROR = 'https://cdn.npmmirror.com/binaries/electron/'
Write-Host '== Ensure Electron binary is installed =='
npx install-electron
if ($LASTEXITCODE -ne 0) { throw 'install-electron failed' }

Write-Host '== electron-vite build =='
npx electron-vite build
if ($LASTEXITCODE -ne 0) { throw 'electron-vite build failed' }

$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://cdn.npmmirror.com/binaries/electron-builder-binaries/'
Write-Host '== electron-builder (nsis) =='
npx electron-builder --win nsis
if ($LASTEXITCODE -ne 0) { throw 'electron-builder failed' }
Write-Host 'DONE'
