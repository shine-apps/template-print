# Local release pipeline: build installers, generate latest.json, upload to Tencent COS.
# Run this on a machine inside mainland China (the GitHub CI runner -> COS cross-border
# upload is unreliable for large files; a local upload avoids that link entirely).
#
# Credentials are loaded from a .env file (default: <repo>/.env, git-ignored):
#
#   COS_SECRET_ID=AKID...
#   COS_SECRET_KEY=...
#   COS_BUCKET=template-print-1250000000
#   COS_REGION=ap-shanghai
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File ./scripts/publish-to-cos.ps1
#   powershell -ExecutionPolicy Bypass -File ./scripts/publish-to-cos.ps1 -SkipBuild
#   powershell -ExecutionPolicy Bypass -File ./scripts/publish-to-cos.ps1 -IncludeExe
#   powershell -ExecutionPolicy Bypass -File ./scripts/publish-to-cos.ps1 -DryRun
param(
  [string]$EnvFile = '',
  # Never build; fail if the MSI for the current package.json version is missing.
  # Without this flag the build is skipped automatically whenever that MSI already exists.
  [switch]$SkipBuild,
  # Also upload the NSIS .exe (auto-update only needs the .msi + latest.json).
  [switch]$IncludeExe,
  # Resolve targets and print them, but do not sign or upload anything.
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
Set-Location $root
$scriptsDir = Join-Path $root 'scripts'

if (-not $EnvFile) { $EnvFile = Join-Path $root '.env' }

function Read-DotEnv {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    throw ("env file not found: $Path`nCreate it with COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION lines (see scripts/publish-to-cos.ps1 header).")
  }
  $loaded = 0
  foreach ($raw in Get-Content -Path $Path) {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    if ($line.StartsWith('export ')) { $line = $line.Substring(7).Trim() }
    $eq = $line.IndexOf('=')
    if ($eq -le 0) { continue }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    if (($val.StartsWith('"') -and $val.EndsWith('"')) -or
        ($val.StartsWith("'") -and $val.EndsWith("'"))) {
      $val = $val.Substring(1, $val.Length - 2)
    }
    Set-Item -Path ("env:" + $key) -Value $val
    $loaded++
  }
  Write-Host ("Loaded " + $loaded + " setting(s) from " + $Path)
}

function Invoke-NativeChecked {
  param([string]$FilePath, [string[]]$Arguments, [string]$Label)
  Write-Host ("== " + $Label + " ==")
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw ($Label + " failed (exit " + $LASTEXITCODE + ")") }
}

Read-DotEnv -Path $EnvFile

foreach ($k in 'COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_REGION') {
  if (-not [Environment]::GetEnvironmentVariable($k)) { throw ("missing required variable in env file: " + $k) }
}
$bucket = $env:COS_BUCKET
$region = $env:COS_REGION
$assetBaseUrl = 'https://' + $bucket + '.cos.' + $region + '.myqcloud.com/'

# 1) The manifest version comes from package.json. If the MSI for that exact version
# already exists in release\, reuse it and skip the build entirely; otherwise build both
# targets (NSIS .exe + MSI) locally, same as the GitHub release workflow.
$releaseDir = Join-Path $root 'release'
$pkgVersion = [string]((Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version)
$msiNamePattern = '*-' + $pkgVersion + '-Setup-x64.msi'
$msi = Get-ChildItem -Path $releaseDir -Filter $msiNamePattern -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($msi) {
  Write-Host ('MSI for v' + $pkgVersion + ' already built, skip build: ' + $msi.Name)
} elseif ($SkipBuild) {
  throw ('-SkipBuild set but no MSI for package.json version ' + $pkgVersion + ' found under ' + $releaseDir + ' (expected *-' + $pkgVersion + '-Setup-x64.msi). Run a full build first.')
} else {
  Write-Host ('MSI for v' + $pkgVersion + ' not found, building installers...')
  $env:ELECTRON_MIRROR = 'https://cdn.npmmirror.com/binaries/electron/'
  Invoke-NativeChecked -FilePath 'npx.cmd' -Arguments @('install-electron') -Label 'Ensure Electron binary is installed'
  Invoke-NativeChecked -FilePath 'npx.cmd' -Arguments @('electron-vite', 'build') -Label 'electron-vite build'
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://cdn.npmmirror.com/binaries/electron-builder-binaries/'
  Invoke-NativeChecked -FilePath 'npx.cmd' -Arguments @('electron-builder', '--win', '--publish', 'never') -Label 'electron-builder (nsis + msi)'
  $msi = Get-ChildItem -Path $releaseDir -Filter $msiNamePattern -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $msi) { throw ('build finished but expected MSI is missing: *-' + $pkgVersion + '-Setup-x64.msi under ' + $releaseDir) }
}
Write-Host ('Using installer: ' + $msi.Name + ' (v' + $pkgVersion + ')')

# 3) Generate latest.json with size/sha256, URL pointing at the COS direct link.
Invoke-NativeChecked -FilePath 'powershell.exe' -Arguments @(
  '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $scriptsDir 'build-update-manifest.ps1'),
  '-SetupPath', $msi.FullName,
  '-AssetBaseUrl', $assetBaseUrl
) -Label 'Generate latest.json'

# 4) Verify the signing implementation, then upload. Order matters for release safety:
# the installer(s) MUST be fully in place before latest.json is published, otherwise a
# client could fetch a manifest pointing at an installer that does not exist yet.
$uploadScript = Join-Path $scriptsDir 'upload-to-cos.ps1'
$installerPaths = @($msi.FullName)
if ($IncludeExe) {
  $exe = Get-ChildItem -Path $releaseDir -Filter ('*-' + $pkgVersion + '-Setup-x64.exe') |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($exe) { $installerPaths += $exe.FullName } else { Write-Host ('WARNING: -IncludeExe set but no v' + $pkgVersion + ' .exe found in release\') }
}
$manifestPath = Join-Path $releaseDir 'latest.json'

if ($DryRun) {
  Write-Host '== Dry run: resolving upload targets only =='
  & $uploadScript -Path ($installerPaths + $manifestPath) -DryRun
  if ($LASTEXITCODE -ne 0) { throw 'upload script dry run failed' }
  Write-Host 'DRY RUN OK - nothing was uploaded.'
  exit 0
}

& $uploadScript -SelfTest
if ($LASTEXITCODE -ne 0) { throw 'upload script self test failed' }

# Step A: installers first; abort on any failure so the manifest is never updated.
& $uploadScript -Path $installerPaths
if ($LASTEXITCODE -ne 0) { throw 'installer upload to COS failed; latest.json was NOT updated' }

# Step B: only now publish the manifest pointing at the verified-available installer.
& $uploadScript -Path $manifestPath
if ($LASTEXITCODE -ne 0) { throw 'installers uploaded but latest.json update failed' }

Write-Host ''
Write-Host 'PUBLISH COMPLETE'
Write-Host ('Manifest: ' + $assetBaseUrl + 'latest.json')
Write-Host ('Installer: ' + $assetBaseUrl + $msi.Name)
Write-Host 'Verify hotlink rules (anonymous 403, with Referer 200):'
Write-Host ('  curl.exe -I "' + $assetBaseUrl + 'latest.json"')
Write-Host ('  curl.exe -I -H "Referer: https://dl.templateprint.app/" "' + $assetBaseUrl + 'latest.json"')
