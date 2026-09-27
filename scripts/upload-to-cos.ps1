# Upload files to Tencent COS (XML API, v5 HMAC-SHA1 signature).
# Pure PowerShell 5.1+, usable locally and on GitHub Actions runners.
# Large files use COS multipart upload to avoid a single long-lived connection.
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
  # Files larger than this use multipart upload.
  [long]$MultipartThreshold = 52428800,  # 50MB
  # COS requires every part except the last to be at least 1MB.
  [long]$ChunkSize = 10485760,  # 10MB
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
      $isTransient = $errorMsg -match '(timeout|canceled|aborted|connection|reset|disconnected|temporarily unavailable)' -or $_.Exception -is [System.Net.WebException]
      if ($isTransient -and $attempt -lt $MaxAttempts) {
        Write-Host "  [Attempt $attempt] Transient error: $errorMsg"
        Start-Sleep -Seconds ([Math]::Min(30, 5 * $attempt))
      } else { throw }
    }
  }
}

function New-CosUri([string]$HostName, [string]$EncodedPath, [System.Collections.IDictionary]$UrlParams) {
  $query = (($UrlParams.Keys | Sort-Object | ForEach-Object {
    (ConvertTo-CosUriEncode $_) + '=' + (ConvertTo-CosUriEncode ([string]$UrlParams[$_]))
  }) -join '&')
  if ($query) { return 'https://' + $HostName + $EncodedPath + '?' + $query }
  return 'https://' + $HostName + $EncodedPath
}

function Get-CosResponseBody($Response) {
  $reader = New-Object System.IO.StreamReader($Response.GetResponseStream())
  try { return $reader.ReadToEnd() } finally { $reader.Dispose(); $Response.Close() }
}

function Invoke-CosXmlRequest {
  param([string]$Method, [string]$Uri, [string]$EncodedPath, [System.Collections.IDictionary]$UrlParams,
        [string]$HostName, [string]$Body, [string]$SecretId, [string]$SecretKey, [switch]$AclHeader)
  $now = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $signTime = $now.ToString() + ';' + ($now + $ExpiresSeconds).ToString()
  $signedHeaders = [ordered]@{ host = $HostName }
  if ($AclHeader -and $Acl) { $signedHeaders['x-cos-acl'] = $Acl }
  $authorization = New-CosAuthorization -Method $Method -UriPathname $EncodedPath -Headers $signedHeaders -UrlParams $UrlParams -SignTime $signTime -SecretId $SecretId -SecretKey $SecretKey
  $req = [System.Net.HttpWebRequest]::Create($Uri)
  $req.Method = $Method
  $req.Timeout = $RequestTimeoutMs
  $req.ReadWriteTimeout = $RequestTimeoutMs
  $req.ServicePoint.Expect100Continue = $false
  $req.ContentType = 'application/xml'
  $req.Headers.Add('Authorization', $authorization)
  if ($AclHeader -and $Acl) { $req.Headers.Add('x-cos-acl', $Acl) }
  if ($Body) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
  } else { $req.ContentLength = 0 }
  $response = $req.GetResponse()
  try {
    $bodyText = Get-CosResponseBody $response
    return @{ Body = $bodyText; ETag = $response.Headers['ETag']; Status = [int]$response.StatusCode }
  } catch { $response.Close(); throw }
}

function Upload-FileDirect {
  param([string]$FilePath, [string]$EncodedPath, [string]$Uri, [string]$HostName, [string]$SecretId, [string]$SecretKey)
  $fi = Get-Item $FilePath
  $now = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $signTime = $now.ToString() + ';' + ($now + $ExpiresSeconds).ToString()
  $signedHeaders = [ordered]@{ host = $HostName }
  if ($Acl) { $signedHeaders['x-cos-acl'] = $Acl }
  $auth = New-CosAuthorization -Method 'put' -UriPathname $EncodedPath -Headers $signedHeaders -SignTime $signTime -SecretId $SecretId -SecretKey $SecretKey
  $req = [System.Net.HttpWebRequest]::Create($Uri)
  $req.Method = 'PUT'; $req.Timeout = $RequestTimeoutMs; $req.ReadWriteTimeout = $RequestTimeoutMs
  $req.ServicePoint.Expect100Continue = $false; $req.AllowWriteStreamBuffering = $false; $req.ContentLength = $fi.Length
  $req.Headers.Add('Authorization', $auth)
  if ($Acl) { $req.Headers.Add('x-cos-acl', $Acl) }
  $fs = [System.IO.File]::OpenRead($fi.FullName)
  try {
    $stream = $req.GetRequestStream()
    try { $fs.CopyTo($stream, 65536) } finally { $stream.Dispose() }
  } finally { $fs.Dispose() }
  $response = $req.GetResponse()
  try { return @{ Status = [int]$response.StatusCode; Uri = $Uri } } finally { $response.Close() }
}

function Upload-Part {
  param([string]$FilePath, [long]$Offset, [long]$Length, [int]$PartNumber, [string]$UploadId,
        [string]$EncodedPath, [string]$HostName, [string]$SecretId, [string]$SecretKey)
  $params = [ordered]@{ partNumber = $PartNumber.ToString(); uploadId = $UploadId }
  $uri = New-CosUri $HostName $EncodedPath $params
  $now = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); $signTime = $now.ToString() + ';' + ($now + $ExpiresSeconds).ToString()
  $auth = New-CosAuthorization -Method 'put' -UriPathname $EncodedPath -Headers ([ordered]@{ host = $HostName }) -UrlParams $params -SignTime $signTime -SecretId $SecretId -SecretKey $SecretKey
  $req = [System.Net.HttpWebRequest]::Create($uri); $req.Method = 'PUT'; $req.Timeout = $RequestTimeoutMs; $req.ReadWriteTimeout = $RequestTimeoutMs
  $req.ServicePoint.Expect100Continue = $false; $req.AllowWriteStreamBuffering = $false; $req.ContentLength = $Length; $req.Headers.Add('Authorization', $auth)
  $fs = [System.IO.File]::OpenRead($FilePath)
  try {
    $fs.Position = $Offset; $stream = $req.GetRequestStream()
    try {
      $buffer = New-Object byte[] 1048576; $remaining = $Length
      while ($remaining -gt 0) { $wanted = [int][Math]::Min($buffer.Length, $remaining); $read = $fs.Read($buffer, 0, $wanted); if ($read -le 0) { throw 'Unexpected end of file while reading multipart data' }; $stream.Write($buffer, 0, $read); $remaining -= $read }
    } finally { $stream.Dispose() }
  } finally { $fs.Dispose() }
  $response = $req.GetResponse()
  try { return [string]$response.Headers['ETag'] } finally { $response.Close() }
}

function Upload-FileMultipart {
  param([string]$FilePath, [string]$EncodedPath, [string]$HostName, [string]$SecretId, [string]$SecretKey)
  $initParams = [ordered]@{ uploads = '' }
  $initUri = New-CosUri $HostName $EncodedPath $initParams
  $init = Invoke-CosXmlRequest -Method 'POST' -Uri $initUri -EncodedPath $EncodedPath -UrlParams $initParams -HostName $HostName -Body '' -SecretId $SecretId -SecretKey $SecretKey -AclHeader
  $uploadId = ([xml]$init.Body).InitiateMultipartUploadResult.UploadId
  if (-not $uploadId) { throw ('COS did not return an UploadId: ' + $init.Body) }
  Write-Host "  Multipart upload started: $uploadId"
  $parts = New-Object System.Collections.ArrayList
  $fi = Get-Item $FilePath
  try {
    $partNumber = 1; $offset = [long]0
    while ($offset -lt $fi.Length) {
      $length = [long][Math]::Min($ChunkSize, $fi.Length - $offset)
      $n = $partNumber; $o = $offset; $l = $length
      $etag = Invoke-WithRetry -OperationName "PUT part $n ($([Math]::Round($l / 1MB, 1)) MB)" {
        Upload-Part -FilePath $fi.FullName -Offset $o -Length $l -PartNumber $n -UploadId $uploadId -EncodedPath $EncodedPath -HostName $HostName -SecretId $SecretId -SecretKey $SecretKey
      }
      if (-not $etag) { throw "COS returned no ETag for part $n" }
      [void]$parts.Add(@{ Number = $n; ETag = $etag })
      $offset += $length; $partNumber++
    }
    $xml = New-Object System.Text.StringBuilder
    [void]$xml.Append('<CompleteMultipartUpload>')
    foreach ($part in $parts) { [void]$xml.Append('<Part><PartNumber>'); [void]$xml.Append($part.Number); [void]$xml.Append('</PartNumber><ETag>'); [void]$xml.Append([System.Security.SecurityElement]::Escape($part.ETag)); [void]$xml.Append('</ETag></Part>') }
    [void]$xml.Append('</CompleteMultipartUpload>')
    $completeParams = [ordered]@{ uploadId = $uploadId }
    $completeUri = New-CosUri $HostName $EncodedPath $completeParams
    [void](Invoke-CosXmlRequest -Method 'POST' -Uri $completeUri -EncodedPath $EncodedPath -UrlParams $completeParams -HostName $HostName -Body $xml.ToString() -SecretId $SecretId -SecretKey $SecretKey)
    Write-Host "  Multipart upload completed: $($parts.Count) parts"
  } catch {
    try {
      $abortParams = [ordered]@{ uploadId = $uploadId }; $abortUri = New-CosUri $HostName $EncodedPath $abortParams
      [void](Invoke-CosXmlRequest -Method 'DELETE' -Uri $abortUri -EncodedPath $EncodedPath -UrlParams $abortParams -HostName $HostName -Body '' -SecretId $SecretId -SecretKey $SecretKey)
      Write-Host '  Multipart upload aborted after failure'
    } catch { Write-Host ('  Warning: failed to abort multipart upload: ' + $_.Exception.Message) }
    throw
  }
}

if (-not $Bucket) { throw 'Bucket is required (or set COS_BUCKET)' }
if (-not $Region) { throw 'Region is required (or set COS_REGION)' }
if ($Path.Count -eq 0) { throw 'Path is required' }
if ($ChunkSize -lt 1048576) { throw 'ChunkSize must be at least 1MB for COS multipart upload' }
$files = @()
foreach ($p in $Path) { $items = @(Get-ChildItem -Path $p -File -ErrorAction SilentlyContinue); if ($items.Count -eq 0) { throw ('no file matches: ' + $p) }; $files += $items }
$hostName = $Bucket + '.cos.' + $Region + '.myqcloud.com'
$prefixSegments = @(); if ($KeyPrefix) { $prefixSegments = @($KeyPrefix.Trim('/') -split '/' | Where-Object { $_ }) }
if ($DryRun) {
  foreach ($fi in $files) { $segments = $prefixSegments + @($fi.Name); $ep = '/' + (($segments | ForEach-Object { ConvertTo-CosUriEncode $_ }) -join '/'); Write-Host ('would upload ' + $fi.Length + ' bytes -> https://' + $hostName + $ep + $(if ($fi.Length -gt $MultipartThreshold) { ' (multipart)' } else { '' })) }
  exit 0
}
if (-not $SecretId) { throw 'SecretId is required (or set COS_SECRET_ID)' }
if (-not $SecretKey) { throw 'SecretKey is required (or set COS_SECRET_KEY)' }
$successCount = 0
foreach ($fi in $files) {
  $segments = $prefixSegments + @($fi.Name); $encodedPath = '/' + (($segments | ForEach-Object { ConvertTo-CosUriEncode $_ }) -join '/'); $uri = 'https://' + $hostName + $encodedPath
  Write-Host ''; Write-Host ("Uploading: " + $fi.Name + " (" + ($fi.Length / 1MB).ToString('F2') + " MB)")
  try {
    if ($fi.Length -gt $MultipartThreshold) {
      Invoke-WithRetry -OperationName "multipart upload $($fi.Name)" { Upload-FileMultipart -FilePath $fi.FullName -EncodedPath $encodedPath -HostName $hostName -SecretId $SecretId -SecretKey $SecretKey }
    } else {
      Invoke-WithRetry -OperationName "PUT $($fi.Name)" { [void](Upload-FileDirect -FilePath $fi.FullName -EncodedPath $encodedPath -Uri $uri -HostName $hostName -SecretId $SecretId -SecretKey $SecretKey) }
    }
    $successCount++; Write-Host ('Success: ' + $fi.Name)
  } catch { Write-Host ('Failed after ' + $MaxRetries + ' attempts: ' + $_.Exception.Message); throw }
}
Write-Host ''; Write-Host ('Upload complete: ' + $successCount + '/' + $files.Count + ' files succeeded'); Write-Host ('Destination: https://' + $hostName + '/')
