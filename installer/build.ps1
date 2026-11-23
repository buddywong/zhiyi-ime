# 知意输入法 · 安装包构建
# 依赖：Windows 自带的 .NET Framework csc.exe；无需联网。
$ErrorActionPreference = 'Stop'

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$src = Join-Path $PSScriptRoot 'src'
$build = Join-Path $PSScriptRoot 'build'
$payload = Join-Path $build 'payload'
$dist = Join-Path $root 'dist'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$icon = Join-Path $root 'assets\zhiyi.ico'
$version = '1.0.0'

if (-not (Test-Path -LiteralPath $csc)) { throw "找不到 csc.exe：$csc" }
New-Item -ItemType Directory -Force -Path $build, $payload, $dist | Out-Null
Remove-Item (Join-Path $build 'payload\*') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $build 'Zhiyi.exe') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $build 'payload.zip') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dist '知意输入法-*-Setup.exe') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dist '知意输入法-*-Portable.zip') -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $dist -Directory -Filter '知意输入法-*-Portable' -ErrorAction SilentlyContinue |
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dist 'SHA256SUMS.txt') -Force -ErrorAction SilentlyContinue

Write-Host '1/5 编译启动器…'
& $csc /nologo /target:winexe /codepage:65001 /win32icon:"$icon" /out:"$build\Zhiyi.exe" (Join-Path $src 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw '启动器编译失败' }

Write-Host '2/5 整理运行文件…'
$files = @(
  'index.html',
  'README.md',
  'LICENSE',
  'NOTICE.md',
  'server.ps1',
  'stop.ps1',
  '启动知意输入法.cmd',
  '停止知意输入法.cmd'
)
foreach ($f in $files) {
  Copy-Item -LiteralPath (Join-Path $root $f) -Destination (Join-Path $payload $f) -Force
}
$assetFiles = @('app.js', 'data.js', 'engine.js', 'seeds.js', 'snippets.js', 'style.css', 'favicon.svg')
New-Item -ItemType Directory -Force -Path (Join-Path $payload 'assets') | Out-Null
foreach ($f in $assetFiles) {
  Copy-Item -LiteralPath (Join-Path $root "assets\$f") -Destination (Join-Path $payload "assets\$f") -Force
}
Copy-Item -LiteralPath $icon -Destination (Join-Path $payload 'zhiyi.ico') -Force
Copy-Item -LiteralPath (Join-Path $build 'Zhiyi.exe') -Destination (Join-Path $payload 'Zhiyi.exe') -Force
$versionText = "$version`r`nzh-CN`r`n"
[System.IO.File]::WriteAllText((Join-Path $payload 'version.txt'), $versionText, (New-Object System.Text.UTF8Encoding($true)))

Write-Host '3/5 打包运行文件…'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $build 'payload.zip'
[System.IO.Compression.ZipFile]::CreateFromDirectory($payload, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

Write-Host '4/5 编译安装程序…'
$setup = Join-Path $dist "知意输入法-$version-Setup.exe"
& $csc /nologo /target:winexe /codepage:65001 /win32icon:"$icon" /win32manifest:"$src\installer.manifest" `
  /resource:"$zip,ZhiyiPayload.zip" `
  /r:System.IO.Compression.dll `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  /out:"$setup" (Join-Path $src 'Installer.cs')
if ($LASTEXITCODE -ne 0) { throw '安装程序编译失败' }

Write-Host '5/5 生成便携版…'
$portableName = "知意输入法-$version-Portable"
$portable = Join-Path $dist $portableName
if (Test-Path -LiteralPath $portable) { Remove-Item -LiteralPath $portable -Recurse -Force }
New-Item -ItemType Directory -Force -Path $portable | Out-Null
Copy-Item -Path (Join-Path $payload '*') -Destination $portable -Recurse -Force
$portableZip = Join-Path $dist ($portableName + '.zip')
if (Test-Path -LiteralPath $portableZip) { Remove-Item -LiteralPath $portableZip -Force }
Compress-Archive -Path (Join-Path $portable '*') -DestinationPath $portableZip -CompressionLevel Optimal

# 便携版不需要安装器；只保留 ZIP
Remove-Item -LiteralPath (Join-Path $portable 'Uninstall.exe') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $portable -Recurse -Force -ErrorAction SilentlyContinue

$hashLines = @(Get-FileHash -Algorithm SHA256 -LiteralPath $setup, $portableZip |
  ForEach-Object { "$($_.Hash.ToLower())  $([System.IO.Path]::GetFileName($_.Path))" })
$rimeZip = Get-ChildItem -LiteralPath $dist -Filter '知意输入法-Rime-*.zip' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($rimeZip) {
  $hashLines += ("{0}  {1}" -f (Get-FileHash -Algorithm SHA256 -LiteralPath $rimeZip.FullName).Hash.ToLower(), $rimeZip.Name)
}
$hashLines | Set-Content -LiteralPath (Join-Path $dist 'SHA256SUMS.txt') -Encoding UTF8

$setupInfo = Get-Item -LiteralPath $setup
$portableInfo = Get-Item -LiteralPath $portableZip
Write-Host ''
Write-Host '构建完成：'
Write-Host ("  {0}  {1:N0} KB" -f $setupInfo.Name, ($setupInfo.Length / 1KB))
Write-Host ("  {0}  {1:N0} KB" -f $portableInfo.Name, ($portableInfo.Length / 1KB))
Write-Host ("  SHA256SUMS.txt")
