# 知意输入法 · 本地静态服务器
# 只监听 127.0.0.1，不向外网开放；由「启动知意输入法.cmd」调用。
param(
  [int]$Port = 8765,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$pidFile = Join-Path $root '.zhiyi.pid'
$logFile = Join-Path $root 'zhiyi-server.log'
$url = "http://127.0.0.1:$Port/"

function Write-Log([string]$message) {
  try {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  } catch { }
}

function Open-App {
  $edgePaths = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  $edge = $edgePaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($edge) {
    Start-Process -FilePath $edge -ArgumentList @("--app=$url", '--window-size=1440,980') | Out-Null
  } else {
    Start-Process $url | Out-Null
  }
}

# 已经有一个知意服务器在跑：直接把窗口叫出来
if (Test-Path -LiteralPath $pidFile) {
  $oldPid = (Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  $oldProcess = if ($oldPid) { Get-Process -Id $oldPid -ErrorAction SilentlyContinue } else { $null }
  if ($oldProcess -and $oldProcess.ProcessName -match 'powershell|pwsh') {
    if (-not $NoBrowser) { Open-App }
    exit 0
  }
}

$listener = $null
try {
  $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
  $listener.Start()
} catch {
  Write-Log "无法监听端口 ${Port}：$($_.Exception.Message)"
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "端口 $Port 已被占用，知意无法启动。`n请关闭占用该端口的程序，或查看 zhiyi-server.log。",
      '知意输入法',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
  } catch { }
  exit 1
}

$PID | Set-Content -LiteralPath $pidFile -Encoding ASCII
Write-Log "服务已启动：$url"

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.mjs'  = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2' = 'font/woff2'
}

function Send-Response($stream, [int]$status, [string]$contentType, [byte[]]$body, [bool]$headOnly) {
  $reason = if ($status -eq 200) { 'OK' } elseif ($status -eq 400) { 'Bad Request' } elseif ($status -eq 404) { 'Not Found' } elseif ($status -eq 405) { 'Method Not Allowed' } elseif ($status -eq 500) { 'Internal Server Error' } else { 'OK' }
  $header = "HTTP/1.1 $status $reason`r`n" +
            "Content-Type: $contentType`r`n" +
            "Content-Length: $($body.Length)`r`n" +
            "Cache-Control: no-store, no-cache, must-revalidate`r`n" +
            "Connection: close`r`n" +
            "X-Content-Type-Options: nosniff`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $headOnly) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

function Send-Json($stream, [int]$status, $payload) {
  $json = $payload | ConvertTo-Json -Compress -Depth 6
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Send-Response $stream $status 'application/json; charset=utf-8' $bytes $false
}

function Read-HttpRequest($stream) {
  $buffer = New-Object byte[] 8192
  $ms = New-Object System.IO.MemoryStream
  $headerEnd = -1
  while ($headerEnd -lt 0) {
    $read = $stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) { break }
    $ms.Write($buffer, 0, $read)
    $all = $ms.ToArray()
    for ($i = 0; $i -le $all.Length - 4; $i++) {
      if ($all[$i] -eq 13 -and $all[$i + 1] -eq 10 -and $all[$i + 2] -eq 13 -and $all[$i + 3] -eq 10) {
        $headerEnd = $i
        break
      }
    }
  }
  if ($headerEnd -lt 0) { return $null }
  $all = $ms.ToArray()
  $headerText = [System.Text.Encoding]::UTF8.GetString($all, 0, $headerEnd)
  $lines = $headerText -split "`r`n"
  $requestLine = $lines[0]
  $headers = @{}
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $idx = $lines[$i].IndexOf(':')
    if ($idx -gt 0) {
      $headers[$lines[$i].Substring(0, $idx).Trim().ToLowerInvariant()] = $lines[$i].Substring($idx + 1).Trim()
    }
  }
  $contentLength = 0
  if ($headers.ContainsKey('content-length')) {
    [int]::TryParse($headers['content-length'], [ref]$contentLength) | Out-Null
  }
  $bodyStart = $headerEnd + 4
  $bodyMs = New-Object System.IO.MemoryStream
  $already = $all.Length - $bodyStart
  if ($already -gt 0) { $bodyMs.Write($all, $bodyStart, $already) }
  $remaining = $contentLength - $already
  while ($remaining -gt 0) {
    $want = [Math]::Min($buffer.Length, $remaining)
    $read = $stream.Read($buffer, 0, $want)
    if ($read -le 0) { break }
    $bodyMs.Write($buffer, 0, $read)
    $remaining -= $read
  }
  return @{
    Method = if ($requestLine) { ($requestLine -split ' ')[0] } else { '' }
    RawPath = if ($requestLine -and ($requestLine -split ' ').Count -gt 1) { ($requestLine -split ' ')[1] } else { '/' }
    Headers = $headers
    Body = $bodyMs.ToArray()
  }
}

function Find-WeaselDeployer {
  $root = $null
  $reg = Get-ItemProperty 'HKLM:\Software\WOW6432Node\Rime\Weasel' -ErrorAction SilentlyContinue
  if ($reg -and $reg.WeaselRoot) { $root = $reg.WeaselRoot }
  if (-not $root) {
    $reg = Get-ItemProperty 'HKLM:\Software\Rime\Weasel' -ErrorAction SilentlyContinue
    if ($reg -and $reg.WeaselRoot) { $root = $reg.WeaselRoot }
  }
  if ($root) {
    $candidate = Join-Path $root 'WeaselDeployer.exe'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  $base = Join-Path $env:ProgramFiles 'Rime'
  if (Test-Path -LiteralPath $base) {
    $found = Get-ChildItem -LiteralPath $base -Filter 'WeaselDeployer.exe' -Recurse -File -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  return $null
}

function Get-RimeUserDir {
  $reg = Get-ItemProperty 'HKCU:\Software\Rime\Weasel' -ErrorAction SilentlyContinue
  if ($reg -and $reg.RimeUserDir) { return $reg.RimeUserDir }
  return (Join-Path $env:APPDATA 'Rime')
}

function Sync-RimeSnippets([string]$lua) {
  if ([string]::IsNullOrWhiteSpace($lua)) { throw '同步内容为空。' }
  if ($lua.Length -gt 2000000) { throw '同步内容过大。' }
  if ($lua -notmatch 'local\s+snippets\s*=' -or $lua -notmatch 'return\s+translator') {
    throw '同步内容不是有效的知意段落脚本。'
  }
  $rimeDir = Get-RimeUserDir
  if (-not (Test-Path -LiteralPath $rimeDir)) {
    throw '没有找到小狼毫用户目录，请先安装小狼毫。'
  }
  $luaDir = Join-Path $rimeDir 'lua'
  if (-not (Test-Path -LiteralPath $luaDir)) {
    New-Item -ItemType Directory -Path $luaDir -Force | Out-Null
  }
  $target = Join-Path $luaDir 'zhiyi_snippets.lua'
  $backupDir = Join-Path $rimeDir ('zhiyi-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Path (Join-Path $backupDir 'lua') -Force | Out-Null
  if (Test-Path -LiteralPath $target) {
    Copy-Item -LiteralPath $target -Destination (Join-Path $backupDir 'lua\zhiyi_snippets.lua') -Force
  }
  [System.IO.File]::WriteAllText($target, $lua, (New-Object System.Text.UTF8Encoding($false)))

  $deployer = Find-WeaselDeployer
  if (-not $deployer) { throw '没有找到 WeaselDeployer.exe，请确认小狼毫已安装。' }
  $weaselRoot = Split-Path -Parent $deployer
  $serverExe = Join-Path $weaselRoot 'WeaselServer.exe'
  if ((Test-Path -LiteralPath $serverExe) -and -not (Get-Process WeaselServer -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $serverExe -WindowStyle Hidden -ErrorAction SilentlyContinue | Out-Null
    Start-Sleep -Milliseconds 800
  }
  Start-Process -FilePath $deployer -ArgumentList '/deploy' -WindowStyle Hidden -ErrorAction SilentlyContinue | Out-Null
  Start-Sleep -Milliseconds 1200
  return "已同步 $target"
}

try {
  if (-not $NoBrowser) { Open-App }

  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 5000
      $client.SendTimeout = 5000
      $stream = $client.GetStream()
      $request = Read-HttpRequest $stream
      if (-not $request) { continue }
      $method = $request.Method
      $rawPath = $request.RawPath
      $headOnly = $method -eq 'HEAD'

      $path = $rawPath.Split('?')[0]
      $path = [System.Uri]::UnescapeDataString($path)
      if ($path -eq '/' -or [string]::IsNullOrWhiteSpace($path)) { $path = '/index.html' }

      if ($method -eq 'GET' -and $path -eq '/api/health') {
        $rimeDir = Get-RimeUserDir
        $deployer = Find-WeaselDeployer
        $luaFile = Join-Path $rimeDir 'lua\zhiyi_snippets.lua'
        $payload = @{
          ok = $true
          rimeInstalled = (Test-Path -LiteralPath $rimeDir)
          weaselInstalled = [bool]$deployer
          snippetsInstalled = (Test-Path -LiteralPath $luaFile)
          lastSync = if (Test-Path -LiteralPath $luaFile) { (Get-Item -LiteralPath $luaFile).LastWriteTime.ToString('o') } else { $null }
        }
        Send-Json $stream 200 $payload
        continue
      }

      if ($method -eq 'POST' -and $path -eq '/api/sync-rime') {
        try {
          $lua = [System.Text.Encoding]::UTF8.GetString($request.Body)
          $message = Sync-RimeSnippets $lua
          Send-Json $stream 200 @{ ok = $true; message = $message }
        } catch {
          Send-Json $stream 500 @{ ok = $false; error = $_.Exception.Message }
        }
        continue
      }

      if ($method -ne 'GET' -and -not $headOnly) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Method Not Allowed')
        Send-Response $stream 405 'text/plain; charset=utf-8' $body $false
        continue
      }

      $relative = $path.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $full = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
      $inside = $full.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)

      if ($inside -and (Test-Path -LiteralPath $full -PathType Leaf)) {
        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $contentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $body = [System.IO.File]::ReadAllBytes($full)
        Send-Response $stream 200 $contentType $body $headOnly
      } else {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
        Send-Response $stream 404 'text/plain; charset=utf-8' $body $headOnly
      }
    } catch {
      Write-Log "请求处理失败：$($_.Exception.Message)"
    } finally {
      try { $client.Close() } catch { }
    }
  }
} finally {
  try { $listener.Stop() } catch { }
  try { if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force } } catch { }
  Write-Log '服务已停止'
}
