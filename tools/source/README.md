# 词库源文件

| 文件 | 说明 | 上游 |
| --- | --- | --- |
| `kHanyuPinlu.txt` | 常用字及多音读音，3799 字 | mozillazg/pinyin-data（Unihan） |
| `kMandarin_8105.txt` | 补充常用字读音 | mozillazg/pinyin-data（Unihan） |
| `phrases.txt` | 词组与拼音，约 5,470 条 | mozillazg/phrase-pinyin-data（MIT） |
| `curated.txt` | 本项目现代常用词表 | 本项目 |
| `overrides.txt` | 多音词人工校正 / 常用别名 | 本项目 |
| `topchars.txt` | 常用字顺序 | 本项目 |

`../build-dict.mjs` 会合并上述文件，生成 `../../assets/data.js`。

注意：`kMandarin_8105.txt` 是抓取时的快照，可能并非完整 8105 字；缺失的字由 `kHanyuPinlu.txt` 与词组数据补足。若需要更新到最新上游版本，请替换文件后重新构建。
