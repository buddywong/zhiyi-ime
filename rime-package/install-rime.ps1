param(
  [string]$RimeDir = (Join-Path $env:APPDATA 'Rime'),
  [switch]$NoDeploy
)

$ErrorActionPreference = 'Stop'
$packageRoot = $PSScriptRoot
$source = Join-Path $packageRoot 'rime'

if (-not (Test-Path -LiteralPath (Join-Path $source 'zhiyi.schema.yaml'))) {
  throw "没有找到 rime 配置目录：$source"
}

function Find-Deployer {
  $roots = @()
  if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles 'Rime') }
  if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} 'Rime') }
  if ($env:LOCALAPPDATA) { $roots += (Join-Path $env:LOCALAPPDATA 'Programs\Rime') }
  if ($env:LOCALAPPDATA) { $roots += (Join-Path $env:LOCALAPPDATA 'Rime') }
  foreach ($root in $roots) {
    if ($root -and (Test-Path -LiteralPath $root)) {
      $found = Get-ChildItem -LiteralPath $root -Filter 'WeaselDeployer.exe' -Recurse -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($found) { return $found.FullName }
    }
  }
  return $null
}

$deployer = Find-Deployer
if (-not (Test-Path -LiteralPath $RimeDir)) {
  New-Item -ItemType Directory -Path $RimeDir -Force | Out-Null
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $RimeDir "zhiyi-backup-$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null

$relativeFiles = @(
  'default.custom.yaml',
  'weasel.custom.yaml',
  'zhiyi.schema.yaml',
  'zhiyi.dict.yaml',
  'lua\zhiyi_snippets.lua'
)
foreach ($rel in $relativeFiles) {
  $existing = Join-Path $RimeDir $rel
  if (Test-Path -LiteralPath $existing) {
    $dest = Join-Path $backup $rel
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $destDir)) {
      New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $existing -Destination $dest -Force
  }
}

Copy-Item -LiteralPath (Join-Path $source 'zhiyi.schema.yaml') -Destination (Join-Path $RimeDir 'zhiyi.schema.yaml') -Force
Copy-Item -LiteralPath (Join-Path $source 'zhiyi.dict.yaml') -Destination (Join-Path $RimeDir 'zhiyi.dict.yaml') -Force

$luaDir = Join-Path $RimeDir 'lua'
if (-not (Test-Path -LiteralPath $luaDir)) {
  New-Item -ItemType Directory -Path $luaDir -Force | Out-Null
}
$luaTarget = Join-Path $luaDir 'zhiyi_snippets.lua'
if (Test-Path -LiteralPath $luaTarget) {
  Write-Host '已保留现有常用段落；如需换成新版默认段落，请先在网页里删除或手动替换。' -ForegroundColor Yellow
} else {
  Copy-Item -LiteralPath (Join-Path $source 'lua\zhiyi_snippets.lua') -Destination $luaTarget -Force
}
Copy-Item -LiteralPath (Join-Path $source 'lua\zhiyi_initials.lua') -Destination (Join-Path $luaDir 'zhiyi_initials.lua') -Force

$defaultTarget = Join-Path $RimeDir 'default.custom.yaml'
if (Test-Path -LiteralPath $defaultTarget) {
  Write-Host '检测到已有 default.custom.yaml，已备份并替换为知意方案列表。' -ForegroundColor Yellow
}
Copy-Item -LiteralPath (Join-Path $source 'default.custom.yaml') -Destination $defaultTarget -Force

$weaselTarget = Join-Path $RimeDir 'weasel.custom.yaml'
if (Test-Path -LiteralPath $weaselTarget) {
  Write-Host '已保留现有小狼毫主题；知意主题示例写入 weasel.custom.yaml.zhiyi-example。' -ForegroundColor Yellow
  Copy-Item -LiteralPath (Join-Path $source 'weasel.custom.yaml') -Destination ($weaselTarget + '.zhiyi-example') -Force
} else {
  Copy-Item -LiteralPath (Join-Path $source 'weasel.custom.yaml') -Destination $weaselTarget -Force
}

if ($deployer -and -not $NoDeploy) {
  Write-Host "正在部署小狼毫：$deployer" -ForegroundColor Cyan
  try {
    & $deployer /deploy
    Start-Sleep -Seconds 1
  } catch {
    Write-Host "自动部署失败：$($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host '请右键任务栏的小狼毫图标，选择「重新部署」。' -ForegroundColor Yellow
  }
} elseif (-not $deployer) {
  Write-Host '没有检测到小狼毫。配置已经写入 Rime 用户目录，安装小狼毫后请重新部署。' -ForegroundColor Yellow
} else {
  Write-Host '已跳过自动部署，请手动右键小狼毫图标 → 重新部署。' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '知意 Rime 配置安装完成。' -ForegroundColor Green
Write-Host "安装位置：$RimeDir"
Write-Host "备份位置：$backup"
Write-Host ''
Write-Host '接下来：'
Write-Host '  1. 右键任务栏的小狼毫图标 → 重新部署（如果刚才没有自动部署）'
Write-Host '  2. 按 F4 或 Ctrl+`，选择「知意拼音」'
Write-Host '  3. 输入 nihao 测试「你好」；输入 dz 测试「收件地址」'
Write-Host ''
Write-Host '提示：Rime 会从你的选词中自动学习；浏览器里原来的习惯不会自动迁移。'
