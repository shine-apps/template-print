# Offline drill for guardian.ps1: compiles fake old/new exes with csc, runs the real guardian
# against a sandbox "install dir" with success/failure fake installers, asserts results.
# Usage: powershell -ExecutionPolicy Bypass -File ./scripts/dev-drill-guardian.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
$sandbox = Join-Path $env:TEMP ('tp-guardian-drill-' + [Guid]::NewGuid().ToString('N'))
$appDir = Join-Path $sandbox 'app'
$updDir = Join-Path $sandbox 'updates'
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $updDir 'downloads') | Out-Null

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'csc.exe not found' }

function New-FakeExe($path, $ver) {
  $src = [System.IO.Path]::ChangeExtension($path, '.cs')
  $code = @"
using System.Reflection;
[assembly: AssemblyVersion("$ver")]
[assembly: AssemblyFileVersion("$ver")]
[assembly: AssemblyInformationalVersion("$ver")]
class P { static void Main() { } }
"@
  [System.IO.File]::WriteAllText($src, $code, [System.Text.Encoding]::ASCII)
  & $csc /nologo /target:exe /out:$path $src | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'csc failed' }
}

Write-Host '== compile fake exes (0.1.0.0 old, 0.2.0.0 new) =='
$exePath = Join-Path $appDir 'TemplatePrint.exe'
New-FakeExe $exePath '0.1.0.0'
$newExe = Join-Path $sandbox 'new.exe'
New-FakeExe $newExe '0.2.0.0'

# Success fake installer: overwrite app exe with the new one.
$setupOk = Join-Path $sandbox 'setup-ok.cmd'
@"
@echo off
copy /y "$newExe" "$exePath" >nul
exit /b 0
"@ | Out-File -FilePath $setupOk -Encoding ASCII
# Failure fake installer.
$setupFail = Join-Path $sandbox 'setup-fail.cmd'
"@`r`n@echo off`r`nexit /b 1`r`n" | Out-File -FilePath $setupFail -Encoding ASCII

# Emit guardian.ps1 from the TS generator via esbuild.
$bundle = Join-Path $sandbox 'g.mjs'
$runner = Join-Path $sandbox 'run-gen.mjs'
$guardian = Join-Path $updDir 'guardian.ps1'
Push-Location $root
try {
  npx esbuild 'electron/main/update/guardian-script.ts' --bundle --platform=node --format=esm --outfile=$bundle | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'esbuild failed' }
  $runnerCode = "import { buildGuardianScript } from " +
    "'file:///" + ($bundle -replace '\\', '/') + "'; " +
    "import { writeFileSync } from 'node:fs'; " +
    "writeFileSync(process.argv[2], buildGuardianScript(), 'ascii')"
  [System.IO.File]::WriteAllText($runner, $runnerCode, [System.Text.Encoding]::ASCII)
  node $runner $guardian
  if ($LASTEXITCODE -ne 0) { throw 'guardian emit failed' }
} finally { Pop-Location }

$paramsFile = Join-Path $updDir 'guardian-params.json'
$stateFile = Join-Path $updDir 'install-state.json'
$logFile = Join-Path $updDir 'guardian.log'

function Invoke-Drill($setupPath, $tag) {
  Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
  Remove-Item $logFile -Force -ErrorAction SilentlyContinue
  $params = [ordered]@{
    setupPath   = $setupPath
    exePath     = $exePath
    statePath   = $stateFile
    backupDir   = Join-Path $updDir 'backup-0.1.0'
    logPath     = $logFile
    fromVersion = '0.1.0'
    toVersion   = '0.2.0'
  }
  [System.IO.File]::WriteAllText($paramsFile, ($params | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ('== drill ' + $tag + ' ==')
  # Fail-Guardian intentionally exits 1 on rollback; assert via state file, not exit code
  & powershell.exe -ExecutionPolicy Bypass -File $guardian
  $code = $LASTEXITCODE
  Write-Host ('guardian exit code ' + $code)
  Start-Sleep -Milliseconds 300
  $st = Get-Content $stateFile -Raw | ConvertFrom-Json
  $ver = (Get-Item $exePath).VersionInfo.ProductVersion
  Write-Host ('state=' + $st.phase + ' reason=' + $st.reason + ' exeVersion=' + $ver)
  return [pscustomobject]@{ State = $st.phase; Reason = $st.reason; Version = $ver }
}

$r1 = Invoke-Drill $setupOk 'success'
if ($r1.State -ne 'done' -or $r1.Version -notlike '0.2.0*') {
  Get-Content $logFile -ErrorAction SilentlyContinue
  throw 'success drill FAILED'
}

# Restore old exe, then the failing installer must trigger rollback to the old files.
New-FakeExe $exePath '0.1.0.0'
Remove-Item (Join-Path $updDir 'backup-0.1.0') -Recurse -Force -ErrorAction SilentlyContinue
$r2 = Invoke-Drill $setupFail 'failure-rollback'
if ($r2.State -ne 'failed' -or $r2.Reason -ne 'installer-failed' -or $r2.Version -notlike '0.1.0*') {
  Get-Content $logFile -ErrorAction SilentlyContinue
  throw 'failure drill FAILED'
}
if (-not (Test-Path (Join-Path $updDir 'backup-0.1.0\TemplatePrint.exe'))) { throw 'backup missing' }

Write-Host 'GUARDIAN DRILL PASSED (success install + failure rollback)'
Write-Host ('sandbox left for inspection: ' + $sandbox)
