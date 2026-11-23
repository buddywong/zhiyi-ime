/* ============================================================
   知意输入法 · 交互
   ============================================================ */
(function () {
  'use strict';

  const DATA = window.ZHIYI_DATA || { entries: [], meta: {} };
  const ENGINE = window.ZhiyiEngine;
  const DEFAULT_SNIPPETS = deepClone(window.ZHIYI_SNIPPETS || []);
  const SEEDS = window.ZHIYI_SEEDS || {};
  const STORAGE_KEY = 'zhiyi.state.v1';
  const WELCOME = [
    '你好，欢迎来到知意。',
    '试着输入 nihao，按空格上屏；',
    '输入 dz，调出收件地址。',
    '你写下的每个词，都会成为下一次的默契。'
  ].join('\n');

  const PUNCT = {
    ',': '，', '.': '。', '?': '？', '!': '！', ':': '：', ';': '；',
    '(': '（', ')': '）', '[': '【', ']': '】'
  };
  const CATEGORIES = ['地址', '开票', '沟通', '自定义'];
  const ROUTES = { input: '输入', snippets: '常用段落', habit: '习惯', settings: '设置' };
  const TIPS = [
    '用 <kbd>空格</kbd> 上屏第一个候选，用 <kbd>数字</kbd> 选择其他候选。知意会记住你的选择。',
    '输入 <kbd>dz</kbd> 可以叫出收件地址，输入 <kbd>kp</kbd> 可以叫出开票信息。',
    '按一下 <kbd>Shift</kbd> 切换中英；<kbd>Tab</kbd> 可以采纳一个联想。',
    '你输入过的词会慢慢往前排。用得越多，它越懂你。'
  ];

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  const ui = {
    route: 'input',
    lang: 'zh',
    composing: false,
    code: '',
    candidates: [],
    active: 0,
    predictions: [],
    lastToken: '',
    internalInput: false,
    shiftUsed: false,
    snippetFilter: '全部',
    snippetSearch: '',
    rimeOnline: false,
    rimeChecked: false,
    modalOpen: false,
    pendingImport: null,
    saveTimer: null,
    toastTimer: null,
    quoteOpen: true,
    singleQuoteOpen: true,
    mirror: null
  };

  let state;

  /* ── 小工具 ─────────────────────────────────────────── */

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function todayKey(date) {
    const d = date || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function lastNDays(n) {
    const out = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      out.push({ key: todayKey(d), date: d, value: 0 });
    }
    return out;
  }

  function formatRelative(ts) {
    if (!ts) return '还没用过';
    const diff = Date.now() - ts;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }

  function formatCount(n) {
    return new Intl.NumberFormat('zh-CN').format(n || 0);
  }

  function charLength(text) {
    return Array.from(String(text || '')).filter((ch) => !/\s/.test(ch)).length;
  }

  function showToast(message, ms) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('is-show');
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => el.classList.remove('is-show'), ms || 2200);
  }

  /* ── 状态 ───────────────────────────────────────────── */

  function freshState() {
    return {
      version: 1,
      settings: {
        candidateCount: 7,
        learning: true,
        prediction: true,
        punctuation: true,
        snippetSuggest: true,
        autoSyncRime: true,
        theme: 'light',
        fontSize: 18
      },
      learning: {
        words: {},
        bigrams: {},
        commits: 0,
        chars: 0,
        savedKeys: 0,
        snippetsUsed: 0,
        days: {}
      },
      customWords: [],
      snippets: deepClone(DEFAULT_SNIPPETS),
      ui: {
        draft: WELCOME,
        lang: 'zh',
        firstRun: true
      }
    };
  }

  function normalizeState(raw) {
    const fresh = freshState();
    if (!raw || typeof raw !== 'object') return fresh;
    const out = Object.assign({}, fresh, raw);
    out.version = 1;
    out.settings = Object.assign({}, fresh.settings, raw.settings || {});
    out.settings.candidateCount = clamp(Number(out.settings.candidateCount) || 7, 5, 9);
    out.settings.fontSize = clamp(Number(out.settings.fontSize) || 18, 15, 24);
    out.settings.theme = out.settings.theme === 'dark' ? 'dark' : 'light';
    ['learning', 'prediction', 'punctuation', 'snippetSuggest', 'autoSyncRime'].forEach((k) => {
      out.settings[k] = out.settings[k] !== false;
    });

    const learning = Object.assign({}, fresh.learning, raw.learning || {});
    learning.words = learning.words && typeof learning.words === 'object' ? learning.words : {};
    learning.bigrams = learning.bigrams && typeof learning.bigrams === 'object' ? learning.bigrams : {};
    learning.days = learning.days && typeof learning.days === 'object' ? learning.days : {};
    ['commits', 'chars', 'savedKeys', 'snippetsUsed'].forEach((k) => {
      learning[k] = Math.max(0, Number(learning[k]) || 0);
    });
    out.learning = learning;

    out.customWords = Array.isArray(raw.customWords) ? raw.customWords.filter((w) => w && w.word && w.pinyin).map((w) => ({
      word: String(w.word).trim(),
      pinyin: ENGINE.stripTones(w.pinyin),
      addedAt: Number(w.addedAt) || Date.now()
    })) : [];

    if (Array.isArray(raw.snippets)) {
      out.snippets = raw.snippets.filter((s) => s && s.title && s.content).map((s, i) => ({
        id: s.id || `imported-${i}-${Date.now().toString(36)}`,
        title: String(s.title).trim().slice(0, 30),
        category: CATEGORIES.includes(s.category) ? s.category : '自定义',
        trigger: String(s.trigger || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'aa',
        pinned: !!s.pinned,
        builtin: !!s.builtin,
        uses: Math.max(0, Number(s.uses) || 0),
        lastUsed: Number(s.lastUsed) || 0,
        content: String(s.content)
      }));
    } else {
      out.snippets = deepClone(DEFAULT_SNIPPETS);
    }

    out.ui = Object.assign({}, fresh.ui, raw.ui || {});
    out.ui.lang = out.ui.lang === 'en' ? 'en' : 'zh';
    out.ui.draft = typeof out.ui.draft === 'string' ? out.ui.draft : WELCOME;
    out.ui.firstRun = !!out.ui.firstRun;
    return out;
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      return normalizeState(JSON.parse(raw));
    } catch (err) {
      console.warn('[知意] 读取本地数据失败，已使用初始数据。', err);
      return freshState();
    }
  }

  function persist(immediate) {
    const write = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        const chip = $('#save-chip');
        if (chip) chip.innerHTML = '<span class="save-dot"></span>已自动保存';
        const stateEl = $('#save-state');
        if (stateEl) stateEl.textContent = '已保存';
      } catch (err) {
        console.warn('[知意] 保存失败。', err);
        showToast('本地存储空间不足，暂时无法保存');
      }
    };
    if (immediate) {
      clearTimeout(ui.saveTimer);
      write();
      return;
    }
    clearTimeout(ui.saveTimer);
    ui.saveTimer = setTimeout(write, 260);
    const stateEl = $('#save-state');
    if (stateEl) stateEl.textContent = '保存中…';
  }

  function persistDraft() {
    state.ui.draft = editor.value;
    persist(false);
  }

  /* ── 主题与外观 ─────────────────────────────────────── */

  function applyTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    state.settings.theme = next;
    document.documentElement.dataset.theme = next;
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', next === 'dark' ? 'dark' : 'light dark');
    $$('[data-theme-btn]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.themeBtn === next));
    persist(true);
  }

  function applyFontSize(size) {
    const px = clamp(Number(size) || 18, 15, 24);
    state.settings.fontSize = px;
    document.documentElement.style.setProperty('--editor-size', `${px}px`);
    const out = $('#out-fontsize');
    if (out) out.textContent = String(px);
    const slider = $('#set-fontsize');
    if (slider) slider.value = String(px);
  }

  /* ── 路由 ───────────────────────────────────────────── */

  function routeFromHash() {
    const name = (location.hash || '#/input').replace(/^#\/?/, '') || 'input';
    return ROUTES[name] ? name : 'input';
  }

  function renderRoute(focus) {
    const route = routeFromHash();
    ui.route = route;
    $$('.view').forEach((view) => view.classList.toggle('is-active', view.dataset.view === route));
    $$('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.route === route));
    const title = $('#page-title');
    if (title) title.textContent = ROUTES[route];
    const demoBtn = $('#btn-demo');
    if (demoBtn) demoBtn.hidden = route !== 'input';
    if (route !== 'input') {
      cancelComposition(true);
      hidePredictions();
    }
    if (route === 'snippets') renderSnippets();
    if (route === 'habit') renderHabit();
    if (route === 'settings') renderSettings();
    if (route === 'input') {
      updateEditorMeta();
      if (focus) setTimeout(() => editor.focus({ preventScroll: true }), 60);
    }
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if ((route === 'snippets' || route === 'settings') && ui.rimeChecked) refreshRimeStatus();
  }

  function go(route) {
    if (location.hash === `#/${route}`) {
      renderRoute(true);
    } else {
      location.hash = `#/${route}`;
    }
  }

  /* ── 编辑器 ─────────────────────────────────────────── */

  let editor;
  let editorBody;
  let imePopover;
  let lastCaretPoint = null;

  function setupEditor() {
    editor = $('#editor');
    editorBody = $('#editor-body');
    imePopover = $('#ime-popover');
    editor.value = state.ui.draft || '';
    updateEditorMeta();

    editor.addEventListener('input', () => {
      state.ui.draft = editor.value;
      updateEditorMeta();
      persistDraft();
      if (!ui.internalInput) {
        ui.lastToken = deriveLastToken();
        hidePredictions();
      }
    });

    editor.addEventListener('focus', () => {
      editorBody.classList.add('is-focused');
      if (ui.composing) positionPopover();
    });

    editor.addEventListener('blur', () => {
      editorBody.classList.remove('is-focused');
      setTimeout(() => {
        if (document.activeElement === editor) return;
        if (imePopover && imePopover.contains(document.activeElement)) return;
        hidePopover();
      }, 120);
    });

    editor.addEventListener('scroll', () => {
      if (ui.composing) positionPopover();
      else hidePopover();
    });

    editor.addEventListener('keydown', onEditorKeyDown);

    $('#ime-list').addEventListener('mousedown', (e) => e.preventDefault());
    $('#ime-list').addEventListener('click', (e) => {
      const item = e.target.closest('[data-index]');
      if (item) commitCandidate(Number(item.dataset.index));
    });

    $('#suggest-list').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-predict-index]');
      if (chip) acceptPrediction(Number(chip.dataset.predictIndex));
    });

    document.addEventListener('mousedown', (e) => {
      if (!ui.composing) return;
      if (imePopover && imePopover.contains(e.target)) return;
      if (e.target === editor) return;
      cancelComposition();
    });

    window.addEventListener('resize', () => {
      if (ui.composing) positionPopover();
    });
    window.addEventListener('scroll', () => {
      if (ui.composing) positionPopover();
    }, { passive: true });

    window.addEventListener('pagehide', () => {
      state.ui.draft = editor.value;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* ignore */ }
    });
  }

  function updateEditorMeta() {
    const value = editor.value;
    const count = charLength(value);
    const charEl = $('#char-count');
    if (charEl) charEl.textContent = `${formatCount(count)} 字`;
    const placeholder = $('#editor-placeholder');
    if (placeholder) placeholder.hidden = value.length > 0;
    const firstLine = value.split('\n').map((line) => line.trim()).find(Boolean) || '';
    const docTitle = $('#doc-title');
    if (docTitle) {
      const clean = firstLine.replace(/^[#>\s·•\-]+/, '');
      docTitle.textContent = clean ? clean.slice(0, 18) : '未命名文稿';
    }
    const stateEl = $('#save-state');
    if (stateEl && stateEl.textContent === '保存中…') return;
    if (stateEl) stateEl.textContent = count ? '草稿' : '空白';
  }

  function deriveLastToken() {
    const before = editor.value.slice(0, editor.selectionStart);
    const match = before.match(/[\u3400-\u9fff]{1,8}$/);
    if (!match) return '';
    return match[0].length > 4 ? match[0].slice(-2) : match[0];
  }

  function onEditorKeyDown(e) {
    if (e.isComposing) return;
    if (ui.modalOpen) return;
    const key = e.key;

    if (key === 'Shift') {
      ui.shiftUsed = false;
      return;
    }
    if (e.shiftKey && key !== 'Shift') ui.shiftUsed = true;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (ui.composing) {
      handleCompositionKey(e);
      return;
    }

    // 未在输入中
    if (key === 'Tab' && ui.predictions.length) {
      e.preventDefault();
      acceptPrediction(0);
      return;
    }
    if (/^[a-zA-Z]$/.test(key) && ui.lang === 'zh' && !e.shiftKey) {
      e.preventDefault();
      startComposition(key.toLowerCase());
      return;
    }
    if (ui.lang === 'zh' && state.settings.punctuation && key in PUNCT) {
      e.preventDefault();
      insertText(PUNCT[key]);
      return;
    }
    if (ui.lang === 'zh' && state.settings.punctuation && (key === '"' || key === "'")) {
      e.preventDefault();
      if (key === '"') {
        insertText(ui.quoteOpen ? '“' : '”');
        ui.quoteOpen = !ui.quoteOpen;
      } else {
        insertText(ui.singleQuoteOpen ? '‘' : '’');
        ui.singleQuoteOpen = !ui.singleQuoteOpen;
      }
      return;
    }
    if (key === 'Enter') {
      ui.lastToken = '';
      hidePredictions();
      return;
    }
    if (key === 'Backspace' || key === 'Delete') {
      ui.lastToken = '';
      hidePredictions();
    }
    if (key === 'Escape') {
      hidePredictions();
    }
  }

  function handleCompositionKey(e) {
    const key = e.key;

    if (/^[a-zA-Z]$/.test(key)) {
      e.preventDefault();
      ui.code += key.toLowerCase();
      ui.active = 0;
      refreshCandidates();
      return;
    }
    if (key === 'Backspace') {
      e.preventDefault();
      ui.code = ui.code.slice(0, -1);
      ui.active = 0;
      if (!ui.code) cancelComposition();
      else refreshCandidates();
      return;
    }
    if (key === 'Escape') {
      e.preventDefault();
      cancelComposition();
      return;
    }
    if (key === ' ') {
      e.preventDefault();
      if (ui.candidates[ui.active]) commitCandidate(ui.active);
      else commitRaw();
      return;
    }
    if (key === 'Enter') {
      e.preventDefault();
      if (ui.candidates[ui.active]) commitCandidate(ui.active);
      else commitRaw();
      return;
    }
    if (key === 'Tab') {
      e.preventDefault();
      if (ui.candidates[ui.active]) commitCandidate(ui.active);
      return;
    }
    if (key === 'ArrowLeft') {
      e.preventDefault();
      if (ui.candidates.length) {
        ui.active = (ui.active - 1 + ui.candidates.length) % ui.candidates.length;
        renderCandidates();
      }
      return;
    }
    if (key === 'ArrowRight') {
      e.preventDefault();
      if (ui.candidates.length) {
        ui.active = (ui.active + 1) % ui.candidates.length;
        renderCandidates();
      }
      return;
    }
    if (/^[1-9]$/.test(key)) {
      const idx = Number(key) - 1;
      if (ui.candidates[idx]) {
        e.preventDefault();
        commitCandidate(idx);
      }
      return;
    }
    if (ui.lang === 'zh' && state.settings.punctuation && key in PUNCT) {
      e.preventDefault();
      if (ui.candidates[ui.active]) commitCandidate(ui.active, { silent: true });
      insertText(PUNCT[key]);
      return;
    }
    if (key.length === 1) {
      e.preventDefault();
      if (ui.candidates[ui.active]) commitCandidate(ui.active, { silent: true });
      insertText(key);
    }
  }

  function startComposition(letter) {
    ui.composing = true;
    ui.code = letter;
    ui.active = 0;
    ui.candidates = [];
    $('#compose-badge').hidden = false;
    hidePredictions();
    refreshCandidates();
    showPopover();
    updateStatus();
  }

  function refreshCandidates() {
    if (!ui.composing) return;
    const snippets = state.settings.snippetSuggest ? state.snippets : [];
    ui.candidates = ENGINE.candidates(ui.code, {
      limit: state.settings.candidateCount,
      habit: state.learning.words,
      bigrams: mergedBigrams(),
      snippets,
      snippetSuggest: state.settings.snippetSuggest,
      lastToken: ui.lastToken
    });
    if (ui.active >= ui.candidates.length) ui.active = Math.max(0, ui.candidates.length - 1);
    renderCandidates();
    positionPopover();
    updateStatus();
  }

  function renderCandidates() {
    const list = $('#ime-list');
    if (!list) return;
    const preedit = $('#ime-preedit');
    const seg = $('#ime-seg');
    if (preedit) preedit.textContent = ui.code;
    if (seg) {
      const parts = ENGINE.segment(ui.code);
      seg.textContent = parts.length > 1 ? parts.join(' · ') : (parts[0] || '');
    }
    if (!ui.candidates.length) {
      list.innerHTML = `<div class="ime-empty">没有找到候选，按 <kbd>Enter</kbd> 输入「${esc(ui.code)}」</div>`;
    } else {
      list.innerHTML = ui.candidates.map((c, i) => {
        const tag = c.type === 'snippet' ? '段落' : c.habit ? '习惯' : c.initialsMatch ? '简拼' : '';
        return `<button type="button" class="ime-item${i === ui.active ? ' is-active' : ''}${c.type === 'snippet' ? ' is-snippet' : ''}" data-index="${i}" role="option" aria-selected="${i === ui.active}">
          <span class="ime-idx">${i + 1}</span>
          <span class="ime-word">${esc(c.text)}</span>
          ${tag ? `<span class="ime-tag">${tag}</span>` : ''}
        </button>`;
      }).join('');
    }
    const count = $('#ime-count-label');
    if (count) count.textContent = `${ui.candidates.length} 个候选`;
    const mode = $('#compose-mode');
    if (mode) mode.textContent = ui.candidates[0] && ui.candidates[0].type === 'snippet' ? '段落' : '拼音';
    const statusCode = $('#status-code');
    if (statusCode) statusCode.textContent = `拼音 · ${ui.code}`;
  }

  function showPopover() {
    imePopover.hidden = false;
    imePopover.style.visibility = 'hidden';
    requestAnimationFrame(() => {
      positionPopover();
      imePopover.style.visibility = 'visible';
    });
  }

  function hidePopover() {
    if (!imePopover) return;
    imePopover.hidden = true;
    imePopover.style.visibility = '';
    imePopover.style.left = '';
    imePopover.style.top = '';
  }

  function caretPoint() {
    if (!ui.mirror) {
      ui.mirror = document.createElement('div');
      ui.mirror.className = 'caret-mirror';
      document.body.appendChild(ui.mirror);
    }
    const mirror = ui.mirror;
    const style = getComputedStyle(editor);
    const props = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textAlign', 'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'wordBreak', 'overflowWrap'];
    mirror.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;z-index:-1;white-space:pre-wrap;overflow:hidden;border:0;margin:0;';
    for (const prop of props) mirror.style[prop] = style[prop];
    mirror.style.width = `${editor.clientWidth}px`;
    mirror.style.boxSizing = 'border-box';
    mirror.textContent = editor.value.slice(0, editor.selectionEnd);
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.appendChild(marker);
    const rect = editor.getBoundingClientRect();
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 18) * 1.8;
    const point = {
      left: rect.left + borderLeft + marker.offsetLeft - editor.scrollLeft,
      top: rect.top + borderTop + marker.offsetTop - editor.scrollTop,
      lineHeight
    };
    lastCaretPoint = point;
    return point;
  }

  function positionPopover() {
    if (!ui.composing || imePopover.hidden) return;
    if (window.matchMedia('(max-width: 680px)').matches) {
      imePopover.style.left = '';
      imePopover.style.top = '';
      return;
    }
    const point = caretPoint();
    const width = imePopover.offsetWidth;
    const height = imePopover.offsetHeight;
    let left = point.left;
    let top = point.top + point.lineHeight + 9;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (left < 12) left = 12;
    if (top + height > window.innerHeight - 12) top = point.top - height - 9;
    if (top < 12) top = 12;
    imePopover.style.left = `${Math.round(left)}px`;
    imePopover.style.top = `${Math.round(top)}px`;
  }

  function cancelComposition(silent) {
    if (!ui.composing) return;
    ui.composing = false;
    ui.code = '';
    ui.candidates = [];
    ui.active = 0;
    hidePopover();
    const badge = $('#compose-badge');
    if (badge) badge.hidden = true;
    updateStatus();
    if (!silent) editor.focus({ preventScroll: true });
  }

  function commitCandidate(index, opts) {
    const cand = ui.candidates[index];
    if (!cand) {
      commitRaw();
      return;
    }
    cancelComposition(true);
    if (cand.type === 'snippet' && cand.snippet) {
      insertSnippetContent(cand.snippet);
      return;
    }
    insertText(cand.text);
    recordWordCommit(cand.text, cand.pinyin, 0);
    ui.lastToken = cand.text;
    if (!opts || !opts.silent) {
      setTimeout(refreshPredictions, 40);
    }
    editor.focus({ preventScroll: true });
  }

  function commitRaw() {
    const raw = ui.code;
    cancelComposition(true);
    insertText(raw);
    ui.lastToken = '';
    updateStatus();
    editor.focus({ preventScroll: true });
  }

  function insertText(text) {
    if (!text) return;
    hidePredictions();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText(text, start, end, 'end');
    state.ui.draft = editor.value;
    ui.internalInput = true;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    ui.internalInput = false;
    updateEditorMeta();
    persistDraft();
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 30;
    const before = editor.value.slice(0, editor.selectionStart);
    const lines = before.split('\n').length;
    const target = lines * lineHeight - editor.clientHeight * 0.55;
    if (target > 0) editor.scrollTop = Math.min(editor.scrollHeight, Math.max(0, target));
  }

  /* ── 联想 ───────────────────────────────────────────── */

  function mergedBigrams() {
    const merged = {};
    for (const [prev, row] of Object.entries(SEEDS)) {
      merged[prev] = Object.assign({}, row);
    }
    for (const [prev, row] of Object.entries(state.learning.bigrams)) {
      if (!merged[prev]) merged[prev] = {};
      for (const [next, count] of Object.entries(row)) {
        merged[prev][next] = (merged[prev][next] || 0) + count;
      }
    }
    return merged;
  }

  function refreshPredictions() {
    if (!state.settings.prediction || ui.composing || ui.modalOpen) {
      hidePredictions();
      return;
    }
    if (document.activeElement !== editor) {
      hidePredictions();
      return;
    }
    if (editor.selectionStart !== editor.value.length) {
      hidePredictions();
      return;
    }
    if (!editor.value.trim()) {
      hidePredictions();
      return;
    }
    const context = editor.value.slice(0, editor.selectionStart).slice(-64);
    const predictions = ENGINE.predict({
      lastToken: ui.lastToken,
      bigrams: mergedBigrams(),
      habit: state.learning.words,
      snippets: state.snippets,
      context,
      limit: 6
    }).filter((item) => item.text && item.text !== ui.lastToken && !context.endsWith(item.text));
    ui.predictions = predictions;
    renderPredictions();
  }

  function renderPredictions() {
    const strip = $('#suggest-strip');
    const list = $('#suggest-list');
    if (!strip || !list) return;
    if (!ui.predictions.length) {
      strip.hidden = true;
      list.innerHTML = '';
      return;
    }
    list.innerHTML = ui.predictions.map((item, i) => `<button type="button" class="suggest-chip" data-predict-index="${i}">${esc(item.text)}<small>${esc(item.label || (item.type === 'snippet' ? '段落' : '联想'))}</small></button>`).join('');
    strip.hidden = false;
  }

  function hidePredictions() {
    ui.predictions = [];
    const strip = $('#suggest-strip');
    if (strip) strip.hidden = true;
  }

  function acceptPrediction(index) {
    const pred = ui.predictions[index];
    if (!pred) return;
    if (pred.type === 'snippet' && pred.snippet) {
      insertSnippetContent(pred.snippet);
      return;
    }
    insertText(pred.text);
    recordWordCommit(pred.text, '', pred.text.length);
    ui.lastToken = pred.text;
    showToast(`已采纳「${pred.text}」`);
    refreshPredictions();
  }

  /* ── 学习与统计 ─────────────────────────────────────── */

  function recordWordCommit(text, pinyin, savedKeys) {
    if (!text) return;
    const learning = state.learning;
    learning.commits += 1;
    learning.chars += text.length;
    learning.days[todayKey()] = (learning.days[todayKey()] || 0) + text.length;
    if (savedKeys) learning.savedKeys += savedKeys;
    if (state.settings.learning) {
      const prev = learning.words[text] || { count: 0, last: 0 };
      prev.count += 1;
      prev.last = Date.now();
      if (pinyin) prev.pinyin = pinyin;
      learning.words[text] = prev;
      const last = ui.lastToken;
      if (last && last !== text) {
        if (!learning.bigrams[last]) learning.bigrams[last] = {};
        learning.bigrams[last][text] = (learning.bigrams[last][text] || 0) + 1;
      }
    }
    persist();
    renderRail();
    if (ui.route === 'habit') renderHabit();
  }

  function recordSnippetUse(snippet, contentLength) {
    const learning = state.learning;
    learning.commits += 1;
    learning.chars += contentLength;
    learning.snippetsUsed += 1;
    learning.savedKeys += contentLength;
    learning.days[todayKey()] = (learning.days[todayKey()] || 0) + contentLength;
    snippet.uses = (snippet.uses || 0) + 1;
    snippet.lastUsed = Date.now();
    persist();
    renderRail();
    if (ui.route === 'snippets') renderSnippets();
    if (ui.route === 'habit') renderHabit();
  }

  function renderRail() {
    const days = lastNDays(7);
    const today = todayKey();
    days.forEach((d) => { d.value = state.learning.days[d.key] || 0; });
    const todayValue = state.learning.days[today] || 0;
    const railToday = $('#today-count');
    if (railToday) railToday.textContent = formatCount(todayValue);
    const railLearned = $('#rail-learned');
    if (railLearned) railLearned.textContent = String(Object.keys(state.learning.words).length);
    const railSaved = $('#rail-saved');
    if (railSaved) railSaved.textContent = `省下 ${formatCount(state.learning.savedKeys)} 次按键`;

    const dateEl = $('#today-date');
    if (dateEl) {
      const now = new Date();
      const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
      dateEl.textContent = `${now.getMonth() + 1} 月 ${now.getDate()} 日 · 周${week}`;
    }

    const chart = $('#mini-chart');
    if (chart) {
      const max = Math.max(1, ...days.map((d) => d.value));
      chart.innerHTML = days.map((d) => {
        const height = Math.max(3, Math.round((d.value / max) * 35));
        return `<span class="mini-bar${d.key === today ? ' today' : ''}" style="height:${height}px" title="${d.key} · ${d.value} 字"></span>`;
      }).join('');
    }

    const quick = $('#quick-list');
    if (quick) {
      const items = [...state.snippets].sort((a, b) => (b.pinned - a.pinned) || (b.lastUsed || 0) - (a.lastUsed || 0)).slice(0, 3);
      quick.innerHTML = items.length ? items.map((s) => `<button type="button" class="quick-item" data-quick-id="${esc(s.id)}">
        <span class="quick-icon">${esc(s.title.slice(0, 1))}</span>
        <span class="quick-main"><strong>${esc(s.title)}</strong><small>${esc(s.content.split('\n')[0].slice(0, 24))}</small></span>
        <span class="quick-key">${esc(s.trigger)}</span>
      </button>`).join('') : '<div class="quick-empty">还没有常用段落。</div>';
      quick.onclick = (e) => {
        const item = e.target.closest('[data-quick-id]');
        if (!item) return;
        const snippet = state.snippets.find((s) => s.id === item.dataset.quickId);
        if (snippet) insertSnippetContent(snippet);
      };
    }

    const statusLearning = $('#status-learning');
    if (statusLearning) {
      statusLearning.innerHTML = `<span class="tiny-dot"></span>习惯学习 · ${state.settings.learning ? '开' : '关'}`;
      statusLearning.classList.toggle('is-off', !state.settings.learning);
    }
    const sideLearning = $('#side-learning');
    if (sideLearning) sideLearning.textContent = state.settings.learning ? '习惯学习已开启' : '习惯学习已暂停';
    const tip = $('#tip-text');
    if (tip) tip.innerHTML = TIPS[new Date().getDate() % TIPS.length];
    updateStatus();
  }

  function updateStatus() {
    const mode = $('#btn-mode');
    if (mode) mode.textContent = ui.lang === 'zh' ? '中' : '英';
    const punct = $('#btn-punct');
    if (punct) punct.textContent = state.settings.punctuation ? '中文标点' : '英文标点';
    const code = $('#status-code');
    if (code && !ui.composing) code.textContent = '就绪';
    const badge = $('#compose-badge');
    if (badge) badge.hidden = !ui.composing;
  }

  /* ── 段落 ───────────────────────────────────────────── */

  function categoryClass(cat) {
    return `cat-${CATEGORIES.includes(cat) ? cat : '自定义'}`;
  }

  function renderSnippets() {
    if (!$('#snippet-grid')) return;
    const filters = $('#snippet-filters');
    const counts = { 全部: state.snippets.length };
    CATEGORIES.forEach((c) => { counts[c] = state.snippets.filter((s) => s.category === c).length; });
    const filterItems = ['全部', ...CATEGORIES];
    if (filters) {
      filters.innerHTML = filterItems.map((c) => `<button type="button" class="filter-chip${ui.snippetFilter === c ? ' is-active' : ''}" data-filter="${c}">${c}${counts[c] ? `<span class="chip-count">${counts[c]}</span>` : ''}</button>`).join('');
      filters.onclick = (e) => {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        ui.snippetFilter = btn.dataset.filter;
        renderSnippets();
      };
    }

    const q = ui.snippetSearch.trim().toLowerCase();
    const list = state.snippets.filter((s) => {
      if (ui.snippetFilter !== '全部' && s.category !== ui.snippetFilter) return false;
      if (!q) return true;
      return [s.title, s.content, s.trigger, s.category].some((v) => String(v).toLowerCase().includes(q));
    }).sort((a, b) => (b.pinned - a.pinned) || (b.lastUsed || 0) - (a.lastUsed || 0));

    const grid = $('#snippet-grid');
    const empty = $('#snippets-empty');
    if (!list.length) {
      grid.innerHTML = '';
      empty.hidden = false;
    } else {
      empty.hidden = true;
      grid.innerHTML = list.map((s) => `<article class="snippet-card ${categoryClass(s.category)}">
        <div class="snippet-top">
          <div class="snippet-title-wrap">
            <span class="snippet-mark">${esc(s.title.slice(0, 1))}</span>
            <div><h3 class="snippet-title">${esc(s.title)}</h3><span class="snippet-cat">${esc(s.category)}</span></div>
          </div>
          <button type="button" class="snippet-pin${s.pinned ? ' is-pinned' : ''}" data-pin="${esc(s.id)}" title="${s.pinned ? '取消固定' : '固定到首页'}" aria-label="${s.pinned ? '取消固定' : '固定到首页'}"><svg class="icon"><use href="#i-pin"/></svg></button>
        </div>
        <p class="snippet-content">${esc(s.content)}</p>
        <div class="snippet-foot">
          <span class="snippet-trigger"><b>${esc(s.trigger)}</b>触发</span>
          <span class="snippet-uses">${s.uses ? `用过 ${s.uses} 次` : '还没用过'}</span>
          <div class="snippet-actions">
            <button type="button" class="mini-btn" data-edit="${esc(s.id)}" title="编辑" aria-label="编辑"><svg class="icon"><use href="#i-edit"/></svg></button>
            <button type="button" class="mini-btn" data-delete="${esc(s.id)}" title="删除" aria-label="删除"><svg class="icon"><use href="#i-trash"/></svg></button>
            <button type="button" class="snippet-use" data-use="${esc(s.id)}">插入</button>
          </div>
        </div>
      </article>`).join('');
    }

    grid.onclick = (e) => {
      const pin = e.target.closest('[data-pin]');
      if (pin) {
        const snippet = state.snippets.find((s) => s.id === pin.dataset.pin);
        if (snippet) {
          snippet.pinned = !snippet.pinned;
          persist();
          renderSnippets();
          renderRail();
        }
        return;
      }
      const edit = e.target.closest('[data-edit]');
      if (edit) {
        openSnippetModal(edit.dataset.edit);
        return;
      }
      const del = e.target.closest('[data-delete]');
      if (del) {
        const snippet = state.snippets.find((s) => s.id === del.dataset.delete);
        if (snippet) {
          confirmDialog('删除段落', `确定删除「${snippet.title}」吗？这个操作不能撤销。`, '删除', () => {
            state.snippets = state.snippets.filter((s) => s.id !== snippet.id);
            persist();
            renderSnippets();
            renderRail();
            showToast('段落已删除');
            autoSyncRimeIfEnabled();
          });
        }
        return;
      }
      const use = e.target.closest('[data-use]');
      if (use) {
        const snippet = state.snippets.find((s) => s.id === use.dataset.use);
        if (snippet) insertSnippetContent(snippet);
      }
    };
  }

  function insertSnippetContent(snippet) {
    if (!snippet) return;
    cancelComposition(true);
    let content = snippet.content;
    const atEnd = editor.selectionStart === editor.selectionEnd;
    const atDocEnd = editor.selectionEnd === editor.value.length;
    const before = editor.value.slice(0, editor.selectionStart);
    if (atEnd && content.includes('\n') && before && !before.endsWith('\n')) content = `\n${content}`;
    if (atDocEnd && content.includes('\n') && !content.endsWith('\n')) content += '\n';
    go('input');
    setTimeout(() => {
      editor.focus({ preventScroll: true });
      insertText(content);
      recordSnippetUse(snippet, content.length);
      ui.lastToken = '';
      showToast(`已插入「${snippet.title}」`);
      setTimeout(refreshPredictions, 80);
    }, location.hash === '#/input' ? 0 : 80);
  }

  function openSnippetModal(id) {
    const existing = id ? state.snippets.find((s) => s.id === id) : null;
    const isEdit = !!existing;
    const snippet = existing || {
      id: '',
      title: '',
      category: '自定义',
      trigger: '',
      pinned: false,
      builtin: false,
      uses: 0,
      lastUsed: 0,
      content: ''
    };
    openModal({
      eyebrow: isEdit ? '编辑段落' : '新建段落',
      title: isEdit ? '编辑常用段落' : '新建常用段落',
      body: `<form id="snippet-form" class="form-grid" novalidate>
        <div class="form-field"><label for="sn-title">标题</label><input id="sn-title" maxlength="24" placeholder="例如：收件地址" value="${esc(snippet.title)}"></div>
        <div class="form-field"><label for="sn-category">分类</label><select id="sn-category">${CATEGORIES.map((c) => `<option value="${c}"${c === snippet.category ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="form-field"><label for="sn-trigger">触发码</label><input id="sn-trigger" maxlength="8" placeholder="例如 dz" value="${esc(snippet.trigger)}"><small>2–8 个字母或数字，输入它就能叫出段落</small></div>
        <div class="form-field"><label>首页显示</label><label class="check-line"><input type="checkbox" id="sn-pinned"${snippet.pinned ? ' checked' : ''}> 固定到常用段落快捷区</label></div>
        <div class="form-field full"><label for="sn-content">段落内容</label><textarea id="sn-content" placeholder="把常用的整段文字写在这里…">${esc(snippet.content)}</textarea></div>
        <div class="form-field full"><div class="form-error" id="sn-error"></div></div>
      </form>`,
      footer: `<button type="button" class="btn btn-ghost" data-modal-cancel>取消</button><button type="button" class="btn btn-primary" id="sn-save">保存段落</button>`,
      onMount: () => {
        const form = $('#snippet-form');
        const error = $('#sn-error');
        const save = () => {
          const title = $('#sn-title').value.trim();
          const category = $('#sn-category').value;
          const trigger = $('#sn-trigger').value.toLowerCase().replace(/[^a-z0-9]/g, '');
          const content = $('#sn-content').value.trim();
          const pinned = $('#sn-pinned').checked;
          if (!title) { error.textContent = '给段落起一个标题吧。'; return; }
          if (!/^[a-z0-9]{2,8}$/.test(trigger)) { error.textContent = '触发码需要是 2–8 个字母或数字。'; return; }
          if (!content) { error.textContent = '段落内容不能为空。'; return; }
          const conflict = state.snippets.find((s) => s.trigger === trigger && s.id !== snippet.id);
          if (conflict) { error.textContent = `触发码「${trigger}」已经被「${conflict.title}」使用了。`; return; }
          if (isEdit) {
            Object.assign(snippet, { title, category, trigger, content, pinned });
          } else {
            state.snippets.unshift({
              id: `s-${Date.now().toString(36)}`,
              title,
              category,
              trigger,
              content,
              pinned,
              builtin: false,
              uses: 0,
              lastUsed: 0
            });
          }
          persist();
          closeModal();
          renderSnippets();
          renderRail();
          showToast(isEdit ? '段落已更新' : '段落已创建');
          autoSyncRimeIfEnabled();
        };
        $('#sn-save').addEventListener('click', save);
        form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
        $('#sn-title').focus();
        $('#sn-content').addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            save();
          }
        });
      }
    });
  }

  /* ── 习惯页 ─────────────────────────────────────────── */

  function renderHabit() {
    if (!$('#m-chars')) return;
    const days = lastNDays(7);
    days.forEach((d) => { d.value = state.learning.days[d.key] || 0; });
    const totalChars = state.learning.chars || 0;
    $('#m-chars').textContent = formatCount(totalChars);
    $('#m-words').textContent = formatCount(Object.keys(state.learning.words).length);
    $('#m-snippets').textContent = formatCount(state.learning.snippetsUsed);
    $('#m-saved').textContent = formatCount(state.learning.savedKeys);

    const max = Math.max(1, ...days.map((d) => d.value));
    const today = todayKey();
    const weekTotal = days.reduce((sum, d) => sum + d.value, 0);
    $('#week-total').textContent = `共 ${formatCount(weekTotal)} 字`;
    $('#bar-chart').innerHTML = days.map((d) => {
      const height = d.value === 0 ? 3 : Math.max(6, Math.round((d.value / max) * 100));
      const label = ['日', '一', '二', '三', '四', '五', '六'][d.date.getDay()];
      return `<div class="bar-col${d.key === today ? ' is-today' : ''}">
        <span class="bar-value">${d.value || ''}</span>
        <div class="bar-track"><div class="bar-fill" style="height:${height}%"></div></div>
        <span class="bar-day">${d.key === today ? '今天' : `周${label}`}</span>
      </div>`;
    }).join('');

    const words = Object.entries(state.learning.words)
      .filter(([, v]) => v && v.count)
      .sort((a, b) => b[1].count - a[1].count || (b[1].last || 0) - (a[1].last || 0))
      .slice(0, 8);
    const topList = $('#top-words');
    const topEmpty = $('#top-words-empty');
    if (!words.length) {
      topList.innerHTML = '';
      topEmpty.hidden = false;
    } else {
      topEmpty.hidden = true;
      const maxCount = words[0][1].count;
      topList.innerHTML = words.map(([word, meta]) => `<li class="top-word">
        <div class="top-word-main">
          <div class="top-word-line"><b>${esc(word)}</b><span>${meta.count} 次</span></div>
          <div class="top-word-track"><div class="top-word-fill" style="width:${Math.max(5, Math.round((meta.count / maxCount) * 100))}%"></div></div>
        </div>
      </li>`).join('');
    }

    const learned = Object.entries(state.learning.words)
      .filter(([, v]) => v && v.last)
      .sort((a, b) => (b[1].last || 0) - (a[1].last || 0))
      .slice(0, 28);
    const chips = $('#learned-chips');
    const learnedEmpty = $('#learned-empty');
    if (!learned.length) {
      chips.innerHTML = '';
      learnedEmpty.hidden = false;
    } else {
      learnedEmpty.hidden = true;
      chips.innerHTML = learned.map(([word, meta], i) => `<span class="learned-chip${i < 3 ? ' is-fresh' : ''}">${esc(word)}<small>${meta.count} 次</small></span>`).join('');
    }

    const habitToggle = $('#habit-toggle');
    const predictToggle = $('#habit-predict-toggle');
    if (habitToggle) habitToggle.checked = state.settings.learning;
    if (predictToggle) predictToggle.checked = state.settings.prediction;
  }

  /* ── 设置页 ─────────────────────────────────────────── */

  function renderSettings() {
    syncSettingsControls();
    const custom = state.customWords;
    const count = $('#custom-count');
    if (count) count.textContent = `${custom.length} 个`;
    const list = $('#custom-word-list');
    const empty = $('#custom-empty');
    if (!custom.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
    } else {
      if (empty) empty.hidden = true;
      list.innerHTML = custom.map((w, i) => `<div class="word-row"><b>${esc(w.word)}</b><code>${esc(w.pinyin)}</code><button type="button" class="mini-btn" data-del-word="${i}" title="删除" aria-label="删除"><svg class="icon"><use href="#i-trash"/></svg></button></div>`).join('');
    }
    const about = $('#about-words');
    if (about) about.textContent = formatCount(ENGINE.size);
    $$('[data-theme-btn]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.themeBtn === state.settings.theme));
  }

  function syncSettingsControls() {
    const setCheckbox = (id, value) => { const el = $(id); if (el) el.checked = !!value; };
    setCheckbox('#set-learning', state.settings.learning);
    setCheckbox('#set-prediction', state.settings.prediction);
    setCheckbox('#set-punct', state.settings.punctuation);
    setCheckbox('#set-snippet-suggest', state.settings.snippetSuggest);
    setCheckbox('#set-auto-sync-rime', state.settings.autoSyncRime);
    setCheckbox('#habit-toggle', state.settings.learning);
    setCheckbox('#habit-predict-toggle', state.settings.prediction);
    const slider = $('#set-candidates');
    if (slider) slider.value = String(state.settings.candidateCount);
    const out = $('#out-candidates');
    if (out) out.textContent = String(state.settings.candidateCount);
    const font = $('#set-fontsize');
    if (font) font.value = String(state.settings.fontSize);
    const fontOut = $('#out-fontsize');
    if (fontOut) fontOut.textContent = String(state.settings.fontSize);
  }

  function addCustomWord(word, pinyin) {
    const cleanWord = String(word || '').trim();
    const cleanPinyin = ENGINE.stripTones(pinyin || '');
    if (!/^[\u3400-\u9fff]{1,12}$/.test(cleanWord)) {
      showToast('词语需要是 1–12 个汉字');
      return false;
    }
    if (!/^[a-z]{1,40}$/.test(cleanPinyin)) {
      showToast('拼音只能包含字母，可以用空格分隔');
      return false;
    }
    if (state.customWords.some((w) => w.word === cleanWord)) {
      showToast('这个词已经在自定义词库里了');
      return false;
    }
    state.customWords.push({ word: cleanWord, pinyin: cleanPinyin, addedAt: Date.now() });
    ENGINE.setCustomWords(state.customWords);
    persist();
    renderSettings();
    showToast(`已添加「${cleanWord}」`);
    return true;
  }

  function removeCustomWord(index) {
    const word = state.customWords[index];
    if (!word) return;
    confirmDialog('删除自定义词', `确定删除「${word.word}」吗？`, '删除', () => {
      state.customWords.splice(index, 1);
      ENGINE.setCustomWords(state.customWords);
      persist();
      renderSettings();
      showToast('已删除');
    });
  }

  /* ── 弹窗 ───────────────────────────────────────────── */

  function openModal(opts) {
    const backdrop = $('#modal-backdrop');
    const body = $('#modal-body');
    const foot = $('#modal-foot');
    $('#modal-eyebrow').textContent = opts.eyebrow || '编辑';
    $('#modal-title').textContent = opts.title || '';
    body.innerHTML = opts.body || '';
    foot.innerHTML = opts.footer || '';
    backdrop.hidden = false;
    ui.modalOpen = true;
    const cancel = $('[data-modal-cancel]', foot);
    if (cancel) cancel.addEventListener('click', closeModal);
    $('#modal-close').onclick = closeModal;
    backdrop.onclick = (e) => { if (e.target === backdrop) closeModal(); };
    if (opts.onMount) opts.onMount();
    setTimeout(() => {
      const focusable = $('#modal-body input, #modal-body textarea, #modal-body select, #modal-foot button');
      if (focusable) focusable.focus();
    }, 40);
  }

  function closeModal() {
    $('#modal-backdrop').hidden = true;
    ui.modalOpen = false;
    ui.pendingImport = null;
    $('#modal-body').innerHTML = '';
    $('#modal-foot').innerHTML = '';
    if (ui.route === 'input') editor.focus({ preventScroll: true });
  }

  function confirmDialog(title, message, confirmText, onConfirm, options) {
    const danger = !options || options.danger !== false;
    openModal({
      eyebrow: '请确认',
      title,
      body: `<p class="confirm-text">${esc(message)}</p>`,
      footer: `<button type="button" class="btn btn-ghost" data-modal-cancel>取消</button><button type="button" class="btn ${danger ? 'btn-primary' : 'btn-primary'}" id="modal-confirm">${esc(confirmText || '确定')}</button>`,
      onMount: () => {
        $('#modal-confirm').addEventListener('click', () => {
          closeModal();
          onConfirm();
        });
        $('[data-modal-cancel]').addEventListener('click', closeModal);
      }
    });
  }

  /* ── 数据 ───────────────────────────────────────────── */

  function luaString(value) {
    return JSON.stringify(String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  }

  function buildRimeSnippetLua() {
    const snippets = state.snippets
      .filter((s) => s && s.title && s.content)
      .map((s) => ({
        trigger: String(s.trigger || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8),
        title: String(s.title),
        content: String(s.content).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      }))
      .filter((s) => /^[a-z0-9]{2,8}$/.test(s.trigger));
    const lines = [
      '-- 知意输入法 · Rime 常用段落',
      '-- 由知意设置页同步生成，请勿手工修改。',
      'local snippets = {'
    ];
    for (const s of snippets) {
      lines.push(`  { trigger = ${luaString(s.trigger)}, title = ${luaString(s.title)}, content = ${luaString(s.content)} },`);
    }
    lines.push(
      '}',
      '',
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
    return lines.join('\n') + '\n';
  }

  function setRimeStatus(state, text) {
    $$('[data-rime-status]').forEach((el) => {
      const textEl = el.querySelector('.rime-sync-text') || el;
      textEl.textContent = text;
      el.classList.toggle('is-online', state === 'online');
      el.classList.toggle('is-offline', state === 'offline');
      el.classList.toggle('is-syncing', state === 'syncing');
    });
  }

  async function refreshRimeStatus() {
    if (location.protocol === 'file:') {
      ui.rimeOnline = false;
      ui.rimeChecked = true;
      setRimeStatus('offline', '需通过启动器运行');
      return;
    }
    try {
      const resp = await fetch('/api/health', { cache: 'no-store' });
      const data = await resp.json();
      if (data && data.rimeInstalled && data.weaselInstalled) {
        ui.rimeOnline = true;
        ui.rimeChecked = true;
        setRimeStatus('online', '小狼毫 · 已连接');
      } else {
        ui.rimeOnline = false;
        ui.rimeChecked = true;
        setRimeStatus('offline', data && data.rimeInstalled ? '未找到小狼毫部署器' : '未发现小狼毫');
      }
    } catch (err) {
      ui.rimeOnline = false;
      ui.rimeChecked = true;
      setRimeStatus('offline', '同步服务未启动');
    }
  }

  async function syncRimeSnippets(options) {
    const opts = options || {};
    const manual = !opts.silent;
    if (location.protocol === 'file:') {
      if (manual) showToast('请通过「启动知意输入法」打开页面后再同步');
      setRimeStatus('offline', '需通过启动器运行');
      return;
    }
    const buttons = manual
      ? ['#btn-sync-rime', '#btn-sync-rime-settings'].map((sel) => $(sel)).filter(Boolean)
      : [];
    const oldTexts = buttons.map((b) => b.innerHTML);
    if (manual) {
      buttons.forEach((b) => { b.disabled = true; b.textContent = '同步中…'; });
      setRimeStatus('syncing', '正在同步…');
    }
    try {
      const resp = await fetch('/api/sync-rime', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: buildRimeSnippetLua()
      });
      let data = null;
      try { data = await resp.json(); } catch (err) { /* ignore */ }
      if (!resp.ok || !data || !data.ok) {
        throw new Error((data && data.error) || '当前服务不支持同步，请重启知意启动器');
      }
      ui.rimeOnline = true;
      ui.rimeChecked = true;
      setRimeStatus('online', '小狼毫 · 已同步');
      if (manual) showToast('已将常用段落同步到小狼毫');
    } catch (err) {
      ui.rimeOnline = false;
      ui.rimeChecked = true;
      setRimeStatus('offline', '同步失败');
      if (manual) showToast(`同步失败：${err.message || '请确认小狼毫已安装'}`, 3600);
    } finally {
      buttons.forEach((b, i) => { b.disabled = false; b.innerHTML = oldTexts[i]; });
    }
  }

  function autoSyncRimeIfEnabled() {
    if (!state.settings.autoSyncRime) return;
    if (ui.rimeChecked && !ui.rimeOnline) return;
    syncRimeSnippets({ silent: true });
  }

  function exportData() {
    const payload = {
      app: 'zhiyi-ime',
      version: 1,
      exportedAt: new Date().toISOString(),
      state: {
        settings: state.settings,
        learning: state.learning,
        snippets: state.snippets,
        customWords: state.customWords,
        ui: { lang: state.ui.lang }
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    a.href = url;
    a.download = `知意输入法备份-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('备份已导出');
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const raw = parsed && parsed.state ? parsed.state : parsed;
        if (!raw || typeof raw !== 'object') throw new Error('bad file');
        const pending = normalizeState(raw);
        ui.pendingImport = pending;
        confirmDialog('导入备份', '导入会覆盖当前的段落、习惯与自定义词。建议先导出一份备份。确定继续吗？', '导入并覆盖', () => {
          applyImportedState(pending);
        });
      } catch (err) {
        showToast('无法读取这个备份文件');
      }
    };
    reader.readAsText(file);
  }

  function applyImportedState(next) {
    state = normalizeState(next);
    ui.lang = state.ui.lang;
    ENGINE.setCustomWords(state.customWords);
    editor.value = state.ui.draft || '';
    applyTheme(state.settings.theme);
    applyFontSize(state.settings.fontSize);
    syncSettingsControls();
    updateEditorMeta();
    renderRail();
    renderSnippets();
    renderHabit();
    renderSettings();
    updateStatus();
    go('input');
    showToast('备份已导入');
    autoSyncRimeIfEnabled();
  }

  function resetAll() {
    confirmDialog('恢复默认', '这会清空全部文字草稿、习惯、段落与自定义词，且不能撤销。确定要恢复默认吗？', '恢复默认', () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
      state = freshState();
      ui.lang = state.ui.lang;
      ENGINE.setCustomWords([]);
      editor.value = state.ui.draft;
      applyTheme(state.settings.theme);
      applyFontSize(state.settings.fontSize);
      syncSettingsControls();
      updateEditorMeta();
      renderRail();
      renderSnippets();
      renderHabit();
      renderSettings();
      updateStatus();
      go('input');
      showToast('已恢复默认');
    });
  }

  function clearLearning() {
    confirmDialog('清空学习记录', '会清空已记住的词、联想和统计，但保留草稿、段落与自定义词。确定吗？', '清空', () => {
      state.learning = {
        words: {},
        bigrams: {},
        commits: 0,
        chars: 0,
        savedKeys: 0,
        snippetsUsed: 0,
        days: {}
      };
      ui.lastToken = '';
      hidePredictions();
      persist();
      renderRail();
      renderHabit();
      showToast('学习记录已清空');
    });
  }

  /* ── 事件绑定 ───────────────────────────────────────── */

  function bindEvents() {
    $('#btn-theme').addEventListener('click', () => applyTheme(state.settings.theme === 'dark' ? 'light' : 'dark'));
    $('#btn-theme-side').addEventListener('click', () => applyTheme(state.settings.theme === 'dark' ? 'light' : 'dark'));
    $('#btn-demo').addEventListener('click', loadDemo);
    $('#btn-clear').addEventListener('click', clearDraft);
    $('#btn-copy').addEventListener('click', copyDraft);
    $('#btn-mode').addEventListener('click', toggleLang);
    $('#btn-punct').addEventListener('click', togglePunctuation);

    $('#btn-new-snippet').addEventListener('click', () => openSnippetModal());
    $('#btn-empty-new').addEventListener('click', () => openSnippetModal());
    $('#btn-sync-rime').addEventListener('click', syncRimeSnippets);
    $('#btn-sync-rime-settings').addEventListener('click', syncRimeSnippets);
    $('#snippet-search').addEventListener('input', (e) => {
      ui.snippetSearch = e.target.value;
      renderSnippets();
    });

    $('#habit-toggle').addEventListener('change', (e) => {
      state.settings.learning = e.target.checked;
      persist();
      renderRail();
      renderHabit();
      showToast(state.settings.learning ? '习惯学习已开启' : '习惯学习已暂停');
    });
    $('#habit-predict-toggle').addEventListener('change', (e) => {
      state.settings.prediction = e.target.checked;
      persist();
      renderHabit();
      if (!e.target.checked) hidePredictions();
    });
    $('#btn-habit-clear').addEventListener('click', clearLearning);
    $('#btn-habit-reset').addEventListener('click', clearLearning);

    $('#set-learning').addEventListener('change', (e) => {
      state.settings.learning = e.target.checked;
      persist();
      renderHabit();
      renderRail();
    });
    $('#set-prediction').addEventListener('change', (e) => {
      state.settings.prediction = e.target.checked;
      persist();
      renderHabit();
      if (!e.target.checked) hidePredictions();
    });
    $('#set-punct').addEventListener('change', (e) => {
      state.settings.punctuation = e.target.checked;
      persist();
      updateStatus();
    });
    $('#set-snippet-suggest').addEventListener('change', (e) => {
      state.settings.snippetSuggest = e.target.checked;
      persist();
    });
    $('#set-auto-sync-rime').addEventListener('change', (e) => {
      state.settings.autoSyncRime = e.target.checked;
      persist();
      showToast(e.target.checked ? '段落后自动同步已开启' : '段落后自动同步已关闭');
      if (e.target.checked) autoSyncRimeIfEnabled();
    });
    $('#set-candidates').addEventListener('input', (e) => {
      state.settings.candidateCount = clamp(Number(e.target.value) || 7, 5, 9);
      const out = $('#out-candidates');
      if (out) out.textContent = String(state.settings.candidateCount);
      persist();
      if (ui.composing) refreshCandidates();
    });
    $('#set-fontsize').addEventListener('input', (e) => {
      applyFontSize(e.target.value);
      persist();
    });
    $$('[data-theme-btn]').forEach((btn) => btn.addEventListener('click', () => applyTheme(btn.dataset.themeBtn)));

    $('#custom-word-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const word = $('#custom-word').value;
      const pinyin = $('#custom-pinyin').value;
      if (addCustomWord(word, pinyin)) {
        $('#custom-word').value = '';
        $('#custom-pinyin').value = '';
        $('#custom-word').focus();
      }
    });
    $('#custom-word-list').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del-word]');
      if (del) removeCustomWord(Number(del.dataset.delWord));
    });

    $('#btn-export').addEventListener('click', exportData);
    $('#btn-import').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      importData(file);
    });
    $('#btn-reset-all').addEventListener('click', resetAll);

    $('#modal-close').addEventListener('click', closeModal);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && ui.modalOpen) {
        e.preventDefault();
        closeModal();
        return;
      }
      if (ui.modalOpen) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        go(['input', 'snippets', 'habit', 'settings'][Number(e.key) - 1]);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift' && !ui.shiftUsed && !ui.modalOpen) {
        toggleLang();
      }
    });
    window.addEventListener('hashchange', () => renderRoute(true));
  }

  function toggleLang() {
    ui.lang = ui.lang === 'zh' ? 'en' : 'zh';
    state.ui.lang = ui.lang;
    cancelComposition(true);
    hidePredictions();
    updateStatus();
    persist();
    showToast(ui.lang === 'zh' ? '中文输入' : '英文输入');
  }

  function togglePunctuation() {
    state.settings.punctuation = !state.settings.punctuation;
    persist();
    updateStatus();
    showToast(state.settings.punctuation ? '中文标点已开启' : '已切换为英文标点');
  }

  function clearDraft() {
    cancelComposition(true);
    ui.lastToken = '';
    editor.value = '';
    state.ui.draft = '';
    updateEditorMeta();
    persist();
    hidePredictions();
    showToast('草稿已清空');
    editor.focus({ preventScroll: true });
  }

  function copyDraft() {
    const text = editor.value;
    if (!text) {
      showToast('还没有可以复制的内容');
      return;
    }
    const done = () => showToast('已复制到剪贴板');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    editor.focus();
    editor.select();
    try {
      document.execCommand('copy');
      done();
    } catch (err) {
      showToast('复制失败，请手动选择文本');
    }
    const pos = editor.value.length;
    editor.setSelectionRange(pos, pos);
  }

  function loadDemo() {
    cancelComposition(true);
    ui.lastToken = '';
    go('input');
    const sample = [
      '知意是一支很安静的笔。',
      '',
      '它记得你常写的地址、常开的发票，也记得你偏爱把「好的」放在句首。',
      '',
      '下次见面，它会更快一点。'
    ].join('\n');
    setTimeout(() => {
      const current = editor.value.trim();
      editor.value = current ? `${current}\n\n${sample}` : sample;
      state.ui.draft = editor.value;
      updateEditorMeta();
      persist();
      editor.focus();
      showToast('示例已载入，试试输入 nihao');
    }, location.hash === '#/input' ? 0 : 80);
  }

  /* ── 启动 ───────────────────────────────────────────── */

  function init() {
    state = loadState();
    ui.lang = state.ui.lang;
    ENGINE.setCustomWords(state.customWords);
    applyTheme(state.settings.theme);
    applyFontSize(state.settings.fontSize);
    setupEditor();
    bindEvents();
    syncSettingsControls();
    updateEditorMeta();
    renderRail();
    renderSnippets();
    renderHabit();
    renderSettings();
    updateStatus();
    renderRoute(false);
    refreshRimeStatus();
    if (!location.hash) {
      history.replaceState(null, '', '#/input');
    }
    if (state.ui.firstRun) {
      state.ui.firstRun = false;
      persist();
      setTimeout(() => {
        showToast('试试输入 nihao，按空格上屏；输入 dz 调出收件地址。', 3600);
      }, 600);
    }
    if (window.matchMedia('(min-width: 921px)').matches) {
      setTimeout(() => editor.focus({ preventScroll: true }), 120);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
