/* 墨记 · 公共工具：命名空间、DOM 帮助函数、图标、弹窗、菜单、设置 */
(function () {
  'use strict';
  const Ink = (window.Ink = {});

  Ink.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  Ink.$ = (s, r = document) => r.querySelector(s);
  Ink.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  Ink.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  Ink.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** h('div', {class:'x', onclick}, child, ...) */
  Ink.h = function (tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const sk in v) sk.startsWith('--') ? e.style.setProperty(sk, v[sk]) : (e.style[sk] = v[sk]);
        } else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'value') e.value = v;
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  };
  const h = Ink.h;

  /* ---------- 事件总线 ---------- */
  const bus = {};
  Ink.on = (n, f) => (bus[n] = bus[n] || []).push(f);
  Ink.emit = (n, ...a) => (bus[n] || []).forEach((f) => f(...a));
  Ink.off = (n, f) => { bus[n] = (bus[n] || []).filter((x) => x !== f); };

  /* ---------- localStorage（失败时静默） ---------- */
  Ink.ls = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  Ink.settings = Object.assign(
    { penOnly: 'auto', penSeen: false, defaultTemplate: 'lined', defaultPaper: 'white', defaultSize: 'a4p' },
    Ink.ls.get('inkji.settings') || {}
  );
  Ink.saveSettings = () => Ink.ls.set('inkji.settings', Ink.settings);

  /* ---------- 图标（24×24，描边） ---------- */
  Ink.icons = {
    pen: '<path d="M4 20l1.1-4.4L15.6 5.1a2.1 2.1 0 0 1 3 0l.3.3a2.1 2.1 0 0 1 0 3L8.4 18.9z"/><path d="M13.6 7.1l3.3 3.3"/>',
    highlighter: '<path d="M8.6 15.2l7.6-9.4a1.8 1.8 0 0 1 2.6-.2l.9.8a1.8 1.8 0 0 1 .1 2.6l-8.5 8.6z"/><path d="M8.6 15.2L6.5 19h4.1l.8-1.4"/><path d="M4 21.2h16" opacity=".55"/>',
    eraser: '<path d="M8 20.5h12"/><path d="M5.2 15.6l8.9-8.9a2 2 0 0 1 2.8 0l2.4 2.4a2 2 0 0 1 0 2.8L12 19.2a2 2 0 0 1-1.4.6H8.9a2 2 0 0 1-1.4-.6l-2.3-2.3a.9.9 0 0 1 0-1.3z"/><path d="M9.6 11.2l5.2 5.2"/>',
    lasso: '<path d="M7.4 17.6C4.8 16.4 3 14.3 3 11.9 3 7.8 7 4.5 12 4.5s9 3.3 9 7.4-4 7.4-9 7.4c-.9 0-1.8-.1-2.6-.3"/><circle cx="7.6" cy="18.4" r="1.6"/><path d="M7.2 20c-.3 1-1.2 1.6-2.3 1.6"/>',
    shape: '<rect x="3.5" y="11" width="8.5" height="8.5" rx="1.2"/><circle cx="16.3" cy="8" r="4.6"/>',
    text: '<path d="M5 6.6V4.5h14v2.1"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><circle cx="9" cy="9.8" r="1.7"/><path d="M20.5 15.6l-4.6-4.6L6.2 19.5"/>',
    undo: '<path d="M9 13.5L4.5 9 9 4.5"/><path d="M4.5 9H14a5.5 5.5 0 0 1 0 11h-3.5"/>',
    redo: '<path d="M15 13.5L19.5 9 15 4.5"/><path d="M19.5 9H10a5.5 5.5 0 0 0 0 11h3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    pages: '<rect x="3.5" y="4" width="7" height="9" rx="1.2"/><rect x="13.5" y="4" width="7" height="9" rx="1.2"/><path d="M3.5 17h7M13.5 17h7M3.5 20h7M13.5 20h7" opacity=".6"/>',
    addpage: '<path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13.5 3.5V9H19"/><path d="M12 12v6M9 15h6"/>',
    back: '<path d="M14.5 18l-6-6 6-6"/>',
    next: '<path d="M9.5 18l6-6-6-6"/>',
    more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.6h5V7"/><path d="M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.8a1.8 1.8 0 0 0-1.8-1.8H5.8A1.8 1.8 0 0 0 4 5.8v7.9a1.8 1.8 0 0 0 1.8 1.8h2.7"/>',
    cut: '<circle cx="6.5" cy="17.5" r="2.6"/><circle cx="17.5" cy="17.5" r="2.6"/><path d="M8.4 15.6L19 4M15.6 15.6L5 4"/>',
    paste: '<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3.5h6v1"/><path d="M9 11h6M9 15h4"/>',
    star: '<path d="M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6L12 16.6l-5 2.7.9-5.6-4-4 5.6-.8z"/>',
    folder: '<path d="M3.5 7.3A1.8 1.8 0 0 1 5.3 5.5h3.9l2.1 2.4h7.4a1.8 1.8 0 0 1 1.8 1.8v7.8a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8z"/>',
    search: '<circle cx="11" cy="11" r="6.3"/><path d="M20 20l-4.3-4.3"/>',
    export: '<path d="M12 14.5V3.8M7.8 7.9L12 3.8l4.2 4.1"/><path d="M5 12.5v6.2a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8v-6.2"/>',
    import: '<path d="M12 3.8v10.7M7.8 10.4l4.2 4.1 4.2-4.1"/><path d="M5 12.5v6.2a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8v-6.2"/>',
    settings: '<path d="M4 7h9.5M17.5 7H20M4 17h3M11 17h9"/><circle cx="15.5" cy="7" r="2.1"/><circle cx="9" cy="17" r="2.1"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    book: '<path d="M5.5 4.5h11a2 2 0 0 1 2 2v14h-11a2 2 0 0 1-2-2z"/><path d="M5.5 18.5a2 2 0 0 1 2-2h11"/>',
    pdf: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/><path d="M12 11v6M9.5 14.5L12 17l2.5-2.5"/>',
    check: '<path d="M5 12.5l4.4 4.4L19 7.4"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    edit: '<path d="M4 20h4.2L19 9.2a2.1 2.1 0 0 0 0-3l-1.2-1.2a2.1 2.1 0 0 0-3 0L4 15.8z"/>',
    palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.4-1.2-1.5-1.2-2.6 0-.9.7-1.6 1.6-1.6h2.1a4.2 4.2 0 0 0 4.2-4.2C20.5 6.6 16.7 3.5 12 3.5z"/><circle cx="7.7" cy="11.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.4" cy="7.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.7" cy="7.6" r="1.1" fill="currentColor" stroke="none"/>',
    move: '<path d="M12 3.5v17M3.5 12h17M9 6.3l3-2.8 3 2.8M9 17.7l3 2.8 3-2.8M6.3 9l-2.8 3 2.8 3M17.7 9l2.8 3-2.8 3"/>',
    line: '<path d="M5 19L19 5"/>',
    arrow: '<path d="M5 19L19 5"/><path d="M10.5 5H19v8.5"/>',
    rect: '<rect x="4.5" y="6" width="15" height="12" rx="1"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
    triangle: '<path d="M12 5l8 14H4z"/>',
    database: '<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/><path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>',
  };
  Ink.icon = (name, cls) =>
    `<svg class="ic ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${Ink.icons[name] || ''}</svg>`;
  Ink.hydrateIcons = (root = document) => {
    root.querySelectorAll('i[data-icon]').forEach((i) => (i.outerHTML = Ink.icon(i.dataset.icon)));
  };

  /* ---------- 提示条 ---------- */
  let toastT;
  Ink.toast = (msg, ms = 2400, action) => {
    const t = Ink.$('#toast');
    t.textContent = msg;
    if (action) {
      t.append(Ink.h('button', { class: 'toast-act', onclick: () => { t.classList.remove('show'); action.onClick(); } }, action.label));
    }
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), ms);
  };

  /* ---------- 弹窗 ---------- */
  Ink.modal = function ({ title, body, actions, wide }) {
    return new Promise((resolve) => {
      const root = Ink.$('#modal-root');
      let done = false;
      const close = (v) => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        back.remove();
        resolve(v);
      };
      const val = (a) => (typeof a.value === 'function' ? a.value() : a.value);
      const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'modal-head' },
          h('h2', { class: 'modal-title' }, title),
          h('button', { class: 'icon-btn sm', 'aria-label': '关闭', html: Ink.icon('close'), onclick: () => close(null) })),
        h('div', { class: 'modal-body' }, body || ''),
        actions && actions.length
          ? h('div', { class: 'modal-actions' }, actions.map((a) => h('button', { class: 'btn ' + (a.kind || 'ghost'), onclick: () => close(val(a)) }, a.label)))
          : null
      );
      const back = h('div', { class: 'modal-back', onpointerdown: (e) => { if (e.target === back) close(null); } }, box);
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
        else if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
          const p = (actions || []).find((a) => (a.kind || '').includes('primary'));
          if (p) { e.preventDefault(); close(val(p)); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      root.append(back);
      Ink.modal.close = close;
      const f = box.querySelector('input[type=text],input:not([type]),textarea');
      if (f) setTimeout(() => { f.focus(); f.select && f.select(); }, 40);
    });
  };
  Ink.confirm = (title, text, ok = '确定', danger = false) =>
    Ink.modal({ title, body: h('p', { class: 'modal-text' }, text), actions: [{ label: '取消', value: false }, { label: ok, kind: danger ? 'danger' : 'primary', value: true }] }).then((v) => !!v);
  Ink.prompt = (title, value = '', placeholder = '') => {
    const inp = h('input', { class: 'input', type: 'text', value, placeholder, maxlength: '60' });
    return Ink.modal({ title, body: inp, actions: [{ label: '取消', value: null }, { label: '确定', kind: 'primary', value: () => inp.value.trim() }] });
  };
  Ink.alert = (title, text) => Ink.modal({ title, body: h('p', { class: 'modal-text' }, text), actions: [{ label: '知道了', kind: 'primary', value: true }] });

  Ink.progress = (title) => {
    const fill = h('i');
    const txt = h('div', { class: 'prog-text' }, '准备中…');
    const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal' }, h('div', { class: 'modal-head' }, h('h2', { class: 'modal-title' }, title)), h('div', { class: 'modal-body' }, txt, h('div', { class: 'prog-bar' }, fill))));
    Ink.$('#modal-root').append(back);
    return {
      set(t, f) { txt.textContent = t; fill.style.width = Math.round(Ink.clamp(f, 0, 1) * 100) + '%'; },
      close() { back.remove(); },
    };
  };

  /* ---------- 弹出菜单 ---------- */
  let menuEl = null;
  const outside = (e) => { if (menuEl && !menuEl.contains(e.target)) Ink.closeMenu(); };
  Ink.closeMenu = () => {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    document.removeEventListener('pointerdown', outside, true);
  };
  Ink.menu = function (anchor, items) {
    Ink.closeMenu();
    const m = h('div', { class: 'menu', role: 'menu' });
    for (const it of items) {
      if (!it) continue;
      if (it.sep) { m.append(h('div', { class: 'menu-sep' })); continue; }
      if (it.node) { m.append(it.node); continue; }
      m.append(h('button', {
        class: 'menu-item' + (it.danger ? ' danger' : ''), role: 'menuitem', disabled: it.disabled || null,
        html: (it.icon ? Ink.icon(it.icon) : '<span class="ic"></span>') + `<span class="mi-label">${Ink.esc(it.label)}</span>` + (it.hint ? `<kbd>${Ink.esc(it.hint)}</kbd>` : '') + (it.checked ? Ink.icon('check', 'mi-check') : ''),
        onclick: (e) => { e.stopPropagation(); Ink.closeMenu(); it.onClick && it.onClick(); },
      }));
    }
    document.body.append(m);
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let x = r.right - mw;
    if (x < 8) x = Math.min(r.left, innerWidth - mw - 8);
    x = Math.max(8, x);
    let y = r.bottom + 6;
    if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 6);
    m.style.left = x + 'px';
    m.style.top = y + 'px';
    menuEl = m;
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    return m;
  };

  /* ---------- 文件 ---------- */
  Ink.pickFile = (accept, multiple = false) =>
    new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept, style: { position: 'fixed', left: '-9999px' } });
      if (multiple) inp.multiple = true;
      inp.addEventListener('change', () => { resolve(multiple ? Array.from(inp.files) : inp.files[0] || null); inp.remove(); });
      inp.addEventListener('cancel', () => { resolve(null); inp.remove(); });
      document.body.append(inp);
      inp.click();
    });
  Ink.download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, style: { display: 'none' } });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  };
  Ink.safeName = (s) => (s || '未命名').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);

  Ink.fmtDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts), n = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    if (d.toDateString() === n.toDateString()) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const y = new Date(n); y.setDate(n.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return '昨天';
    if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };
  Ink.fmtBytes = (b) => (b < 1024 * 1024 ? (b / 1024).toFixed(0) + ' KB' : b < 1024 ** 3 ? (b / 1024 / 1024).toFixed(1) + ' MB' : (b / 1024 ** 3).toFixed(2) + ' GB');

  Ink.setView = (v) => {
    Ink.currentView = v;
    Ink.$('#library').hidden = v !== 'library';
    Ink.$('#editor').hidden = v !== 'editor';
    Ink.closeMenu();
  };

  /* ---------- 书写设置 ---------- */
  Ink.openSettings = async () => {
    const S = Ink.settings;
    const opts = [
      ['auto', '自动', '一旦检测到触控笔（Apple Pencil、手写笔），手指就只用来滚动和缩放'],
      ['on', '只用触控笔书写', '手指永远不会留下笔迹，适合手掌容易碰到屏幕的情况'],
      ['off', '手指也能书写', '单指书写，双指缩放和平移'],
    ];
    let pick = S.penOnly;
    const list = h('div', { class: 'radio-list' }, opts.map(([v, t, d]) =>
      h('label', { class: 'radio' },
        h('input', { type: 'radio', name: 'penmode', value: v, checked: pick === v || null, onchange: () => (pick = v) }),
        h('span', { class: 'radio-text' }, h('b', null, t), h('small', null, d)))));
    const ok = await Ink.modal({
      title: '书写设置',
      body: h('div', { class: 'form' }, h('div', { class: 'field-label' }, '手指和触控笔'), list,
        h('p', { class: 'hint' }, S.penSeen ? '这台设备已识别到触控笔。' : '这台设备还没有用过触控笔。')),
      actions: [{ label: '取消', value: false }, { label: '保存', kind: 'primary', value: true }],
    });
    if (ok) { S.penOnly = pick; Ink.saveSettings(); Ink.toast('设置已保存'); }
  };
})();
