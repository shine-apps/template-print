# Upload files to Tencent COS (XML API, v5 HMAC-SHA1 signature).
# Pure PowerShell, no external tools: usable locally and on GitHub Actions runners.
# ASCII only (PowerShell 5.1 misparses BOM-less UTF-8 .ps1 files).
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
  # Object key prefix, e.g. 'releases/' (kept as given, leading slash optional)
  [string]$KeyPrefix = '',
  # Object ACL; empty string keeps the bucket default
  [string]$Acl = 'public-read',
  [int]$ExpiresSeconds = 3600,
  [switch]$SelfTest,
  # Resolve the files and print the target URLs without uploading (no credentials needed)
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------- signing helpers ----------

# RFC3986 percent-encoding: only A-Z a-z 0-9 - _ . ~ stay literal
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
  $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Data))
  $sha.Dispose()
  return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-HmacSha1Hex([string]$Key, [string]$Data) {
  $hmac = [System.Security.Cryptography.HMACSHA1]::Create()
  $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($Key)
  $hash = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Data))
  $hmac.Dispose()
  return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

# COS v5 Authorization header value.
# Headers is an ordered hashtable of lowercase header name -> value; only these
# headers are signed, so they must be sent verbatim with the request.
function New-CosAuthorization {
  param(
    [string]$Method,
    [string]$UriPathname,
    [System.Collections.IDictionary]$Headers,
    [string]$SignTime,
    [string]$SecretId,
    [string]$SecretKey
  )
  $sorted = $Headers.Keys | Sort-Object
  $headerList = ($sorted -join ';')
  $headerString = (($sorted | ForEach-Object {
    (ConvertTo-CosUriEncode $_) + '=' + (ConvertTo-CosUriEncode ([string]$Headers[$_]))
  }) -join '&')
  # HttpString = Method \n UriPathname \n UrlParamList \n HeaderString \n
  $httpString = $Method.ToLower() + "`n" + $UriPathname + "`n" + '' + "`n" + $headerString + "`n"
  $stringToSign = 'sha1' + "`n" + $SignTime + "`n" + (Get-Sha1Hex $httpString) + "`n"
  $signKey = Get-HmacSha1Hex $SecretKey $SignTime
  $signature = Get-HmacSha1Hex $signKey $stringToSign
  return 'q-sign-algorithm=sha1&q-ak=' + $SecretId +
    '&q-sign-time=' + $SignTime + '&q-key-time=' + $SignTime +
    '&q-header-list=' + $headerList + '&q-url-param-list=&q-signature=' + $signature
}

if ($SelfTest) {
  # Vector 1 (from the official docs): SignKey = HMAC-SHA1(SecretKey, KeyTime).
  # The doc's example key pair is a sample credential, not a real account.
  $docSecretKey = 'BQYIM75p8x0iWVFSIgqEKwFprpRSVHlz'
  $signTime = '1557989151;1557996351'
  $signKey = Get-HmacSha1Hex $docSecretKey $signTime
  $expectSignKey = 'eb2519b498b02ac213cb1f3d1a3d27a3b3c9bc5f'
  if ($signKey -ne $expectSignKey) {
    throw ('SelfTest failed: signKey ' + $signKey + ' != ' + $expectSignKey)
  }

  # Vector 2: a production-shaped PUT (host + x-cos-acl signed), cross-checked
  # against an independent implementation of the documented algorithm.
  $auth = New-CosAuthorization -Method 'put' -UriPathname '/TemplatePrint-0.2.2-Setup-x64.msi' `
    -Headers ([ordered]@{ host = 'examplebucket-1250000000.cos.ap-beijing.myqcloud.com'; 'x-cos-acl' = 'public-read' }) `
    -SignTime $signTime -SecretId 'AKIDEXAMPLE' -SecretKey $docSecretKey
  $expectAuth = 'q-sign-algorithm=sha1&q-ak=AKIDEXAMPLE&q-sign-time=1557989151;1557996351' +
    '&q-key-time=1557989151;1557996351&q-header-list=host;x-cos-acl&q-url-param-list=' +
    '&q-signature=74cb1be4904cf16881dae2c777c40d2617472c47'
  if ($auth -ne $expectAuth) {
    throw ('SelfTest failed: authorization mismatch' + "`n" + $auth + "`n" + $expectAuth)
  }

  # Vector 3: the doc's UrlEncode table, character by character.
  $raw = 'a b/c?d=e&f+g~-_.!''()*$,:;<=>@[\]^`{|}#"'
  $expectEncoded = 'a%20b%2Fc%3Fd%3De%26f%2Bg~-_.%21%27%28%29%2A%24%2C%3A%3B%3C%3D%3E%40%5B%5C%5D%5E%60%7B%7C%7D%23%22'
  $encoded = ConvertTo-CosUriEncode $raw
  if ($encoded -ne $expectEncoded) {
    throw ('SelfTest failed: urlencode ' + $encoded + ' != ' + $expectEncoded)
  }

  Write-Host 'SelfTest ok: signing matches the documented COS vectors'
  exit 0
}

# ---------- upload ----------

if (-not $Bucket) { throw 'Bucket is required (or set COS_BUCKET)' }
if (-not $Region) { throw 'Region is required (or set COS_REGION)' }
if ($Path.Count -eq 0) { throw 'Path is required' }

$files = @()
foreach ($p in $Path) {
  $items = @(Get-ChildItem -Path $p -File -ErrorAction SilentlyContinue)
  if ($items.Count -eq 0) { throw ('no file matches: ' + $p) }
  $files += $items
}

$host_ = $Bucket + '.cos.' + $Region + '.myqcloud.com'
$prefixSegments = @()
if ($KeyPrefix) { $prefixSegments = @($KeyPrefix.Trim('/') -split '/' | Where-Object { $_ }) }

if ($DryRun) {
  foreach ($fi in $files) {
    $segments = $prefixSegments + @($fi.Name)
    $encodedPath = '/' + (($segments | ForEach-Object { ConvertTo-CosUriEncode $_ }) -join '/')
    Write-Host ('would upload ' + $fi.Length + ' bytes -> https://' + $host_ + $encodedPath)
  }
  exit 0
}

if (-not $SecretId) { throw 'SecretId is required (or set COS_SECRET_ID)' }
if (-not $SecretKey) { throw 'SecretKey is required (or set COS_SECRET_KEY)' }

foreach ($fi in $files) {
  $segments = $prefixSegments + @($fi.Name)
  $key = $segments -join '/'
  $encodedPath = '/' + (($segments | ForEach-Object { ConvertTo-CosUriEncode $_ }) -join '/')
  $uri = 'https://' + $host_ + $encodedPath

  $now = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $signTime = $now.ToString() + ';' + ($now + $ExpiresSeconds).ToString()
  $signedHeaders = [ordered]@{ host = $host_ }
  if ($Acl) { $signedHeaders['x-cos-acl'] = $Acl }
  $authorization = New-CosAuthorization -Method 'put' -UriPathname $encodedPath `
    -Headers $signedHeaders -SignTime $signTime -SecretId $SecretId -SecretKey $SecretKey

  $req = [System.Net.HttpWebRequest]::Create($uri)
  $req.Method = 'PUT'
  $req.Timeout = 600000
  $req.ReadWriteTimeout = 600000
  $req.ServicePoint.Expect100Continue = $false
  $req.AllowWriteStreamBuffering = $false
  $req.ContentLength = $fi.Length
  $req.Headers.Add('Authorization', $authorization)
  if ($Acl) { $req.Headers.Add('x-cos-acl', $Acl) }

  Write-Host ('uploading ' + $fi.Name + ' (' + $fi.Length + ' bytes) -> ' + $key)
  $fs = [System.IO.File]::OpenRead($fi.FullName)
  try {
    $stream = $req.GetRequestStream()
    try { $fs.CopyTo($stream) } finally { $stream.Dispose() }
  } finally { $fs.Dispose() }

  try {
    $resp = $req.GetResponse()
    $status = [int]$resp.StatusCode
    $resp.Close()
    Write-Host ('ok ' + $status + ' ' + $uri)
  } catch [System.Net.WebException] {
    $body = ''
    $r = $_.Exception.Response
    if ($r) {
      $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
      $body = $sr.ReadToEnd()
      $sr.Dispose()
    }
    throw ('COS PUT failed for ' + $key + ': ' + $_.Exception.Message + ' ' + $body)
  }
}

Write-Host ('uploaded ' + $files.Count + ' file(s) to ' + $host_)
