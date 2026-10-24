/* 墨记 · 编辑器：画布、工具、手势、选择、撤销、页面管理 */
(function () {
  'use strict';
  const R = Ink.render, h = Ink.h, $ = Ink.$, clamp = Ink.clamp;
  const E = (Ink.editor = {});

  const PEN_COLORS = ['#1d1d1f', '#1f4fb8', '#c9302c', '#22805a', '#7a3fbf', '#e07a10'];
  const HL_COLORS = ['#ffe14d', '#a6e86f', '#ff9fcb', '#8fd1ff', '#ffbf6b'];
  const PEN_SIZES = [1.2, 2, 3, 4.5, 7];
  const HL_SIZES = [10, 16, 26];
  const ER_SIZES = [6, 14, 30];
  const TEXT_SIZES = [14, 18, 24, 32, 44];
  const SHAPES = [['line', '直线'], ['arrow', '箭头'], ['rect', '矩形'], ['ellipse', '椭圆'], ['triangle', '三角形']];
  const SEL_BLUE = '#3a62d6';

  const defaults = () => ({
    pen: { color: PEN_COLORS[0], size: 2, style: 'fountain', straighten: true, scribble: true, circle: true },
    hl: { color: HL_COLORS[0], size: 16, straighten: true },
    eraser: { mode: 'stroke', size: 14 },
    shape: { kind: 'line', color: PEN_COLORS[1], size: 2 },
    text: { color: PEN_COLORS[0], size: 18 },
  });
  const opts = Object.assign(defaults(), Ink.ls.get('inkji.tools') || {});
  const saveOpts = () => Ink.ls.set('inkji.tools', opts);

  /* ---------- 状态 ---------- */
  let nb = null, pages = [], cur = 0, page = null;
  let stage, base, over, bctx, octx, ta, selMenu;
  let dpr = 1, W = 1, H = 1, sr = { left: 0, top: 0 };
  const view = { s: 1, tx: 0, ty: 0, fit: 'page' };
  let tool = Ink.ls.get('inkji.tool') || 'pen';
  if (tool === 'image') tool = 'pen';
  let undoStack = [], redoStack = [];
  let sel = null; // {ids:Set, box}
  let action = null, gesture = null, editing = null;
  let fastMode = false, wheelT = 0, overscroll = 0, overscrollT = 0;
  let snap = null; // 当前页离屏缓存 {canvas, ctx, k, dirty}
  let rq = 0, orq = 0, hoverPt = null, spaceDown = false;
  let clip = null; // 剪贴板 {strokes, objects, pageId}
  let returnTool = null; // 画圈选择后临时切到套索，取消选择时回到原来的笔
  const pointers = new Map();
  const dirty = new Set();
  let saveT = 0;
  const thumbs = new Map(), vers = new Map();
  let thumbT = 0;

  /* ---------- 初始化 ---------- */
  E.init = function () {
    stage = $('#stage'); base = $('#cv-base'); over = $('#cv-over');
    bctx = base.getContext('2d'); octx = over.getContext('2d', { desynchronized: true });
    ta = $('#text-edit'); selMenu = $('#sel-menu');

    new ResizeObserver(onResize).observe(stage);
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('pointerleave', (e) => { if (!action && e.pointerType !== 'touch') { hoverPt = null; overlaySoon(); } });
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.type.startsWith('image/'))) e.preventDefault(); });
    stage.addEventListener('drop', (e) => {
      const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); sr = stage.getBoundingClientRect(); insertImage(f, toPage(e.clientX, e.clientY)); }
    });
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));

    ta.addEventListener('input', sizeTA);
    ta.addEventListener('blur', () => commitText());
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') ta.blur(); });
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());

    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; stage.classList.remove('grab'); } });
    document.addEventListener('paste', onPaste);
    window.addEventListener('pagehide', () => flush(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); });
    // iPad Safari：阻止系统把笔 / 手指的拖动当成滚动、放大镜或「随手写」，否则笔画会被打断
    const blockTouch = (e) => { if (!(e.target.closest && e.target.closest('#sel-menu, #text-edit'))) e.preventDefault(); };
    stage.addEventListener('touchstart', blockTouch, { passive: false });
    stage.addEventListener('touchmove', blockTouch, { passive: false });
    window.addEventListener('popstate', () => { if (Ink.currentView === 'editor') E.close(true); });

    Ink.$$('#tools .tool').forEach((b) => (b.onclick = () => (b.dataset.tool === 'image' ? pickImage() : setTool(b.dataset.tool))));
    $('#ed-back').onclick = () => E.close();
    $('#btn-undo').onclick = undo;
    $('#btn-redo').onclick = redo;
    $('#btn-addpage').onclick = addPage;
    $('#btn-pages').onclick = togglePanel;
    $('#btn-ed-more').onclick = (e) => moreMenu(e.currentTarget);
    $('#pg-prev').onclick = () => gotoPage(cur - 1);
    $('#pg-next').onclick = () => gotoPage(cur + 1);
    $('#zoom-in').onclick = () => zoomAt(1.25, W / 2, H / 2);
    $('#zoom-out').onclick = () => zoomAt(0.8, W / 2, H / 2);
    $('#zoom-label').onclick = () => { if (page && page.infinite) fitBoard(); else fitView(view.fit === 'page' ? 'width' : 'page'); render(); };
    $('#ed-title').addEventListener('change', (e) => { nb.title = e.target.value.trim() || '未命名笔记本'; e.target.value = nb.title; nbChanged(); });
    $('#ed-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

    Ink.on('font-loaded', () => {
      if (!page) return;
      if (page.objects.some((o) => o.hw)) { invalidate(); requestRender(); }
      thumbs.forEach((t) => (t.ver = -1));
      thumbsSoon();
    });
    Ink.on('blob-loaded', (key) => {
      if (page && (page.bg === key || page.objects.some((o) => o.src === key))) { invalidate(); requestRender(); }
      thumbsSoon();
    });
    Ink.panelOpen = Ink.ls.get('inkji.panel') ?? (innerWidth > 1100);
  };

  /* ---------- 打开 / 关闭 ---------- */
  E.open = async function (id) {
    const n = await Ink.db.get('notebooks', id);
    if (!n) { Ink.toast('找不到这本笔记本'); return; }
    nb = n;
    pages = (await Promise.all(nb.pageIds.map((pid) => Ink.db.get('pages', pid)))).filter(Boolean);
    if (!pages.length) {
      const p = blankPage({ w: 794, h: 1123, template: 'lined', paper: 'white' });
      pages = [p];
      await Ink.db.put('pages', p);
    }
    nb.pageIds = pages.map((p) => p.id);
    undoStack = []; redoStack = []; sel = null; action = null; gesture = null; editing = null; clipHint();
    thumbs.clear(); vers.clear();
    Ink.setView('editor');
    if (!history.state || history.state.nb !== id) history.pushState({ nb: id }, '');
    $('#ed-title').value = nb.title;
    const board = !!(pages[0] && pages[0].infinite);
    $('#editor').classList.toggle('is-board', board);
    if (board) $('#pages-panel').hidden = true;
    else setPanel(Ink.panelOpen);
    onResize();
    setTool(tool);
    setPage(clamp(nb.lastPage || 0, 0, pages.length - 1), true);
  };

  E.close = async function (fromPop) {
    if (!nb) return Ink.library.show();
    commitText();
    clearSel();
    try {
      await flush();
      nb.thumb = await Ink.io.thumbData(pages[0]);
      await Ink.db.put('notebooks', nb);
    } catch (e) { console.error(e); }
    nb = null; page = null; pages = []; snap = null;
    if (!fromPop && history.state && history.state.nb) history.back();
    Ink.library.show();
  };

  function blankPage(ref) {
    return { id: Ink.uid(), nbId: nb.id, w: ref.w, h: ref.h, template: ref.bg ? 'lined' : ref.template, paper: ref.paper || 'white', strokes: [], objects: [] };
  }

  /* ---------- 保存 ---------- */
  function markDirty(p = page) {
    dirty.add(p.id);
    vers.set(p.id, (vers.get(p.id) || 0) + 1);
    nb.updated = Date.now();
    clearTimeout(saveT);
    saveT = setTimeout(flush, 1200);
    thumbsSoon();
    updateUndoBtns();
  }
  function nbChanged() {
    nb.updated = Date.now();
    clearTimeout(saveT);
    saveT = setTimeout(flush, 300);
  }
  async function flush(force) {
    clearTimeout(saveT);
    if (!nb) return;
    if (action && force !== true && !document.hidden) { saveT = setTimeout(flush, 800); return; } // 正在书写时不保存，避免卡顿
    const ids = new Set(dirty);
    dirty.clear();
    const ps = pages.filter((p) => ids.has(p.id));
    nb.pageIds = pages.map((p) => p.id);
    nb.pageCount = pages.length;
    nb.lastPage = cur;
    nb.textIndex = pages.flatMap((p) => p.objects.filter((o) => o.type === 'text').map((o) => o.text)).join(' ').slice(0, 20000);
    try {
      await Ink.db.putMany('pages', ps);
      await Ink.db.put('notebooks', nb);
    } catch (e) {
      console.error(e);
      ps.forEach((p) => dirty.add(p.id));
      Ink.toast('保存失败：' + (e.message || e) + '。存储空间可能已满。', 5000);
    }
  }
  E.flush = flush;

  /* ---------- 历史 ---------- */
  const snapState = () => ({ strokes: page.strokes, objects: page.objects });
  function pushHistory(before) {
    undoStack.push({ pageId: page.id, before, after: snapState() });
    if (undoStack.length > 200) undoStack.shift();
    redoStack = [];
    updateUndoBtns();
  }
  function applyHist(entry, which) {
    const idx = pages.findIndex((p) => p.id === entry.pageId);
    if (idx < 0) return false;
    if (idx !== cur) setPage(idx);
    page.strokes = entry[which].strokes;
    page.objects = entry[which].objects;
    clearSel();
    invalidate();
    markDirty();
    render();
    return true;
  }
  function undo() {
    commitText();
    while (undoStack.length) {
      const e = undoStack.pop();
      if (applyHist(e, 'before')) { redoStack.push(e); break; }
    }
    updateUndoBtns();
  }
  function redo() {
    commitText();
    while (redoStack.length) {
      const e = redoStack.pop();
      if (applyHist(e, 'after')) { undoStack.push(e); break; }
    }
    updateUndoBtns();
  }
  function updateUndoBtns() {
    $('#btn-undo').disabled = !undoStack.length;
    $('#btn-redo').disabled = !redoStack.length;
  }

  /* ---------- 视图 ---------- */
  function onResize() {
    const r = stage.getBoundingClientRect();
    sr = r;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    for (const c of [base, over]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    if (!page) return;
    if (view.fit) fitView(view.fit); else clampView();
    render();
  }
  /* 竖屏（iPad 竖放、手机）默认适应宽度，横屏默认整页 */
  const defaultFit = () => (H > W * 1.1 ? 'width' : 'page');
  function margin() { return W < 600 ? 10 : 28; }
  function fitScale(mode) {
    const m = margin();
    const sx = (W - 2 * m) / page.w, sy = (H - 2 * m) / page.h;
    return mode === 'width' ? sx : Math.min(sx, sy);
  }
  /* 白板：显示全部内容（最多放大到 100%）；空白板就停在中央 */
  function fitBoard() {
    const b = R.contentBox(page);
    if (!b) { view.s = 1; view.tx = W / 2 - page.w / 2; view.ty = H / 2 - page.h / 2; }
    else {
      const pad = 60;
      view.s = clamp(Math.min((W - 2 * pad) / (b.x1 - b.x0 || 1), (H - 2 * pad) / (b.y1 - b.y0 || 1)), 0.15, 1);
      view.tx = W / 2 - ((b.x0 + b.x1) / 2) * view.s;
      view.ty = H / 2 - ((b.y0 + b.y1) / 2) * view.s;
    }
    view.fit = null;
    clampView();
    updateZoomLabel();
  }
  function fitView(mode) {
    if (page.infinite) return fitBoard();
    const m = margin();
    view.s = fitScale(mode);
    view.fit = mode;
    view.tx = (W - page.w * view.s) / 2;
    view.ty = mode === 'width' ? m : (H - page.h * view.s) / 2;
    clampView();
    updateZoomLabel();
  }
  function clampView() {
    const m = 40, pw = page.w * view.s, ph = page.h * view.s;
    view.tx = pw + 32 <= W ? (W - pw) / 2 : clamp(view.tx, W - pw - m, m);
    view.ty = ph + 32 <= H ? (H - ph) / 2 : clamp(view.ty, H - ph - m, m);
  }
  function zoomAt(f, cx, cy) {
    if (!page) return;
    const fs = page.infinite ? 0.2 : fitScale('page');
    const ns = clamp(view.s * f, fs * 0.5, 8);
    const u = (cx - view.tx) / view.s, v = (cy - view.ty) / view.s;
    view.s = ns;
    view.tx = cx - u * ns;
    view.ty = cy - v * ns;
    view.fit = null;
    clampView();
    updateZoomLabel();
    requestRender();
  }
  function updateZoomLabel() {
    $('#zoom-label').textContent = Math.round(view.s * 100) + '%';
  }
  const toPage = (cx, cy) => [(cx - sr.left - view.tx) / view.s, (cy - sr.top - view.ty) / view.s];

  /* ---------- 渲染 ---------- */
  function hiddenIds() {
    const s = new Set();
    if (editing) s.add(editing.o.id);
    if (action && (action.type === 'move' || action.type === 'scale') && sel) sel.ids.forEach((i) => s.add(i));
    return s;
  }
  function invalidate() { if (snap) snap.dirty = true; }
  function snapLimit() {
    return Math.min(6000 / Math.max(page.w, page.h), Math.sqrt(16e6 / (page.w * page.h)));
  }
  function buildSnap(k) {
    const c = snap ? snap.canvas : document.createElement('canvas');
    c.width = Math.ceil(page.w * k);
    c.height = Math.ceil(page.h * k);
    const x = c.getContext('2d');
    x.setTransform(k, 0, 0, k, 0, 0);
    R.drawPage(x, page, { skip: hiddenIds() });
    snap = { canvas: c, ctx: x, k, dirty: false };
  }
  function requestRender() { if (!rq) rq = requestAnimationFrame(render); }
  function render() {
    if (rq) { cancelAnimationFrame(rq); rq = 0; }
    if (!page) return;
    const k = view.s * dpr;
    const c = bctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, base.width, base.height);
    const X = Math.round(view.tx * dpr), Y = Math.round(view.ty * dpr), PW = page.w * k, PH = page.h * k;
    const vr = { x: -view.tx / view.s, y: -view.ty / view.s, w: W / view.s, h: H / view.s }; // 屏幕可见区域（页面坐标）
    if (page.infinite) {
      // 白板太大不能整页缓存：每次只画屏幕里看得见的部分
      c.setTransform(k, 0, 0, k, X, Y);
      R.drawPage(c, page, { skip: hiddenIds(), rect: vr, scale: view.s });
      renderOverlay();
      placeFloating();
      return;
    }
    c.save();
    c.shadowColor = 'rgba(16,24,40,0.20)';
    c.shadowBlur = 18 * dpr;
    c.shadowOffsetY = 3 * dpr;
    c.fillStyle = R.paper(page).bg;
    c.fillRect(X, Y, PW, PH);
    c.restore();
    const lim = snapLimit();
    if (fastMode) {
      if (!snap || snap.dirty) buildSnap(Math.min(k, lim));
      c.imageSmoothingQuality = 'high';
      c.drawImage(snap.canvas, X, Y, PW, PH);
    } else if (k <= lim) {
      if (!snap || snap.dirty || Math.abs(snap.k - k) > 1e-3) buildSnap(k);
      c.drawImage(snap.canvas, X, Y, snap.canvas.width, snap.canvas.height);
    } else {
      c.setTransform(k, 0, 0, k, X, Y);
      R.drawPage(c, page, { skip: hiddenIds(), rect: vr });
    }
    renderOverlay();
    placeFloating();
  }
  /* 书写中的笔画：已经确定的部分画在一张缓存画布上，每帧只补新增的几段，
   * 笔画再长也不会越写越卡 */
  let liveLayer = null, liveCtx = null;
  function drawLiveInk(c, A, k) {
    const st = A.st, a = st.pts, n = a.length / 3;
    if (!liveLayer || liveLayer.width !== over.width || liveLayer.height !== over.height) {
      liveLayer = document.createElement('canvas');
      liveLayer.width = over.width; liveLayer.height = over.height;
      liveCtx = liveLayer.getContext('2d');
      A.drawn = undefined;
    }
    const vkey = view.s + ',' + view.tx + ',' + view.ty;
    if (A.drawn === undefined || A.vkey !== vkey) {
      liveCtx.setTransform(1, 0, 0, 1, 0, 0);
      liveCtx.clearRect(0, 0, liveLayer.width, liveLayer.height);
      A.drawn = 0;
      A.vkey = vkey;
    }
    const r = R.liveRadii(st, A, Math.max(0, A.drawn - 1));
    const waitHead = R.needsHead(st) && A.head === null;
    // 铅笔先缓存不透明轮廓，合成后统一加纹理，长笔画也只补新增部分。
    const pencil = st.pen === 'pencil';
    const stable = waitHead || A.straight ? 0 : n - 3 - (A.W || 0);
    if (stable > A.drawn) {
      liveCtx.setTransform(k, 0, 0, k, view.tx * dpr, view.ty * dpr);
      liveCtx.fillStyle = pencil ? '#000' : R.inkFill(liveCtx, st);
      liveCtx.fill(R.addRange(new Path2D(), st, a, r, A.drawn, stable));
      A.drawn = stable;
    }
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(liveLayer, 0, 0);
    c.restore();
    c.fillStyle = pencil ? '#000' : R.inkFill(c, st);
    c.fill(R.addRange(new Path2D(), st, a, r, A.drawn, n - 1));
    if (A.pred && performance.now() - A.predAt < 24 && n) {
      const lr = r[n - 1], lx = a[n * 3 - 3], ly = a[n * 3 - 2];
      const pts = [lx, ly, 0];
      A.pred.forEach(([x, y]) => pts.push(x, y, 0));
      c.fill(R.addRange(new Path2D(), st, pts, new Float32Array(pts.length / 3).fill(lr), 0, pts.length / 3 - 1));
    }
    if (pencil) {
      c.save();
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = R.inkFill(c, st);
      c.fillRect(0, 0, page.w, page.h);
      c.restore();
    }
  }
  function overlaySoon() { if (!orq) orq = requestAnimationFrame(() => { orq = 0; renderOverlay(); }); }
  function renderOverlay() {
    const c = octx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, over.width, over.height);
    if (!page) return;
    const k = view.s * dpr;
    c.setTransform(k, 0, 0, k, view.tx * dpr, view.ty * dpr);
    const P = R.paper(page);
    if (action) {
      if (action.type === 'ink') {
        c.save(); c.beginPath(); c.rect(0, 0, page.w, page.h); c.clip();
        if (action.st.tool === 'hl') {
          c.globalAlpha = 0.42; c.strokeStyle = action.st.color; c.lineWidth = action.st.size; c.lineCap = 'round'; c.lineJoin = 'round';
          c.stroke(R.buildPath(action.st));
        } else drawLiveInk(c, action, k);
        c.restore();
      } else if (action.type === 'shape') {
        c.save(); c.beginPath(); c.rect(0, 0, page.w, page.h); c.clip();
        for (const st of action.preview) R.drawStroke(c, st, P, true);
        c.restore();
      } else if (action.type === 'lasso') {
        const a = action.poly;
        c.beginPath();
        c.moveTo(a[0], a[1]);
        for (let i = 2; i < a.length; i += 2) c.lineTo(a[i], a[i + 1]);
        c.closePath();
        c.fillStyle = 'rgba(58,98,214,0.07)';
        c.fill();
        c.setLineDash([6 / view.s, 5 / view.s]);
        c.lineWidth = 1.5 / view.s;
        c.strokeStyle = SEL_BLUE;
        c.stroke();
        c.setLineDash([]);
      } else if (action.type === 'move' || action.type === 'scale') {
        const m = selMatrix(action);
        c.save();
        c.translate(m.ax + m.ox, m.ay + m.oy); c.scale(m.k, m.k); c.translate(-m.ax, -m.ay);
        for (const o of page.objects) if (o.type === 'image' && sel.ids.has(o.id)) R.drawObject(c, o);
        for (const st of page.strokes) if (sel.ids.has(st.id)) R.drawStroke(c, st, P);
        for (const o of page.objects) if (o.type === 'text' && sel.ids.has(o.id)) R.drawObject(c, o);
        c.restore();
      }
    }
    if (sel && (!action || action.type === 'move' || action.type === 'scale')) drawSelBox(c);
    if (hoverPt && tool === 'eraser') {
      const r = opts.eraser.size / 2;
      c.beginPath(); c.arc(hoverPt[0], hoverPt[1], r, 0, Math.PI * 2);
      c.lineWidth = 2.5 / view.s; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.stroke();
      c.lineWidth = 1 / view.s; c.strokeStyle = 'rgba(20,24,32,0.7)'; c.stroke();
    }
  }
  function selMatrix(a) {
    const b = sel.box;
    if (a && a.type === 'move') return { k: 1, ax: 0, ay: 0, ox: a.dx, oy: a.dy };
    if (a && a.type === 'scale') return { k: a.f, ax: b.x0, ay: b.y0, ox: 0, oy: 0 };
    return { k: 1, ax: 0, ay: 0, ox: 0, oy: 0 };
  }
  function drawSelBox(c) {
    const m = selMatrix(action);
    const b = sel.box, pad = 6 / view.s;
    const x0 = m.ax + (b.x0 - m.ax) * m.k + m.ox - pad, y0 = m.ay + (b.y0 - m.ay) * m.k + m.oy - pad;
    const x1 = m.ax + (b.x1 - m.ax) * m.k + m.ox + pad, y1 = m.ay + (b.y1 - m.ay) * m.k + m.oy + pad;
    c.setLineDash([6 / view.s, 4 / view.s]);
    c.lineWidth = 1.3 / view.s;
    c.strokeStyle = SEL_BLUE;
    c.strokeRect(x0, y0, x1 - x0, y1 - y0);
    c.setLineDash([]);
    c.beginPath();
    c.arc(x1, y1, 7 / view.s, 0, Math.PI * 2);
    c.fillStyle = '#fff'; c.fill();
    c.lineWidth = 2 / view.s; c.stroke();
  }

  /* ---------- 页面 ---------- */
  function setPage(i, first) {
    commitText();
    clearSel();
    const prev = page;
    cur = clamp(i, 0, pages.length - 1);
    page = pages[cur];
    nb.lastPage = cur;
    snap = null;
    if (page.infinite) { if (first || !prev || !prev.infinite) fitBoard(); }
    else if (first || !prev || prev.w !== page.w || prev.h !== page.h || view.fit) fitView(first ? defaultFit() : view.fit || defaultFit());
    else { view.ty = margin(); clampView(); }
    $('#pg-label').textContent = `${cur + 1} / ${pages.length}`;
    $('#pg-prev').disabled = cur === 0;
    $('#pg-next').disabled = cur === pages.length - 1;
    render();
    markPanelCurrent();
  }
  function gotoPage(i, fromBottom) {
    if (i < 0 || i >= pages.length || i === cur) return;
    setPage(i);
    if (fromBottom && !view.fit) { view.ty = H - page.h * view.s - margin(); clampView(); render(); }
    nbChanged();
  }

  async function addPage() {
    commitText();
    const p = blankPage(page);
    pages.splice(cur + 1, 0, p);
    nb.pageIds = pages.map((x) => x.id);
    markDirty(p);
    await flush();
    renderPanel();
    setPage(cur + 1);
    Ink.toast(`已添加第 ${cur + 1} 页`);
  }
  async function dupPage() {
    const p = { ...page, id: Ink.uid(), strokes: page.strokes.slice(), objects: page.objects.slice() };
    pages.splice(cur + 1, 0, p);
    markDirty(p);
    await flush();
    renderPanel();
    setPage(cur + 1);
    Ink.toast('已复制为第 ' + (cur + 1) + ' 页');
  }
  async function deletePage() {
    if (pages.length === 1) {
      if (!(await Ink.confirm('清空本页', '这是唯一的一页，删除会清空上面的所有内容。', '清空', true))) return;
      const before = snapState();
      page.strokes = []; page.objects = [];
      pushHistory(before); invalidate(); markDirty(); render();
      return;
    }
    if (!(await Ink.confirm('删除本页', `第 ${cur + 1} 页会被永久删除，无法撤销。`, '删除', true))) return;
    const gone = pages.splice(cur, 1)[0];
    undoStack = undoStack.filter((e) => e.pageId !== gone.id);
    redoStack = redoStack.filter((e) => e.pageId !== gone.id);
    await Ink.db.del('pages', gone.id);
    nb.pageIds = pages.map((x) => x.id);
    nbChanged();
    await flush();
    renderPanel();
    setPage(Math.min(cur, pages.length - 1), false);
    updateUndoBtns();
    Ink.toast('已删除');
  }
  async function movePage(d) {
    const j = cur + d;
    if (j < 0 || j >= pages.length) return;
    [pages[cur], pages[j]] = [pages[j], pages[cur]];
    cur = j;
    nbChanged();
    await flush();
    renderPanel();
    setPage(j);
  }
  async function pageSettings() {
    const st = { template: page.template, paper: page.paper };
    let scope = 'page';
    const seg = h('div', { class: 'seg' });
    const drawSeg = () => {
      seg.innerHTML = '';
      [['page', '仅本页'], ['all', '全部页面']].forEach(([k, l]) => seg.append(h('button', { type: 'button', class: scope === k ? 'on' : '', onclick: () => { scope = k; drawSeg(); } }, l)));
    };
    drawSeg();
    const note = page.bg ? h('p', { class: 'hint' }, '这是 PDF 页面，模板线条会被 PDF 内容盖住；纸张颜色只在 PDF 透明处可见。') : null;
    const ok = await Ink.modal({
      title: '页面模板与纸张', wide: true,
      body: h('div', { class: 'form' }, ...Ink.ui.pagePickers(st, { size: false }), Ink.ui.field('应用到', seg), note),
      actions: [{ label: '取消', value: false }, { label: '应用', kind: 'primary', value: true }],
    });
    if (!ok) return;
    for (const p of scope === 'all' ? pages : [page]) { p.template = st.template; p.paper = st.paper; markDirty(p); }
    invalidate();
    render();
  }

  /* ---------- 页面面板 ---------- */
  function setPanel(open) {
    Ink.panelOpen = open;
    Ink.ls.set('inkji.panel', open);
    $('#pages-panel').hidden = !open;
    $('#btn-pages').classList.toggle('on', open);
    if (open) renderPanel();
  }
  function togglePanel() { setPanel(!Ink.panelOpen); requestAnimationFrame(onResize); }
  function renderPanel() {
    if (!Ink.panelOpen) return;
    const list = $('#pp-list');
    list.innerHTML = '';
    $('#pp-count').textContent = pages.length + ' 页';
    pages.forEach((p, i) => {
      list.append(h('button', { class: 'pp-item' + (i === cur ? ' on' : ''), 'data-i': i, onclick: () => { gotoPage(i); if (W < 700) setPanel(false); } },
        h('span', { class: 'pp-thumb', style: { aspectRatio: R.region(p).w + ' / ' + R.region(p).h } }, thumbFor(p)),
        h('span', { class: 'pp-num' }, String(i + 1))));
    });
    list.append(h('button', { class: 'pp-add', onclick: addPage, html: Ink.icon('plus') + '<span>添加页面</span>' }));
    markPanelCurrent();
  }
  function markPanelCurrent() {
    if (!Ink.panelOpen) return;
    Ink.$$('#pp-list .pp-item').forEach((el) => el.classList.toggle('on', +el.dataset.i === cur));
    const on = $('#pp-list .pp-item.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function thumbFor(p) {
    let t = thumbs.get(p.id);
    const v = vers.get(p.id) || 0;
    if (!t) { t = { canvas: h('canvas'), ver: -1 }; thumbs.set(p.id, t); }
    if (t.ver !== v) {
      t.ver = v;
      R.renderPageCanvas(p, (124 * Math.min(2, dpr)) / R.region(p).w).then((c) => {
        t.canvas.width = c.width; t.canvas.height = c.height;
        t.canvas.getContext('2d').drawImage(c, 0, 0);
      });
    }
    return t.canvas;
  }
  function thumbsSoon() {
    clearTimeout(thumbT);
    thumbT = setTimeout(() => { if (action) return thumbsSoon(); if (Ink.panelOpen && nb) pages.forEach(thumbFor); }, 900);
  }

  /* ---------- 工具栏 ---------- */
  function setTool(t, keepReturn) {
    commitText();
    if (t !== 'lasso') clearSel();
    if (!keepReturn) returnTool = null;
    tool = t;
    Ink.ls.set('inkji.tool', t);
    Ink.$$('#tools .tool').forEach((b) => { b.classList.toggle('on', b.dataset.tool === t); b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false'); });
    stage.dataset.tool = t;
    over.classList.toggle('blend', t === 'hl');
    if (t !== 'eraser') hoverPt = null;
    renderOptions();
    updateToolDots();
    overlaySoon();
  }
  function updateToolDots() {
    const set = (t, c) => { const d = $(`#tools .tool[data-tool="${t}"] .tdot`); if (d) d.style.background = c; };
    set('pen', opts.pen.color); set('hl', opts.hl.color); set('shape', opts.shape.color); set('text', opts.text.color);
  }
  function swatches(colors, o) {
    const g = h('div', { class: 'opt-group', role: 'group', 'aria-label': '颜色' });
    const isCustom = !colors.includes(o.color.toLowerCase());
    colors.forEach((c) => g.append(h('button', { class: 'swatch' + (o.color.toLowerCase() === c ? ' on' : ''), style: { '--sw': c }, 'aria-label': '颜色 ' + c, onclick: () => { o.color = c; saveOpts(); renderOptions(); updateToolDots(); } })));
    const lab = h('label', { class: 'swatch custom' + (isCustom ? ' on' : ''), style: { '--sw': o.color }, title: '自定义颜色' });
    lab.append(h('input', { type: 'color', value: o.color, 'aria-label': '自定义颜色', oninput: (e) => { o.color = e.target.value; lab.style.setProperty('--sw', o.color); updateToolDots(); }, onchange: () => { saveOpts(); renderOptions(); } }));
    g.append(lab);
    return g;
  }
  function sizes(list, o, dot, label) {
    const g = h('div', { class: 'opt-group', role: 'group', 'aria-label': '粗细' });
    list.forEach((s) => g.append(h('button', { class: 'size' + (o.size === s ? ' on' : ''), title: label ? label(s) : '粗细 ' + s, 'aria-label': label ? label(s) : '粗细 ' + s, onclick: () => { o.size = s; saveOpts(); renderOptions(); } },
      h('span', { class: 'size-dot', style: { width: dot(s) + 'px', height: dot(s) + 'px' } }))));
    return g;
  }
  const sep = () => h('span', { class: 'opt-sep' });
  const hint = (t) => h('span', { class: 'opt-hint' }, t);
  const straightToggle = (o) => h('button', {
    class: 'toggle' + (o.straighten !== false ? ' on' : ''), role: 'switch', 'aria-checked': o.straighten !== false ? 'true' : 'false',
    title: '写完一笔后停住不动 0.65 秒，线条自动拉直',
    onclick: () => { o.straighten = o.straighten === false; saveOpts(); renderOptions(); },
  }, h('span', { class: 'toggle-knob' }), '停笔拉直');
  function renderOptions() {
    const bar = $('#ed-options');
    bar.innerHTML = '';
    const add = (...n) => bar.append(...n);
    switch (tool) {
      case 'pen': {
        const seg = h('div', { class: 'seg sm', role: 'group', 'aria-label': '笔型' });
        ['fountain', 'pencil', 'ball', 'brush'].forEach((k) => seg.append(h('button', { class: (opts.pen.style || 'fountain') === k ? 'on' : '', title: { fountain: '有压感和笔锋', pencil: '石墨颗粒质感，适合草稿和画图', ball: '粗细均匀', brush: '压感强、笔锋明显，适合写毛笔字' }[k], onclick: () => { opts.pen.style = k; saveOpts(); renderOptions(); } }, R.PEN[k].label)));
        const o = opts.pen;
        const on = [o.straighten !== false, o.scribble !== false, o.circle !== false].filter(Boolean).length;
        const gestBtn = h('button', { class: 'btn ghost sm', title: '笔的手势', html: Ink.icon('settings') + `<span>笔势 ${on}/3</span>`,
          onclick: (e) => Ink.menu(e.currentTarget, [
            { label: '停笔拉直：写完停住，变直线', checked: o.straighten !== false, onClick: () => { o.straighten = o.straighten === false; saveOpts(); renderOptions(); } },
            { label: '涂抹擦除：在笔迹上来回涂 7 下以上', checked: o.scribble !== false, onClick: () => { o.scribble = o.scribble === false; saveOpts(); renderOptions(); } },
            { label: '画圈选择：画个圈停住', checked: o.circle !== false, onClick: () => { o.circle = o.circle === false; saveOpts(); renderOptions(); } },
            { sep: true },
            ...[[0, '笔锋：关闭（粗细只看压力）'], [1, '笔锋：自然'], [1.8, '笔锋：明显']].map(([v, l]) => ({ label: l, checked: (o.taper === undefined ? 1 : o.taper) === v, onClick: () => { o.taper = v; saveOpts(); } })),
            { sep: true },
            ...STAB.map((c, i) => ({ label: `防抖：${c.label}` + (i === 1 ? '（默认）' : i === 2 ? '（线条最顺，略有拖尾）' : '（最跟手）'), checked: (o.stab === undefined ? 1 : o.stab) === i, onClick: () => { o.stab = i; saveOpts(); } })),
          ]) });
        add(seg, sep(), swatches(PEN_COLORS, o), sep(), sizes(PEN_SIZES, o, (s) => clamp(s * 2.2 + 2, 4, 20)), sep(), gestBtn);
        break;
      }
      case 'hl':
        add(swatches(HL_COLORS, opts.hl), sep(), sizes(HL_SIZES, opts.hl, (s) => clamp(s * 0.7, 6, 20)), sep(), straightToggle(opts.hl));
        break;
      case 'eraser': {
        const seg = h('div', { class: 'seg sm' });
        [['stroke', '整笔擦除'], ['precise', '精确擦除']].forEach(([k, l]) => seg.append(h('button', { class: opts.eraser.mode === k ? 'on' : '', onclick: () => { opts.eraser.mode = k; saveOpts(); renderOptions(); } }, l)));
        add(seg, sep(), sizes(ER_SIZES, opts.eraser, (s) => clamp(s * 0.6, 5, 20)), sep(),
          h('button', { class: 'btn ghost sm danger-text', onclick: clearPage }, '清空本页'));
        break;
      }
      case 'lasso':
        add(hint(returnTool ? '已用画圈选中：拖动或拖右下角圆点缩放，点空白处回到钢笔' : '圈住笔迹、文字或图片，然后拖动、拖右下角圆点缩放'));
        if (clip) add(h('button', { class: 'btn ghost sm', onclick: pasteClip, html: Ink.icon('paste') + '<span>粘贴</span>' }));
        break;
      case 'shape': {
        const g = h('div', { class: 'opt-group' });
        SHAPES.forEach(([k, l]) => g.append(h('button', { class: 'shape-btn' + (opts.shape.kind === k ? ' on' : ''), title: l, 'aria-label': l, html: Ink.icon(k), onclick: () => { opts.shape.kind = k; saveOpts(); renderOptions(); } })));
        add(g, sep(), swatches(PEN_COLORS, opts.shape), sep(), sizes(PEN_SIZES, opts.shape, (s) => clamp(s * 2.2 + 2, 4, 20)), hint('按住 Shift 画正方形、正圆、45° 线'));
        break;
      }
      case 'text': {
        const g = h('div', { class: 'opt-group' });
        TEXT_SIZES.forEach((s) => g.append(h('button', { class: 'tsize' + (opts.text.size === s ? ' on' : ''), title: '字号 ' + s, onclick: () => { opts.text.size = s; saveOpts(); renderOptions(); if (editing) { editing.o = { ...editing.o, size: s }; placeTA(); } } }, String(s))));
        add(h('button', { class: 'btn primary sm', onclick: () => openHW(null), html: Ink.icon('pen') + '<span>打字转手写</span>' }),
          h('button', { class: 'btn sm', onclick: () => openFormula(null), html: '<b class="fx-glyph">∑</b><span>公式</span>' }), sep(),
          swatches(PEN_COLORS, opts.text), sep(), g, hint('点一下页面开始输入，点已有文字可修改'));
        break;
      }
    }
  }
  async function clearPage() {
    if (!page.strokes.length && !page.objects.length) return;
    if (!(await Ink.confirm('清空本页', '本页所有笔迹、文字和图片都会被清除。之后可以用撤销恢复。', '清空', true))) return;
    const before = snapState();
    page.strokes = []; page.objects = [];
    pushHistory(before); invalidate(); markDirty(); render();
  }

  function moreMenu(anchor) {
    const board = !!page.infinite;
    Ink.menu(anchor, [
      clip ? { label: '粘贴', icon: 'paste', hint: 'Ctrl+V', onClick: pasteClip } : null,
      clip ? { sep: true } : null,
      { label: '打字转手写…', icon: 'pen', onClick: () => openHW(null) },
      { label: '插入公式…', icon: 'text', onClick: () => openFormula(null) },
      { label: board ? '扫描文档放到白板上…' : '扫描文档并插入…', icon: 'image', onClick: scanInsert },
      { sep: true },
      board ? { label: '显示全部内容', icon: 'move', onClick: () => { fitBoard(); render(); } } : null,
      board ? null : { label: '在后面添加页面', icon: 'addpage', onClick: addPage },
      board ? null : { label: '复制本页', icon: 'copy', onClick: dupPage },
      { label: board ? '背景与纸张…' : '页面模板与纸张…', icon: 'pages', onClick: pageSettings },
      board ? null : { label: '本页前移', icon: 'back', disabled: cur === 0, onClick: () => movePage(-1) },
      board ? null : { label: '本页后移', icon: 'next', disabled: cur === pages.length - 1, onClick: () => movePage(1) },
      board ? { label: '清空白板', icon: 'trash', danger: true, onClick: clearPage } : { label: '删除本页', icon: 'trash', danger: true, onClick: deletePage },
      { sep: true },
      { label: board ? '导出白板为 PNG' : '导出本页为 PNG', icon: 'export', onClick: () => Ink.io.exportPng(nb.title, page, cur).then(() => Ink.toast('PNG 已导出')) },
      { label: board ? '导出白板为 PDF' : '导出整本为 PDF', icon: 'export', onClick: async () => { await flush(); Ink.library.exportNbPdf(nb); } },
      { sep: true },
      { label: '书写设置…', icon: 'settings', onClick: Ink.openSettings },
    ]);
  }

  /* ---------- 指针输入 ---------- */
  /* 防误触：笔落下时以及抬笔后 0.5 秒内，屏幕上的手指 / 手掌一律忽略 */
  const touchCount = () => [...pointers.values()].filter((p) => p.type === 'touch' && !p.palm).length;
  const penOnly = () => Ink.settings.penOnly === 'on' || (Ink.settings.penOnly === 'auto' && Ink.settings.penSeen);
  const clampP = (p) => (p > 0 ? Math.min(1, p) : 0.5);
  /* 压力曲线：轻轻写也不会细成一根丝，用力时变粗得更线性 */
  const penP = (raw) => Math.pow(clampP(raw), 0.7);

  /* 防抖：One Euro 滤波。慢写时强力平滑（这时最容易看出抖），快写时几乎不平滑（不拖笔） */
  /* 两步防抖：① One Euro 滤波去掉手抖和采样误差；② 按固定间距重采样后，用相邻几个点做高斯平均，
   * 平滑程度与书写速度无关。W 是平均窗口的半径（点数） */
  const STAB = [
    { min: 12, beta: 0.06, W: 0, lag: 1.25, label: '低' },
    { min: 8, beta: 0.035, W: 1, lag: 2.5, label: '中' },
    { min: 4, beta: 0.018, W: 2, lag: 5, label: '高' },
  ];
  const GAUSS = [[1], [1, 2, 1], [1, 4, 6, 4, 1], [1, 6, 15, 20, 15, 6, 1]];
  const stabLevel = () => (Number.isInteger(opts.pen.stab) && STAB[opts.pen.stab] ? opts.pen.stab : 1);
  function smoothAt(A, i) {
    const r = A.raw, n = r.length / 3, W = A.W, w = GAUSS[W];
    let sx = 0, sy = 0, sp = 0, sw = 0;
    for (let k = -W; k <= W; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const wt = w[k + W];
      sx += r[j * 3] * wt; sy += r[j * 3 + 1] * wt; sp += r[j * 3 + 2] * wt; sw += wt;
    }
    const a = A.st.pts;
    a[i * 3] = sx / sw; a[i * 3 + 1] = sy / sw; a[i * 3 + 2] = sp / sw;
  }
  function oneEuro(level, isPen = false) {
    const cfg = STAB[level] || STAB[1];
    let x = null, y = null, px = 0, py = 0, dx = 0, dy = 0, t0 = 0;
    const alpha = (fc, dt) => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
    return (nx, ny, t) => {
      if (x === null) { x = px = nx; y = py = ny; t0 = t; return [x, y]; }
      if (t <= t0) return [x, y];
      const dt = Math.min(0.05, Math.max(1 / 1000, (t - t0) / 1000));
      t0 = t;
      const ad = alpha(1.2, dt);
      dx += ad * ((nx - px) / dt - dx);
      dy += ad * ((ny - py) / dt - dy);
      px = nx; py = ny;
      const a = alpha(cfg.min + cfg.beta * Math.hypot(dx, dy), dt);
      x += a * (nx - x);
      y += a * (ny - y);
      // 触控笔本身采样较准：限制滤波拖尾，不依赖 Safari 未必提供的预测事件。
      const gap = Math.hypot(nx - x, ny - y);
      if (isPen && gap > cfg.lag) {
        x = nx + (x - nx) * cfg.lag / gap;
        y = ny + (y - ny) * cfg.lag / gap;
      }
      return [x, y];
    };
  }
  let penDown = 0, lastPenUp = -1e9;
  const penBusy = () => penDown > 0 || performance.now() - lastPenUp < 500;

  function onDown(e) {
    if (!page) return;
    if (e.target.closest && e.target.closest('#sel-menu')) return;
    sr = stage.getBoundingClientRect();
    e.preventDefault();
    const isPen = e.pointerType === 'pen';
    if (isPen) {
      penDown++;
      if (!Ink.settings.penSeen) {
        Ink.settings.penSeen = true;
        Ink.saveSettings();
        if (Ink.settings.penOnly === 'auto') Ink.toast('已识别触控笔：之后手指只用来滚动和缩放，可在「书写设置」里更改', 4200);
      }
    }
    const palm = e.pointerType === 'touch' && (penBusy() || (action && !action.byTouch));
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType, palm });
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (palm) return;

    if (editing) {
      commitText();
      if (tool === 'text' && !isPen) return;
    }
    if (isPen) {
      // 笔永远优先：手掌先碰到屏幕造成的平移 / 缩放 / 误画，全部让位给笔
      if (gesture) { gesture = null; stage.classList.remove('panning'); fastMode = false; clampView(); render(); }
      if (action && action.byTouch) cancelAction();
      pointers.forEach((p) => { if (p.type === 'touch') p.palm = true; });
      if (editing && tool === 'text') return;
    }
    if (e.pointerType === 'touch') {
      if (touchCount() >= 2) {
        if (action && action.byTouch) cancelAction();
        if (!gesture || gesture.type !== 'pinch') startPinch();
        return;
      }
      if (gesture) return;
      if (penOnly()) { startPan(e); return; }
    }
    if (e.pointerType === 'mouse' && (e.button === 1 || spaceDown)) { startPan(e); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (action || gesture) return;
    startAction(e);
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (p && p.palm) return;
    if (action && action.pointerId === e.pointerId) { moveAction(e); return; }
    if (gesture) {
      if (gesture.type === 'pan' && e.pointerId === gesture.id) {
        view.tx = gesture.tx0 + (e.clientX - gesture.x0);
        view.ty = gesture.ty0 + (e.clientY - gesture.y0);
        view.fit = null;
        clampView();
        requestRender();
      } else if (gesture.type === 'pinch' && gesture.ids.includes(e.pointerId)) pinchMove();
      return;
    }
    if (!action && tool === 'eraser' && e.pointerType !== 'touch') {
      sr = stage.getBoundingClientRect();
      hoverPt = toPage(e.clientX, e.clientY);
      overlaySoon();
    }
  }

  function onUp(e) {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (e.pointerType === 'pen') { penDown = Math.max(0, penDown - 1); lastPenUp = performance.now(); }
    if (p && p.palm) return;
    if (action && action.pointerId === e.pointerId) {
      // iPad 偶尔会发 pointercancel：保留已经写下的笔画，而不是整笔丢掉
      if (e.type === 'pointercancel' && action.type !== 'ink') cancelAction();
      else endAction(e);
      if (editing && document.activeElement !== ta) ta.focus();
      return;
    }
    if (gesture) {
      if (gesture.type === 'pan' && e.pointerId === gesture.id) endGesture();
      else if (gesture.type === 'pinch' && gesture.ids.includes(e.pointerId)) {
        const g = gesture;
        if (!g.ended) {
          g.ended = true;
          if (!g.moved && performance.now() - g.t0 < 320 && e.type !== 'pointercancel') { undo(); Ink.toast('已撤销', 900); }
        }
        if (touchCount() === 0) endGesture();
      }
      return;
    }
    if (editing && document.activeElement !== ta) ta.focus();
  }

  function startPan(e) {
    gesture = { type: 'pan', id: e.pointerId, x0: e.clientX, y0: e.clientY, tx0: view.tx, ty0: view.ty };
    fastMode = true;
    stage.classList.add('panning');
  }
  function startPinch() {
    const ts = [...pointers.entries()].filter(([, p]) => p.type === 'touch' && !p.palm).slice(0, 2);
    const [a, b] = ts.map(([, p]) => p);
    gesture = {
      type: 'pinch', ids: ts.map(([id]) => id), t0: performance.now(), moved: false,
      d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), cx0: (a.x + b.x) / 2 - sr.left, cy0: (a.y + b.y) / 2 - sr.top,
      s0: view.s, tx0: view.tx, ty0: view.ty,
    };
    fastMode = true;
  }
  function pinchMove() {
    const g = gesture;
    const a = pointers.get(g.ids[0]), b = pointers.get(g.ids[1]);
    if (!a || !b || g.ended) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2 - sr.left, cy = (a.y + b.y) / 2 - sr.top;
    if (Math.abs(d - g.d0) > 12 || Math.hypot(cx - g.cx0, cy - g.cy0) > 12) g.moved = true;
    if (!g.moved) return;
    const fs = fitScale('page');
    const ns = clamp((g.s0 * d) / g.d0, fs * 0.5, 8);
    const u = (g.cx0 - g.tx0) / g.s0, v = (g.cy0 - g.ty0) / g.s0;
    view.s = ns;
    view.tx = cx - u * ns;
    view.ty = cy - v * ns;
    view.fit = null;
    updateZoomLabel();
    requestRender();
  }
  function endGesture() {
    const wasPinch = gesture && gesture.type === 'pinch';
    gesture = null;
    stage.classList.remove('panning');
    fastMode = false;
    if (wasPinch && !page.infinite && Math.abs(view.s / fitScale('page') - 1) < 0.06) fitView('page');
    clampView();
    updateZoomLabel();
    render();
  }

  function onWheel(e) {
    if (!page || Ink.currentView !== 'editor') return;
    e.preventDefault();
    sr = stage.getBoundingClientRect();
    fastMode = true;
    clearTimeout(wheelT);
    wheelT = setTimeout(() => { fastMode = false; render(); }, 180);
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), e.clientX - sr.left, e.clientY - sr.top);
      return;
    }
    const m = e.deltaMode === 1 ? 18 : 1;
    const dx = (e.shiftKey ? e.deltaY : e.deltaX) * m, dy = (e.shiftKey ? 0 : e.deltaY) * m;
    const ty0 = view.ty;
    view.tx -= dx;
    view.ty -= dy;
    clampView();
    // 页面到底 / 到顶后继续滚动 → 翻页
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(view.ty - ty0) < 0.5) {
      overscroll += dy;
      clearTimeout(overscrollT);
      overscrollT = setTimeout(() => (overscroll = 0), 350);
      if (overscroll > 260 && cur < pages.length - 1) { overscroll = 0; gotoPage(cur + 1); return; }
      if (overscroll < -260 && cur > 0) { overscroll = 0; gotoPage(cur - 1, true); return; }
    } else overscroll = 0;
    requestRender();
  }

  /* ---------- 绘制动作 ---------- */
  function startAction(e) {
    const [x, y] = toPage(e.clientX, e.clientY);
    const b = { pointerId: e.pointerId, byTouch: e.pointerType === 'touch' };
    switch (tool) {
      case 'pen':
      case 'hl': {
        const o = opts[tool];
        const isPen = e.pointerType === 'pen';
        const t0 = e.timeStamp || performance.now();
        action = { ...b, type: 'ink', isPen, rx: x, ry: y, t: t0, t0, head: null, recent: [[x, y, t0]], hold: { x: e.clientX, y: e.clientY },
          v: 0, fixFirst: isPen && !(e.pressure > 0), pf: e.pressure > 0 ? e.pressure : -1, tp: t0,
          filt: oneEuro(stabLevel(), isPen), W: STAB[stabLevel()].W, lastSample: t0,
          st: { id: Ink.uid(), tool, color: o.color, size: o.size, pts: [x, y, isPen ? (e.pressure > 0 ? penP(e.pressure) : 0.35) : 0.55] } };
        action.raw = action.st.pts.slice();
        action.filt(e.clientX, e.clientY, t0);
        if (tool === 'pen') {
          action.st.pen = o.style || 'fountain';
          action.st.tp = o.taper === undefined ? 1 : o.taper;
          if (isPen) action.st.pp = 1;
        }
        if (holdOn(tool)) armHold();
        overlaySoon();
        break;
      }
      case 'eraser':
        action = { ...b, type: 'erase', before: snapState(), last: [x, y], changed: false };
        hoverPt = [x, y];
        eraseSeg(x, y, x, y);
        break;
      case 'lasso': {
        if (sel) {
          if (onHandle(e)) { action = { ...b, type: 'scale', start: [x, y], f: 1 }; hideSelMenu(); invalidate(); render(); return; }
          const bx = sel.box, pad = 8 / view.s;
          if (x > bx.x0 - pad && x < bx.x1 + pad && y > bx.y0 - pad && y < bx.y1 + pad) { action = { ...b, type: 'move', start: [x, y], dx: 0, dy: 0 }; hideSelMenu(); invalidate(); render(); return; }
          clearSel();
        }
        if (returnTool) {
          setTool(returnTool);
          startAction(e);
          if (action && action.type === 'ink') action.tapOnly = true; // 只是点一下取消选择，不留墨点
          return;
        }
        action = { ...b, type: 'lasso', poly: [x, y] };
        break;
      }
      case 'shape':
        action = { ...b, type: 'shape', x0: x, y0: y, x1: x, y1: y, preview: [] };
        break;
      case 'text': {
        const hit = [...page.objects].reverse().find((o) => o.type === 'text' && x >= o.x - 4 && x <= o.x + o.w + 4 && y >= o.y - 4 && y <= o.y + o.h + 4);
        const fx = [...page.objects].reverse().find((o) => o.formula && x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h);
        if (fx) { openFormula(fx); break; }
        if (hit && hit.hw) openHW(hit);
        else if (hit) startText(hit, false);
        else {
          const t = opts.text;
          const w = Math.max(160, Math.min(420, page.w - x - 24));
          startText({ id: Ink.uid(), type: 'text', x: Math.min(x, page.w - 60), y: y - t.size * 0.7, w, h: t.size * R.LH, text: '', size: t.size, color: t.color }, true);
        }
        break;
      }
    }
  }

  function moveAction(e) {
    const A = action;
    switch (A.type) {
      case 'ink': {
        const list = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
        for (const ev of list) addInk(ev);
        addInk(e); // 有些浏览器的合并列表不含最后一个事件；时间戳负责去重。
        // 预测点：只用来画，不保存，减少笔尖和墨迹之间的距离感
        const pred = !A.straight && A.isPen && e.getPredictedEvents ? e.getPredictedEvents() : null;
        A.pred = pred && pred.length ? pred.filter((ev) => ev.timeStamp > e.timeStamp && ev.timeStamp - e.timeStamp <= 12 && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) <= 12).slice(0, 2).map((ev) => toPage(ev.clientX, ev.clientY)) : null;
        A.predAt = performance.now();
        if (!A.straight && holdOn(A.st.tool) && Math.hypot(e.clientX - A.hold.x, e.clientY - A.hold.y) > 4) { A.hold = { x: e.clientX, y: e.clientY }; armHold(); }
        overlaySoon();
        break;
      }
      case 'erase': {
        const [x, y] = toPage(e.clientX, e.clientY);
        eraseSeg(A.last[0], A.last[1], x, y);
        A.last = [x, y];
        hoverPt = [x, y];
        break;
      }
      case 'lasso': {
        const [x, y] = toPage(e.clientX, e.clientY);
        const a = A.poly;
        if (Math.hypot(x - a[a.length - 2], y - a[a.length - 1]) > 2 / view.s) a.push(x, y);
        overlaySoon();
        break;
      }
      case 'shape': {
        const [x, y] = toPage(e.clientX, e.clientY);
        A.x1 = x; A.y1 = y;
        A.preview = shapeStrokes(A, e.shiftKey);
        overlaySoon();
        break;
      }
      case 'move': {
        const [x, y] = toPage(e.clientX, e.clientY);
        A.dx = x - A.start[0]; A.dy = y - A.start[1];
        overlaySoon();
        break;
      }
      case 'scale': {
        const [x, y] = toPage(e.clientX, e.clientY);
        const b = sel.box;
        const d0 = A.start[0] - b.x0 + (A.start[1] - b.y0);
        A.f = clamp((x - b.x0 + (y - b.y0)) / Math.max(1, d0), 0.1, 12);
        overlaySoon();
        break;
      }
    }
  }

  function addInk(ev) {
    const A = action;
    const now = ev.timeStamp || performance.now();
    if (now <= A.lastSample) return;
    A.lastSample = now;
    const [x, y] = toPage(ev.clientX, ev.clientY);
    A.rx = x; A.ry = y;
    if (A.straight) {
      const a = A.st.pts;
      A.st.pts = R.linePts(a[0], a[1], x, y, A.sp);
      A.drawn = undefined;
      return;
    }
    // 记录原始采样，用来算起笔 / 收笔速度（决定笔锋）
    A.recent.push([x, y, now]);
    if (A.recent.length > 10) A.recent.shift();
    if (A.head === null && now - A.t0 >= 40) {
      const a0 = A.st.pts;
      A.head = Math.hypot(x - a0[0], y - a0[1]) / (now - A.t0);
      if (A.st.tool === 'pen') A.st.head = Math.round(A.head * 1000) / 1000;
    }
    // 位置：在屏幕坐标里做防抖，再换算到页面坐标
    const [fx, fy] = A.filt(ev.clientX, ev.clientY, now);
    const [sx, sy] = toPage(fx, fy);
    // 压力：每个采样都参与平滑（时间常数约 25 毫秒），粗细不会一跳一跳
    if (A.isPen && ev.pressure > 0) {
      const dtp = Math.max(1, now - A.tp);
      A.tp = now;
      A.pf = A.pf < 0 ? ev.pressure : A.pf + (ev.pressure - A.pf) * (1 - Math.exp(-dtp / 25));
    }
    const r = A.raw;
    let lx = r[r.length - 3], ly = r[r.length - 2], lp = r[r.length - 1];
    const S = 2 / view.s; // 每 2 个屏幕像素一个点
    let dx = sx - lx, dy = sy - ly, d = Math.hypot(dx, dy);
    if (d < S) return;
    const v = (d * view.s) / Math.max(1, now - A.t); // 屏幕像素 / 毫秒
    A.t = now;
    A.v = A.v * 0.75 + v * 0.25;
    let p;
    if (A.isPen) p = penP(A.pf > 0 ? A.pf : 0.5) * (1 - clamp(A.v * 0.03, 0, 0.1)); // 写得越快略细
    else p = lp + (clamp(0.68 - A.v * 0.09, 0.3, 0.62) - lp) * 0.35;
    if (A.fixFirst) { r[2] = A.st.pts[2] = lp = p; A.fixFirst = false; } // 有的笔落笔瞬间压力报 0，用后面的压力代替，避免起笔一个墨团
    let added = 0;
    while (d >= S) {
      const t = S / d;
      lx += dx * t; ly += dy * t; lp += (p - lp) * t;
      r.push(lx, ly, lp);
      A.st.pts.push(lx, ly, lp);
      dx = sx - lx; dy = sy - ly; d = Math.hypot(dx, dy);
      added++;
    }
    const n = r.length / 3;
    for (let i = Math.max(1, n - 1 - A.W - added); i < n; i++) smoothAt(A, i);
  }

  const holdOn = (t) => opts[t].straighten !== false || (t === 'pen' && opts.pen.circle !== false);

  /* 这一笔是不是一个（接近）闭合的圈 */
  function isLoop(a) {
    const n = a.length / 3;
    if (n < 10) return false;
    let len = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = a[i * 3], y = a[i * 3 + 1];
      if (i) len += Math.hypot(x - a[i * 3 - 3], y - a[i * 3 - 2]);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const gap = Math.hypot(a[(n - 1) * 3] - a[0], a[(n - 1) * 3 + 1] - a[1]);
    const span = Math.max(x1 - x0, y1 - y0);
    return len * view.s > 90 && span * view.s > 30 && gap < Math.max(span * 0.3, 24 / view.s);
  }

  /* 画圈选择：画一个圈并停住 → 圈里的内容被选中，笔不抬起来可以直接拖走 */
  function circleSelect(A) {
    const a = A.st.pts;
    if (!isLoop(a)) return false;
    const poly = [];
    for (let i = 0; i < a.length; i += 3) poly.push(a[i], a[i + 1]);
    const ids = itemsInPoly(poly);
    if (!ids.size) return false;
    clearTimeout(A.holdT);
    action = null;
    const back = tool;
    setTool('lasso', true);
    returnTool = back;
    renderOptions();
    sel = { ids };
    updateSelBox();
    action = { pointerId: A.pointerId, byTouch: A.byTouch, type: 'move', start: [A.rx, A.ry], dx: 0, dy: 0 };
    invalidate();
    render();
    if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) { /* ignore */ }
    return true;
  }

  /* 涂抹擦除：在已有笔迹上快速来回涂（至少折返 4 次），被涂到的笔画删除，涂抹本身不留下 */
  function scribbleTargets(st) {
    const a = st.pts, n = a.length / 3;
    if (n < 14) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, len = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i * 3], y = a[i * 3 + 1];
      if (i) len += Math.hypot(x - a[i * 3 - 3], y - a[i * 3 - 2]);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const bw = x1 - x0, bh = y1 - y0, major = Math.max(bw, bh);
    if (major * view.s < 28 || len < major * 5.5) return null; // 要涂得够大、来回够多
    // 沿主方向数折返次数（带滞回，避免抖动误判）
    const ax = bw >= bh ? 0 : 1, amp = major * 0.55; // 每一下都要涂过大半个范围才算一次来回
    let dir = 0, hi = a[ax], lo = a[ax], rev = 0;
    for (let i = 1; i < n; i++) {
      const c = a[i * 3 + ax];
      if (dir >= 0) {
        if (c > hi) hi = c;
        if (hi - c > amp) { if (dir === 1) rev++; dir = -1; lo = c; }
        else if (dir === 0 && c - lo > amp) dir = 1;
      }
      if (dir === -1) {
        if (c < lo) lo = c;
        if (c - lo > amp) { rev++; dir = 1; hi = c; }
      }
    }
    if (rev < 6) return null; // 至少来回 6 次（7 下）
    const m = 4;
    const hit = new Set();
    for (const t of page.strokes) {
      const b = R.bbox(t);
      if (b.x1 < x0 - m || b.x0 > x1 + m || b.y1 < y0 - m || b.y0 > y1 + m) continue;
      // 笔画至少一半落在涂抹范围内，并且真的被涂到
      const ta = t.pts, tn = ta.length / 3, step = Math.max(1, Math.floor(tn / 30));
      let inside = 0, tot = 0;
      for (let i = 0; i < tn; i += step) { tot++; const x = ta[i * 3], y = ta[i * 3 + 1]; if (x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m) inside++; }
      if (inside / tot < 0.7) continue;
      const r = Math.max(3, st.size);
      let touched = false;
      for (let i = 0; i < n && !touched; i += 2) if (R.hitStroke(t, a[i * 3], a[i * 3 + 1], r)) touched = true;
      if (touched) hit.add(t.id);
    }
    return hit;
  }

  /* 停笔拉直：书写中停住 0.6 秒，这一笔变成从起点到当前点的直线 */
  function armHold() {
    const A = action;
    clearTimeout(A.holdT);
    A.holdT = setTimeout(() => {
      if (action !== A || A.straight) return;
      const a = A.st.pts;
      if (A.st.tool === 'pen' && opts.pen.circle !== false && circleSelect(A)) return;
      if (opts[A.st.tool].straighten === false) return;
      if (a.length < 9 || Math.hypot(A.rx - a[0], A.ry - a[1]) * view.s < 30) return;
      if (isLoop(a)) return; // 画的是圈，不要拉直
      let sum = 0;
      for (let i = 2; i < a.length; i += 3) sum += a[i];
      A.sp = sum / (a.length / 3);
      A.straight = true;
      A.st.pts = R.linePts(a[0], a[1], A.rx, A.ry, A.sp);
      A.drawn = undefined;
      delete A.st.head; delete A.st.tail;
      overlaySoon();
      if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) { /* ignore */ }
    }, 650);
  }

  function endAction(e) {
    const A = action;
    if (A.type === 'ink' && e.type !== 'pointercancel') addInk(e);
    action = null;
    clearTimeout(A.holdT);
    switch (A.type) {
      case 'ink': {
        const st = A.st;
        if (st.tool === 'pen' && !A.straight && opts.pen.scribble !== false) {
          const t = scribbleTargets(st);
          if (t && t.size) {
            const before = snapState();
            page.strokes = page.strokes.filter((s) => !t.has(s.id));
            pushHistory(before);
            markDirty(); invalidate(); render();
            Ink.toast(`已擦除 ${t.size} 笔`, 3500, { label: '撤销', onClick: undo });
            break;
          }
        }
        if (A.tapOnly) {
          const a = st.pts;
          let len = 0;
          for (let i = 3; i < a.length; i += 3) len += Math.hypot(a[i] - a[i - 3], a[i + 1] - a[i - 2]);
          if (len * view.s < 3) { renderOverlay(); break; }
        }
        if (!A.straight) {
          const a = st.pts, n = a.length;
          // 防抖会让笔画末端略落后于笔尖：抬笔时补到真实落点，再把最后几个点平滑好
          const r = A.raw, rn = r.length;
          const gx = A.rx - r[rn - 3], gy = A.ry - r[rn - 2], gd = Math.hypot(gx, gy);
          if (gd * view.s > 1) {
            const steps = Math.min(8, Math.ceil((gd * view.s) / 2));
            for (let i = 1; i <= steps; i++) { const t = i / steps; r.push(r[rn - 3] + gx * t, r[rn - 2] + gy * t, r[rn - 1]); a.push(0, 0, 0); }
          }
          const m = r.length / 3;
          for (let i = Math.max(1, rn / 3 - 1 - A.W); i < m - 1; i++) smoothAt(A, i);
          if (m > 1) { a[(m - 1) * 3] = r[(m - 1) * 3]; a[(m - 1) * 3 + 1] = r[(m - 1) * 3 + 1]; a[(m - 1) * 3 + 2] = r[(m - 1) * 3 + 2]; }
          st.pts = a.map((v, i) => (i % 3 === 2 ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100));
          if (st.tool === 'pen') {
            // 收笔速度：抬笔前一直在动 → 出锋；停住再抬 → 不出锋
            const r = A.recent, last = r[r.length - 1];
            const up = e.timeStamp || performance.now();
            let tail = 0;
            if (r.length > 1 && up - last[2] < 45) {
              let j = r.length - 2;
              while (j > 0 && last[2] - r[j][2] < 35) j--;
              const dt = last[2] - r[j][2];
              if (dt > 0) tail = Math.hypot(last[0] - r[j][0], last[1] - r[j][1]) / dt;
            }
            const head = A.head !== null ? A.head : 0;
            st.head = Math.round(head * 1000) / 1000;
            st.tail = Math.round(tail * 1000) / 1000;
          }
        }
        const before = snapState();
        page.strokes = [...page.strokes, st];
        pushHistory(before);
        markDirty();
        if (snap && !snap.dirty) {
          snap.ctx.save(); snap.ctx.beginPath(); snap.ctx.rect(0, 0, page.w, page.h); snap.ctx.clip();
          R.drawStroke(snap.ctx, st, R.paper(page));
          snap.ctx.restore();
        } else invalidate();
        render();
        break;
      }
      case 'erase':
        if (A.changed) { pushHistory(A.before); markDirty(); }
        if (e.pointerType === 'touch') hoverPt = null;
        render();
        break;
      case 'lasso':
        finishLasso(A.poly);
        break;
      case 'shape':
        if (A.preview.length && Math.hypot(A.x1 - A.x0, A.y1 - A.y0) * view.s > 4) {
          const before = snapState();
          page.strokes = [...page.strokes, ...A.preview];
          pushHistory(before);
          markDirty();
          invalidate();
        }
        render();
        break;
      case 'move':
      case 'scale':
        applySelTransform(A);
        break;
    }
  }

  function cancelAction() {
    const A = action;
    if (!A) return;
    clearTimeout(A.holdT);
    action = null;
    if (A.type === 'erase' && A.changed) { page.strokes = A.before.strokes; invalidate(); }
    if (A.type === 'move' || A.type === 'scale') invalidate();
    render();
    if (sel) showSelMenu();
  }

  /* ---------- 橡皮 ---------- */
  function eraseSeg(x0, y0, x1, y1) {
    const r = opts.eraser.size / 2;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (r * 0.5)));
    let strokes = page.strokes, changed = false;
    const precise = opts.eraser.mode === 'precise';
    for (let i = 1; i <= steps; i++) {
      const qx = x0 + ((x1 - x0) * i) / steps, qy = y0 + ((y1 - y0) * i) / steps;
      let out = null;
      for (let j = 0; j < strokes.length; j++) {
        const st = strokes[j];
        const b = R.bbox(st);
        let repl;
        if (qx < b.x0 - r || qx > b.x1 + r || qy < b.y0 - r || qy > b.y1 + r) repl = undefined;
        else if (precise) repl = R.splitStroke(st, qx, qy, r);
        else repl = R.hitStroke(st, qx, qy, r) ? [] : undefined;
        if (repl !== undefined && repl !== null) {
          if (!out) out = strokes.slice(0, j);
          out.push(...repl);
        } else if (out) out.push(st);
      }
      if (out) { strokes = out; changed = true; }
    }
    if (changed) {
      page.strokes = strokes;
      action.changed = true;
      invalidate();
      requestRender();
    } else overlaySoon();
  }

  /* ---------- 形状 ---------- */
  function shapeStrokes(A, shift) {
    const o = opts.shape, p = 0.55;
    let { x0, y0, x1, y1 } = A;
    const kind = o.kind;
    if (shift) {
      if (kind === 'line' || kind === 'arrow') {
        const ang = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(x1 - x0, y1 - y0);
        x1 = x0 + Math.cos(ang) * len; y1 = y0 + Math.sin(ang) * len;
      } else {
        const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        x1 = x0 + Math.sign(x1 - x0 || 1) * d; y1 = y0 + Math.sign(y1 - y0 || 1) * d;
      }
    }
    const mk = (pts) => ({ id: Ink.uid(), tool: 'pen', pen: 'ball', color: o.color, size: o.size, pts });
    switch (kind) {
      case 'line': return [mk(R.linePts(x0, y0, x1, y1, p))];
      case 'arrow': {
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 2) return [];
        const ang = Math.atan2(y1 - y0, x1 - x0);
        const L = Math.min(len * 0.4, 14 + o.size * 3);
        const a1 = ang + Math.PI - 0.45, a2 = ang + Math.PI + 0.45;
        return [mk(R.linePts(x0, y0, x1, y1, p)), mk(R.polyPts([x1 + Math.cos(a1) * L, y1 + Math.sin(a1) * L, x1, y1, x1 + Math.cos(a2) * L, y1 + Math.sin(a2) * L], p, false))];
      }
      case 'rect': return [mk(R.polyPts([x0, y0, x1, y0, x1, y1, x0, y1], p, true))];
      case 'triangle': return [mk(R.polyPts([(x0 + x1) / 2, y0, x1, y1, x0, y1], p, true))];
      case 'ellipse': {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
        const n = Math.max(32, Math.ceil((Math.PI * (rx + ry)) / 3));
        const pts = [];
        for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI * 2 - Math.PI / 2; pts.push(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, p); }
        return [mk(pts)];
      }
    }
    return [];
  }

  /* ---------- 选择 ---------- */
  function itemsInPoly(poly) {
    const ids = new Set();
    for (const st of page.strokes) {
      const a = st.pts, n = a.length / 3;
      const step = Math.max(1, Math.floor(n / 40));
      let inside = 0, tot = 0;
      for (let i = 0; i < n; i += step) { tot++; if (R.inPoly(poly, a[i * 3], a[i * 3 + 1])) inside++; }
      if (inside / tot >= 0.5) ids.add(st.id);
    }
    for (const o of page.objects) if (R.inPoly(poly, o.x + o.w / 2, o.y + o.h / 2)) ids.add(o.id);
    return ids;
  }
  function finishLasso(poly) {
    if (poly.length < 8) { clearSel(); renderOverlay(); return; }
    const ids = itemsInPoly(poly);
    if (ids.size) { sel = { ids }; updateSelBox(); showSelMenu(); }
    else clearSel();
    renderOverlay();
  }
  function selected() {
    return { strokes: page.strokes.filter((s) => sel.ids.has(s.id)), objects: page.objects.filter((o) => sel.ids.has(o.id)) };
  }
  function updateSelBox() {
    if (!sel) return;
    const { strokes, objects } = selected();
    if (!strokes.length && !objects.length) { clearSel(); return; }
    let b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const bb of [...strokes.map(R.bbox), ...objects.map(R.objBox)]) b = { x0: Math.min(b.x0, bb.x0), y0: Math.min(b.y0, bb.y0), x1: Math.max(b.x1, bb.x1), y1: Math.max(b.y1, bb.y1) };
    sel.box = b;
  }
  function clearSel() {
    if (!sel) return;
    sel = null;
    hideSelMenu();
    overlaySoon();
  }
  function onHandle(e) {
    const b = sel.box, pad = 6;
    const hx = sr.left + view.tx + b.x1 * view.s + pad, hy = sr.top + view.ty + b.y1 * view.s + pad;
    return Math.hypot(e.clientX - hx, e.clientY - hy) < (e.pointerType === 'mouse' ? 12 : 22);
  }
  function applySelTransform(A) {
    const m = selMatrix(A);
    const moved = A.type === 'move' ? Math.hypot(A.dx, A.dy) > 0.5 : Math.abs(A.f - 1) > 0.005;
    if (moved) {
      const before = snapState();
      const T = (x, y) => [m.ax + (x - m.ax) * m.k + m.ox, m.ay + (y - m.ay) * m.k + m.oy];
      page.strokes = page.strokes.map((st) => {
        if (!sel.ids.has(st.id)) return st;
        const a = st.pts, pts = new Array(a.length);
        for (let i = 0; i < a.length; i += 3) { const [x, y] = T(a[i], a[i + 1]); pts[i] = x; pts[i + 1] = y; pts[i + 2] = a[i + 2]; }
        return { ...st, pts, size: st.size * m.k };
      });
      page.objects = page.objects.map((o) => {
        if (!sel.ids.has(o.id)) return o;
        const [x, y] = T(o.x, o.y);
        const n = { ...o, x, y, w: o.w * m.k, h: o.h * m.k };
        if (o.type === 'text') { n.size = o.size * m.k; n.h = R.textHeight(n); }
        if (o.formula) n.fsize = o.fsize * m.k;
        return n;
      });
      pushHistory(before);
      markDirty();
      updateSelBox();
    }
    invalidate();
    render();
    showSelMenu();
  }
  function showSelMenu() {
    if (!sel) return hideSelMenu();
    selMenu.innerHTML = '';
    const btn = (icon, label, fn, cls) => h('button', { class: 'sm-btn ' + (cls || ''), title: label, 'aria-label': label, html: Ink.icon(icon) + `<span>${label}</span>`, onclick: (e) => { e.stopPropagation(); fn(); } });
    selMenu.append(
      ...(() => {
        const only = sel.ids.size === 1 ? page.objects.find((o) => sel.ids.has(o.id) && (o.hw || o.formula)) : null;
        return only ? [btn('edit', '编辑', () => (only.formula ? openFormula(only) : openHW(only)))] : [];
      })(),
      btn('copy', '复制', copySel),
      btn('cut', '剪切', () => { copySel(); deleteSel(); }),
      btn('plus', '再制', duplicateSel),
      btn('trash', '删除', deleteSel, 'danger'),
      h('span', { class: 'sm-sep' }),
      ...PEN_COLORS.slice(0, 5).map((c) => h('button', { class: 'sm-sw', style: { '--sw': c }, 'aria-label': '改为颜色 ' + c, onclick: (e) => { e.stopPropagation(); recolorSel(c); } }))
    );
    selMenu.hidden = false;
    placeFloating();
  }
  function hideSelMenu() { if (selMenu) selMenu.hidden = true; }
  function placeFloating() {
    if (sel && !selMenu.hidden && sel.box) {
      const b = sel.box;
      const mw = selMenu.offsetWidth, mh = selMenu.offsetHeight;
      let x = view.tx + ((b.x0 + b.x1) / 2) * view.s - mw / 2;
      let y = view.ty + b.y0 * view.s - mh - 16;
      if (y < 8) y = view.ty + b.y1 * view.s + 20;
      x = clamp(x, 8, Math.max(8, W - mw - 8));
      y = clamp(y, 8, Math.max(8, H - mh - 8));
      selMenu.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
    if (editing) placeTA();
  }
  function copySel() {
    if (!sel) return;
    const s = selected();
    clip = { ...s, pageId: page.id };
    Ink.toast('已复制，可在任意页面粘贴', 1500);
    if (tool === 'lasso') renderOptions();
  }
  function deleteSel() {
    if (!sel) return;
    const before = snapState();
    page.strokes = page.strokes.filter((s) => !sel.ids.has(s.id));
    page.objects = page.objects.filter((o) => !sel.ids.has(o.id));
    pushHistory(before);
    clearSel();
    markDirty(); invalidate(); render();
  }
  function insertItems(items, dx, dy) {
    const before = snapState();
    const ids = new Set();
    const strokes = items.strokes.map((st) => {
      const id = Ink.uid(); ids.add(id);
      const pts = st.pts.slice();
      for (let i = 0; i < pts.length; i += 3) { pts[i] += dx; pts[i + 1] += dy; }
      return { ...st, id, pts };
    });
    const objects = items.objects.map((o) => { const id = Ink.uid(); ids.add(id); return { ...o, id, x: o.x + dx, y: o.y + dy }; });
    page.strokes = [...page.strokes, ...strokes];
    page.objects = [...page.objects, ...objects];
    pushHistory(before);
    if (tool !== 'lasso') setTool('lasso');
    sel = { ids };
    updateSelBox();
    markDirty(); invalidate(); render(); showSelMenu();
  }
  function duplicateSel() { if (sel) insertItems(selected(), 24, 24); }
  function pasteClip() {
    if (!clip) return;
    commitText();
    const off = clip.pageId === page.id ? 24 : 0;
    insertItems(clip, off, off);
    clip = { ...clip, pageId: null };
  }
  function clipHint() { /* 保留：粘贴入口在套索选项栏和更多菜单中 */ }
  function recolorSel(c) {
    if (!sel) return;
    const before = snapState();
    page.strokes = page.strokes.map((s) => (sel.ids.has(s.id) && s.tool === 'pen' ? { ...s, color: c } : s));
    page.objects = page.objects.map((o) => (sel.ids.has(o.id) && o.type === 'text' ? { ...o, color: c } : o));
    pushHistory(before);
    markDirty(); invalidate(); render();
  }

  /* ---------- 文字 ---------- */
  function startText(o, isNew) {
    editing = { o, isNew };
    ta.value = o.text;
    ta.hidden = false;
    ta.style.color = o.color;
    placeTA();
    invalidate();
    render();
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }
  function placeTA() {
    const o = editing.o;
    ta.style.left = view.tx + o.x * view.s + 'px';
    ta.style.top = view.ty + o.y * view.s + 'px';
    ta.style.width = o.w * view.s + 'px';
    ta.style.fontSize = o.size * view.s + 'px';
    sizeTA();
  }
  function sizeTA() {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }
  function commitText() {
    if (!editing) return;
    const { o, isNew } = editing;
    editing = null;
    ta.hidden = true;
    const text = ta.value.replace(/\s+$/, '');
    const before = snapState();
    let changed = false;
    if (!text) {
      if (!isNew) { page.objects = page.objects.filter((x) => x.id !== o.id); changed = true; }
    } else if (isNew || text !== o.text || o.size !== (page.objects.find((x) => x.id === o.id) || {}).size) {
      const n = { ...o, text, color: isNew ? o.color : o.color };
      n.h = R.textHeight(n);
      page.objects = isNew ? [...page.objects, n] : page.objects.map((x) => (x.id === o.id ? n : x));
      changed = true;
    }
    if (changed) { pushHistory(before); markDirty(); }
    invalidate();
    render();
  }

  /* ---------- 打字转手写 ---------- */
  async function openHW(obj) {
    if (!page) return;
    commitText();
    const res = await Ink.hw.open({ obj, pageW: page.infinite ? 794 : page.w });
    if (!res) return;
    const before = snapState();
    if (res === 'delete') {
      if (!obj) return;
      page.objects = page.objects.filter((o) => o.id !== obj.id);
      clearSel();
    } else {
      let n;
      if (obj) n = { ...obj, ...res, id: obj.id, x: obj.x, y: obj.y };
      else {
        sr = stage.getBoundingClientRect();
        const [cx, cy] = toPage(sr.left + W / 2, sr.top + H * 0.3);
        n = { ...res, id: Ink.uid(), x: clamp(cx - res.w / 2, 8, Math.max(8, page.w - res.w - 8)), y: clamp(cy, 8, Math.max(8, page.h - 60)) };
      }
      await Ink.hw.ensure(n.font, n.text);
      n.h = R.textHeight(n);
      page.objects = obj ? page.objects.map((o) => (o.id === obj.id ? n : o)) : [...page.objects, n];
      if (tool !== 'lasso') setTool('lasso');
      sel = { ids: new Set([n.id]) };
      updateSelBox();
    }
    pushHistory(before);
    markDirty(); invalidate(); render();
    if (sel) showSelMenu();
  }
  E.openHW = openHW;

  /* ---------- 公式 ---------- */
  async function openFormula(obj) {
    if (!page) return;
    commitText();
    const res = await Ink.formula.open(obj);
    if (!res) return;
    const before = snapState();
    if (res === 'delete') {
      if (!obj) return;
      page.objects = page.objects.filter((o) => o.id !== obj.id);
      clearSel();
    } else {
      const src = await Ink.blobs.put(new Blob([res.svg], { type: 'image/svg+xml' }));
      await Ink.blobs.load(src);
      let n;
      if (obj) n = { ...obj, src, tex: res.tex, fsize: res.size, color: res.color, w: res.w, h: res.h };
      else {
        sr = stage.getBoundingClientRect();
        const [cx, cy] = toPage(sr.left + W / 2, sr.top + H * 0.35);
        n = { id: Ink.uid(), type: 'image', formula: true, src, tex: res.tex, fsize: res.size, color: res.color, w: res.w, h: res.h,
          x: clamp(cx - res.w / 2, 8, Math.max(8, page.w - res.w - 8)), y: clamp(cy - res.h / 2, 8, Math.max(8, page.h - res.h - 8)) };
      }
      page.objects = obj ? page.objects.map((o) => (o.id === obj.id ? n : o)) : [...page.objects, n];
      if (tool !== 'lasso') setTool('lasso');
      sel = { ids: new Set([n.id]) };
      updateSelBox();
    }
    pushHistory(before);
    markDirty(); invalidate(); render();
    if (sel) showSelMenu();
  }

  /* ---------- 扫描插入 ---------- */
  async function scanInsert() {
    if (!page) return;
    commitText();
    const res = await Ink.scan.start();
    if (!res || !res.length) return;
    if (page.infinite) {
      // 白板：扫描件作为图片并排放在屏幕中央，可以再拖动缩放
      sr = stage.getBoundingClientRect();
      const [cx, cy] = toPage(sr.left + W / 2, sr.top + H / 2);
      for (let i = 0; i < res.length; i++) await insertImage(res[i].blob, [cx + (i - (res.length - 1) / 2) * 640, cy], 600);
      return;
    }
    const added = [];
    for (const r of res) {
      const bg = await Ink.blobs.put(r.blob);
      added.push({ id: Ink.uid(), nbId: nb.id, w: r.w, h: r.h, template: 'blank', paper: 'white', bg, strokes: [], objects: [] });
    }
    pages.splice(cur + 1, 0, ...added);
    added.forEach((p) => markDirty(p));
    await flush();
    renderPanel();
    setPage(cur + 1);
    Ink.toast(`已插入 ${added.length} 页扫描件`);
  }

  /* ---------- 图片 ---------- */
  async function pickImage() {
    const f = await Ink.pickFile('image/*');
    if (f) insertImage(f);
  }
  async function shrink(file, max = 2400) {
    const bm = await (window.createImageBitmap ? createImageBitmap(file) : Promise.reject());
    if (Math.max(bm.width, bm.height) <= max && file.size < 3e6) return { blob: file, w: bm.width, h: bm.height };
    const k = max / Math.max(bm.width, bm.height);
    const c = document.createElement('canvas');
    c.width = Math.round(bm.width * Math.min(1, k)); c.height = Math.round(bm.height * Math.min(1, k));
    c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((r) => c.toBlob(r, type, 0.9));
    return { blob, w: c.width, h: c.height };
  }
  async function insertImage(file, at, maxW) {
    if (!page) return;
    try {
      const { blob, w: iw, h: ih } = await shrink(file);
      const src = await Ink.blobs.put(blob);
      await Ink.blobs.load(src);
      const limW = maxW || (page.infinite ? Math.min(900, W / view.s * 0.6) : page.w * 0.6);
      const limH = page.infinite ? Math.max(limW * 1.5, H / view.s * 0.7) : page.h * 0.6;
      let w = Math.min(limW, iw), hh = (w * ih) / iw;
      if (hh > limH) { hh = limH; w = (hh * iw) / ih; }
      let cx, cy;
      if (at) [cx, cy] = at;
      else { [cx, cy] = toPage(sr.left + W / 2, sr.top + H / 2); }
      const x = clamp(cx - w / 2, 0, Math.max(0, page.w - w)), y = clamp(cy - hh / 2, 0, Math.max(0, page.h - hh));
      const o = { id: Ink.uid(), type: 'image', x, y, w, h: hh, src };
      const before = snapState();
      page.objects = [...page.objects, o];
      pushHistory(before);
      setTool('lasso');
      sel = { ids: new Set([o.id]) };
      updateSelBox();
      markDirty(); invalidate(); render(); showSelMenu();
    } catch (e) {
      console.error(e);
      Ink.toast('无法读取这张图片');
    }
  }

  /* ---------- 键盘与粘贴 ---------- */
  function onKey(e) {
    if (Ink.currentView !== 'editor') return;
    const tag = e.target.tagName || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    if (document.querySelector('.modal-back')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'c') { if (sel) { e.preventDefault(); copySel(); } return; }
    if (mod && k === 'x') { if (sel) { e.preventDefault(); copySel(); deleteSel(); } return; }
    if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (mod && k === 'a') { e.preventDefault(); setTool('lasso'); sel = { ids: new Set([...page.strokes, ...page.objects].map((x) => x.id)) }; updateSelBox(); showSelMenu(); renderOverlay(); return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomAt(1.25, W / 2, H / 2); return; }
    if (mod && k === '-') { e.preventDefault(); zoomAt(0.8, W / 2, H / 2); return; }
    if (mod && k === '0') { e.preventDefault(); fitView('page'); render(); return; }
    if (mod) return;
    if (e.code === 'Space') { e.preventDefault(); spaceDown = true; stage.classList.add('grab'); return; }
    if (k === 'delete' || k === 'backspace') { if (sel) { e.preventDefault(); deleteSel(); } return; }
    if (k === 'escape') { clearSel(); return; }
    if (k === 'arrowright' || k === 'pagedown') { e.preventDefault(); gotoPage(cur + 1); return; }
    if (k === 'arrowleft' || k === 'pageup') { e.preventDefault(); gotoPage(cur - 1); return; }
    const map = { p: 'pen', h: 'hl', e: 'eraser', l: 'lasso', s: 'shape', t: 'text' };
    if (map[k]) setTool(map[k]);
    else if (k === 'i') pickImage();
  }
  function onPaste(e) {
    if (Ink.currentView !== 'editor' || !page) return;
    const tag = e.target.tagName || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); insertImage(f); return; }
      }
    }
    if (clip) { e.preventDefault(); pasteClip(); }
  }

  /* 供测试与调试 */
  E._debug = () => ({ nb, pages, cur, page, view, sel, tool, undo: undoStack.length, redo: redoStack.length });
})();
