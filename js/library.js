/* 墨记 · 文稿库：文件夹、笔记本列表、新建 / 重命名 / 移动 / 删除 */
(function () {
  'use strict';
  const L = (Ink.library = {});
  const h = Ink.h, $ = Ink.$, R = Ink.render;

  Ink.COVERS = [
    ['#2b4a7a', '墨蓝'], ['#2e6a58', '松绿'], ['#a4452f', '砖红'], ['#c3962f', '姜黄'],
    ['#6b5a8e', '藕紫'], ['#3a3e46', '石墨'], ['#b97b7b', '豆沙'], ['#4b8aa3', '天青'],
  ];

  let filter = 'all', query = '', folders = [], notebooks = [];

  /* ---------- 共享的页面选项（新建笔记本、页面设置都会用） ---------- */
  Ink.ui = {};
  Ink.ui.field = (label, ...kids) => h('div', { class: 'field' }, h('div', { class: 'field-label' }, label), ...kids);
  Ink.ui.pagePickers = function (st, { size = true } = {}) {
    const tplWrap = h('div', { class: 'tpl-grid' });
    const drawTpl = () => {
      tplWrap.innerHTML = '';
      for (const [k, label] of Object.entries(R.TEMPLATES)) {
        tplWrap.append(h('button', { type: 'button', class: 'tpl' + (st.template === k ? ' on' : ''), 'aria-pressed': st.template === k ? 'true' : 'false', onclick: () => { st.template = k; drawTpl(); } },
          R.templatePreview(k, st.paper), h('span', null, label)));
      }
    };
    drawTpl();
    const paperWrap = h('div', { class: 'chip-row' });
    const drawPaper = () => {
      paperWrap.innerHTML = '';
      for (const [k, p] of Object.entries(R.PAPERS)) {
        paperWrap.append(h('button', { type: 'button', class: 'paper-chip' + (st.paper === k ? ' on' : ''), onclick: () => { st.paper = k; drawPaper(); drawTpl(); } },
          h('span', { class: 'paper-swatch', style: { background: p.bg } }), p.label));
      }
    };
    drawPaper();
    const nodes = [Ink.ui.field('模板', tplWrap), Ink.ui.field('纸张', paperWrap)];
    if (size) {
      const sizeWrap = h('div', { class: 'seg' });
      const drawSize = () => {
        sizeWrap.innerHTML = '';
        for (const [k, s] of Object.entries(R.SIZES)) sizeWrap.append(h('button', { type: 'button', class: st.size === k ? 'on' : '', onclick: () => { st.size = k; drawSize(); } }, s.label));
      };
      drawSize();
      nodes.push(Ink.ui.field('尺寸', sizeWrap));
    }
    return nodes;
  };
  function coverPicker(st, allowPreview) {
    const wrap = h('div', { class: 'cover-row' });
    const draw = () => {
      wrap.innerHTML = '';
      for (const [c, name] of Ink.COVERS) wrap.append(h('button', { type: 'button', class: 'cover-chip' + (st.cover === c ? ' on' : ''), title: name, 'aria-label': '封面 ' + name, style: { '--c': c }, onclick: () => { st.cover = c; draw(); } }));
      if (allowPreview) wrap.append(h('button', { type: 'button', class: 'cover-chip preview' + (st.cover === 'preview' ? ' on' : ''), title: '用第一页做封面', onclick: () => { st.cover = 'preview'; draw(); } }, '首页'));
    };
    draw();
    return wrap;
  }

  /* ---------- 数据 ---------- */
  L.createNotebook = async function ({ title, cover, template, paper, size, folderId }) {
    const S = R.SIZES[size] || R.SIZES.a4p;
    const now = Date.now();
    const nb = { id: Ink.uid(), title, folderId: folderId || null, cover, fav: false, created: now, updated: now, pageIds: [], pageCount: 1, lastPage: 0, textIndex: '' };
    const page = { id: Ink.uid(), nbId: nb.id, w: S.w, h: S.h, template, paper, strokes: [], objects: [] };
    nb.pageIds = [page.id];
    await Ink.db.put('pages', page);
    await Ink.db.put('notebooks', nb);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return nb;
  };

  L.init = function () {
    $('#lib-search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); renderGrid(); });
    $('#btn-new').onclick = (e) => Ink.menu(e.currentTarget, [
      { label: '新建笔记本', icon: 'book', onClick: newNotebook },
      { label: '新建白板', icon: 'move', onClick: newBoard },
      { label: '扫描文档', icon: 'image', onClick: scanNew },
      { label: '导入 PDF…', icon: 'pdf', onClick: importPdf },
      { label: '新建文件夹', icon: 'folder', onClick: newFolder },
    ]);
    $('#btn-lib-more').onclick = (e) => Ink.menu(e.currentTarget, [
      { label: '导出全部备份', icon: 'export', onClick: exportBackup },
      { label: '从备份恢复…', icon: 'import', onClick: importBackup },
      { sep: true },
      { label: '书写设置…', icon: 'settings', onClick: Ink.openSettings },
    ]);
    $('#btn-new-folder').onclick = newFolder;
    $('#lib-menu-btn').onclick = () => $('#library').classList.toggle('side-open');
    $('#side-scrim').onclick = () => $('#library').classList.remove('side-open');
    Ink.$$('#lib-side .side-item[data-filter]').forEach((b) => (b.onclick = () => setFilter(b.dataset.filter)));
    const main = $('.lib-main');
    main.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.items].some((i) => i.type === 'application/pdf')) { e.preventDefault(); main.classList.add('drop'); } });
    main.addEventListener('dragleave', () => main.classList.remove('drop'));
    main.addEventListener('drop', (e) => {
      main.classList.remove('drop');
      const f = [...(e.dataTransfer?.files || [])].find((x) => x.type === 'application/pdf' || /\.pdf$/i.test(x.name));
      if (f) { e.preventDefault(); importPdf(f); }
    });
  };

  L.show = async function () {
    Ink.setView('library');
    await L.reload();
  };

  L.reload = async function () {
    [folders, notebooks] = await Promise.all([Ink.db.all('folders'), Ink.db.all('notebooks')]);
    folders.sort((a, b) => a.created - b.created);
    if (filter.startsWith('f:') && !folders.some((f) => 'f:' + f.id === filter)) filter = 'all';
    renderSide();
    renderGrid();
    storageInfo();
  };

  function setFilter(f) {
    filter = f;
    $('#library').classList.remove('side-open');
    renderSide();
    renderGrid();
  }

  function renderSide() {
    $('#cnt-all').textContent = notebooks.length || '';
    $('#cnt-fav').textContent = notebooks.filter((n) => n.fav).length || '';
    Ink.$$('#lib-side .side-item[data-filter]').forEach((b) => b.classList.toggle('on', b.dataset.filter === filter));
    const list = $('#folder-list');
    list.innerHTML = '';
    if (!folders.length) list.append(h('p', { class: 'side-empty' }, '还没有文件夹'));
    for (const f of folders) {
      const n = notebooks.filter((x) => x.folderId === f.id).length;
      const key = 'f:' + f.id;
      list.append(h('div', { class: 'side-item folder' + (filter === key ? ' on' : ''), role: 'button', tabindex: '0', onclick: () => setFilter(key), onkeydown: (e) => { if (e.key === 'Enter') setFilter(key); } },
        h('span', { html: Ink.icon('folder') }), h('span', { class: 'side-name' }, f.name), h('em', { class: 'count' }, n || ''),
        h('button', { class: 'icon-btn xs side-more', 'aria-label': '文件夹选项', html: Ink.icon('more'), onclick: (e) => { e.stopPropagation(); folderMenu(e.currentTarget, f); } })));
    }
  }

  function currentTitle() {
    if (query) return '搜索结果';
    if (filter === 'fav') return '收藏';
    if (filter.startsWith('f:')) return (folders.find((f) => 'f:' + f.id === filter) || {}).name || '文件夹';
    return '全部笔记本';
  }

  function renderGrid() {
    const grid = $('#nb-grid');
    grid.innerHTML = '';
    let list = notebooks.slice();
    if (filter === 'fav') list = list.filter((n) => n.fav);
    else if (filter.startsWith('f:')) list = list.filter((n) => n.folderId === filter.slice(2));
    if (query) list = list.filter((n) => (n.title || '').toLowerCase().includes(query) || (n.textIndex || '').toLowerCase().includes(query));
    list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    $('#lib-title').textContent = currentTitle();
    $('#lib-sub').textContent = list.length ? `${list.length} 本` : '';
    if (!query && filter !== 'fav') grid.append(h('button', { class: 'nb-new', onclick: newNotebook }, h('span', { class: 'nb-new-face', html: Ink.icon('plus') }), h('span', { class: 'nb-new-label' }, '新建笔记本')));
    for (const nb of list) grid.append(card(nb));
    const empty = $('#lib-empty');
    empty.hidden = !!list.length;
    empty.textContent = query ? `没有找到包含「${query}」的笔记本。` : filter === 'fav' ? '点笔记本右下角的「⋯」，选「收藏」，它就会出现在这里。' : '';
    if (!list.length && !query && filter !== 'fav') empty.hidden = true;
  }

  function card(nb) {
    const isPrev = nb.cover === 'preview';
    const face = isPrev && nb.thumb
      ? h('img', { src: nb.thumb, alt: '', draggable: 'false' })
      : h('span', { class: 'cv-label' }, h('span', null, nb.title || '未命名'));
    return h('article', { class: 'nb-card' },
      h('button', { class: 'nb-cover' + (isPrev ? ' is-preview' : ''), style: { '--c': isPrev ? '#e9ecf1' : nb.cover }, 'aria-label': '打开 ' + nb.title, onclick: () => Ink.editor.open(nb.id) },
        face, nb.fav ? h('span', { class: 'fav-badge', html: Ink.icon('star') }) : null),
      h('div', { class: 'nb-meta' },
        h('div', { class: 'nb-text' }, h('div', { class: 'nb-name', title: nb.title }, nb.title || '未命名'), h('div', { class: 'nb-sub' }, `${nb.kind === 'board' ? '白板' : (nb.pageCount || nb.pageIds.length) + ' 页'} · ${Ink.fmtDate(nb.updated)}`)),
        h('button', { class: 'icon-btn sm', 'aria-label': '笔记本选项', html: Ink.icon('more'), onclick: (e) => nbMenu(e.currentTarget, nb) })));
  }

  async function storageInfo() {
    const el = $('#storage-info');
    try {
      const est = await navigator.storage.estimate();
      el.innerHTML = `${Ink.icon('database')}<span>已用 ${Ink.fmtBytes(est.usage || 0)}</span>`;
      el.title = '数据只保存在这台设备的这个浏览器里。换设备前请导出备份。';
    } catch (e) { el.textContent = ''; }
  }

  /* ---------- 操作 ---------- */
  function folderOfFilter() { return filter.startsWith('f:') ? filter.slice(2) : null; }

  async function newNotebook() {
    const S = Ink.settings;
    const st = { cover: Ink.COVERS[Math.floor(Math.random() * Ink.COVERS.length)][0], template: S.defaultTemplate || 'lined', paper: S.defaultPaper || 'white', size: S.defaultSize || 'a4p' };
    const inp = h('input', { class: 'input', type: 'text', id: 'nn-title', placeholder: '例如：高数笔记、读书摘录', maxlength: '60' });
    const ok = await Ink.modal({
      title: '新建笔记本', wide: true,
      body: h('div', { class: 'form' }, Ink.ui.field('名称', inp), Ink.ui.field('封面', coverPicker(st, false)), ...Ink.ui.pagePickers(st, { size: true })),
      actions: [{ label: '取消', value: false }, { label: '创建', kind: 'primary', value: true }],
    });
    if (!ok) return;
    Object.assign(S, { defaultTemplate: st.template, defaultPaper: st.paper, defaultSize: st.size });
    Ink.saveSettings();
    const d = new Date();
    const nb = await L.createNotebook({ ...st, title: inp.value.trim() || `笔记 ${d.getMonth() + 1}月${d.getDate()}日`, folderId: folderOfFilter() });
    Ink.editor.open(nb.id);
  }
  L.newNotebook = newNotebook;

  async function importPdf(file) {
    const f = file instanceof File ? file : await Ink.pickFile('application/pdf,.pdf');
    if (!f) return;
    const pr = Ink.progress('正在导入 PDF');
    pr.set('正在读取 ' + f.name, 0);
    try {
      const nb = await Ink.io.importPdf(f, (i, n) => pr.set(`正在处理第 ${i} / ${n} 页`, i / n), folderOfFilter());
      pr.close();
      Ink.toast(`已导入 ${nb.pageCount} 页`);
      Ink.editor.open(nb.id);
    } catch (err) {
      pr.close();
      console.error(err);
      Ink.alert('导入失败', err.userMessage || '读取 PDF 时出错了：' + (err.message || err));
    }
  }

  /* 无限白板：一张 20000 × 20000 的超大页面（约 25 张 A4 那么宽），想画多大画多大 */
  async function newBoard() {
    const name = await Ink.prompt('新建白板', '', '例如：期末复习思维导图');
    if (name === null) return;
    const now = Date.now(), d = new Date();
    const nb = {
      id: Ink.uid(), kind: 'board', title: name || `白板 ${d.getMonth() + 1}月${d.getDate()}日`, folderId: folderOfFilter(), cover: 'preview', fav: false,
      created: now, updated: now, pageIds: [], pageCount: 1, lastPage: 0, textIndex: '',
    };
    const page = { id: Ink.uid(), nbId: nb.id, w: 20000, h: 20000, infinite: true, template: 'dots', paper: 'white', strokes: [], objects: [] };
    nb.pageIds = [page.id];
    nb.thumb = await Ink.io.thumbData(page);
    await Ink.db.put('pages', page);
    await Ink.db.put('notebooks', nb);
    Ink.editor.open(nb.id);
  }
  L.newBoard = newBoard;

  /* 扫描纸质资料，生成一本新笔记本（每张扫描件一页，可以直接在上面写） */
  async function scanNew() {
    const res = await Ink.scan.start();
    if (!res || !res.length) return;
    const now = Date.now(), d = new Date();
    const nb = {
      id: Ink.uid(), title: `扫描 ${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      folderId: folderOfFilter(), cover: 'preview', fav: false, created: now, updated: now, pageIds: [], pageCount: res.length, lastPage: 0, textIndex: '',
    };
    const pages = [];
    for (const r of res) {
      const bg = await Ink.blobs.put(r.blob);
      pages.push({ id: Ink.uid(), nbId: nb.id, w: r.w, h: r.h, template: 'blank', paper: 'white', bg, strokes: [], objects: [] });
    }
    await Ink.db.putMany('pages', pages);
    nb.pageIds = pages.map((x) => x.id);
    nb.thumb = await Ink.io.thumbData(pages[0]);
    await Ink.db.put('notebooks', nb);
    Ink.toast(`已生成 ${pages.length} 页扫描件`);
    Ink.editor.open(nb.id);
  }
  L.scanNew = scanNew;

  async function newFolder() {
    const name = await Ink.prompt('新建文件夹', '', '文件夹名称');
    if (!name) return;
    const f = { id: Ink.uid(), name, created: Date.now() };
    await Ink.db.put('folders', f);
    filter = 'f:' + f.id;
    await L.reload();
  }

  function folderMenu(anchor, f) {
    Ink.menu(anchor, [
      { label: '重命名', icon: 'edit', onClick: async () => { const n = await Ink.prompt('重命名文件夹', f.name); if (n) { f.name = n; await Ink.db.put('folders', f); L.reload(); } } },
      { label: '删除文件夹', icon: 'trash', danger: true, onClick: async () => {
        const inside = notebooks.filter((x) => x.folderId === f.id);
        if (!(await Ink.confirm('删除文件夹', `只删除文件夹「${f.name}」。里面的 ${inside.length} 本笔记本会留在「全部笔记本」里。`, '删除文件夹', true))) return;
        for (const nb of inside) { nb.folderId = null; }
        await Ink.db.putMany('notebooks', inside);
        await Ink.db.del('folders', f.id);
        if (filter === 'f:' + f.id) filter = 'all';
        L.reload();
      } },
    ]);
  }

  function nbMenu(anchor, nb) {
    Ink.menu(anchor, [
      { label: '打开', icon: 'book', onClick: () => Ink.editor.open(nb.id) },
      { label: '重命名', icon: 'edit', onClick: () => renameNb(nb) },
      { label: '更换封面', icon: 'palette', onClick: () => changeCover(nb) },
      { label: '移动到文件夹', icon: 'folder', onClick: () => moveNb(nb) },
      { label: nb.fav ? '取消收藏' : '收藏', icon: 'star', onClick: async () => { nb.fav = !nb.fav; await Ink.db.put('notebooks', nb); L.reload(); } },
      { label: '导出为 PDF', icon: 'export', onClick: () => exportNbPdf(nb) },
      { sep: true },
      { label: '删除笔记本', icon: 'trash', danger: true, onClick: () => deleteNb(nb) },
    ]);
  }

  async function renameNb(nb) {
    const n = await Ink.prompt('重命名笔记本', nb.title);
    if (!n) return;
    nb.title = n;
    await Ink.db.put('notebooks', nb);
    L.reload();
  }

  async function changeCover(nb) {
    const st = { cover: nb.cover };
    const ok = await Ink.modal({ title: '更换封面', body: coverPicker(st, true), actions: [{ label: '取消', value: false }, { label: '应用', kind: 'primary', value: true }] });
    if (!ok) return;
    nb.cover = st.cover;
    if (nb.cover === 'preview' && !nb.thumb) {
      const p = await Ink.db.get('pages', nb.pageIds[0]);
      nb.thumb = await Ink.io.thumbData(p);
    }
    await Ink.db.put('notebooks', nb);
    L.reload();
  }

  async function moveNb(nb) {
    let pick = nb.folderId || '';
    const list = h('div', { class: 'radio-list' },
      [['', '不放在文件夹里'], ...folders.map((f) => [f.id, f.name])].map(([id, name]) =>
        h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'mv', value: id, checked: pick === id || null, onchange: () => (pick = id) }), h('span', { class: 'radio-text' }, h('b', null, name)))));
    const body = folders.length ? list : h('p', { class: 'modal-text' }, '还没有文件夹。先在左侧「文件夹」旁边点 + 新建一个。');
    const ok = await Ink.modal({ title: `移动「${nb.title}」`, body, actions: folders.length ? [{ label: '取消', value: false }, { label: '移动', kind: 'primary', value: true }] : [{ label: '知道了', kind: 'primary', value: false }] });
    if (!ok) return;
    nb.folderId = pick || null;
    await Ink.db.put('notebooks', nb);
    L.reload();
  }

  async function exportNbPdf(nb) {
    const pages = (await Promise.all(nb.pageIds.map((id) => Ink.db.get('pages', id)))).filter(Boolean);
    const pr = Ink.progress('正在导出 PDF');
    try { await Ink.io.exportPdf(nb.title, pages, (i, n) => pr.set(`正在生成第 ${i} / ${n} 页`, i / n)); Ink.toast('PDF 已导出'); }
    catch (e) { console.error(e); Ink.alert('导出失败', String(e.message || e)); }
    finally { pr.close(); }
  }
  L.exportNbPdf = exportNbPdf;

  async function deleteNb(nb) {
    const n = nb.pageCount || nb.pageIds.length;
    if (!(await Ink.confirm('删除笔记本', `「${nb.title}」和里面的 ${n} 页会被永久删除，无法恢复。`, '删除', true))) return;
    await Ink.db.delMany('pages', nb.pageIds);
    await Ink.db.del('notebooks', nb.id);
    Ink.db.gcBlobs().catch(() => {});
    Ink.toast('已删除「' + nb.title + '」');
    L.reload();
  }

  async function exportBackup() {
    const pr = Ink.progress('正在打包备份');
    try { const r = await Ink.io.exportBackup((i, n) => pr.set(`正在打包图片 ${i} / ${n}`, i / n)); Ink.toast(`已导出 ${r.notebooks} 本笔记本`); }
    catch (e) { console.error(e); Ink.alert('备份失败', String(e.message || e)); }
    finally { pr.close(); }
  }
  async function importBackup() {
    const f = await Ink.pickFile('application/json,.json');
    if (!f) return;
    if (!(await Ink.confirm('从备份恢复', '备份里的笔记本会合并进来；相同的笔记本会被备份里的版本覆盖。', '恢复'))) return;
    const pr = Ink.progress('正在恢复备份');
    try { const r = await Ink.io.importBackup(f); pr.close(); Ink.toast(`已恢复 ${r.notebooks} 本笔记本`); L.reload(); }
    catch (e) { pr.close(); console.error(e); Ink.alert('恢复失败', e.userMessage || String(e.message || e)); }
  }
})();
