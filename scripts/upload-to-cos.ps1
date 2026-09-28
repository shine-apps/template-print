# Upload files to Tencent COS (XML API, v5 HMAC-SHA1 signature).
# Pure PowerShell 5.1+, usable locally and on CI runners.
# Every file is uploaded with a single PUT object request (COS simple upload
# supports up to 5GB per object; intended for use from a domestic network).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File ./scripts/upload-to-cos.ps1 `
#     -Path 'release/latest.json','release/*Setup*x64.msi' `
#     -KeyPrefix releases/
# Secrets/ids may be passed as parameters or via env vars:
#   COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
#
# -SelfTest checks the signing implementation against the official documentation
# vectors (no credentials, no network); -DryRun prints the target URLs only.

param(
  [string[]]$Path = @(),
  [string]$Bucket = $env:COS_BUCKET,
  [string]$Region = $env:COS_REGION,
  [string]$SecretId = $env:COS_SECRET_ID,
  [string]$SecretKey = $env:COS_SECRET_KEY,
  [string]$KeyPrefix = '',
  [string]$Acl = 'public-read',
  [int]$ExpiresSeconds = 3600,
  [int]$MaxRetries = 3,
  # Timeout for each HTTP request, not for the whole file.
  [int]$RequestTimeoutMs = 900000,  # 15 minutes
  [switch]$SelfTest,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function ConvertTo-CosUriEncode([string]$Value) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($b in [System.Text.Encoding]::UTF8.GetBytes($Value)) {
    if (($b -ge 0x41 -and $b -le 0x5A) -or ($b -ge 0x61 -and $b -le 0x7A) -or
        ($b -ge 0x30 -and $b -le 0x39) -or $b -eq 0x2D -or $b -eq 0x5F -or
        $b -eq 0x2E -or $b -eq 0x7E) {
      [void]$sb.Append([char]$b)
    } else {
      [void]$sb.Append('%' + $b.ToString('X2'))
    }
  }
  return $sb.ToString()
}

function Get-Sha1Hex([string]$Data) {
  $sha = [System.Security.Cryptography.SHA1]::Create()
  try { $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Data)) }
  finally { $sha.Dispose() }
  return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-HmacSha1Hex([string]$Key, [string]$Data) {
  $hmac = [System.Security.Cryptography.HMACSHA1]::Create()
  try {
    $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($Key)
    $hash = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Data))
  } finally { $hmac.Dispose() }
  return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

# COS v5 Authorization. UrlParams and Headers contain the values actually sent.
function New-CosAuthorization {
  param(
    [string]$Method,
    [string]$UriPathname,
    [System.Collections.IDictionary]$Headers,
    [System.Collections.IDictionary]$UrlParams = ([ordered]@{}),
    [string]$SignTime,
    [string]$SecretId,
    [string]$SecretKey
  )
  $sortedHeaders = @($Headers.Keys | Sort-Object)
  $headerList = ($sortedHeaders -join ';')
  $headerString = (($sortedHeaders | ForEach-Object {
    (ConvertTo-CosUriEncode $_) + '=' + (ConvertTo-CosUriEncode ([string]$Headers[$_]))
  }) -join '&')
  $sortedParams = @($UrlParams.Keys | Sort-Object)
  $urlParamList = ($sortedParams -join ';')
  $urlParamString = (($sortedParams | ForEach-Object {
    (ConvertTo-CosUriEncode $_) + '=' + (ConvertTo-CosUriEncode ([string]$UrlParams[$_]))
  }) -join '&')
  $httpString = $Method.ToLower() + "`n" + $UriPathname + "`n" + $urlParamString + "`n" + $headerString + "`n"
  $stringToSign = 'sha1' + "`n" + $SignTime + "`n" + (Get-Sha1Hex $httpString) + "`n"
  $signKey = Get-HmacSha1Hex $SecretKey $SignTime
  $signature = Get-HmacSha1Hex $signKey $stringToSign
  return 'q-sign-algorithm=sha1&q-ak=' + $SecretId +
    '&q-sign-time=' + $SignTime + '&q-key-time=' + $SignTime +
    '&q-header-list=' + $headerList + '&q-url-param-list=' + $urlParamList + '&q-signature=' + $signature
}

if ($SelfTest) {
  $docSecretKey = 'BQYIM75p8x0iWVFSIgqEKwFprpRSVHlz'
  $signTime = '1557989151;1557996351'
  $signKey = Get-HmacSha1Hex $docSecretKey $signTime
  $expectSignKey = 'eb2519b498b02ac213cb1f3d1a3d27a3b3c9bc5f'
  if ($signKey -ne $expectSignKey) { throw ('SelfTest failed: signKey ' + $signKey + ' != ' + $expectSignKey) }
  $auth = New-CosAuthorization -Method 'put' -UriPathname '/TemplatePrint-0.2.2-Setup-x64.msi' `
    -Headers ([ordered]@{ host = 'examplebucket-1250000000.cos.ap-beijing.myqcloud.com'; 'x-cos-acl' = 'public-read' }) `
    -SignTime $signTime -SecretId 'AKIDEXAMPLE' -SecretKey $docSecretKey
  $expectAuth = 'q-sign-algorithm=sha1&q-ak=AKIDEXAMPLE&q-sign-time=1557989151;1557996351' +
    '&q-key-time=1557989151;1557996351&q-header-list=host;x-cos-acl&q-url-param-list=' +
    '&q-signature=74cb1be4904cf16881dae2c777c40d2617472c47'
  if ($auth -ne $expectAuth) { throw ('SelfTest failed: authorization mismatch' + "`n" + $auth + "`n" + $expectAuth) }
  $raw = 'a b/c?d=e&f+g~-_.!''()*$,:;<=>@[\]^`{|}#"'
  $expectEncoded = 'a%20b%2Fc%3Fd%3De%26f%2Bg~-_.%21%27%28%29%2A%24%2C%3A%3B%3C%3D%3E%40%5B%5C%5D%5E%60%7B%7C%7D%23%22'
  $encoded = ConvertTo-CosUriEncode $raw
  if ($encoded -ne $expectEncoded) { throw ('SelfTest failed: urlencode ' + $encoded + ' != ' + $expectEncoded) }
  Write-Host 'SelfTest ok: signing matches the documented COS vectors'
  exit 0
}

# 4xx responses (bad request/auth/permission) never improve on retry, so fail fast
# instead of re-sending a large file several times.
function Test-PermanentHttpError {
  param($ErrorRecord)
  $resp = $null
  if ($ErrorRecord.Exception -is [System.Net.WebException]) { $resp = $ErrorRecord.Exception.Response }
  if ($null -ne $resp) {
    $code = [int]$resp.StatusCode
    if ($code -ge 400 -and $code -lt 500) {
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      try { $detail = $reader.ReadToEnd() } finally { $reader.Dispose() }
      if ($detail) { Write-Host ("  COS error response: " + $detail) }
      return $true
    }
  }
  return $false
}

function Invoke-WithRetry {
  param([scriptblock]$ScriptBlock, [int]$MaxAttempts = $MaxRetries, [string]$OperationName = 'Operation')
  $attempt = 0
  while ($attempt -lt $MaxAttempts) {
    $attempt++
    try {
      Write-Host "  [Attempt $attempt/$MaxAttempts] $OperationName..."
      & $ScriptBlock
      return
    } catch {
      $errorMsg = $_.Exception.Message
      if (Test-PermanentHttpError $_) { throw }
      $isTransient = $errorMsg -match '(timeout|canceled|aborted|connection|reset|disconnected|temporarily unavailable)' -or $_.Exception -is [System.Net.WebException]
      if ($isTransient -and $attempt -lt $MaxAttempts) {
        Write-Host "  [Attempt $attempt] Transient error: $errorMsg"
        Start-Sleep -Seconds ([Math]::Min(30, 5 * $attempt))
      } else { throw }
    }
  }
}

function Upload-FileDirect {
  param([string]$FilePath, [string]$EncodedPath, [string]$Uri, [string]$HostName, [string]$SecretId, [string]$SecretKey)
  $fi = Get-Item $FilePath
  $total = [long]$fi.Length
  $now = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $signTime = $now.ToString() + ';' + ($now + $ExpiresSeconds).ToString()
  $signedHeaders = [ordered]@{ host = $HostName }
  if ($Acl) { $signedHeaders['x-cos-acl'] = $Acl }
  $auth = New-CosAuthorization -Method 'put' -UriPathname $EncodedPath -Headers $signedHeaders -SignTime $signTime -SecretId $SecretId -SecretKey $SecretKey
  $req = [System.Net.HttpWebRequest]::Create($Uri)
  $req.Method = 'PUT'; $req.Timeout = $RequestTimeoutMs; $req.ReadWriteTimeout = $RequestTimeoutMs
  $req.ServicePoint.Expect100Continue = $false; $req.AllowWriteStreamBuffering = $false; $req.ContentLength = $total
  $req.Headers.Add('Authorization', $auth)
  if ($Acl) { $req.Headers.Add('x-cos-acl', $Acl) }
  $activity = 'Uploading ' + $fi.Name
  $showProgress = $total -ge 1MB
  $fs = [System.IO.File]::OpenRead($fi.FullName)
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $stream = $req.GetRequestStream()
    try {
      if ($showProgress) {
        # Manual copy loop with a progress bar (stream writes go straight to the network
        # because AllowWriteStreamBuffering is false, so sent bytes track real progress).
        $buffer = New-Object byte[] 262144  # 256 KB
        [long]$sent = 0; $lastPct = -1
        while (($read = $fs.Read($buffer, 0, $buffer.Length)) -gt 0) {
          $stream.Write($buffer, 0, $read)
          $sent += $read
          $pct = [int][Math]::Floor($sent * 100 / $total)
          if ($pct -ne $lastPct) {
            $lastPct = $pct
            $secs = $stopwatch.Elapsed.TotalSeconds
            $speed = if ($secs -gt 0.05) { $sent / $secs / 1MB } else { 0 }
            Write-Progress -Activity $activity -PercentComplete $pct -Status `
              ($pct.ToString() + '%  ' + [Math]::Round($sent / 1MB, 1) + '/' + [Math]::Round($total / 1MB, 1) + ' MB  ' + [Math]::Round($speed, 2) + ' MB/s')
          }
        }
      } else {
        $fs.CopyTo($stream, 65536)
      }
    } finally { $stream.Dispose() }
    $response = $req.GetResponse()
    try {
      $status = [int]$response.StatusCode
    } finally { $response.Close() }
  } finally {
    if ($showProgress) { Write-Progress -Activity $activity -Completed }
    $stopwatch.Stop(); $fs.Dispose()
  }
  if ($showProgress) {
    $avg = if ($stopwatch.Elapsed.TotalSeconds -gt 0) { $total / $stopwatch.Elapsed.TotalSeconds / 1MB } else { 0 }
    Write-Host ('  Sent ' + [Math]::Round($total / 1MB, 2) + ' MB in ' + [Math]::Round($stopwatch.Elapsed.TotalSeconds, 1) + 's (' + [Math]::Round($avg, 2) + ' MB/s)')
  }
  return @{ Status = $status; Uri = $Uri }
}

if (-not $Bucket) { throw 'Bucket is required (or set COS_BUCKET)' }
if (-not $Region) { throw 'Region is required (or set COS_REGION)' }
if ($Path.Count -eq 0) { throw 'Path is required' }
$files = @()
foreach ($p in $Path) { $items = @(Get-ChildItem -Path $p -File -ErrorAction SilentlyContinue); if ($items.Count -eq 0) { throw ('no file matches: ' + $p) }; $files += $items }
$hostName = $Bucket + '.cos.' + $Region + '.myqcloud.com'
$prefixSegments = @(); if ($KeyPrefix) { $prefixSegments = @($KeyPrefix.Trim('/') -split '/' | Where-Object { $_ }) }
if ($DryRun) {
  foreach ($fi in $files) { $segments = $prefixSegments + @($fi.Name); $ep = '/' + (($segments | ForEach-Object { ConvertTo-CosUriEncode $_ }) -join '/'); Write-Host ('would upload ' + $fi.Length + ' bytes -> https://' + $hostName + $ep) }
  exit 0
}
if (-not $SecretId) { throw 'SecretId is required (or set COS_SECRET_ID)' }
if (-not $SecretKey) { throw 'SecretKey is required (or set COS_SECRET_KEY)' }
$successCount = 0
foreach ($fi in $files) {
  $segments = $prefixSegments + @($fi.Name); $encodedPath = '/' + (($segments | ForEach-Object { ConvertTo-CosUriEncode $_ }) -join '/'); $uri = 'https://' + $hostName + $encodedPath
  Write-Host ''; Write-Host ("Uploading: " + $fi.Name + " (" + ($fi.Length / 1MB).ToString('F2') + " MB)")
  try {
    Invoke-WithRetry -OperationName "PUT $($fi.Name)" { [void](Upload-FileDirect -FilePath $fi.FullName -EncodedPath $encodedPath -Uri $uri -HostName $hostName -SecretId $SecretId -SecretKey $SecretKey) }
    $successCount++; Write-Host ('Success: ' + $fi.Name)
  } catch { Write-Host ('Failed after ' + $MaxRetries + ' attempts: ' + $_.Exception.Message); throw }
}
Write-Host ''; Write-Host ('Upload complete: ' + $successCount + '/' + $files.Count + ' files succeeded'); Write-Host ('Destination: https://' + $hostName + '/')
