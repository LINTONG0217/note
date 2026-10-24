/* 墨记 · 启动 */
(function () {
  'use strict';
  const R = Ink.render;

  /* 第一次打开时放一本「使用指南」，演示各个工具 */
  async function ensureWelcome() {
    if (Ink.ls.get('inkji.welcomed')) return;
    const existing = await Ink.db.all('notebooks');
    Ink.ls.set('inkji.welcomed', true);
    if (existing.length) return;

    const nb = await Ink.library.createNotebook({ title: '欢迎使用墨记', cover: '#2b4a7a', template: 'lined', paper: 'cream', size: 'a4p' });
    const p1 = await Ink.db.get('pages', nb.pageIds[0]);
    const T = (y, text, size = 17, color = '#2a2d33', x = 96, w = 660) => ({ id: Ink.uid(), type: 'text', x, y, w, h: size * R.LH, text, size, color });
    const rowY = (row, size = 17) => 96 + row * 32 - size * 1.18;
    const items = [
      ['钢笔 P', '按压越重笔画越粗；写完一笔停住不动，会自动拉成直线'],
      ['荧光笔 H', '半透明标记，不会盖住下面的字'],
      ['橡皮 E', '整笔擦除或精确擦除，在上方选项栏切换'],
      ['套索 L', '圈住内容后拖动、拖右下角圆点缩放、改颜色、复制'],
      ['形状 S', '直线、箭头、矩形、椭圆、三角形；按住 Shift 画正形'],
      ['文字 T', '点一下页面就能打字，点已有文字可以修改'],
      ['图片 I', '插入图片，或者直接 Ctrl+V 粘贴截图'],
      ['手势', '双指缩放和平移，双指轻点撤销；有触控笔时手指只负责滚动'],
      ['导出', '右上角「⋯」导出 PNG 或整本 PDF；左上角返回文稿库'],
    ];
    p1.objects = [
      T(30, '欢迎使用墨记', 34, '#1d2433'),
      T(rowY(1), '这是你的第一本笔记本。下面的每一项都可以直接在这页上试：', 17, '#4a505c'),
      ...items.map(([k], i) => T(rowY(3 + i * 2), k, 17, '#1f4fb8', 96, 110)),
      ...items.map(([, v], i) => T(rowY(3 + i * 2), v, 17, '#2a2d33', 206, 560)),
    ];
    p1.objects.forEach((o) => (o.h = R.textHeight(o)));

    // 示范笔迹：标题下划线、一道荧光笔、一个勾
    const wave = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      wave.push(98 + t * 228, 84 + Math.sin(t * Math.PI * 1.6) * 1.6 + t * 1.2, 0.35 + Math.sin(t * Math.PI) * 0.45);
    }
    const hlY = 96 + 9 * 32 - 11;
    const tick = [];
    const tp = [[690, 368], [702, 381], [728, 350]];
    for (let s = 0; s < 2; s++) {
      const [ax, ay] = tp[s], [bx, by] = tp[s + 1];
      for (let i = 0; i <= 12; i++) { const t = i / 12; tick.push(ax + (bx - ax) * t, ay + (by - ay) * t, 0.4 + 0.3 * Math.sin((s + t) * 1.5)); }
    }
    p1.strokes = [
      { id: Ink.uid(), tool: 'pen', color: '#1f4fb8', size: 2.4, pts: wave },
      { id: Ink.uid(), tool: 'hl', color: '#ffe14d', size: 20, pts: R.linePts(200, hlY, 590, hlY - 1, 0.5, 8) },
      { id: Ink.uid(), tool: 'pen', color: '#c9302c', size: 2.6, pts: tick },
    ];
    const p2 = { id: Ink.uid(), nbId: nb.id, w: 794, h: 1123, template: 'dots', paper: 'cream', strokes: [], objects: [T(40, '练习页：随便写写画画', 22, '#4a505c')] };
    p2.objects[0].h = R.textHeight(p2.objects[0]);
    nb.pageIds.push(p2.id);
    nb.pageCount = 2;
    nb.textIndex = p1.objects.map((o) => o.text).join(' ');
    await Ink.db.putMany('pages', [p1, p2]);
    nb.thumb = await Ink.io.thumbData(p1);
    await Ink.db.put('notebooks', nb);
  }

  async function boot() {
    Ink.hydrateIcons();
    Ink.library.init();
    Ink.editor.init();
    try {
      await Ink.db.open();
      Ink.hw.loadUserFonts();
      await ensureWelcome();
    } catch (e) {
      console.error(e);
      Ink.alert('无法打开本地数据库', '浏览器禁止了本地存储（可能是无痕模式或隐私设置）。笔记将无法保存。\n\n' + (e.message || e));
    }
    await Ink.library.show();
    if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('离线缓存未启用', e));
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
