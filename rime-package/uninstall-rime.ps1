param(
  [string]$RimeDir = (Join-Path $env:APPDATA 'Rime'),
  [switch]$NoDeploy,
  [switch]$PurgeUserData
)

$ErrorActionPreference = 'Stop'

function Find-Deployer {
  $roots = @()
  if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles 'Rime') }
  if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} 'Rime') }
  if ($env:LOCALAPPDATA) { $roots += (Join-Path $env:LOCALAPPDATA 'Programs\Rime') }
  foreach ($root in $roots) {
    if ($root -and (Test-Path -LiteralPath $root)) {
      $found = Get-ChildItem -LiteralPath $root -Filter 'WeaselDeployer.exe' -Recurse -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($found) { return $found.FullName }
    }
  }
  return $null
}

if (-not (Test-Path -LiteralPath $RimeDir)) {
  Write-Host "没有找到 Rime 用户目录：$RimeDir" -ForegroundColor Yellow
  exit 0
}

$removed = @()
foreach ($rel in @('zhiyi.schema.yaml', 'zhiyi.dict.yaml', 'lua\zhiyi_snippets.lua', 'weasel.custom.yaml.zhiyi-example')) {
  $target = Join-Path $RimeDir $rel
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Force
    $removed += $rel
  }
}

$backups = Get-ChildItem -LiteralPath $RimeDir -Directory -Filter 'zhiyi-backup-*' -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending
$latest = $null
if ($backups.Count -gt 0) { $latest = $backups[0].FullName }

$defaultTarget = Join-Path $RimeDir 'default.custom.yaml'
$beforeDefault = if ($latest) { Join-Path $latest 'default.custom.yaml' } else { $null }
if ($beforeDefault -and (Test-Path -LiteralPath $beforeDefault)) {
  Copy-Item -LiteralPath $beforeDefault -Destination $defaultTarget -Force
  Write-Host '已恢复：default.custom.yaml' -ForegroundColor Green
} elseif (Test-Path -LiteralPath $defaultTarget) {
  $content = Get-Content -LiteralPath $defaultTarget -Raw -Encoding UTF8
  if ($content -match 'schema:\s*zhiyi') {
    Remove-Item -LiteralPath $defaultTarget -Force
    Write-Host '已移除知意写入的 default.custom.yaml' -ForegroundColor Green
  }
}

$weaselTarget = Join-Path $RimeDir 'weasel.custom.yaml'
$beforeWeasel = if ($latest) { Join-Path $latest 'weasel.custom.yaml' } else { $null }
if ($beforeWeasel -and (Test-Path -LiteralPath $beforeWeasel)) {
  Copy-Item -LiteralPath $beforeWeasel -Destination $weaselTarget -Force
  Write-Host '已恢复：weasel.custom.yaml' -ForegroundColor Green
} elseif (Test-Path -LiteralPath $weaselTarget) {
  $content = Get-Content -LiteralPath $weaselTarget -Raw -Encoding UTF8
  if ($content -match 'zhiyi_paper') {
    Remove-Item -LiteralPath $weaselTarget -Force
    Write-Host '已移除知意写入的 weasel.custom.yaml' -ForegroundColor Green
  }
}

$luaDir = Join-Path $RimeDir 'lua'
if (Test-Path -LiteralPath $luaDir) {
  $left = Get-ChildItem -LiteralPath $luaDir -Force -ErrorAction SilentlyContinue
  if (-not $left -or $left.Count -eq 0) {
    Remove-Item -LiteralPath $luaDir -Force
  }
}

if ($PurgeUserData) {
  $userdb = Join-Path $RimeDir 'zhiyi.userdb'
  if (Test-Path -LiteralPath $userdb) {
    Remove-Item -LiteralPath $userdb -Recurse -Force
    Write-Host '已删除 Rime 学习数据 zhiyi.userdb' -ForegroundColor Yellow
  }
}

$deployer = Find-Deployer
if ($deployer -and -not $NoDeploy) {
  try {
    & $deployer /deploy
    Start-Sleep -Seconds 1
  } catch {
    Write-Host '自动部署失败，请右键小狼毫图标 → 重新部署。' -ForegroundColor Yellow
  }
}

Write-Host '知意 Rime 配置已移除。' -ForegroundColor Green
if ($removed.Count -gt 0) { Write-Host ('删除：' + ($removed -join ', ')) }
Write-Host '如果之前没有安装过知意，default.custom.yaml / weasel.custom.yaml 的备份会保留在 zhiyi-backup-* 目录。'
