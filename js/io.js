/* 墨记 · 导入与导出：PDF 导入（pdf.js）、PDF/PNG 导出、整库备份 */
(function () {
  'use strict';
  const IO = (Ink.io = {});
  const R = Ink.render;
  const CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => { s.remove(); rej(new Error('无法加载 ' + src)); };
      document.head.append(s);
    });
  }

  /* 先找本地 vendor/ 里的 pdf.js（可离线），找不到再用 CDN */
  let pdfjsP = null;
  function getPdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsP) return pdfjsP;
    pdfjsP = (async () => {
      let base = 'vendor/';
      try { await loadScript(base + 'pdf.min.js'); }
      catch (e) { base = CDN; await loadScript(base + 'pdf.min.js'); }
      const lib = window.pdfjsLib;
      if (!lib) throw new Error('pdf.js 加载失败');
      lib.GlobalWorkerOptions.workerSrc = new URL(base + 'pdf.worker.min.js', location.href).href;
      return lib;
    })();
    pdfjsP.catch(() => (pdfjsP = null));
    return pdfjsP;
  }

  const toBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));

  IO.importPdf = async function (file, onProgress, folderId) {
    let lib;
    try { lib = await getPdfjs(); }
    catch (e) {
      const err = new Error('pdf');
      err.userMessage = '没能加载 PDF 组件。第一次导入 PDF 需要联网（约 1 MB）；想完全离线使用，请按 README 把 pdf.js 放进 vendor 文件夹。';
      throw err;
    }
    const data = new Uint8Array(await file.arrayBuffer());
    let doc;
    try { doc = await lib.getDocument({ data }).promise; }
    catch (e) {
      const err = new Error('pdf');
      err.userMessage = e && e.name === 'PasswordException' ? '这个 PDF 有密码保护，暂时无法导入。' : '这个文件无法作为 PDF 读取，可能已损坏。';
      throw err;
    }
    const nbId = Ink.uid();
    const pages = [];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const vp1 = pg.getViewport({ scale: 1 }); // 单位：pt
      const w = Math.round(vp1.width / 0.75), h = Math.round(vp1.height / 0.75);
      const scale = Math.min(2 / 0.75, 4200 / Math.max(vp1.width, vp1.height));
      const vp = pg.getViewport({ scale });
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await toBlob(canvas, 'image/jpeg', 0.9);
      const key = await Ink.blobs.put(blob);
      const page = { id: Ink.uid(), nbId, w, h, template: 'blank', paper: 'white', bg: key, strokes: [], objects: [] };
      await Ink.db.put('pages', page);
      pages.push(page);
      pg.cleanup();
      onProgress && onProgress(i, doc.numPages);
    }
    doc.destroy();
    const now = Date.now();
    const nb = {
      id: nbId, title: file.name.replace(/\.pdf$/i, '') || 'PDF 文稿', folderId: folderId || null, cover: 'preview', fav: false,
      created: now, updated: now, pageIds: pages.map((p) => p.id), pageCount: pages.length, lastPage: 0, textIndex: '',
    };
    nb.thumb = await IO.thumbData(pages[0]);
    await Ink.db.put('notebooks', nb);
    return nb;
  };

  IO.thumbData = async function (page) {
    if (!page) return null;
    const c = await R.renderPageCanvas(page, 320 / R.region(page).w);
    return c.toDataURL('image/jpeg', 0.82);
  };

  /* ---------- 极简 PDF 写入：每页一张 JPEG ---------- */
  IO.buildPdf = function (imgs) {
    const enc = new TextEncoder();
    const chunks = [];
    let len = 0;
    const offsets = [];
    const add = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
    const obj = (n, dict, stream) => {
      offsets[n] = len;
      add(`${n} 0 obj\n${dict}\n`);
      if (stream) { add('stream\n'); add(stream); add('\nendstream\n'); }
      add('endobj\n');
    };
    add('%PDF-1.4\n');
    add(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    const n = imgs.length;
    const kids = imgs.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
    imgs.forEach((im, i) => {
      const pn = 3 + i * 3, cn = pn + 1, inum = pn + 2;
      const W = im.w.toFixed(2), H = im.h.toFixed(2);
      const content = enc.encode(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`);
      obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${inum} 0 R >> >> /Contents ${cn} 0 R >>`);
      obj(cn, `<< /Length ${content.length} >>`, content);
      obj(inum, `<< /Type /XObject /Subtype /Image /Width ${im.pw} /Height ${im.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>`, im.bytes);
    });
    const total = 3 + n * 3;
    const xref = len;
    let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    add(x);
    add(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  };

  IO.exportPdf = async function (title, pages, onProgress) {
    const imgs = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i], g = R.region(p);
      const c = await R.renderPageCanvas(p, Math.min(2, 7000 / Math.max(g.w, g.h)));
      const blob = await toBlob(c, 'image/jpeg', 0.92);
      imgs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), pw: c.width, ph: c.height, w: g.w * 0.75, h: g.h * 0.75 });
      onProgress && onProgress(i + 1, pages.length);
    }
    const pdf = IO.buildPdf(imgs);
    Ink.download(pdf, Ink.safeName(title) + '.pdf');
    return pdf;
  };

  IO.exportPng = async function (title, page, index) {
    const g = R.region(page);
    const c = await R.renderPageCanvas(page, Math.min(2, 7000 / Math.max(g.w, g.h)));
    const blob = await toBlob(c, 'image/png');
    Ink.download(blob, `${Ink.safeName(title)}-第${index + 1}页.png`);
  };

  /* ---------- 备份 ---------- */
  const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  function dataURLToBlob(u) {
    const i = u.indexOf(',');
    const mime = (u.slice(0, i).match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(u.slice(i + 1));
    const arr = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
    return new Blob([arr], { type: mime });
  }

  IO.exportBackup = async function (onProgress) {
    const [folders, notebooks, pages, keys] = await Promise.all([Ink.db.all('folders'), Ink.db.all('notebooks'), Ink.db.all('pages'), Ink.db.keys('blobs')]);
    const blobs = {};
    for (let i = 0; i < keys.length; i++) {
      const b = await Ink.db.get('blobs', keys[i]);
      if (b) blobs[keys[i]] = await blobToDataURL(b);
      onProgress && onProgress(i + 1, keys.length);
    }
    const data = { app: 'inkji', version: 1, exported: Date.now(), folders, notebooks, pages, blobs };
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    Ink.download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `墨记备份-${stamp}.json`);
    return { notebooks: notebooks.length, pages: pages.length };
  };

  IO.importBackup = async function (file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { throw Object.assign(new Error('bad'), { userMessage: '这个文件不是有效的 JSON。' }); }
    if (!data || data.app !== 'inkji') throw Object.assign(new Error('bad'), { userMessage: '这不是墨记的备份文件。' });
    for (const k in data.blobs || {}) await Ink.db.put('blobs', dataURLToBlob(data.blobs[k]), k);
    await Ink.db.putMany('folders', data.folders || []);
    await Ink.db.putMany('pages', data.pages || []);
    await Ink.db.putMany('notebooks', data.notebooks || []);
    return { notebooks: (data.notebooks || []).length };
  };
})();
