# 数据来源与许可

知意的代码使用 MIT 许可。`assets/data.js` 是由以下数据构建出的衍生词库，使用时请同时遵守上游许可。

## 1. 字音数据

- 文件：`tools/source/kHanyuPinlu.txt`、`tools/source/kMandarin_8105.txt`
- 来源：[mozillazg/pinyin-data](https://github.com/mozillazg/pinyin-data)
- 上游数据：Unicode Unihan Database 的 `kHanyuPinlu`、`kMandarin_8105` 字段
- 许可：Unicode License（详见 <https://www.unicode.org/license.txt>）
- 用途：常用字的多音读音、单字候选与拼音切分音节表。

## 2. 词组拼音数据

- 文件：`tools/source/phrases.txt`
- 来源：[mozillazg/phrase-pinyin-data](https://github.com/mozillazg/phrase-pinyin-data) 的 `pinyin.txt`
- 许可：MIT
- 用途：词组与成语的拼音和候选。

## 3. 本项目补充数据

- `tools/source/curated.txt`：面向地址、开票、办公与日常沟通的现代常用词；
- `tools/source/overrides.txt`：多音词人工校正与少量常用别名（如 `北京 bj`）；
- `tools/source/topchars.txt`：单字候选排序用的常用字顺序。

这些文件由本项目编写，随项目以 MIT 许可发布。

## 重新构建

```bash
node tools/build-dict.mjs
```

生成的 `assets/data.js` 会写入 `meta.builtAt`，便于追踪快照时间。
