/* 墨记 · 打字转手写：手写字体（内置 + 导入）和编辑对话框 */
(function () {
  'use strict';
  const HW = (Ink.hw = {});
  const R = Ink.render, h = Ink.h;
  const FALLBACK = '"KaiTi", "STKaiti", "Kaiti SC", serif';

  /* 内置字体来自 Google Fonts（开源可商用）。国内优先用 googleapis.cn 镜像 */
  HW.BUILTIN = [
    { key: 'longcang', name: '钢笔行书', gf: 'Long Cang' },
    { key: 'zhimangxing', name: '行书', gf: 'Zhi Mang Xing' },
    { key: 'mashanzheng', name: '毛笔楷书', gf: 'Ma Shan Zheng' },
    { key: 'liujian', name: '草书', gf: 'Liu Jian Mao Cao' },
    { key: 'kuaile', name: '圆润可爱', gf: 'ZCOOL KuaiLe' },
    { key: 'kai', name: '楷体', family: FALLBACK, local: true },
    { key: 'system', name: '印刷体', family: R.FONT, local: true },
  ];
  HW.user = []; // {key:'u:<id>', name, family, blobKey}

  HW.find = (key) => HW.BUILTIN.find((f) => f.key === key) || HW.user.find((f) => f.key === key);
  HW.family = function (key) {
    const f = HW.find(key);
    if (!f) return FALLBACK;
    if (f.family) return f.family;
    return `"${f.gf}", ${FALLBACK}`;
  };

  /* ---------- 加载 Google 字体样式表：依次尝试几个地址 ---------- */
  const HOSTS = ['https://fonts.googleapis.cn', 'https://fonts.googleapis.com', 'https://fonts.loli.net'];
  let cssP = null;
  function tryLink(href, ms) {
    return new Promise((res) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      let done = false;
      const fin = (ok) => { if (done) return; done = true; if (!ok) l.remove(); res(ok); };
      l.onload = () => fin(true);
      l.onerror = () => fin(false);
      setTimeout(() => fin(false), ms);
      document.head.append(l);
    });
  }
  function loadCss() {
    if (cssP) return cssP;
    const q = HW.BUILTIN.filter((f) => f.gf).map((f) => 'family=' + f.gf.replace(/ /g, '+')).join('&');
    cssP = (async () => {
      for (const host of HOSTS) if (await tryLink(`${host}/css2?${q}&display=swap`, 7000)) return true;
      return false;
    })();
    cssP.then((ok) => { if (!ok) setTimeout(() => (cssP = null), 60000); }); // 失败后一分钟内不再重试
    return cssP;
  }

  /** 确保某字体里这段文字用到的字形都已下载；成功后通知重绘 */
  const ready = new Map();
  HW.ensure = function (key, text) {
    const f = HW.find(key);
    if (!f || f.local) return Promise.resolve(true);
    const sample = Array.from(new Set(String(text || '字').replace(/\s/g, ''))).join('').slice(0, 400) || '字';
    const id = key + '|' + sample;
    if (ready.has(id)) return ready.get(id);
    const p = (async () => {
      try {
        if (f.gf && !(await loadCss())) return false;
        const fam = f.gf || f.cssName;
        await document.fonts.load(`32px "${fam}"`, sample);
        const ok = document.fonts.check(`32px "${fam}"`, sample);
        R.clearTextCache();
        Ink.emit('font-loaded', key);
        return ok;
      } catch (e) { return false; }
    })();
    ready.set(id, p);
    return p;
  };
  const touched = new Set();
  HW.touch = (key, text) => {
    const id = key + '|' + (text || '').length + '|' + (text || '').slice(0, 40);
    if (touched.has(id)) return;
    touched.add(id);
    HW.ensure(key, text);
  };

  /* ---------- 导入自己的字体：保存在本地数据库，备份时一起导出 ---------- */
  async function addUserFont(blobKey, blob) {
    const m = String(blobKey).match(/^font_([^_]+)_(.*)$/);
    if (!m) return null;
    const id = m[1], name = decodeURIComponent(m[2]);
    const cssName = 'InkU_' + id;
    const face = new FontFace(cssName, await blob.arrayBuffer());
    await face.load();
    document.fonts.add(face);
    const f = { key: 'u:' + id, name, cssName, family: `"${cssName}", ${FALLBACK}`, blobKey, local: true };
    HW.user = HW.user.filter((x) => x.key !== f.key).concat(f);
    return f;
  }
  HW.loadUserFonts = async function () {
    try {
      const keys = (await Ink.db.keys('blobs')).filter((k) => String(k).startsWith('font_'));
      for (const k of keys) {
        try { await addUserFont(k, await Ink.db.get('blobs', k)); } catch (e) { console.warn('字体加载失败', k, e); }
      }
      if (keys.length) { R.clearTextCache(); Ink.emit('font-loaded', 'user'); }
    } catch (e) { /* 数据库不可用 */ }
  };
  HW.importFont = async function () {
    const file = await Ink.pickFile('.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2');
    if (!file) return null;
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) { Ink.alert('无法导入', '请选择 .ttf、.otf、.woff 或 .woff2 字体文件。'); return null; }
    const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').slice(0, 40) || '我的字体';
    const blobKey = `font_${Ink.uid()}_${encodeURIComponent(name)}`;
    try {
      const f = await addUserFont(blobKey, file);
      await Ink.db.put('blobs', file, blobKey);
      Ink.toast(`已导入字体「${name}」`);
      return f;
    } catch (e) {
      console.error(e);
      Ink.alert('无法导入', '这个文件无法作为字体读取，可能已损坏或格式不受支持。');
      return null;
    }
  };
  HW.removeFont = async function (f) {
    if (!(await Ink.confirm('删除字体', `删除「${f.name}」？已经用这个字体写的文字会改用楷体显示。`, '删除', true))) return false;
    await Ink.db.del('blobs', f.blobKey);
    HW.user = HW.user.filter((x) => x.key !== f.key);
    R.clearTextCache();
    Ink.emit('font-loaded', 'user');
    return true;
  };

  /* ---------- 对话框 ---------- */
  const DEFAULTS = { font: 'longcang', size: 22, color: '#1d1d1f', slant: 4, lh: 1.6, jitter: 0.5, weight: 0.3, wPct: 82 };
  const COLORS = ['#1d1d1f', '#1f4fb8', '#c9302c', '#22805a', '#7a3fbf', '#5a4a3a'];
  const SAMPLE = '# 第三章 函数的极限\n极限描述的是自变量无限接近某个值时，函数值的变化趋势。\n- 左极限与右极限都存在且相等\n- 例：lim (1 + 1/n)^n = e ≈ 2.718';

  /**
   * 打开「打字转手写」对话框。
   * @param {object} opt.obj 要修改的已有文字对象（可选）
   * @param {number} opt.pageW 页面宽度（页面单位），用来决定换行宽度
   * @returns {Promise<object|null|'delete'>} 新的文字对象属性；取消返回 null
   */
  HW.open = function ({ obj, pageW }) {
    const saved = Ink.ls.get('inkji.hw') || {};
    const st = obj
      ? { font: obj.font, size: obj.size, color: obj.color, slant: obj.slant || 0, lh: obj.lh || 1.6, jitter: obj.jitter ?? 0.5, weight: obj.weight || 0, wPct: Math.round((obj.w / pageW) * 100), text: obj.text }
      : Object.assign({}, DEFAULTS, saved, { text: '' });
    st.wPct = Ink.clamp(st.wPct || 82, 30, 100);
    const seed = obj ? obj.seed : Math.floor(Math.random() * 2147483646) + 1;

    const ta = h('textarea', { class: 'input hw-text', rows: '5', placeholder: '在这里输入文字，会实时显示成手写效果。\n「# 」开头是标题，「- 」开头是列表，「1. 」开头是编号。', oninput: () => { st.text = ta.value; draw(); } });
    ta.value = st.text || '';
    const cv = h('canvas', { class: 'hw-preview-cv' });
    const box = h('div', { class: 'hw-preview' }, cv);
    const note = h('p', { class: 'hint hw-note' });

    const fontRow = h('div', { class: 'hw-fonts' });
    const drawFonts = () => {
      fontRow.innerHTML = '';
      for (const f of [...HW.BUILTIN, ...HW.user]) {
        const b = h('button', { type: 'button', class: 'hw-font' + (st.font === f.key ? ' on' : ''), style: { fontFamily: HW.family(f.key) }, onclick: () => { st.font = f.key; drawFonts(); draw(); } }, f.name);
        if (f.key.startsWith('u:')) {
          b.append(h('span', { class: 'hw-font-x', title: '删除这个字体', html: Ink.icon('close'), onclick: async (e) => { e.stopPropagation(); if (await HW.removeFont(f)) { if (st.font === f.key) st.font = 'longcang'; drawFonts(); draw(); } } }));
        }
        fontRow.append(b);
      }
      fontRow.append(h('button', { type: 'button', class: 'hw-font add', onclick: async () => { const f = await HW.importFont(); if (f) { st.font = f.key; drawFonts(); draw(); } }, html: Ink.icon('plus') + '<span>导入字体</span>' }));
    };
    drawFonts();
    // 预先下载字体名称这几个字，按钮上就能看到各自的字体效果
    HW.BUILTIN.forEach((f) => HW.ensure(f.key, f.name).then(() => drawFonts()));

    const colorRow = h('div', { class: 'chip-row' });
    const drawColors = () => {
      colorRow.innerHTML = '';
      COLORS.forEach((c) => colorRow.append(h('button', { type: 'button', class: 'swatch' + (st.color === c ? ' on' : ''), style: { '--sw': c }, 'aria-label': '颜色 ' + c, onclick: () => { st.color = c; drawColors(); draw(); } })));
    };
    drawColors();

    const slider = (label, key, min, max, step, fmt) => {
      const out = h('span', { class: 'hw-val' }, fmt(st[key]));
      const inp = h('input', { type: 'range', min, max, step, value: st[key], oninput: (e) => { st[key] = +e.target.value; out.textContent = fmt(st[key]); draw(); } });
      return h('label', { class: 'hw-slider' }, h('span', { class: 'hw-lab' }, label), inp, out);
    };

    let rq = 0;
    function draw() {
      if (rq) return;
      rq = requestAnimationFrame(() => {
        rq = 0;
        const o = toObj();
        o.x = 0; o.y = 0;
        const bw = Math.max(200, box.clientWidth - 2);
        const k = (bw - 32) / pageW;
        const L = R.hwLayout(o);
        const hh = Math.max(110, (L.h + 20) * k + 24);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.width = Math.round(bw * dpr); cv.height = Math.round(hh * dpr);
        cv.style.width = bw + 'px'; cv.style.height = hh + 'px';
        const x = cv.getContext('2d');
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
        x.fillStyle = '#fffdf7'; x.fillRect(0, 0, bw, hh);
        x.strokeStyle = 'rgba(70,100,150,0.16)'; x.lineWidth = 1;
        const gap = o.size * o.lh * k;
        x.beginPath();
        for (let y = 16 + o.size * 1.25 * k; y < hh; y += gap) { x.moveTo(0, Math.round(y) + 0.5); x.lineTo(bw, Math.round(y) + 0.5); }
        x.stroke();
        x.strokeStyle = 'rgba(58,98,214,0.35)'; x.setLineDash([4, 4]);
        x.strokeRect(16 + 0.5, 4.5, o.w * k, hh - 9);
        x.setLineDash([]);
        x.setTransform(dpr * k, 0, 0, dpr * k, 16 * dpr, 12 * dpr);
        if (!o.text) { o.text = SAMPLE; o.color = '#9aa0aa'; }
        R.drawHW(x, o);
      });
    }
    function toObj() {
      return { type: 'text', hw: true, font: st.font, size: st.size, color: st.color, slant: st.slant, lh: st.lh, jitter: st.jitter, weight: st.weight, w: Math.round((pageW * st.wPct) / 100 - 0), text: st.text || '', seed };
    }
    const onFont = () => draw();
    Ink.on('font-loaded', onFont);
    HW.ensure(st.font, (st.text || '') + SAMPLE).then((ok) => {
      const f = HW.find(st.font);
      note.textContent = ok || (f && f.local) ? '' : '手写字体需要联网下载（只在第一次使用时）。现在暂时用楷体显示，联网后会自动换成所选字体。';
      draw();
    });

    const body = h('div', { class: 'form hw-form' },
      ta,
      box,
      note,
      Ink.ui.field('字体', fontRow),
      h('div', { class: 'hw-grid' },
        slider('字号', 'size', 12, 64, 1, (v) => v),
        slider('倾斜', 'slant', -10, 20, 1, (v) => v + '°'),
        slider('行距', 'lh', 1.1, 2.6, 0.1, (v) => v.toFixed(1)),
        slider('自然度', 'jitter', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'),
        slider('笔画粗细', 'weight', 0, 1.6, 0.1, (v) => (v === 0 ? '原样' : '+' + v.toFixed(1))),
        slider('文字宽度', 'wPct', 30, 100, 1, (v) => v + '%')),
      Ink.ui.field('颜色', colorRow));
    setTimeout(draw, 30);
    const ro = new ResizeObserver(() => draw());
    ro.observe(box);

    return Ink.modal({
      title: obj ? '修改手写文字' : '打字转手写', wide: true, body,
      actions: [
        obj ? { label: '删除', kind: 'ghost danger-text', value: 'delete' } : null,
        { label: '取消', value: null },
        { label: obj ? '更新' : '插入到页面', kind: 'primary', value: () => (st.text.trim() ? toObj() : obj ? 'delete' : null) },
      ].filter(Boolean),
    }).then((res) => {
      ro.disconnect();
      Ink.off('font-loaded', onFont); // 关闭后不再重绘预览
      if (res && res !== 'delete') {
        const { text, ...style } = st;
        Ink.ls.set('inkji.hw', style);
      }
      return res;
    });
  };
})();
