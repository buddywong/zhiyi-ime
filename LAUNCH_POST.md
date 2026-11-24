# 知意 Beta 发布文案

## 一句话

> 知意：一个会记忆、会联想、能收藏常用段落的本地中文输入方案。网页工作台 + 小狼毫 Rime 方案，开源、免费、无账号。

## 长版（适合小众软件 / 少数派 / 知乎）

### 标题

**知意：把常用地址、开票信息和输入习惯，收进一个安静的输入法**

### 正文

我一直在想，输入法除了“打得快”，还能不能更懂一点自己的日常。

于是做了知意。它是一套本地中文输入方案，分成两部分：

- **网页工作台**：管理词库、习惯、主题和常用段落；
- **小狼毫 Rime 方案**：在 Windows 的任意输入框里真正打字。

它现在能做的事：

- 记住你选过的词，让常用词慢慢排到前面；
- 支持全拼、简拼和首字母，比如 `zg` → 中国、`nhm` → 你好吗；
- 把收件地址、开票信息、邮件落款存成常用段落，用 `dz`、`szkp` 一键调出；
- 默认简体输出，繁体候选会自动转成简体；
- 常用词、成语和短句优先；
- 所有文字、习惯和段落只留在本机，没有账号，没有云端。

### 下载

- GitHub Release：<https://github.com/buddywong/zhiyi-ime/releases/tag/v1.0.0-beta.3>
- 项目主页：<https://github.com/buddywong/zhiyi-ime>

Windows 用户下载 `zhiyi-ime-v1.0.0-beta.3-Setup.exe`。
如果要用系统级输入，还需要先安装[小狼毫 Weasel](https://rime.im/download/)，再下载 Rime 方案包。

### 注意

这是 **Beta**，安装包没有数字签名，SmartScreen 可能提示“更多信息 → 仍要运行”。
Rime 方案需要先安装小狼毫；网页工作台不是系统级 TSF 输入法。

### 反馈

匿名问卷：<https://wj.qq.com/s2/28788718/3ozy/>
GitHub Issues：<https://github.com/buddywong/zhiyi-ime/issues>

## 短版（适合 V2EX / 即刻 / 朋友圈）

做了一套本地中文输入方案「知意」：网页工作台 + 小狼毫 Rime 方案。

- 会记忆选词，支持首字母：`zg` → 中国、`nhm` → 你好吗
- 常用地址 / 开票信息 / 邮件落款存成段落，`dz` 一键调出
- 简体优先、常用词优先、完全本地、开源 MIT、无账号

Beta 无签名，需先装小狼毫：
<https://github.com/buddywong/zhiyi-ime/releases/tag/v1.0.0-beta.3>

问卷：<https://wj.qq.com/s2/28788718/3ozy/>

## 发布检查清单

- [x] GitHub 公开源码
- [x] v1.0.0-beta.3 Release
- [x] Setup / Portable / Rime / SHA256
- [x] README 安装说明
- [x] 腾讯匿名问卷
- [x] GitHub Issue 模板
- [ ] 小众软件投稿
- [ ] 少数派投稿
- [ ] V2EX 发帖
- [ ] 知乎 / B站介绍
- [ ] Gitee 镜像（可选）
- [ ] winget / Scoop（可选）
