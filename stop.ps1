# 知意输入法 · 停止本地服务
$ErrorActionPreference = 'SilentlyContinue'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$pidFile = Join-Path $root '.zhiyi.pid'
$logFile = Join-Path $root 'zhiyi-server.log'

if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Host '知意当前没有在运行。'
  exit 0
}

$serverPid = Get-Content -LiteralPath $pidFile | Select-Object -First 1
if (-not $serverPid) {
  Remove-Item -LiteralPath $pidFile -Force
  Write-Host '没有找到服务器进程。'
  exit 0
}

try {
  $process = Get-Process -Id $serverPid -ErrorAction Stop
  if ($process.ProcessName -match 'powershell|pwsh') {
    Stop-Process -Id $serverPid -Force
    Write-Host '知意已停止。'
  } else {
    Write-Host 'PID 对应的不是知意服务器，已忽略。'
  }
} catch {
  Write-Host '服务器进程已经结束。'
}

Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Add-Content -LiteralPath $logFile -Value ("{0}  已通过停止脚本关闭" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8 -ErrorAction SilentlyContinue
