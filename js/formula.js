/* 墨记 · 公式：输入 LaTeX，用 MathJax 转成矢量图（SVG）放进页面；保存原式，随时可以再改 */
(function () {
  'use strict';
  const FX = (Ink.formula = {});
  const h = Ink.h;
  const SOURCES = ['vendor/tex-svg.js', 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js', 'https://unpkg.com/mathjax@3.2.2/es5/tex-svg.js'];
  const COLORS = ['#1d1d1f', '#1f4fb8', '#c9302c', '#22805a', '#7a3fbf'];

  let mjP = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = res;
      s.onerror = () => { s.remove(); rej(new Error(src)); };
      document.head.append(s);
    });
  }
  /** 加载 MathJax（第一次用公式时才加载，约 2 MB；优先用本地 vendor 里的副本） */
  FX.load = function () {
    if (window.MathJax && window.MathJax.tex2svg) return Promise.resolve(window.MathJax);
    if (mjP) return mjP;
    window.MathJax = {
      tex: { packages: { '[+]': ['ams'] } },
      svg: { fontCache: 'none' }, // 每个公式自带字形，单独保存也能显示
      startup: { typeset: false },
    };
    mjP = (async () => {
      for (const src of SOURCES) {
        try {
          await loadScript(src);
          if (window.MathJax.startup && window.MathJax.startup.promise) await window.MathJax.startup.promise;
          if (window.MathJax.tex2svg) return window.MathJax;
        } catch (e) { /* 试下一个地址 */ }
      }
      throw new Error('公式组件加载失败');
    })();
    mjP.catch(() => (mjP = null));
    return mjP;
  };

  /**
   * 把 LaTeX 转成 SVG。size 是公式字号（页面单位），返回 {svg 文本, w, h（页面单位）, error}
   */
  FX.render = function (tex, size, color) {
    const MJ = window.MathJax;
    const node = MJ.tex2svg(tex, { display: true });
    const svg = node.querySelector('svg');
    const err = node.querySelector('[data-mjx-error]');
    const ex = size * 0.45; // 1ex 约等于 0.45 个字号
    const wEx = parseFloat(svg.getAttribute('width')) || 1, hEx = parseFloat(svg.getAttribute('height')) || 1;
    const w = wEx * ex, hh = hEx * ex;
    const k = 3; // 以 3 倍尺寸保存，放大后也清晰
    svg.setAttribute('width', (w * k).toFixed(1));
    svg.setAttribute('height', (hh * k).toFixed(1));
    svg.setAttribute('color', color);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.removeAttribute('style');
    svg.setAttribute('style', `color:${color}`);
    const text = new XMLSerializer().serializeToString(svg).replace(/currentColor/g, color);
    return { svg: text, w, h: hh, error: err ? err.getAttribute('data-mjx-error') || '公式有语法错误' : null };
  };

  const SNIPPETS = [
    ['分数', '\\frac{a}{b}'], ['根号', '\\sqrt{x}'], ['n 次根', '\\sqrt[n]{x}'], ['上标', 'x^{2}'], ['下标', 'a_{n}'],
    ['极限', '\\lim_{x \\to 0}'], ['积分', '\\int_{a}^{b} f(x)\\,dx'], ['求和', '\\sum_{i=1}^{n}'], ['导数', "f'(x)"], ['偏导', '\\frac{\\partial f}{\\partial x}'],
    ['向量', '\\vec{a}'], ['矩阵', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'], ['方程组', '\\begin{cases} x + y = 1 \\\\ x - y = 3 \\end{cases}'],
    ['α', '\\alpha'], ['β', '\\beta'], ['θ', '\\theta'], ['π', '\\pi'], ['Δ', '\\Delta'], ['∞', '\\infty'],
    ['≤', '\\le'], ['≥', '\\ge'], ['≠', '\\ne'], ['≈', '\\approx'], ['±', '\\pm'], ['×', '\\times'], ['÷', '\\div'], ['→', '\\to'], ['°', '^{\\circ}'],
  ];
  const EXAMPLE = '\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^{n} = e';

  /**
   * 打开公式编辑框。返回 {tex, size, color, svg, w, h}；删除返回 'delete'；取消返回 null
   */
  FX.open = function (obj) {
    const saved = Ink.ls.get('inkji.fx') || {};
    const st = { tex: obj ? obj.tex : '', size: obj ? obj.fsize : saved.size || 26, color: obj ? obj.color : saved.color || COLORS[0] };
    let result = null;

    const ta = h('textarea', { class: 'input fx-input', rows: '3', spellcheck: 'false', placeholder: '输入 LaTeX，例如：' + EXAMPLE, oninput: () => { st.tex = ta.value; draw(); } });
    ta.value = st.tex;
    const preview = h('div', { class: 'fx-preview' });
    const status = h('p', { class: 'hint fx-status' }, '正在加载公式组件…');
    const insertAt = (snip) => {
      const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? ta.value.length;
      ta.value = ta.value.slice(0, s) + snip + ta.value.slice(e);
      ta.focus();
      const pos = s + snip.length;
      ta.setSelectionRange(pos, pos);
      st.tex = ta.value;
      draw();
    };
    const pad = h('div', { class: 'fx-pad' }, SNIPPETS.map(([l, s]) => h('button', { type: 'button', class: 'fx-key', title: s, onclick: () => insertAt(s) }, l)));
    const colorRow = h('div', { class: 'chip-row' });
    const drawColors = () => {
      colorRow.innerHTML = '';
      COLORS.forEach((c) => colorRow.append(h('button', { type: 'button', class: 'swatch' + (st.color === c ? ' on' : ''), style: { '--sw': c }, 'aria-label': '颜色 ' + c, onclick: () => { st.color = c; drawColors(); draw(); } })));
    };
    drawColors();
    const sizeOut = h('span', { class: 'hw-val' }, String(st.size));
    const sizeIn = h('input', { type: 'range', min: '14', max: '72', step: '1', value: st.size, oninput: (e) => { st.size = +e.target.value; sizeOut.textContent = st.size; draw(); } });

    let ready = false;
    function draw() {
      if (!ready) return;
      const tex = st.tex.trim() || EXAMPLE;
      try {
        const r = FX.render(tex, st.size, st.tex.trim() ? st.color : '#9aa0aa');
        preview.innerHTML = r.svg;
        const svg = preview.querySelector('svg');
        if (svg) { svg.style.width = Math.min(r.w, 900) + 'px'; svg.style.height = 'auto'; svg.style.maxWidth = '100%'; }
        status.textContent = r.error ? '公式有误：' + r.error : st.tex.trim() ? '' : '上面是示例。点下方按钮可以插入常用符号。';
        status.classList.toggle('danger-text', !!r.error);
        result = st.tex.trim() && !r.error ? { tex: st.tex.trim(), size: st.size, color: st.color, svg: r.svg, w: r.w, h: r.h } : null;
      } catch (e) {
        status.textContent = '公式有误：' + (e.message || e);
        result = null;
      }
    }
    FX.load().then(() => { ready = true; draw(); }).catch(() => {
      status.textContent = '公式组件没能加载。第一次使用公式需要联网（约 2 MB）；想完全离线，请按 README 把 MathJax 放进 vendor 文件夹。';
      status.classList.add('danger-text');
    });

    const body = h('div', { class: 'form' }, ta, preview, status, Ink.ui.field('常用符号', pad),
      h('div', { class: 'hw-grid' }, h('label', { class: 'hw-slider' }, h('span', { class: 'hw-lab' }, '字号'), sizeIn, sizeOut), Ink.ui.field('颜色', colorRow)));
    return Ink.modal({
      title: obj ? '修改公式' : '插入公式', wide: true, body,
      actions: [
        obj ? { label: '删除', kind: 'ghost danger-text', value: 'delete' } : null,
        { label: '取消', value: null },
        { label: obj ? '更新' : '插入到页面', kind: 'primary', value: () => result || (obj && !st.tex.trim() ? 'delete' : null) },
      ].filter(Boolean),
    }).then((res) => {
      if (res && res !== 'delete') Ink.ls.set('inkji.fx', { size: st.size, color: st.color });
      return res;
    });
  };
})();
