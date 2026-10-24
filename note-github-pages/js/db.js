/* 墨记 · 本地存储（IndexedDB）
 * folders   {id, name, created}
 * notebooks {id, title, folderId, cover, fav, created, updated, pageIds[], pageCount, thumb, textIndex, lastPage}
 * pages     {id, nbId, w, h, template, paper, bg?, strokes[], objects[]}
 * blobs     key -> Blob（PDF 页面底图、插入的图片）
 */
(function () {
  'use strict';
  const DB_NAME = 'inkji', VER = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ['folders', 'notebooks', 'pages']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('数据库被其他标签页占用，请关闭其他墨记窗口后刷新'));
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then((d) => new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      const r = fn(s);
      if (r && 'onsuccess' in r) r.onsuccess = () => (out = r.result);
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('事务中止'));
    }));
  }

  Ink.db = {
    open,
    all: (s) => tx(s, 'readonly', (st) => st.getAll()),
    keys: (s) => tx(s, 'readonly', (st) => st.getAllKeys()),
    get: (s, k) => tx(s, 'readonly', (st) => st.get(k)),
    put: (s, v, k) => tx(s, 'readwrite', (st) => (k === undefined ? st.put(v) : st.put(v, k))),
    del: (s, k) => tx(s, 'readwrite', (st) => st.delete(k)),
    putMany: (s, arr) => (arr.length ? tx(s, 'readwrite', (st) => { arr.forEach((v) => st.put(v)); }) : Promise.resolve()),
    delMany: (s, keys) => (keys.length ? tx(s, 'readwrite', (st) => { keys.forEach((k) => st.delete(k)); }) : Promise.resolve()),

    /** 删除没有任何页面引用的图片 */
    async gcBlobs() {
      const [pages, keys] = await Promise.all([Ink.db.all('pages'), Ink.db.keys('blobs')]);
      const used = new Set();
      for (const p of pages) {
        if (p.bg) used.add(p.bg);
        for (const o of p.objects || []) if (o.src) used.add(o.src);
      }
      const dead = keys.filter((k) => !used.has(k) && !String(k).startsWith('font_')); // 导入的字体不算垃圾
      await Ink.db.delMany('blobs', dead);
      return dead.length;
    },
  };

  /* ---------- 图片缓存：渲染时同步取用，没加载好就先异步加载 ---------- */
  const loaded = new Map();
  const pending = new Map();
  function toBitmap(blob) {
    if (!blob) return Promise.resolve(null);
    if (window.createImageBitmap) return createImageBitmap(blob).catch(() => viaImg(blob));
    return viaImg(blob);
  }
  function viaImg(blob) {
    return new Promise((res) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = url;
    });
  }

  Ink.blobs = {
    async put(blob) {
      const k = 'b_' + Ink.uid();
      await Ink.db.put('blobs', blob, k);
      return k;
    },
    load(k) {
      if (loaded.has(k)) return Promise.resolve(loaded.get(k));
      if (!pending.has(k)) {
        pending.set(k, Ink.db.get('blobs', k).then(toBitmap).catch(() => null).then((bm) => {
          loaded.set(k, bm);
          pending.delete(k);
          Ink.emit('blob-loaded', k);
          return bm;
        }));
      }
      return pending.get(k);
    },
    peek(k) {
      if (loaded.has(k)) return loaded.get(k);
      Ink.blobs.load(k);
      return null;
    },
  };
})();
