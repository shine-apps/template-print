# Local update server for end-to-end update walkthroughs. Serves a directory over HTTP
# with Range request support. Usage:
#   powershell -ExecutionPolicy Bypass -File ./scripts/serve-update.ps1 [-Dir release] [-Port 8765]
param(
  [string]$Dir = '',
  [int]$Port = 8765
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
if (-not $Dir) { $Dir = Join-Path $root 'release' }
$Dir = (Resolve-Path $Dir).Path
$prefix = 'http://127.0.0.1:' + $Port + '/'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host ('serving ' + $Dir + ' at ' + $prefix + '  (Ctrl+C to stop)')

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
      if (-not $rel) { $rel = 'index.txt' }
      $file = Join-Path $Dir $rel
      if (-not (Test-Path $file -PathType Leaf)) {
        $ctx.Response.StatusCode = 404
        $ctx.Response.Close()
        continue
      }
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $total = $bytes.Length
      $start = 0
      $end = $total - 1
      $isRange = $false
      $range = $ctx.Request.Headers['Range']
      if ($range -and ($range -match '^bytes=(\d+)-(\d*)$')) {
        $start = [int]$Matches[1]
        if ($Matches[2] -ne '') { $end = [int]$Matches[2] }
        if ($start -le $end -and $start -lt $total) { $isRange = $true }
        else { $start = 0; $end = $total - 1 }
      }
      if ($isRange) {
        $ctx.Response.StatusCode = 206
        $ctx.Response.AddHeader('Content-Range', ('bytes ' + $start + '-' + $end + '/' + $total))
      } else {
        $ctx.Response.StatusCode = 200
      }
      $ctx.Response.AddHeader('Accept-Ranges', 'bytes')
      # Must use ContentLength64 (a raw Content-Length AddHeader makes Stream.Write fail)
      $ctx.Response.ContentLength64 = $end - $start + 1
      if ($file -like '*.json') { $ctx.Response.ContentType = 'application/json; charset=utf-8' }
      else { $ctx.Response.ContentType = 'application/octet-stream' }
      $len = $end - $start + 1
      $ctx.Response.OutputStream.Write($bytes, $start, $len)
      $ctx.Response.OutputStream.Close()
      $ctx.Response.Close()
      Write-Host ((Get-Date).ToString('HH:mm:ss') + ' ' + $ctx.Request.HttpMethod + ' ' + $rel + ' -> ' + $ctx.Response.StatusCode)
    } catch {
      try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {}
      Write-Host ('ERR ' + $_.Exception.Message)
    }
  }
} finally {
  $listener.Stop()
}
