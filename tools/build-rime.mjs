/**
 * 知意输入法 · Rime 适配构建
 *
 * 输入：assets/data.js、assets/snippets.js、assets/engine.js
 * 输出：rime/zhiyi.dict.yaml、rime/lua/zhiyi_snippets.lua
 *
 * 用法：
 *   node tools/build-rime.mjs
 *   node tools/build-rime.mjs --snippets=知意输入法备份.json
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const outDir = path.join(root, 'rime');
const luaDir = path.join(outDir, 'lua');

fs.mkdirSync(luaDir, { recursive: true });

vm.runInThisContext(fs.readFileSync(path.join(root, 'assets', 'data.js'), 'utf8'));
const DATA = globalThis.ZHIYI_DATA;
if (!DATA || !Array.isArray(DATA.entries)) throw new Error('data.js 读取失败');

const engine = require(path.join(root, 'assets', 'engine.js'));
const syllables = new Set(engine.syllables || []);

vm.runInThisContext(fs.readFileSync(path.join(root, 'assets', 'snippets.js'), 'utf8'));
let snippets = Array.isArray(globalThis.ZHIYI_SNIPPETS) ? globalThis.ZHIYI_SNIPPETS : [];

const backupArg = process.argv.find((a) => a.startsWith('--snippets='));
if (backupArg) {
  const file = backupArg.slice('--snippets='.length);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const source = parsed && parsed.state ? parsed.state.snippets : parsed.snippets || parsed;
  if (Array.isArray(source)) snippets = source;
}

function yamlSafe(value) {
  return String(value == null ? '' : value).replace(/\r?\n/g, ' ').replace(/\t/g, ' ').trim();
}

function luaString(value) {
  return JSON.stringify(String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
}

// ── 词库 ─────────────────────────────────────────────
const seen = new Set();
const rows = [];
let skipped = 0;
for (const entry of DATA.entries) {
  const text = String(entry[0] || '');
  const pinyin = String(entry[1] || '');
  const score = Number(entry[2]) || 1;
  if (!text || !pinyin || /[\t\r\n]/.test(text)) { skipped += 1; continue; }
  const parts = engine.segment(pinyin);
  if (!parts.length || parts.join('') !== pinyin || !parts.every((p) => syllables.has(p))) {
    skipped += 1;
    continue;
  }
  const code = parts.join(' ');
  const key = text + '\t' + code;
  if (seen.has(key)) continue;
  seen.add(key);
  const weight = Math.max(1, Math.min(1000000, Math.round(score * 10)));
  rows.push({ text, code, weight });
}
rows.sort((a, b) => b.weight - a.weight || a.text.length - b.text.length || a.text.localeCompare(b.text, 'zh-Hans-CN'));

const header = [
  '# Rime dictionary · 知意拼音',
  '# encoding: utf-8',
  '# 由 tools/build-rime.mjs 生成，请勿手工修改。',
  '---',
  'name: zhiyi',
  'version: "1.0"',
  'sort: by_weight',
  'use_preset_vocabulary: false',
  '...',
  '',
  '# text\\tcode\\tweight',
  ''
].join('\n');
const body = rows.map((r) => `${r.text}\t${r.code}\t${r.weight}`).join('\n');
fs.writeFileSync(path.join(outDir, 'zhiyi.dict.yaml'), header + body + '\n', 'utf8');

// ── 段落 Lua ─────────────────────────────────────────
const cleanSnippets = snippets
  .filter((s) => s && s.title && s.content)
  .map((s) => ({
    trigger: String(s.trigger || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8),
    title: String(s.title),
    content: String(s.content).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  }))
  .filter((s) => /^[a-z0-9]{2,8}$/.test(s.trigger));

const luaLines = [
  '-- 知意输入法 · Rime 常用段落',
  '-- 由 tools/build-rime.mjs 生成，请勿手工修改。',
  'local snippets = {'
];
for (const s of cleanSnippets) {
  luaLines.push(`  { trigger = ${luaString(s.trigger)}, title = ${luaString(s.title)}, content = ${luaString(s.content)} },`);
}
luaLines.push(
  '}',
  '',
  '-- 触发码：输入 dz / kp 等，候选里会出现对应段落。',
  '-- 说明：Rime 候选条的显示文本就是将要上屏的文本，',
  '-- 因此较长的段落会在候选条中完整显示。',
  'local function translator(input, seg, env)',
  '  if #input < 2 then return end',
  '  for _, item in ipairs(snippets) do',
  '    local trigger = item.trigger',
  '    if input == trigger or (#input >= 2 and trigger:sub(1, #input) == input) then',
  '      yield(Candidate("zhiyi_snippet", seg.start, seg._end, item.content, item.title))',
  '    end',
  '  end',
  'end',
  '',
  'return translator'
);
fs.writeFileSync(path.join(luaDir, 'zhiyi_snippets.lua'), luaLines.join('\n') + '\n', 'utf8');

// ── 首字母联想 Lua ───────────────────────────────────
const curatedSet = new Set(
  fs.readFileSync(path.join(root, 'tools', 'source', 'curated.txt'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
);
const initialSeen = new Set();
const initialEntries = [];
for (const entry of DATA.entries) {
  const text = String(entry[0] || '');
  const pinyin = String(entry[1] || '');
  const score = Number(entry[2]) || 1;
  if (text.length < 2 || text.length > 8 || !curatedSet.has(text)) continue;
  const parts = engine.segment(pinyin);
  if (parts.length < 2 || parts.join('') !== pinyin) continue;
  const code = parts.map((part) => part[0]).join('');
  if (!/^[a-z]{2,8}$/.test(code)) continue;
  const key = code + '\t' + text;
  if (initialSeen.has(key)) continue;
  initialSeen.add(key);
  initialEntries.push({ code, text, score });
}
initialEntries.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code) || a.text.localeCompare(b.text, 'zh-Hans-CN'));

const initialLines = [
  '-- 知意输入法 · Rime 首字母联想',
  '-- 由 tools/build-rime.mjs 生成，请勿手工修改。',
  '-- 输入词、成语或常用短句的首字母，例如 zg → 中国、nhm → 你好吗。',
  'local entries = {'
];
for (const item of initialEntries) {
  initialLines.push(`  { code = ${luaString(item.code)}, text = ${luaString(item.text)}, title = ${luaString(item.text)} },`);
}
initialLines.push(
  '}',
  '',
  'local function translator(input, seg, env)',
  '  for _, item in ipairs(entries) do',
  '    if input == item.code then',
  '      yield(Candidate("zhiyi_initials", seg.start, seg._end, item.text, item.title))',
  '    end',
  '  end',
  'end',
  '',
  'return translator'
);
fs.writeFileSync(path.join(luaDir, 'zhiyi_initials.lua'), initialLines.join('\n') + '\n', 'utf8');

console.log('Rime 词库生成完成');
console.log('  词条：' + rows.length);
console.log('  跳过：' + skipped);
console.log('  段落：' + cleanSnippets.length);
console.log('  首字母：' + initialEntries.length);
console.log('  输出：rime/zhiyi.dict.yaml');
console.log('        rime/lua/zhiyi_snippets.lua');
console.log('        rime/lua/zhiyi_initials.lua');
