# GitHub 发布操作清单

仓库：**<https://github.com/buddywong/zhiyi-ime>**  
仓库名：**`zhiyi-ime`**  
公开源码：是（MIT）  
首个版本：`v1.0.0-beta.1`（无签名开发者预览）  
反馈主入口：腾讯问卷 / 问卷星（国内），GitHub Issues 作为开发者补充。

## 一、创建仓库

在 GitHub 新建公开仓库 `zhiyi-ime`，不要勾选自动生成 README（本地已有）。

仓库简介建议：

> 知意：一套会记忆、会联想、能收藏常用段落的本地中文输入方案。网页工作台 + 小狼毫 Rime 方案。

Topics 建议：

`rime` `weasel` `input-method` `pinyin` `chinese` `windows` `local-first`

## 二、本地提交

当前机器没有安装 Git。安装 Git 后，在本目录执行：

```bash
git init
git add .
git commit -m "chore: 知意 1.0.0-beta.1"
git branch -M main
git remote add origin https://github.com/buddywong/zhiyi-ime.git
git push -u origin main
```

`.gitignore` 已排除 `dist/`、`release/`、日志和构建中间文件。源码提交后，
安装包作为 Release 资产单独上传，不进入 Git 历史。

也可以安装 Git 后直接运行：

```powershell
powershell -ExecutionPolicy Bypass -File tools/push-to-github.ps1
```

## 三、创建 Beta Release

Tag：`v1.0.0-beta.1`  
标题：`知意 1.0.0 Beta 1 · 开发者预览`

Release 说明可直接使用 `RELEASE_NOTES-1.0.0.md`，并加一段：

> 这是无签名开发者预览。Windows SmartScreen 可能提示，请选择“更多信息 → 仍要运行”。
> 使用 Rime 方案前需要先安装小狼毫 Weasel。

上传资产：

- `知意输入法-1.0.0-beta.1-Setup.exe`
- `知意输入法-1.0.0-beta.1-Portable.zip`
- `知意输入法-1.0.0-beta.1-Rime.zip`
- `SHA256SUMS.txt`

`release/` 目录已经准备好这些 Beta 命名副本。

## 四、仓库设置

- Issues：开启；
- Discussions：开启（可选，用于使用交流）；
- Wiki：关闭；
- Projects：关闭；
- Security：开启私密漏洞报告；
- 在 About 里填简介和 Topics；
- 把问卷链接放到 README 顶部和 Release 说明里。

## 五、Issue 模板

`.github/ISSUE_TEMPLATE/` 已包含：

- 问题反馈（要求填写使用方式、版本、系统、复现步骤，并提醒打码）；
- 功能建议；
- 联系链接配置。

`.github/ISSUE_TEMPLATE/config.yml` 已指向 `buddywong/zhiyi-ime`。

## 六、不要上传的东西

- 用户真实地址、电话、税号、账号；
- `%APPDATA%\Rime` 的个人段落或用户词典；
- 本地日志、`.zhiyi.pid`；
- `dist/` 和 `release/` 里的二进制（作为 Release 资产上传即可）。

## 七、发布后第一周

- 每天看一次 Issues 和问卷；
- 只修“装不上、打不出、常用段落不同步”这三类；
- 把高频问题补进 README FAQ；
- 一周后发 `v1.0.0-beta.2`，不要急着改品牌和大功能。
