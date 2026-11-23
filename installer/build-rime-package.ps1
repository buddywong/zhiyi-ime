$ErrorActionPreference = 'Stop'

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stage = Join-Path $PSScriptRoot 'build\rime-package'
$dist = Join-Path $root 'dist'
$version = '1.0.0'

if (-not (Test-Path -LiteralPath (Join-Path $root 'rime\zhiyi.dict.yaml'))) {
  throw '没有找到 rime/zhiyi.dict.yaml，请先运行 node tools/build-rime.mjs'
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'rime-package\install-rime.ps1'))) {
  throw '没有找到 rime-package/install-rime.ps1'
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Copy-Item -Path (Join-Path $root 'rime-package\*') -Destination $stage -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination (Join-Path $stage 'LICENSE') -Force
Copy-Item -LiteralPath (Join-Path $root 'NOTICE.md') -Destination (Join-Path $stage 'NOTICE.md') -Force
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'rime') | Out-Null
Copy-Item -Path (Join-Path $root 'rime\*') -Destination (Join-Path $stage 'rime') -Recurse -Force

$zip = Join-Path $dist "知意输入法-Rime-$version.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower()
$sums = Join-Path $dist 'SHA256SUMS.txt'
$lines = @()
if (Test-Path -LiteralPath $sums) {
  $lines = @(Get-Content -LiteralPath $sums -Encoding UTF8 | Where-Object { $_ -notmatch '知意输入法-Rime-' })
}
$lines += ("{0}  {1}" -f $hash, (Split-Path -Leaf $zip))
$lines | Set-Content -LiteralPath $sums -Encoding UTF8

Write-Host ("Rime 适配包：{0}  {1:N0} KB" -f $zip, ((Get-Item $zip).Length / 1KB))
Write-Host ("SHA256：{0}" -f $hash)
Write-Host ("校验文件：{0}" -f $sums)
