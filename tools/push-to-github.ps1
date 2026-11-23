param(
  [string]$Remote = 'https://github.com/buddywong/zhiyi-ime.git',
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw '没有找到 Git。请先安装 Git for Windows，然后重新运行本脚本。'
}

if (-not (Test-Path '.git')) {
  git init
}

# 只配置本地仓库，不修改全局 Git 设置。
if (-not (git config user.name)) {
  git config user.name 'buddywong'
}
if (-not (git config user.email)) {
  git config user.email 'buddywong@users.noreply.github.com'
}

git add -A
$changes = git status --porcelain
if ($changes) {
  git commit -m 'chore: 知意 1.0.0-beta.1'
} else {
  Write-Host '没有需要提交的新改动。'
}

git branch -M $Branch
$remotes = @(git remote)
if ($remotes -contains 'origin') {
  git remote set-url origin $Remote
} else {
  git remote add origin $Remote
}

Write-Host "推送到 $Remote ..." -ForegroundColor Cyan
git push -u origin $Branch

Write-Host ''
Write-Host '完成。接下来在 GitHub 上创建 v1.0.0-beta.1 Release，并上传 release/v1.0.0-beta.1/ 里的安装包。' -ForegroundColor Green
