/**
 * 知意输入法 · 词库构建脚本
 *
 * 数据来源：
 *  - kHanyuPinlu.txt   Unihan / 《现代汉语频率词典》常用字读音（多音字全覆盖）
 *  - phrases.txt       mozillazg/phrase-pinyin-data（常用词组与成语，MIT）
 *  - curated.txt       为现代输入场景补充的常用词（本项目的词表）
 *  - topchars.txt      常用字频顺序（用于单字候选排序）
 *
 * 输出：assets/data.js
 * 只生成静态数据，不依赖网络。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(here, 'source');
const outFile = path.join(here, '..', 'assets', 'data.js');

const read = (name) => fs.readFileSync(path.join(sourceDir, name), 'utf8');

/** 去掉声调，ü 统一写作 v；输出只含 a-z 的紧凑拼音 */
function normalizePinyin(raw) {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/ü/g, 'v')
    .replace(/[’']/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
}

/** 从 kHanyuPinlu 解析：字 -> 读音数组（首项为最常用读音） */
function parseCharReadings(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    // kMandarin 的多音字会在注释里追加 “-> 又音”，这里只取第一个读音字段。
    const m = line.match(/^U\+([0-9A-Fa-f]+):\s*([^#]+?)\s*(?:#\s*(\S+).*)?\s*$/);
    if (!m) continue;
    const ch = String.fromCodePoint(parseInt(m[1], 16));
    if (!/[\u3400-\u9fff]/.test(ch)) continue;
    const readings = [];
    for (const part of m[2].split(',')) {
      const reading = normalizePinyin(part);
      if (reading && !readings.includes(reading)) readings.push(reading);
    }
    if (readings.length) map.set(ch, readings);
  }
  return map;
}

const charReadings = parseCharReadings(read('kHanyuPinlu.txt'));
// 用 kMandarin 补充 kHanyuPinlu 未收录的常用字（如“京”）
for (const [ch, readings] of parseCharReadings(read('kMandarin_8105.txt'))) {
  const existing = charReadings.get(ch);
  if (!existing) {
    charReadings.set(ch, readings);
  } else {
    for (const reading of readings) {
      if (!existing.includes(reading)) existing.push(reading);
    }
  }
}
if (charReadings.size < 5000) {
  throw new Error(`常用字读音数据异常：${charReadings.size}`);
}

/** 解析词组拼音数据 */
function parsePhrases(text) {
  const list = [];
  const seen = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('Fetched ') || line.startsWith('External ') || line.startsWith('(Content') || line.startsWith('(Omitted')) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const word = line.slice(0, idx).trim();
    const pinyin = line.slice(idx + 1).split('#')[0].trim();
    if (!/^[\u3400-\u9fff]{2,9}$/.test(word)) continue;
    const compact = normalizePinyin(pinyin);
    if (!compact || compact.length < 2) continue;
    const key = `${word}|${compact}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ word, pinyin: compact });
  }
  return list;
}

const phrases = parsePhrases(read('phrases.txt'));

/** 解析人工词表：# 注释、空行忽略 */
const curated = read('curated.txt')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .filter((word) => /^[\u3400-\u9fff]+$/.test(word));

const curatedSeen = new Set();
const curatedWords = [];
for (const word of curated) {
  if (curatedSeen.has(word)) continue;
  curatedSeen.add(word);
  curatedWords.push(word);
}

/** 人工校正的多音词：word -> 正确拼音数组 */
const overrides = new Map();
for (const line of read('overrides.txt').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const [word, ...rest] = trimmed.split(/\s+/);
  const pinyin = normalizePinyin(rest.join(''));
  if (!word || !pinyin) continue;
  if (!overrides.has(word)) overrides.set(word, []);
  if (!overrides.get(word).includes(pinyin)) overrides.get(word).push(pinyin);
}
// 校正表里的词如果不在人工词表中，也纳入词表
for (const word of overrides.keys()) {
  if (!curatedSeen.has(word) && /^[\u3400-\u9fff]+$/.test(word)) {
    curatedSeen.add(word);
    curatedWords.push(word);
  }
}

/** 为一个词生成多音组合（首个为常用读音组合，后续降权） */
function variantsFor(word, limit = 10) {
  const options = [];
  for (const ch of word) {
    const readings = charReadings.get(ch);
    if (!readings || !readings.length) return [];
    options.push(readings);
  }
  let combos = [''];
  for (const readings of options) {
    const next = [];
    for (const prefix of combos) {
      for (const reading of readings) {
        if (next.length >= limit) break;
        next.push(prefix + reading);
      }
      if (next.length >= limit) break;
    }
    combos = next;
  }
  return [...new Set(combos)];
}

/** 字频：取人工词与词组中出现的加权次数，再叠加常用字频顺序 */
const charWeight = new Map();
const bumpChar = (ch, v) => charWeight.set(ch, (charWeight.get(ch) || 0) + v);

// 人工词表顺序越靠前越常用
const curatedCount = curatedWords.length;
for (let i = 0; i < curatedCount; i += 1) {
  const word = curatedWords[i];
  const t = curatedCount <= 1 ? 0 : i / (curatedCount - 1);
  const score = 9200 - 5600 * Math.pow(t, 0.55);
  const primary = variantsFor(word, 1)[0];
  if (!primary) continue;
  for (const ch of word) bumpChar(ch, score * 0.42 / word.length);
}

// 词组按顺序给一个较弱的字频信号
for (let i = 0; i < phrases.length; i += 1) {
  const t = phrases.length <= 1 ? 0 : i / (phrases.length - 1);
  const score = 1600 - 1250 * Math.pow(t, 0.6);
  for (const ch of phrases[i].word) bumpChar(ch, score * 0.1 / phrases[i].word.length);
}

const topChars = [...new Set(read('topchars.txt').replace(/\s+/g, '').split(''))].filter((ch) => charReadings.has(ch));
const topCharBase = new Map();
topChars.forEach((ch, i) => {
  const t = topChars.length <= 1 ? 0 : i / (topChars.length - 1);
  topCharBase.set(ch, 9000 - 7800 * Math.pow(t, 0.55));
});

const entryMap = new Map(); // text|pinyin -> entry
function addEntry(text, pinyin, score, kind) {
  if (!text || !pinyin || score < 40) return;
  const key = `${text}|${pinyin}`;
  const prev = entryMap.get(key);
  if (!prev || score > prev[2]) {
    entryMap.set(key, [text, pinyin, Math.round(score), kind]);
  }
}

// 人工词：多音组合，每个组合按排序轻微降权
for (let i = 0; i < curatedCount; i += 1) {
  const word = curatedWords[i];
  const t = curatedCount <= 1 ? 0 : i / (curatedCount - 1);
  const base = 9200 - 5600 * Math.pow(t, 0.55);
  const explicit = overrides.get(word) || [];
  const generated = variantsFor(word, 10).filter((p) => !explicit.includes(p));
  const combos = [...explicit, ...generated];
  combos.forEach((pinyin, idx) => {
    const penalty = Math.pow(0.9, idx);
    addEntry(word, pinyin, base * penalty, word.length === 1 ? 2 : 0);
  });
}

// 词组数据：拼音权威，作为独立候选；长词降权
const lengthFactor = { 2: 1.35, 3: 1.08, 4: 0.72, 5: 0.45, 6: 0.32 };
for (let i = 0; i < phrases.length; i += 1) {
  const { word, pinyin } = phrases[i];
  const t = phrases.length <= 1 ? 0 : i / (phrases.length - 1);
  const base = 1750 - 1300 * Math.pow(t, 0.58);
  const factor = lengthFactor[word.length] ?? 0.2;
  addEntry(word, pinyin, base * factor, 0);
}

// 单字：常用字频 + 读音顺序降权
for (const [ch, readings] of charReadings) {
  const fromWords = Math.min(6200, Math.sqrt(charWeight.get(ch) || 0) * 22);
  const base = Math.min(8200, Math.max(topCharBase.get(ch) || 0, fromWords, 60));
  readings.forEach((pinyin, idx) => {
    addEntry(ch, pinyin, base * Math.pow(0.82, idx), 1);
  });
}

const entries = [...entryMap.values()].sort((a, b) => b[2] - a[2]);

// 供切分与编码提示使用的音节表
const syllables = new Set();
for (const readings of charReadings.values()) for (const r of readings) syllables.add(r);
for (const { pinyin } of phrases) {
  // 词组拼音没有保留声调分隔，这里不再拆分；字表已覆盖常用音节
}
const syllableList = [...syllables].filter((s) => s.length >= 1 && s.length <= 6).sort();

const meta = {
  chars: charReadings.size,
  curated: curatedWords.length,
  phrases: phrases.length,
  entries: entries.length,
  builtAt: new Date().toISOString(),
};

const payload = {
  version: 1,
  entries,
  syllables: syllableList,
  meta,
};

const js = `/* 由 tools/build-dict.mjs 生成，请勿手工修改。 */\n` +
  `/* 数据来源：Unihan kHanyuPinlu、phrase-pinyin-data（MIT）、本项目 curated.txt。 */\n` +
  `globalThis.ZHIYI_DATA = ${JSON.stringify(payload)};\n`;

fs.writeFileSync(outFile, js, 'utf8');
console.log('built', outFile);
console.log(meta);
console.log('size', (fs.statSync(outFile).size / 1024).toFixed(1), 'KB');
