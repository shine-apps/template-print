# Switch better-sqlite3 native binary between Node ABI and Electron ABI.
# Usage:
#   powershell -ExecutionPolicy Bypass -File ./scripts/switch-sqlite.ps1 node
#   powershell -ExecutionPolicy Bypass -File ./scripts/switch-sqlite.ps1 electron
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('node', 'electron')]
  [string]$Target
)

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.dependencies.'better-sqlite3' -replace '^[^0-9]*', ''
if (-not $version) { $version = $pkg.devDependencies.'better-sqlite3' -replace '^[^0-9]*', '' }

$releaseDir = Join-Path $root 'node_modules\better-sqlite3\build\Release'
$cacheDir = Join-Path $root '.native-bin'
$cached = Join-Path $cacheDir "$Target-better_sqlite3.node"
$dest = Join-Path $releaseDir 'better_sqlite3.node'

if ($Target -eq 'node') { $abi = '137'; $runtime = 'node' }
else { $abi = '125'; $runtime = 'electron' }

New-Item -ItemType Directory -Force -Path $cacheDir, $releaseDir | Out-Null

if (-not (Test-Path $cached)) {
  $name = "better-sqlite3-v$version-$runtime-v$abi-win32-x64.tar.gz"
  $url = "https://cdn.npmmirror.com/binaries/better-sqlite3/v$version/$name"
  $tgz = Join-Path $cacheDir $name
  Write-Host "Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $tgz
  $extract = Join-Path $cacheDir "extract-$Target-$version"
  New-Item -ItemType Directory -Force -Path $extract | Out-Null
  tar -xzf $tgz -C $extract
  $found = Get-ChildItem -Path $extract -Recurse -Filter 'better_sqlite3.node' | Select-Object -First 1
  if (-not $found) { throw 'better_sqlite3.node not found in archive' }
  Copy-Item $found.FullName $cached -Force
}

Copy-Item $cached $dest -Force
Write-Host "better-sqlite3 switched to $Target ABI $abi -> $dest"
