# Generate latest.json for a built setup file.
# Usage: powershell -ExecutionPolicy Bypass -File ./scripts/build-update-manifest.ps1 [-SetupPath <file>] [-OutDir <dir>] [-NotesFile <file>] [-AssetBaseUrl <url>]
# -AssetBaseUrl: base URL the installer is served from (e.g. a domestic mirror).
# When given, the manifest "url" becomes an absolute URL; otherwise it stays a
# file name relative to the update base URL (GitHub Release).
param(
  [string]$SetupPath = '',
  [string]$OutDir = '',
  [string]$NotesFile = '',
  [string]$AssetBaseUrl = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
if (-not $OutDir) { $OutDir = Join-Path $root 'release' }
if (-not $SetupPath) {
  $SetupPath = Get-ChildItem -Path $OutDir -Filter '*Setup*x64.msi' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $SetupPath -or -not (Test-Path $SetupPath)) { throw 'setup msi not found' }
if (-not $NotesFile) { $candidate = Join-Path $OutDir 'release-notes.txt'; if (Test-Path $candidate) { $NotesFile = $candidate } }

$pkg = Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$pkg.version
$notes = ''
if ($NotesFile -and (Test-Path $NotesFile)) { $notes = (Get-Content $NotesFile -Raw -Encoding UTF8).Trim() }

$fi = Get-Item $SetupPath
$size = $fi.Length
$hash = (Get-FileHash -Algorithm SHA256 -Path $SetupPath).Hash.ToLower()
$url = $fi.Name
if ($AssetBaseUrl) { $url = $AssetBaseUrl.TrimEnd('/') + '/' + $fi.Name }
$obj = [ordered]@{
  version      = $version
  releaseDate  = (Get-Date).ToString('yyyy-MM-dd')
  releaseNotes = $notes
  url          = $url
  size         = $size
  sha256       = $hash
}
$json = $obj | ConvertTo-Json
$out = Join-Path $OutDir 'latest.json'
# No BOM: JSON.parse rejects a leading BOM.
[System.IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ('wrote ' + $out)
Write-Host ('version=' + $version + ' size=' + $size)
Write-Host ('url=' + $url)
