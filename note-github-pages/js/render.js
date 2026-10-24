/* 墨记 · 页面绘制：纸张模板、笔迹几何、文字排版、命中测试 */
(function () {
  'use strict';
  const R = (Ink.render = {});

  /* 页面坐标单位 ≈ 96 dpi 像素，A4 = 794 × 1123 */
  R.SIZES = {
    a4p: { w: 794, h: 1123, label: 'A4 竖版' },
    a4l: { w: 1123, h: 794, label: 'A4 横版' },
    sq: { w: 900, h: 900, label: '方形' },
    wide: { w: 1280, h: 720, label: '16:9' },
  };
  R.PAPERS = {
    white: { bg: '#ffffff', line: 'rgba(70,100,150,0.22)', dot: 'rgba(70,90,130,0.42)', strong: 'rgba(200,80,70,0.40)', label: '白色' },
    cream: { bg: '#fbf6e9', line: 'rgba(130,105,70,0.25)', dot: 'rgba(120,95,60,0.45)', strong: 'rgba(196,90,64,0.40)', label: '米黄' },
    gray: { bg: '#eef0f3', line: 'rgba(60,72,95,0.20)', dot: 'rgba(60,72,95,0.42)', strong: 'rgba(190,80,70,0.36)', label: '浅灰' },
    dark: { bg: '#24272d', line: 'rgba(255,255,255,0.13)', dot: 'rgba(255,255,255,0.30)', strong: 'rgba(255,150,130,0.35)', label: '深色', dark: true },
  };
  R.TEMPLATES = { blank: '空白', lined: '横线', grid: '方格', dots: '点阵', cornell: '康奈尔' };
  R.FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif';
  R.LH = 1.4;
  R.paper = (page) => R.PAPERS[page.paper] || R.PAPERS.white;

  /* opt.unit 放大间距、opt.lw 加粗线条（用于小尺寸预览） */
  R.drawTemplate = function (ctx, page, opt) {
    const P = R.paper(page);
    const { w, h } = page;
    const u = (opt && opt.unit) || 1, lw = (opt && opt.lw) || 1;
    // opt.rect：只画可见区域（白板这种超大页面必须这样，否则每帧要画几十万个点）
    const r = opt && opt.rect;
    const X0 = r ? Math.max(0, r.x) : 0, Y0 = r ? Math.max(0, r.y) : 0;
    const X1 = r ? Math.min(w, r.x + r.w) : w, Y1 = r ? Math.min(h, r.y + r.h) : h;
    if (X1 <= X0 || Y1 <= Y0) return;
    ctx.fillStyle = P.bg;
    ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    ctx.lineWidth = lw;
    ctx.strokeStyle = P.line;
    switch (page.template) {
      case 'lined': {
        const g = 32 * u, top = 96 * u;
        ctx.beginPath();
        for (let y = Math.max(top, top + Math.ceil((Y0 - top) / g) * g); y < Math.min(Y1, h - g); y += g) { ctx.moveTo(X0, y + 0.5); ctx.lineTo(X1, y + 0.5); }
        ctx.stroke();
        if (72.5 * u >= X0 && 72.5 * u <= X1) {
          ctx.strokeStyle = P.strong;
          ctx.beginPath(); ctx.moveTo(72.5 * u, Y0); ctx.lineTo(72.5 * u, Y1); ctx.stroke();
        }
        break;
      }
      case 'grid': {
        const g = 24 * u;
        ctx.beginPath();
        for (let x = Math.max(g, Math.ceil(X0 / g) * g); x < X1; x += g) { ctx.moveTo(x + 0.5, Y0); ctx.lineTo(x + 0.5, Y1); }
        for (let y = Math.max(g, Math.ceil(Y0 / g) * g); y < Y1; y += g) { ctx.moveTo(X0, y + 0.5); ctx.lineTo(X1, y + 0.5); }
        ctx.stroke();
        break;
      }
      case 'dots': {
        const g = 24 * u, d = 2 * lw;
        ctx.fillStyle = P.dot;
        // 缩得很小时点会挤成一片灰，按屏幕密度隔几个画一个
        const step = opt && opt.scale && opt.scale * g < 6 ? Math.ceil(6 / (opt.scale * g)) * g : g;
        const dd = step > g ? d * (step / g) * 0.6 : d;
        for (let x = Math.max(step, Math.ceil(X0 / step) * step); x < X1; x += step)
          for (let y = Math.max(step, Math.ceil(Y0 / step) * step); y < Y1; y += step) ctx.fillRect(x - dd / 2, y - dd / 2, dd, dd);
        break;
      }
      case 'cornell': {
        const top = 112, cue = Math.round(w * 0.28), sum = Math.round(h * 0.79);
        ctx.beginPath();
        for (let y = top + 32 * u; y < sum; y += 32 * u) { ctx.moveTo(cue, y + 0.5); ctx.lineTo(w, y + 0.5); }
        for (let y = sum + 40 * u; y < h - 24; y += 32 * u) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
        ctx.stroke();
        ctx.strokeStyle = P.strong;
        ctx.lineWidth = 1.5 * lw;
        ctx.beginPath();
        ctx.moveTo(0, top); ctx.lineTo(w, top);
        ctx.moveTo(cue, top); ctx.lineTo(cue, sum);
        ctx.moveTo(0, sum); ctx.lineTo(w, sum);
        ctx.stroke();
        break;
      }
    }
  };

  /* ---------- 笔迹 ----------
   * stroke = {id, tool:'pen'|'hl', color, size, pts:[x,y,pressure, ...]}
   * 钢笔的轮廓 = 每个点一个圆 + 相邻点之间的梯形，统一绕向后用非零规则填充，
   * 得到粗细随压力变化、连接处没有锯齿的笔画。
   */
  /* 笔型：base + 压力 × gain 决定粗细；head / tail 决定起笔、收笔笔锋的强弱；
   * minHead / minTail 是笔锋最细处相对正常粗细的比例（越小越尖） */
  R.PEN = {
    fountain: { base: 0.22, gain: 1.4, head: 0.8, tail: 0.8, minHead: 0.5, minTail: 0.32, label: '钢笔' },
    pencil: { base: 0.42, gain: 1.0, head: 0.5, tail: 0.5, minHead: 0.6, minTail: 0.45, label: '铅笔' },
    ball: { base: 0.85, gain: 0.3, head: 0, tail: 0, minHead: 1, minTail: 1, label: '圆珠笔' },
    brush: { base: 0.08, gain: 2.6, head: 1.4, tail: 1.5, minHead: 0.18, minTail: 0.06, label: '毛笔' },
    legacy: { base: 0.38, gain: 1.15, head: 0, tail: 0, minHead: 1, minTail: 1 },
  };
  const penOf = (st) => R.PEN[st.pen] || R.PEN.legacy;
  R.widthAt = (st, p) => (st.tool === 'hl' ? st.size : st.size * (penOf(st).base + p * penOf(st).gain));

  /* 每个点的笔锋系数
   * - 有真实压感（st.pp，Apple Pencil / 手写笔）：粗细主要交给压力，钢笔只在快速甩笔时补一个短而含蓄的出锋
   * - 没有压感（鼠标、手指）：用起笔 / 收笔速度模拟入锋和出锋
   * - st.tp 是笔锋强度（0 关闭，1 自然，1.8 明显）
   * live = 正在书写：只算入锋，并且长度不随笔画变长而变化，便于增量绘制 */
  function taper(st, a, n, live) {
    const T = penOf(st);
    const m = new Float32Array(n).fill(1);
    const tp = st.tp === undefined ? 1 : st.tp;
    if ((!T.head && !T.tail) || tp <= 0) return m;
    const L = new Float32Array(n);
    for (let i = 1; i < n; i++) L[i] = L[i - 1] + Math.hypot(a[i * 3] - a[i * 3 - 3], a[i * 3 + 1] - a[i * 3 - 2]);
    const total = L[n - 1];
    if (!live && total < 1) return m;
    const soften = (min) => Ink.clamp(1 - (1 - min) * tp, 0.03, 1);
    let headLen = 0;
    const hs = Math.max(0, (st.head || 0) - 0.12);
    if (hs > 0 && T.head && (!st.pp || st.pen === 'brush')) {
      headLen = st.size * (1.5 + hs * T.head * 8 * tp);
      if (!live) headLen = Math.min(headLen, total * 0.3);
    }
    let tailLen = 0;
    const ts = Math.max(0, (st.tail || 0) - 0.1);
    if (!live && ts > 0 && T.tail) tailLen = Math.min(total * 0.4, st.size * (1.5 + ts * T.tail * (st.pp ? 5 : 9) * tp), st.size * 9 + 6);
    const minH = soften(T.minHead), minT = soften(st.pp ? T.minTail : T.minTail * 0.5);
    for (let i = 0; i < n; i++) {
      let k = 1;
      if (headLen > 0 && L[i] < headLen) k *= minH + (1 - minH) * Math.sin((L[i] / headLen) * Math.PI / 2);
      const rest = total - L[i];
      if (tailLen > 0 && rest < tailLen) k *= minT + (1 - minT) * Math.pow(rest / tailLen, 0.6);
      m[i] = k;
    }
    return m;
  }
  /** 有些笔要等起笔速度算出来才能确定入锋（正在书写时用） */
  R.needsHead = (st) => { const T = penOf(st); return !!T.head && (st.tp === undefined ? 1 : st.tp) > 0 && (!st.pp || st.pen === 'brush'); };

  R.radii = function (st, live) {
    const a = st.pts, n = a.length / 3;
    const tp = taper(st, a, n, live);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) r[i] = (R.widthAt(st, a[i * 3 + 2]) / 2) * tp[i];
    return r;
  };

  /** 只更新新增点和仍在平滑的尾部。缓存随笔画增长，不在每帧扫描整笔。 */
  R.liveRadii = function (st, cache, from) {
    const a = st.pts, n = a.length / 3;
    let c = cache.radiusCache;
    if (!c || c.r.length < n) {
      const size = Math.max(128, c ? c.r.length * 2 : 0, n);
      const next = { r: new Float32Array(size), lengths: new Float64Array(size), head: c && c.head, n: c ? c.n : 0 };
      if (c) { next.r.set(c.r); next.lengths.set(c.lengths); }
      c = cache.radiusCache = next;
    }
    if (c.head !== st.head || n < c.n) from = 0;
    from = Math.min(from, c.n);
    c.head = st.head; c.n = n;
    const T = penOf(st), tp = st.tp === undefined ? 1 : st.tp;
    const hs = Math.max(0, (st.head || 0) - 0.12);
    const headLen = tp > 0 && hs > 0 && T.head && (!st.pp || st.pen === 'brush') ? st.size * (1.5 + hs * T.head * 8 * tp) : 0;
    const minH = Ink.clamp(1 - (1 - T.minHead) * tp, 0.03, 1);
    for (let i = from; i < n; i++) {
      const len = c.lengths[i] = i ? c.lengths[i - 1] + Math.hypot(a[i * 3] - a[i * 3 - 3], a[i * 3 + 1] - a[i * 3 - 2]) : 0;
      const taper = headLen > 0 && len < headLen ? minH + (1 - minH) * Math.sin(len / headLen * Math.PI / 2) : 1;
      c.r[i] = R.widthAt(st, a[i * 3 + 2]) / 2 * taper;
    }
    return c.r;
  };

  /** 把第 i0 个点到第 i1 个点之间的笔画轮廓加进 Path2D：每点一个圆 + 相邻点之间的梯形，
   *  采样点之间用 Catmull-Rom 曲线补点，快速书写时也是圆滑的曲线而不是折线 */
  R.addRange = function (P, st, a, r, i0, i1) {
    const n = a.length / 3;
    let px = a[i0 * 3], py = a[i0 * 3 + 1], pr = r[i0];
    P.moveTo(px + pr, py);
    P.arc(px, py, pr, 0, Math.PI * 2);
    const seg = (x, y, rr) => {
      const dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
      if (d > 0.01) {
        const nx = -dy / d, ny = dx / d;
        const ax = px + nx * pr, ay = py + ny * pr, bx = x + nx * rr, by = y + ny * rr;
        const cx = x - nx * rr, cy = y - ny * rr, ex = px - nx * pr, ey = py - ny * pr;
        const s = ax * by - bx * ay + bx * cy - cx * by + cx * ey - ex * cy + ex * ay - ax * ey;
        if (s >= 0) { P.moveTo(ax, ay); P.lineTo(bx, by); P.lineTo(cx, cy); P.lineTo(ex, ey); }
        else { P.moveTo(ex, ey); P.lineTo(cx, cy); P.lineTo(bx, by); P.lineTo(ax, ay); }
        P.closePath();
      }
      P.moveTo(x + rr, y);
      P.arc(x, y, rr, 0, Math.PI * 2);
      px = x; py = y; pr = rr;
    };
    for (let i = i0; i < i1 && i < n - 1; i++) {
      const j0 = Math.max(0, i - 1), j3 = Math.min(n - 1, i + 2);
      const x0 = a[j0 * 3], y0 = a[j0 * 3 + 1], x1 = a[i * 3], y1 = a[i * 3 + 1];
      const x2 = a[i * 3 + 3], y2 = a[i * 3 + 4], x3 = a[j3 * 3], y3 = a[j3 * 3 + 1];
      const r1 = r[i], r2 = r[i + 1];
      const d = Math.hypot(x2 - x1, y2 - y1);
      const steps = d > 2.5 ? Math.min(16, Math.ceil(d / 2)) : 1;
      for (let j = 1; j <= steps; j++) {
        const t = j / steps, t2 = t * t, t3 = t2 * t;
        const x = 0.5 * (2 * x1 + (x2 - x0) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (3 * x1 - x0 - 3 * x2 + x3) * t3);
        const y = 0.5 * (2 * y1 + (y2 - y0) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (3 * y1 - y0 - 3 * y2 + y3) * t3);
        seg(x, y, r1 + (r2 - r1) * t);
      }
    }
    return P;
  };

  R.buildPath = function (st) {
    const a = st.pts, n = a.length / 3;
    const P = new Path2D();
    if (st.tool === 'hl') {
      P.moveTo(a[0], a[1]);
      if (n === 1) P.lineTo(a[0] + 0.01, a[1]);
      for (let i = 1; i < n; i++) P.lineTo(a[i * 3], a[i * 3 + 1]);
      return P;
    }
    return R.addRange(P, st, a, R.radii(st, false), 0, n - 1);
  };

  const pathCache = new WeakMap(), boxCache = new WeakMap();
  R.strokePath = (st) => {
    let p = pathCache.get(st);
    if (!p) { p = R.buildPath(st); pathCache.set(st, p); }
    return p;
  };

  R.drawStroke = function (ctx, st, paper, live) {
    const path = live ? R.buildPath(st) : R.strokePath(st);
    if (st.tool === 'hl') {
      ctx.save();
      ctx.globalAlpha = paper && paper.dark ? 0.5 : 0.42;
      if (!(paper && paper.dark)) ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
      ctx.restore();
    } else {
      ctx.fillStyle = R.inkFill(ctx, st);
      ctx.fill(path, 'nonzero');
    }
  };

  /* 铅笔：用带随机透明度的颗粒纹理填充，模拟石墨在纸上的质感；纹理固定在页面坐标上 */
  const grainCache = new Map();
  R.inkFill = function (ctx, st) {
    if (st.pen !== 'pencil') return st.color;
    let tex = grainCache.get(st.color);
    if (!tex) {
      const N = 96;
      const c = document.createElement('canvas');
      c.width = c.height = N;
      const x = c.getContext('2d');
      x.fillStyle = st.color;
      x.fillRect(0, 0, N, N);
      const img = x.getImageData(0, 0, N, N), d = img.data;
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < N * N; i++) {
        const r = rnd();
        d[i * 4 + 3] = r < 0.18 ? 40 + r * 300 : 150 + rnd() * 90; // 少量“露白”的颗粒
      }
      x.putImageData(img, 0, 0);
      tex = c;
      grainCache.set(st.color, tex);
    }
    const pat = ctx.createPattern(tex, 'repeat');
    if (pat.setTransform && window.DOMMatrix) pat.setTransform(new DOMMatrix().scale(0.45));
    return pat;
  };

  R.bbox = function (st) {
    let b = boxCache.get(st);
    if (b) return b;
    const a = st.pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, pm = 0;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i] < x0) x0 = a[i]; if (a[i] > x1) x1 = a[i];
      if (a[i + 1] < y0) y0 = a[i + 1]; if (a[i + 1] > y1) y1 = a[i + 1];
      if (a[i + 2] > pm) pm = a[i + 2];
    }
    const m = R.widthAt(st, pm) / 2 + 2;
    b = { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
    boxCache.set(st, b);
    return b;
  };
  R.objBox = (o) => ({ x0: o.x, y0: o.y, x1: o.x + o.w, y1: o.y + o.h });

  function segDist(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy;
    let t = L ? ((px - x0) * dx + (py - y0) * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
  }
  R.hitStroke = function (st, x, y, r) {
    const a = st.pts, n = a.length / 3;
    if (n === 1) return Math.hypot(a[0] - x, a[1] - y) < r + R.widthAt(st, a[2]) / 2;
    for (let i = 1; i < n; i++) {
      if (segDist(x, y, a[i * 3 - 3], a[i * 3 - 2], a[i * 3], a[i * 3 + 1]) < r + R.widthAt(st, a[i * 3 + 2]) / 2) return true;
    }
    return false;
  };
  /** 精确擦除：去掉落在橡皮里的点，把剩下的部分拆成几段新笔画；没碰到返回 null */
  R.splitStroke = function (st, x, y, r) {
    const a = st.pts, n = a.length / 3;
    let hit = false;
    const runs = [];
    let run = [];
    for (let i = 0; i < n; i++) {
      const px = a[i * 3], py = a[i * 3 + 1];
      if (Math.hypot(px - x, py - y) < r + R.widthAt(st, a[i * 3 + 2]) * 0.35) {
        hit = true;
        if (run.length) { runs.push(run); run = []; }
      } else run.push(px, py, a[i * 3 + 2]);
    }
    if (!hit) return null;
    if (run.length) runs.push(run);
    return runs.filter((p) => p.length >= 6).map((pts) => ({ id: Ink.uid(), tool: st.tool, color: st.color, size: st.size, pts }));
  };
  R.inPoly = function (poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  /* ---------- 文字 ---------- */
  R.font = (size) => `${size}px ${R.FONT}`;

  /* ---------- 打字转手写：逐字排版 ----------
   * 文字对象 o.hw = true 时启用：o.font 字体、o.slant 倾斜角、o.lh 行距倍数、o.jitter 自然度（0–1）、
   * o.weight 笔画加粗、o.seed 随机种子（同一段文字每次画出来都一样）。
   * 支持「# 标题」「## 小标题」「- 列表」「1. 编号」。 */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let hwCache = new WeakMap();
  R.clearTextCache = () => { hwCache = new WeakMap(); };
  R.hwFamily = (key) => (Ink.hw ? Ink.hw.family(key) : R.FONT);
  R.hwLayout = function (o) {
    let L = hwCache.get(o);
    if (L) return L;
    mctx = mctx || document.createElement('canvas').getContext('2d');
    const ctx = mctx, fam = R.hwFamily(o.font), rnd = mulberry32(o.seed || 1);
    const jit = o.jitter === undefined ? 0.5 : o.jitter, lhM = o.lh || 1.6;
    const glyphs = [];
    let y = 0;
    for (const raw of String(o.text || '').split('\n')) {
      let para = raw, size = o.size, prefix = null, m;
      if ((m = para.match(/^(#{1,2})\s+/))) { size = o.size * (m[1].length === 1 ? 1.45 : 1.2); para = para.slice(m[0].length); }
      else if ((m = para.match(/^[-*•·]\s+/))) { prefix = '•'; para = para.slice(m[0].length); }
      else if ((m = para.match(/^(\d{1,3})[.、)）]\s*/))) { prefix = m[1] + '.'; para = para.slice(m[0].length); }
      ctx.font = `${size}px ${fam}`;
      const lh = size * lhM;
      let indent = 0;
      if (prefix) {
        indent = Math.max(size * 1.2, ctx.measureText(prefix).width + size * 0.5);
        glyphs.push({ ch: prefix, x: 0, y, fs: size, sc: 1, rot: 0, dy: 0, a: 1 });
      }
      let x = indent;
      const toks = para.match(/[A-Za-z0-9'’.,!?;:%+\-=()]+|\s+|[\s\S]/gu) || [];
      for (const tok of toks) {
        if (/^\s+$/.test(tok)) { if (x > indent) x += ctx.measureText(' ').width * tok.length; continue; }
        const w = ctx.measureText(tok).width;
        if (x + w > o.w && x > indent) { y += lh; x = indent; }
        for (const ch of tok) {
          const sc = 1 + (rnd() - 0.5) * 0.14 * jit;
          const cw = ctx.measureText(ch).width;
          if (x + cw > o.w + size * 0.3 && x > indent) { y += lh; x = indent; }
          glyphs.push({ ch, x, y, fs: size, sc, rot: (rnd() - 0.5) * 0.1 * jit, dy: (rnd() - 0.5) * size * 0.1 * jit, a: 1 - rnd() * 0.16 * jit });
          x += cw * sc + (rnd() - 0.5) * size * 0.06 * jit;
        }
      }
      y += lh;
    }
    L = { glyphs, h: Math.max(y, o.size * lhM) };
    hwCache.set(o, L);
    if (Ink.hw) Ink.hw.touch(o.font, o.text);
    return L;
  };
  R.drawHW = function (ctx, o) {
    const L = R.hwLayout(o), fam = R.hwFamily(o.font);
    const sk = Math.tan(((o.slant || 0) * Math.PI) / 180);
    ctx.save();
    ctx.fillStyle = o.color;
    ctx.strokeStyle = o.color;
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    let cur = 0;
    for (const g of L.glyphs) {
      if (g.fs !== cur) { ctx.font = `${g.fs}px ${fam}`; cur = g.fs; }
      ctx.save();
      ctx.translate(o.x + g.x, o.y + g.y + g.fs * 1.05 + g.dy);
      ctx.rotate(g.rot);
      ctx.transform(1, 0, -sk, 1, 0, 0);
      ctx.scale(g.sc, g.sc);
      ctx.globalAlpha = g.a;
      ctx.fillText(g.ch, 0, 0);
      if (o.weight > 0) { ctx.lineWidth = o.weight * g.fs * 0.035; ctx.strokeText(g.ch, 0, 0); }
      ctx.restore();
    }
    ctx.restore();
  };
  R.layoutText = function (ctx, o) {
    ctx.font = R.font(o.size);
    const lines = [];
    for (const para of String(o.text || '').split('\n')) {
      if (!para) { lines.push(''); continue; }
      let line = '';
      for (const ch of para) {
        const t = line + ch;
        if (line && ctx.measureText(t).width > o.w) {
          const sp = line.lastIndexOf(' ');
          if (sp > 0 && /[\w.,!?'"-]/.test(ch)) { lines.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch; }
          else { lines.push(line); line = ch === ' ' ? '' : ch; }
        } else line = t;
      }
      lines.push(line);
    }
    return lines;
  };
  let mctx = null;
  R.textHeight = (o) => {
    if (o.hw) return R.hwLayout(o).h;
    mctx = mctx || document.createElement('canvas').getContext('2d');
    return Math.max(1, R.layoutText(mctx, o).length) * o.size * R.LH;
  };

  R.drawObject = function (ctx, o) {
    if (o.type === 'image') {
      const bm = Ink.blobs.peek(o.src);
      if (bm) ctx.drawImage(bm, o.x, o.y, o.w, o.h);
      else { ctx.fillStyle = 'rgba(120,130,150,0.15)'; ctx.fillRect(o.x, o.y, o.w, o.h); }
    } else if (o.type === 'text' && o.hw) {
      R.drawHW(ctx, o);
    } else if (o.type === 'text') {
      ctx.save();
      ctx.fillStyle = o.color;
      ctx.textBaseline = 'top';
      const lines = R.layoutText(ctx, o);
      const lh = o.size * R.LH;
      lines.forEach((ln, i) => ctx.fillText(ln, o.x, o.y + i * lh + o.size * 0.2));
      ctx.restore();
    }
  };

  /** ctx 已经变换到页面坐标 */
  R.drawPage = function (ctx, page, opt) {
    const skip = opt && opt.skip;
    const r = opt && opt.rect; // 只画这个区域里的内容（页面坐标）
    const P = R.paper(page);
    const vis = (b) => !r || !(b.x1 < r.x || b.x0 > r.x + r.w || b.y1 < r.y || b.y0 > r.y + r.h);
    ctx.save();
    ctx.beginPath();
    if (r) {
      const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
      ctx.rect(x0, y0, Math.min(page.w, r.x + r.w) - x0, Math.min(page.h, r.y + r.h) - y0);
    } else ctx.rect(0, 0, page.w, page.h);
    ctx.clip();
    if (page.bg) {
      ctx.fillStyle = P.bg;
      ctx.fillRect(0, 0, page.w, page.h);
      const bm = Ink.blobs.peek(page.bg);
      if (bm) ctx.drawImage(bm, 0, 0, page.w, page.h);
    } else R.drawTemplate(ctx, page, { rect: r, scale: opt && opt.scale });
    for (const o of page.objects) if (o.type === 'image' && !(skip && skip.has(o.id)) && vis(R.objBox(o))) R.drawObject(ctx, o);
    for (const st of page.strokes) if (!(skip && skip.has(st.id)) && vis(R.bbox(st))) R.drawStroke(ctx, st, P);
    for (const o of page.objects) if (o.type === 'text' && !(skip && skip.has(o.id)) && vis(R.objBox(o))) R.drawObject(ctx, o);
    ctx.restore();
  };

  /** 页面上所有内容的外框；没有内容返回 null */
  R.contentBox = function (page) {
    let b = null;
    const add = (q) => { b = b ? { x0: Math.min(b.x0, q.x0), y0: Math.min(b.y0, q.y0), x1: Math.max(b.x1, q.x1), y1: Math.max(b.y1, q.y1) } : { ...q }; };
    page.strokes.forEach((st) => add(R.bbox(st)));
    page.objects.forEach((o) => add(R.objBox(o)));
    return b;
  };
  /** 导出、缩略图要画的区域：普通页面是整页；白板是内容范围（留一点边） */
  R.region = function (page) {
    if (!page.infinite) return { x: 0, y: 0, w: page.w, h: page.h };
    const b = R.contentBox(page);
    if (!b) return { x: page.w / 2 - 400, y: page.h / 2 - 300, w: 800, h: 600 };
    const pad = 48;
    let x = b.x0 - pad, y = b.y0 - pad, w = b.x1 - b.x0 + pad * 2, hh = b.y1 - b.y0 + pad * 2;
    if (w < 400) { x -= (400 - w) / 2; w = 400; }
    if (hh < 300) { y -= (300 - hh) / 2; hh = 300; }
    return { x, y, w, h: hh };
  };

  R.loadAssets = (page) =>
    Promise.all([
      ...[page.bg, ...page.objects.filter((o) => o.type === 'image').map((o) => o.src)].filter(Boolean).map((k) => Ink.blobs.load(k)),
      ...page.objects.filter((o) => o.hw && Ink.hw).map((o) => Ink.hw.ensure(o.font, o.text)),
    ]);

  /** 把页面（白板则是内容范围）画到新画布上；scale = 每个页面单位多少像素 */
  R.renderPageCanvas = async function (page, scale) {
    await R.loadAssets(page);
    const g = R.region(page);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(g.w * scale));
    c.height = Math.max(1, Math.round(g.h * scale));
    const x = c.getContext('2d');
    x.setTransform(scale, 0, 0, scale, -g.x * scale, -g.y * scale);
    R.drawPage(x, page, page.infinite ? { rect: g, scale } : null);
    return c;
  };

  R.templatePreview = function (template, paper, w = 66) {
    const page = { w: 794, h: 1123, template, paper, strokes: [], objects: [] };
    const k = w / page.w;
    const c = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(page.h * k * dpr);
    const x = c.getContext('2d');
    x.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    R.drawTemplate(x, page, { unit: 2.6, lw: 0.9 / k });
    return c;
  };

  /* ---------- 形状 → 笔画点 ---------- */
  R.linePts = function (x0, y0, x1, y1, p, step = 4) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / step));
    const out = [];
    for (let i = 0; i <= n; i++) out.push(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, p);
    return out;
  };
  R.polyPts = function (corners, p, closed) {
    const out = [];
    const c = closed ? corners.concat(corners.slice(0, 2)) : corners;
    for (let i = 0; i + 3 < c.length; i += 2) {
      const seg = R.linePts(c[i], c[i + 1], c[i + 2], c[i + 3], p);
      if (out.length) seg.splice(0, 3);
      out.push(...seg);
    }
    return out;
  };
})();
