# 知意拼音 · Rime 适配包

把知意词库和常用段落装进 **小狼毫（Weasel）**，装完后它就是真正的系统级输入法：在浏览器、Office、微信、记事本等任意软件里都能用。

## 前置条件

请先安装 **小狼毫 Weasel**：

- 官网：<https://rime.im/download/>
- 安装后确认任务栏出现小狼毫图标

本包不包含小狼毫本体，只包含知意方案、词库和配置。

## 安装

1. 把本 ZIP 解压到任意文件夹。
2. 双击 **`安装到小狼毫.cmd`**。
3. 安装脚本会：
   - 备份现有的 `default.custom.yaml`、`weasel.custom.yaml` 等配置；
   - 复制 `zhiyi.schema.yaml`、`zhiyi.dict.yaml`；
   - 复制 `lua/zhiyi_snippets.lua`；
   - 尝试调用 `WeaselDeployer.exe /deploy`。
4. 如果脚本没有自动部署：右键任务栏小狼毫图标，选择 **「重新部署」**。
5. 按 **F4** 或 **Ctrl + `**，选择 **「知意拼音」**。

## 测试

| 输入 | 结果 |
| --- | --- |
| `nihao` | 你好 |
| `shoudizhi` | 收件地址 |
| `yinhang` | 银行 |
| `bj` | 北京（简拼） |
| `dz` | 收件地址整段 |
| `kp` | 开票信息整段 |
| `hy` | 会议邀请整段 |

## 已适配的能力

- **系统级拼音输入**：全拼、简拼、常用多音组合。
- **知意词库**：约 11,700 条词与字，含地址、开票、办公、沟通词汇。
- **选词学习**：启用 Rime 用户词典 `zhiyi.userdb`，选过的词会被 Rime 记住并逐渐提前。
- **常用段落**：`dz`、`kp`、`lk`、`hy`、`qj`、`jj`、`xk` 调出 7 个内置段落。
- **知意纸白主题**：首次安装且没有自定义主题时启用。

## 和浏览器版知意的差异

Rime 适配不是把浏览器页面嵌进系统，而是复用知意的词库和段落数据。请了解这些差异：

1. **候选窗变成小狼毫的**，不再有知意网页里的纸墨工作台、习惯图表和统计。
2. **浏览器里的习惯不会自动迁移**。Rime 会从你之后的选词重新学习。
3. **联想能力不同**：浏览器版有基于二元组的下一句联想；Rime 版目前主要依靠 Rime 用户词典、句子组合和词库，没有完全等价的“下一句”预测。
4. **段落候选的显示**：Rime 候选条的显示文本就是要上屏的文本，所以收件地址、开票信息这类长段落会在候选条里完整显示；选中后整段上屏。多行段落在不同 Rime 版本上的显示效果可能不同。
5. **浏览器里的自定义段落**不会自动同步。需要重新生成 `zhiyi_snippets.lua` 后再部署，见下一节。

## 同步浏览器里的自定义段落

在知意设置里「导出备份」，然后回到项目源码目录运行：

```bash
node tools/build-rime.mjs --snippets=你的备份.json
```

重新生成 `rime/lua/zhiyi_snippets.lua` 和 `rime/zhiyi.dict.yaml`，再执行：

```powershell
powershell -ExecutionPolicy Bypass -File installer/build-rime-package.ps1
```

把新生成的 `dist/知意输入法-Rime-1.0.0.zip` 解压，重新运行安装脚本即可。

## 卸载

双击 **`卸载知意Rime配置.cmd`**。

- 会移除知意的 schema、词库和 Lua 文件；
- 会尝试恢复最近一次安装前的 `default.custom.yaml` / `weasel.custom.yaml`；
- 默认保留 `zhiyi.userdb` 学习数据；加 `-PurgeUserData` 可一并删除。

## 故障排查

- **F4 里没有「知意拼音」**  
  检查 `%APPDATA%\Rime\default.custom.yaml` 的 `schema_list` 是否包含 `- schema: zhiyi`，然后重新部署。
- **部署报 Lua 错误**  
  确认 `%APPDATA%\Rime\lua\zhiyi_snippets.lua` 存在；升级到较新的小狼毫版本（需要 Lua 支持）。
- **段落显示太长**  
  这是 Rime 候选文本的显示方式；可以缩短段落内容，或把长段落拆成几个短段落。
- **想回到原来的输入法**  
  运行卸载脚本，或在 F4 中切回原来的方案。

## 文件结构

```
安装到小狼毫.cmd
卸载知意Rime配置.cmd
install-rime.ps1
uninstall-rime.ps1
README-Rime.md
LICENSE
NOTICE.md
rime/
  zhiyi.schema.yaml
  zhiyi.dict.yaml
  default.custom.yaml
  weasel.custom.yaml
  lua/zhiyi_snippets.lua
```

词库与拼音数据的上游来源见 `NOTICE.md`。
