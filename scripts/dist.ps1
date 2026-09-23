# Build NSIS installer with the Electron-ABI native binary.
# Usage: powershell -ExecutionPolicy Bypass -File ./scripts/dist.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
Set-Location $root

Write-Host '== Switch better-sqlite3 to Electron ABI =='
powershell -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\switch-sqlite.ps1') electron

Write-Host '== electron-vite build =='
npx electron-vite build
if ($LASTEXITCODE -ne 0) { throw 'electron-vite build failed' }

$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://cdn.npmmirror.com/binaries/electron-builder-binaries/'
$env:ELECTRON_MIRROR = 'https://cdn.npmmirror.com/binaries/electron/'
Write-Host '== electron-builder (nsis) =='
npx electron-builder --win nsis
if ($LASTEXITCODE -ne 0) { throw 'electron-builder failed' }

Write-Host '== Restore Node ABI for tests =='
powershell -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\switch-sqlite.ps1') node
Write-Host 'DONE'
