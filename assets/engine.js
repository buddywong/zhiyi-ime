/**
 * 知意输入法 · 候选引擎
 * 纯函数实现，可在浏览器和 Node 中运行。
 *
 * candidates(input, { habit, bigrams, snippets, lastToken, limit, snippetSuggest })
 * predict({ lastToken, context, habit, bigrams, snippets, limit })
 * segment(input) -> ["ni", "hao"]
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ZhiyiEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DATA = (typeof globalThis !== 'undefined' && globalThis.ZHIYI_DATA) || { entries: [], syllables: [] };

  function stripTones(raw) {
    if (!raw) return '';
    return String(raw)
      .toLowerCase()
      .replace(/ü/g, 'v')
      .replace(/[’']/g, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z]/g, '');
  }

  const SYLLABLES = new Set(DATA.syllables || []);
  const MAX_SYL = 6;

  /** 动态规划切分拼音；优先完整切分，输入未完成时保留尾串 */
  function rawSegment(input) {
    const s = stripTones(input);
    if (!s) return [];
    const n = s.length;

    // 第一轮：只接受完整音节
    const best = new Array(n + 1).fill(null);
    best[0] = { count: 0, parts: [] };
    for (let i = 0; i < n; i += 1) {
      if (!best[i]) continue;
      for (let len = Math.min(MAX_SYL, n - i); len >= 1; len -= 1) {
        const piece = s.slice(i, i + len);
        if (!SYLLABLES.has(piece)) continue;
        const count = best[i].count + 1;
        const prev = best[i + len];
        if (!prev || count < prev.count) {
          best[i + len] = { count, parts: best[i].parts.concat(piece) };
        }
      }
    }
    if (best[n]) return best[n].parts;

    // 第二轮：允许末尾一个未完成音节，例如 "nih"
    const parts = [];
    let i = 0;
    while (i < n) {
      let matched = '';
      for (let len = Math.min(MAX_SYL, n - i); len >= 1; len -= 1) {
        const piece = s.slice(i, i + len);
        if (SYLLABLES.has(piece)) { matched = piece; break; }
      }
      if (matched) {
        parts.push(matched);
        i += matched.length;
      } else {
        parts.push(s.slice(i));
        break;
      }
    }
    return parts;
  }

  /** 显示用：ni hao */
  function segment(input) {
    return rawSegment(input);
  }

  function initialsOf(pinyin) {
    const parts = rawSegment(pinyin);
    if (parts.length > 1) return parts.map((p) => p[0]).join('');
    // 单音节或切分失败：取拼音首字母
    return parts.length ? parts[0][0] : '';
  }

  // 预计算每条词条的简拼
  const baseEntries = (DATA.entries || []).map((e) => ({
    text: e[0],
    pinyin: e[1],
    score: e[2],
    kind: e[3],
    initials: '',
  }));
  for (const e of baseEntries) e.initials = initialsOf(e.pinyin);
  let entries = baseEntries;

  /** 注入用户自定义词，重建候选池 */
  function setCustomWords(list) {
    const custom = [];
    for (const item of list || []) {
      const text = String(item.word || item.text || '').trim();
      const pinyin = stripTones(item.pinyin || '');
      if (!text || !pinyin || !/^[\u3400-\u9fff]+$/.test(text)) continue;
      custom.push({
        text,
        pinyin,
        score: 9600,
        kind: 0,
        initials: initialsOf(pinyin),
        custom: true,
      });
    }
    entries = baseEntries.concat(custom);
  }

  const hasVowel = (s) => /[aeiouv]/.test(s);

  function habitBoost(text, habit) {
    if (!habit) return 1;
    const h = habit[text];
    if (!h || !h.count) return 1;
    const last = h.last || 0;
    const days = last ? Math.max(0, (Date.now() - last) / 86400000) : 30;
    const recency = 0.58 + 0.42 * Math.exp(-days / 45);
    return 1 + Math.min(4.8, Math.log1p(h.count) * 1.38) * recency;
  }

  function contextBoost(text, lastToken, bigrams) {
    if (!lastToken || !bigrams) return 1;
    const row = bigrams[lastToken];
    if (!row) return 1;
    const c = row[text] || 0;
    return c ? 1 + Math.min(1.5, Math.log1p(c) * 0.32) : 1;
  }

  function snippetList(snippets, input) {
    if (!snippets || !input) return [];
    const q = stripTones(input);
    const out = [];
    for (let i = 0; i < snippets.length; i += 1) {
      const s = snippets[i];
      const trigger = stripTones(s.trigger || '');
      if (!trigger) continue;
      if (trigger === q) out.push({ snippet: s, exact: true, order: i });
      else if (q.length >= 2 && trigger.startsWith(q)) out.push({ snippet: s, exact: false, order: i });
    }
    out.sort((a, b) => (b.exact - a.exact) || (a.order - b.order));
    return out;
  }

  /**
   * 候选词
   * @param {string} input 输入码（可含空格/撇号）
   * @param {object} opts
   */
  function candidates(input, opts) {
    const o = opts || {};
    const q = stripTones(input);
    if (!q) return [];
    const limit = Math.max(1, Math.min(30, o.limit || 9));
    const habit = o.habit || null;
    const bigrams = o.bigrams || null;
    const lastToken = o.lastToken || '';
    const result = [];
    const seenText = new Set();

    const push = (item) => {
      if (!item.text || seenText.has(item.text)) return;
      seenText.add(item.text);
      result.push(item);
    };

    // 1) 常用段落触发码优先
    if (o.snippetSuggest !== false) {
      for (const hit of snippetList(o.snippets, q).slice(0, 3)) {
        const s = hit.snippet;
        push({
          text: s.title,
          pinyin: s.trigger,
          score: 1e9 - (hit.exact ? 0 : 1e5) + hit.order,
          type: 'snippet',
          label: '段落',
          snippet: s,
          insert: s.content,
        });
      }
    }

    // 2) 词库前缀匹配
    const useInitials = !hasVowel(q) && q.length >= 2;
    const scored = [];
    for (const e of entries) {
      let score = e.score;
      let how = 0; // 0 前缀 1 简拼
      if (e.pinyin.startsWith(q)) {
        how = 0;
        if (e.pinyin === q) {
          if (e.text.length === 1) score *= 2.35;
          else score *= 1.14;
        } else {
          const ratio = q.length / Math.max(1, e.pinyin.length);
          score *= 0.84 + 0.16 * ratio;
          if (e.text.length === 1) score *= 0.62;
        }
      } else if (useInitials && e.initials.startsWith(q)) {
        how = 1;
        score *= 0.3;
      } else {
        continue;
      }
      score *= habitBoost(e.text, habit);
      score *= contextBoost(e.text, lastToken, bigrams);
      scored.push({ e, score, how });
    }
    scored.sort((a, b) => b.score - a.score);
    for (const item of scored) {
      if (result.length >= limit * 3) break;
      const e = item.e;
      push({
        text: e.text,
        pinyin: e.pinyin,
        score: item.score,
        type: e.text.length === 1 ? 'char' : 'word',
        label: e.text.length === 1 ? '单字' : '',
        habit: !!(habit && habit[e.text] && habit[e.text].count),
        initialsMatch: item.how === 1,
      });
    }

    result.sort((a, b) => b.score - a.score);
    return result.slice(0, limit);
  }

  const SNIPPET_HINTS = [
    { re: /地址|收货|寄到|快递|邮寄|收件|寄件/, cats: ['地址', '物流'] },
    { re: /发票|开票|抬头|税号|报销|开票信息/, cats: ['开票'] },
    { re: /会议|邀请|参会|议程/, cats: ['沟通'] },
    { re: /合同|报价|付款|转账|定金|尾款/, cats: ['开票', '沟通'] },
  ];

  function snippetHints(context, snippets) {
    if (!context || !snippets) return [];
    const out = [];
    for (const h of SNIPPET_HINTS) {
      if (!h.re.test(context)) continue;
      for (const s of snippets) {
        if (h.cats.includes(s.category) && !out.some((x) => x.id === s.id)) out.push(s);
      }
    }
    return out;
  }

  /** 输入后的联想 */
  function predict(opts) {
    const o = opts || {};
    const limit = Math.max(1, Math.min(12, o.limit || 6));
    const lastToken = o.lastToken || '';
    const bigrams = o.bigrams || {};
    const habit = o.habit || {};
    const snippets = o.snippets || [];
    const context = o.context || '';
    const out = [];
    const seen = new Set();

    const add = (text, type, label, extra) => {
      if (!text || seen.has(text) || out.length >= limit) return;
      seen.add(text);
      out.push(Object.assign({ text, type, label }, extra || {}));
    };

    // 1) 上下文相关的段落（最多两条，给词对联想留位置）
    for (const s of snippetHints(context, snippets).slice(0, 2)) {
      add(s.title, 'snippet', '段落', { snippet: s, insert: s.content });
    }

    // 2) 二元习惯
    const row = lastToken ? bigrams[lastToken] : null;
    if (row) {
      const sorted = Object.entries(row).sort((a, b) => b[1] - a[1]).slice(0, limit);
      for (const [word, count] of sorted) {
        if (count < 1) continue;
        add(word, 'predict', '联想', { count });
      }
    }

    // 3) 最近常用词补位
    if (out.length < limit) {
      const top = Object.entries(habit)
        .filter(([word, h]) => h && h.count > 0 && word.length > 1)
        .sort((a, b) => (b[1].count || 0) - (a[1].count || 0) || (b[1].last || 0) - (a[1].last || 0));
      for (const [word] of top) {
        add(word, 'habit', '习惯');
        if (out.length >= limit) break;
      }
    }

    // 4) 常用的新段落补位（只补一个，避免打扰）
    if (out.length < limit) {
      const pin = snippets.find((s) => s.pinned);
      if (pin) add(pin.title, 'snippet', '常用', { snippet: pin, insert: pin.content });
    }

    return out.slice(0, limit);
  }

  function pinyinOf(text) {
    // 仅用于把用户自定义词的中文转成拼音：按字取常用读音
    const map = {};
    for (const e of entries) {
      if (!map[e.text]) map[e.text] = e.pinyin;
    }
    return [...String(text)].map((ch) => map[ch] || '').join('');
  }

  return {
    candidates,
    predict,
    segment,
    initialsOf,
    stripTones,
    pinyinOf,
    setCustomWords,
    get size() { return entries.length; },
    syllables: [...SYLLABLES],
  };
});
