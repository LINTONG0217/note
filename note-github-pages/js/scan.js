/* 墨记 · 扫描文档：拍照 / 选图 → 自动找纸张四角 → 手动微调 → 透视纠偏 → 去阴影增强 → 生成页面 */
(function () {
  'use strict';
  const SC = (Ink.scan = {});
  const h = Ink.h, clamp = Ink.clamp;
  const MAX_SRC = 2600; // 原图最长边（太大会占内存）
  const MAX_OUT = 2200; // 输出最长边
  const FILTERS = [['enhance', '增强'], ['gray', '灰度'], ['bw', '黑白'], ['original', '原图']];

  /* ---------- 图像工具 ---------- */
  const mk = (w, hh) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hh)); return c; };
  const ctx2 = (c) => c.getContext('2d', { willReadFrequently: true });

  async function decode(file, max) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode(); // 浏览器会按照片的 EXIF 方向自动转正
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = mk(img.naturalWidth * k, img.naturalHeight * k);
      const x = ctx2(c);
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, c.width, c.height);
      return c;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function boxBlur(g, w, hh, r) {
    const t = new Float32Array(g.length);
    for (let y = 0; y < hh; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += g[y * w + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        t[y * w + x] = acc / (2 * r + 1);
        acc += g[y * w + Math.min(w - 1, x + r + 1)] - g[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += t[clamp(y, 0, hh - 1) * w + x];
      for (let y = 0; y < hh; y++) {
        g[y * w + x] = acc / (2 * r + 1);
        acc += t[Math.min(hh - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x];
      }
    }
  }

  /* 多阈值区域 + 边缘封闭区域产生候选，按四条边的真实支持度选纸张。
   * 不假定纸一定是最亮区域；识别不可靠时保留原图，避免静默切掉内容。 */
  SC.detectDetailed = function (src) {
    const scale = Math.min(1, 480 / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * scale)), hh = Math.max(1, Math.round(src.height * scale));
    const c = mk(w, hh), x = ctx2(c);
    x.drawImage(src, 0, 0, w, hh);
    const d = x.getImageData(0, 0, w, hh).data, N = w * hh;
    const g = new Float32Array(N);
    for (let i = 0; i < N; i++) g[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2];
    boxBlur(g, w, hh, 1);
    const grad = new Float32Array(N), hist = new Uint32Array(256);
    for (const v of g) hist[v | 0]++;
    for (let y = 1; y < hh - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
      const i = y * w + xx;
      grad[i] = Math.hypot(g[i + 1] - g[i - 1], g[i + w] - g[i - w]);
    }
    let total = 0, count = 0, sum = 0, bestVariance = -1, otsu = 128;
    for (let i = 0; i < 256; i++) total += hist[i] * i;
    const quantiles = [];
    for (let i = 0; i < 256; i++) {
      count += hist[i]; sum += hist[i] * i;
      while (quantiles.length < 3 && count >= N * (.25 + quantiles.length * .25)) quantiles.push(i);
      if (!count || count === N) continue;
      const variance = count * (N - count) * (sum / count - (total - sum) / (N - count)) ** 2;
      if (variance > bestVariance) { bestVariance = variance; otsu = i; }
    }
    const at = (a, xx, y) => a[clamp(Math.round(y), 0, hh - 1) * w + clamp(Math.round(xx), 0, w - 1)];
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    function hull(points) {
      points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const lo = [], hi = [];
      for (const p of points) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (let i = points.length - 1; i >= 0; i--) { const p = points[i]; while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
      lo.pop(); hi.pop();
      return lo.concat(hi);
    }
    function quadOf(points) {
      const a = hull(points);
      if (a.length < 4) return null;
      while (a.length > 4) {
        let least = Infinity, index = 0;
        for (let i = 0; i < a.length; i++) {
          const cost = Math.abs(cross(a[(i + a.length - 1) % a.length], a[i], a[(i + 1) % a.length]));
          if (cost < least) { least = cost; index = i; }
        }
        a.splice(index, 1);
      }
      let first = 0;
      for (let i = 1; i < 4; i++) if (a[i][0] + a[i][1] < a[first][0] + a[first][1]) first = i;
      return [...a.slice(first), ...a.slice(0, first)].flat();
    }
    function score(q) {
      if (!q || !convex(q)) return 0;
      const area = Math.abs(polyArea(q)) / N;
      if (area < .08 || area > .985) return 0;
      let coverage = 0, weakest = 1, contrast = 0, border = 0;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4, prev = (i + 3) % 4;
        const ax = q[i * 2], ay = q[i * 2 + 1], dx = q[j * 2] - ax, dy = q[j * 2 + 1] - ay;
        const len = Math.hypot(dx, dy), ux = q[prev * 2] - ax, uy = q[prev * 2 + 1] - ay;
        if (len < Math.min(w, hh) * .12 || Math.abs(dx * ux + dy * uy) / (len * Math.hypot(ux, uy)) > .94) return 0;
        const nx = -dy / len, ny = dx / len, steps = Math.max(12, Math.ceil(len / 3));
        let hits = 0, strength = 0;
        for (let j = 1; j < steps; j++) {
          const px = ax + dx * j / steps, py = ay + dy * j / steps;
          if (px < 2 || px > w - 3 || py < 2 || py > hh - 3) { border++; continue; }
          const diff = Math.abs(at(g, px + nx * 4, py + ny * 4) - at(g, px - nx * 4, py - ny * 4));
          let edge = 0;
          for (let off = -2; off <= 2; off++) edge = Math.max(edge, at(grad, px + nx * off, py + ny * off));
          if (diff > 5 && edge > 3) hits++;
          strength += Math.min(1, diff / 32);
        }
        const support = hits / (steps - 1);
        weakest = Math.min(weakest, support); coverage += support / 4; contrast += strength / (steps - 1) / 4;
      }
      if (weakest < .52 || coverage < .68 || border > 12) return 0;
      return coverage * .38 + weakest * .22 + contrast * .18 + Math.sqrt(area) * .22;
    }
    // 以边缘附近的点拟合直线，修正缩小采样及阴影导致的四角偏移。
    function refine(q) {
      const lines = [];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4, ax = q[i * 2], ay = q[i * 2 + 1];
        const dx = q[j * 2] - ax, dy = q[j * 2 + 1] - ay, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
        const points = [];
        for (let t = .08; t < .94; t += 3 / len) {
          const px = ax + dx * t, py = ay + dy * t;
          let best = 3, offset = null;
          for (let o = -5; o <= 5; o++) {
            const v = at(grad, px + nx * o, py + ny * o) / (1 + Math.abs(o) * .12);
            if (v > best) { best = v; offset = o; }
          }
          if (offset !== null) points.push([px + nx * offset, py + ny * offset]);
        }
        if (points.length < 6) return q;
        const fit = (ps) => {
          const mx = ps.reduce((a, p) => a + p[0], 0) / ps.length, my = ps.reduce((a, p) => a + p[1], 0) / ps.length;
          let xx = 0, yy = 0, xy = 0;
          for (const [x, y] of ps) { xx += (x - mx) ** 2; yy += (y - my) ** 2; xy += (x - mx) * (y - my); }
          const theta = .5 * Math.atan2(2 * xy, xx - yy), a = -Math.sin(theta), b = Math.cos(theta);
          return [a, b, a * mx + b * my];
        };
        let line = fit(points);
        const inliers = points.filter(([x, y]) => Math.abs(line[0] * x + line[1] * y - line[2]) < 2.5);
        if (inliers.length >= 6) line = fit(inliers);
        lines.push(line);
      }
      const out = [];
      for (let i = 0; i < 4; i++) {
        const a = lines[(i + 3) % 4], b = lines[i], det = a[0] * b[1] - b[0] * a[1];
        if (Math.abs(det) < .1) return q;
        const x = (a[2] * b[1] - b[2] * a[1]) / det, y = (a[0] * b[2] - b[0] * a[2]) / det;
        if (x < 0 || x >= w || y < 0 || y >= hh || Math.hypot(x - q[i * 2], y - q[i * 2 + 1]) > 12) return q;
        out.push(x, y);
      }
      return out;
    }
    let bestQ = null, bestScore = 0;
    const seen = new Uint8Array(N), queue = new Int32Array(N), mask = new Uint8Array(N);
    function candidates() {
      seen.fill(0);
      for (let start = 0; start < N; start++) {
        if (!mask[start] || seen[start]) continue;
        let head = 0, tail = 1, borders = 0;
        queue[0] = start; seen[start] = 1;
        const visit = (i) => { if (!seen[i] && mask[i]) { seen[i] = 1; queue[tail++] = i; } };
        while (head < tail) {
          const p = queue[head++], px = p % w, py = (p / w) | 0;
          if (!px) borders |= 1; if (px === w - 1) borders |= 2;
          if (!py) borders |= 4; if (py === hh - 1) borders |= 8;
          if (px) visit(p - 1); if (px < w - 1) visit(p + 1);
          if (py) visit(p - w); if (py < hh - 1) visit(p + w);
        }
        if (tail < N * .06 || tail > N * .98 || borders === 15) continue;
        const left = new Int32Array(hh).fill(w), right = new Int32Array(hh).fill(-1);
        for (let i = 0; i < tail; i++) { const p = queue[i], y = (p / w) | 0, x = p % w; left[y] = Math.min(left[y], x); right[y] = Math.max(right[y], x); }
        const points = [];
        for (let y = 0; y < hh; y++) if (right[y] >= 0) { points.push([left[y], y]); points.push([right[y], y]); }
        const q = quadOf(points);
        if (!q) continue;
        for (const candidate of [q, refine(q)]) {
          const value = score(candidate);
          if (value > bestScore) { bestScore = value; bestQ = candidate; }
        }
      }
    }
    const thresholds = [...new Set([otsu, otsu - 14, otsu + 14, ...quantiles].map((v) => clamp(v, 1, 254)))];
    for (const threshold of thresholds) for (const bright of [true, false]) {
      for (let i = 0; i < N; i++) mask[i] = bright ? g[i] > threshold : g[i] <= threshold;
      candidates();
    }
    // 闭合的边缘内区不要求亮度一致，纸上有阴影或桌面更亮时仍可产生候选。
    for (const threshold of [7, 16, 30]) {
      mask.fill(1);
      for (let y = 1; y < hh - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
        const i = y * w + xx;
        if (grad[i] < threshold) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mask[i + dy * w + dx] = 0;
      }
      candidates();
    }
    // 阴影可能使纸边在局部消失：用直线投票连接断开的边，再比较四边形。
    const bins = 60, radius = Math.ceil(Math.hypot(w, hh) / 2), stride = radius * 2 + 1;
    const votes = new Float32Array(bins * stride), cos = [], sin = [];
    for (let a = 0; a < bins; a++) { cos[a] = Math.cos(a * Math.PI / bins); sin[a] = Math.sin(a * Math.PI / bins); }
    for (let y = 2; y < hh - 2; y++) for (let xx = 2; xx < w - 2; xx++) {
      const i = y * w + xx;
      if (grad[i] < 5) continue;
      const gx = g[i + 1] - g[i - 1], gy = g[i + w] - g[i - w];
      let angle = Math.atan2(gy, gx); if (angle < 0) angle += Math.PI;
      const center = Math.round(angle * bins / Math.PI);
      for (let delta = -2; delta <= 2; delta++) {
        const a = (center + delta + bins) % bins, rho = Math.round((xx * cos[a] + y * sin[a]) / 2) + radius;
        votes[a * stride + rho] += Math.min(1, grad[i] / 12);
      }
    }
    const peaks = [];
    for (let a = 0; a < bins; a++) for (let r = 1; r < stride - 1; r++) {
      const v = votes[a * stride + r];
      if (v < Math.min(w, hh) * .22 || v < votes[a * stride + r - 1] || v < votes[a * stride + r + 1]) continue;
      peaks.push({ a, rho: (r - radius) * 2, v });
    }
    peaks.sort((a, b) => b.v - a.v);
    const lines = [];
    for (const p of peaks) {
      if (lines.some((q) => {
        const diff = Math.abs(p.a - q.a), flipped = diff > bins / 2;
        return Math.min(diff, bins - diff) <= 3 && Math.abs(p.rho - (flipped ? -q.rho : q.rho)) < 10;
      })) continue;
      lines.push(p); if (lines.length === 18) break;
    }
    const angleBetween = (a, b) => { const d = Math.abs(a.a - b.a); return Math.min(d, bins - d) * Math.PI / bins; };
    const intersect = (a, b) => {
      const det = cos[a.a] * sin[b.a] - cos[b.a] * sin[a.a];
      if (Math.abs(det) < .3) return null;
      const x = (a.rho * sin[b.a] - b.rho * sin[a.a]) / det, y = (cos[a.a] * b.rho - cos[b.a] * a.rho) / det;
      return x >= 0 && x < w && y >= 0 && y < hh ? [x, y] : null;
    };
    const pairs = [];
    for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) if (angleBetween(lines[i], lines[j]) < .55) pairs.push([i, j]);
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
      const [a, b] = pairs[i], [c, d] = pairs[j];
      if (a === c || a === d || b === c || b === d || angleBetween(lines[a], lines[c]) < .65) continue;
      const corners = [intersect(lines[a], lines[c]), intersect(lines[a], lines[d]), intersect(lines[b], lines[d]), intersect(lines[b], lines[c])];
      if (corners.some((p) => !p)) continue;
      const q = quadOf(corners);
      const initial = score(q);
      if (initial < Math.max(.55, bestScore - .12)) continue;
      const refined = refine(q), value = score(refined);
      if (value > bestScore) { bestScore = value; bestQ = refined; }
    }
    const confident = bestQ !== null && bestScore >= .64;
    return {
      quad: confident ? bestQ.map((v, i) => clamp((v + .5) * (i % 2 ? src.height / hh : src.width / w), 0, i % 2 ? src.height : src.width)) : [0, 0, src.width, 0, src.width, src.height, 0, src.height],
      confident,
    };
  };
  SC.detect = (src) => SC.detectDetailed(src).quad;

  function polyArea(q) {
    let a = 0;
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; a += q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1]; }
    return a / 2;
  }
  function convex(q) {
    if (q.length !== 8 || !q.every(Number.isFinite) || Math.abs(polyArea(q)) < 1) return false;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = i * 2, b = ((i + 1) % 4) * 2, c = ((i + 2) % 4) * 2;
      const cr = (q[b] - q[a]) * (q[c + 1] - q[b + 1]) - (q[b + 1] - q[a + 1]) * (q[c] - q[b]);
      if (Math.abs(cr) < 1e-6 || (sign && Math.sign(cr) !== sign)) return false;
      sign = Math.sign(cr);
    }
    return true;
  }

  /* ---------- 透视变换 ---------- */
  function solve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let mx = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[mx][i])) mx = r;
      [A[i], A[mx]] = [A[mx], A[i]]; [b[i], b[mx]] = [b[mx], b[i]];
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
      x[i] = s / A[i][i];
    }
    return x;
  }
  /** 求把 from 四点映射到 to 四点的单应矩阵 */
  function homography(from, to) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const x = from[i * 2], y = from[i * 2 + 1], u = to[i * 2], v = to[i * 2 + 1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    return solve(A, b);
  }
  const dist = (q, i, j) => Math.hypot(q[i * 2] - q[j * 2], q[i * 2 + 1] - q[j * 2 + 1]);
  /* 还原纸张真实宽高比（Zhang & He 的白板扫描方法）：
   * 由四个角估计相机焦距，再求矩形的宽高比；照片透视越强，简单量边长误差越大。
   * 估计不可靠时退回边长比例；接近 A4 / Letter 时吸附到标准比例。 */
  function trueAspect(q, sw, sh) {
    const cx = sw / 2, cy = sh / 2;
    const P = (i) => [q[i * 2] - cx, q[i * 2 + 1] - cy, 1];
    const m1 = P(0), m2 = P(1), m4 = P(2), m3 = P(3); // 左上、右上、右下、左下
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const c14 = cross(m1, m4);
    const k2 = dot(c14, m3) / dot(cross(m2, m4), m3);
    const k3 = dot(c14, m2) / dot(cross(m3, m4), m2);
    const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
    const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
    const edge = Math.max(dist(q, 0, 1), dist(q, 3, 2)) / Math.max(dist(q, 0, 3), dist(q, 1, 2));
    let ar = edge;
    const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
    if (isFinite(f2) && f2 > 0 && Math.abs(n2[2] * n3[2]) > 1e-9) {
      const a = Math.sqrt((n2[0] ** 2 + n2[1] ** 2) / f2 + n2[2] ** 2) / Math.sqrt((n3[0] ** 2 + n3[1] ** 2) / f2 + n3[2] ** 2);
      const f = Math.sqrt(f2), diag = Math.hypot(sw, sh);
      if (isFinite(a) && a > 0.25 && a < 4 && f > diag * 0.3 && f < diag * 6) ar = a; // 焦距在常见手机镜头范围内才采用
    } else if (Math.abs(n2[2]) < 1e-9 || Math.abs(n3[2]) < 1e-9) {
      ar = Math.hypot(n2[0], n2[1]) / Math.hypot(n3[0], n3[1]); // 几乎正对拍摄
    }
    for (const std of [210 / 297, 297 / 210, 8.5 / 11, 11 / 8.5]) if (Math.abs(ar / std - 1) < 0.06) return std;
    return ar;
  }
  function outSize(q, maxSide, sw, sh) {
    const ar = trueAspect(q, sw, sh);
    const L = Math.max(dist(q, 0, 1), dist(q, 3, 2), dist(q, 0, 3), dist(q, 1, 2));
    let W = ar >= 1 ? L : L * ar, H = ar >= 1 ? L / ar : L;
    const k = Math.min(1, maxSide / Math.max(W, H));
    return [Math.max(8, Math.round(W * k)), Math.max(8, Math.round(H * k))];
  }
  function warp(srcData, sw, sh, q, W, H) {
    const Hm = homography([0, 0, W, 0, W, H, 0, H], q);
    const out = new ImageData(W, H), od = out.data, sd = srcData;
    for (let v = 0; v < H; v++) {
      const vv = v + 0.5;
      for (let u = 0; u < W; u++) {
        const uu = u + 0.5;
        const den = Hm[6] * uu + Hm[7] * vv + 1;
        let x = (Hm[0] * uu + Hm[1] * vv + Hm[2]) / den - 0.5;
        let y = (Hm[3] * uu + Hm[4] * vv + Hm[5]) / den - 0.5;
        x = x < 0 ? 0 : x > sw - 1.001 ? sw - 1.001 : x;
        y = y < 0 ? 0 : y > sh - 1.001 ? sh - 1.001 : y;
        const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        const o = (v * W + u) * 4;
        for (let c = 0; c < 3; c++) {
          const top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx;
          const bot = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx;
          od[o + c] = top + (bot - top) * fy;
        }
        od[o + 3] = 255;
      }
    }
    return out;
  }

  /* ---------- 去阴影 / 增强 ----------
   * 估计纸张背景：缩小 → 最大值滤波（把深色文字“抹掉”）→ 模糊 → 放大；
   * 再用原图除以背景，阴影和光照不均就被拉平了。 */
  function enhance(img, mode) {
    if (mode === 'original') return img;
    const W = img.width, H = img.height, d = img.data;
    const full = mk(W, H);
    ctx2(full).putImageData(img, 0, 0);
    const bw = Math.max(6, Math.round(W / 16)), bh = Math.max(6, Math.round(H / 16));
    const small = mk(bw, bh), sx = ctx2(small);
    sx.imageSmoothingQuality = 'high';
    sx.drawImage(full, 0, 0, bw, bh);
    const sdat = sx.getImageData(0, 0, bw, bh), s = sdat.data;
    const tmp = new Uint8ClampedArray(s.length);
    for (let it = 0; it < 3; it++) {
      tmp.set(s);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        for (let c = 0; c < 3; c++) {
          let m = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = clamp(x + dx, 0, bw - 1), yy = clamp(y + dy, 0, bh - 1);
            const v = tmp[(yy * bw + xx) * 4 + c];
            if (v > m) m = v;
          }
          s[(y * bw + x) * 4 + c] = m;
        }
      }
    }
    for (let c = 0; c < 3; c++) {
      const ch = new Float32Array(bw * bh);
      for (let i = 0; i < bw * bh; i++) ch[i] = s[i * 4 + c];
      boxBlur(ch, bw, bh, 1);
      for (let i = 0; i < bw * bh; i++) s[i * 4 + c] = ch[i];
    }
    sx.putImageData(sdat, 0, 0);
    const bg = mk(W, H), bx = ctx2(bg);
    bx.imageSmoothingEnabled = true;
    bx.imageSmoothingQuality = 'high';
    bx.drawImage(small, 0, 0, W, H);
    const b = bx.getImageData(0, 0, W, H).data;
    const lo = 0.1, hi = 0.93;
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      const r = d[o] / Math.max(1, b[o]), g = d[o + 1] / Math.max(1, b[o + 1]), bl = d[o + 2] / Math.max(1, b[o + 2]);
      if (mode === 'enhance') {
        const f = (v) => { v = clamp((v - lo) / (hi - lo), 0, 1); return 255 * Math.pow(v, 1.35); };
        d[o] = f(r); d[o + 1] = f(g); d[o + 2] = f(bl);
      } else {
        let L = clamp((0.299 * r + 0.587 * g + 0.114 * bl - lo) / (hi - lo), 0, 1);
        if (mode === 'bw') { L = clamp((L - 0.5) / 0.3, 0, 1); L = L * L * (3 - 2 * L); }
        else L = Math.pow(L, 1.3);
        d[o] = d[o + 1] = d[o + 2] = L * 255;
      }
    }
    return img;
  }

  function rotate(c, rot) {
    const r = ((rot % 4) + 4) % 4;
    if (!r) return c;
    const o = r % 2 ? mk(c.height, c.width) : mk(c.width, c.height);
    const x = o.getContext('2d');
    x.translate(o.width / 2, o.height / 2);
    x.rotate((r * Math.PI) / 2);
    x.drawImage(c, -c.width / 2, -c.height / 2);
    return o;
  }

  /** 把一页扫描处理成画布 */
  async function processPage(pg, maxSide) {
    const src = await srcOf(pg);
    const sd = srcData(pg, src);
    const [W, H] = outSize(pg.quad, maxSide, src.width, src.height);
    let img = warp(sd, src.width, src.height, pg.quad, W, H);
    img = enhance(img, pg.filter);
    const c = mk(W, H);
    ctx2(c).putImageData(img, 0, 0);
    return rotate(c, pg.rot);
  }

  /* 只缓存当前页的原图，避免多页扫描时占满内存 */
  let cache = { pg: null, src: null, data: null };
  async function srcOf(pg) {
    if (cache.pg === pg && cache.src) return cache.src;
    const src = await decode(pg.file, MAX_SRC);
    cache = { pg, src, data: null };
    return src;
  }
  function srcData(pg, src) {
    if (cache.pg === pg && cache.data) return cache.data;
    const data = ctx2(src).getImageData(0, 0, src.width, src.height).data;
    if (cache.pg === pg) cache.data = data;
    return data;
  }

  /* ---------- 相机取景：识别在 Worker 中串行执行，取景视频保持流畅 ---------- */
  function createCameraDetector() {
    let worker = null, pending = null, closed = false;
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
      const source = `
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const mk = (w, h) => new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
        const ctx2 = (c) => c.getContext('2d', {willReadFrequently:true});
        const boxBlur = ${boxBlur.toString()};
        const polyArea = ${polyArea.toString()};
        const convex = ${convex.toString()};
        const detect = ${SC.detectDetailed.toString()};
        self.onmessage = ({data}) => {
          try { self.postMessage({result:detect(data)}); }
          catch (e) { self.postMessage({error:String(e.message || e)}); }
          finally { data.close(); }
        };`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try { worker = new Worker(url); } catch (e) { /* 老浏览器或受限环境改用低频识别 */ }
      finally { URL.revokeObjectURL(url); }
    }
    function stopWorker() { if (worker) worker.terminate(); worker = null; }
    return {
      async detect(src, live = false) {
        if (closed) throw new Error('相机已关闭');
        // 不支持 Worker 时降低取景识别分辨率；拍照后仍用完整检测精度。
        const k = Math.min(1, (worker || !live ? 480 : 240) / Math.max(src.width, src.height));
        const sample = mk(src.width * k, src.height * k);
        ctx2(sample).drawImage(src, 0, 0, sample.width, sample.height);
        let result;
        if (worker) {
          let bitmap;
          try {
            bitmap = await createImageBitmap(sample);
            if (closed) { bitmap.close(); throw new Error('相机已关闭'); }
            result = await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('边框识别超时')), 8000);
              pending = (error, value) => { clearTimeout(timer); pending = null; error ? reject(error) : resolve(value); };
              worker.onmessage = ({ data }) => pending && pending(data.error ? new Error(data.error) : null, data.result);
              worker.onerror = () => pending && pending(new Error('无法启动边框识别'));
              try { worker.postMessage(bitmap, [bitmap]); }
              catch (error) { pending(error); }
            });
          } catch (error) {
            if (bitmap) bitmap.close();
            stopWorker();
            if (pending) pending(error);
            if (closed) throw error;
          }
        }
        if (!result) {
          await new Promise((r) => setTimeout(r, 0));
          if (closed) throw new Error('相机已关闭');
          result = SC.detectDetailed(sample);
        }
        return { confident: result.confident, quad: result.quad.map((v, i) => v * (i % 2 ? src.height / sample.height : src.width / sample.width)) };
      },
      close() {
        closed = true;
        if (pending) pending(new Error('相机已关闭'));
        stopWorker();
      },
    };
  }

  SC.capturePhoto = function () {
    return new Promise((resolve) => {
      let stream = null, detector = null, ended = false, capturing = false;
      let timer = 0, animation = 0, inFlight = Promise.resolve();
      let target = null, shown = null, lastGood = 0, lastSize = '', stable = 0;
      const previousFocus = document.activeElement;
      const video = h('video', { autoplay: true, muted: true, playsinline: true, 'aria-label': '后置相机取景',
        style: { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain' } });
      video.muted = true; video.playsInline = true;
      const overlay = h('canvas', { 'aria-hidden': 'true', style: { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' } });
      const message = h('p', { role: 'status', 'aria-live': 'polite', style: { margin: '0', padding: '10px 20px', textAlign: 'center', color: '#d5ddec' } }, '正在打开后置相机…');
      const main = h('div', { class: 'scan-main', style: { overflow: 'hidden' } }, video, overlay);
      const shutter = h('button', { class: 'btn primary', disabled: true, onclick: capture,
        style: { minWidth: '140px', minHeight: '52px', borderRadius: '28px', fontSize: '17px' } }, '拍照');
      const system = h('button', { class: 'btn ghost', onclick: () => {
        // 文件选择器必须直接由点击触发，iPad 不允许异步回调擅自打开系统相机。
        const files = pickImages(true); finish({ files });
      } }, '系统相机');
      const root = h('div', { class: 'scan', role: 'dialog', 'aria-modal': 'true', 'aria-label': '实时扫描相机', tabindex: '-1', style: { zIndex: '160' } },
        h('header', { class: 'scan-top' }, h('button', { class: 'btn ghost', onclick: () => finish(null) }, '返回'), h('div', { class: 'scan-title' }, '对准纸张'), system),
        main, message,
        h('div', { style: { display: 'flex', justifyContent: 'center', padding: '8px 16px calc(16px + env(safe-area-inset-bottom, 0px))' } }, shutter));
      document.body.append(root);
      root.focus();
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(null); }
        if (e.key === 'Tab') {
          const buttons = [...root.querySelectorAll('button')].filter((b) => !b.disabled);
          const index = buttons.indexOf(document.activeElement);
          if (index < 0 || (!e.shiftKey && index === buttons.length - 1) || (e.shiftKey && index === 0)) {
            e.preventDefault(); buttons[e.shiftKey ? buttons.length - 1 : 0].focus();
          }
        }
      };
      const onHidden = () => { if (document.hidden) finish(null); };
      const onPageHide = () => finish(null);
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('visibilitychange', onHidden);
      window.addEventListener('pagehide', onPageHide);

      function release() {
        clearTimeout(timer); cancelAnimationFrame(animation);
        if (detector) detector.close();
        if (stream) stream.getTracks().forEach((track) => track.stop());
        stream = null; video.srcObject = null;
      }
      function finish(value) {
        if (ended) return;
        ended = true; release();
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('visibilitychange', onHidden);
        window.removeEventListener('pagehide', onPageHide);
        root.remove();
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
        resolve(value);
      }
      function fail(text) {
        if (ended) return;
        release(); target = shown = null;
        overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
        shutter.disabled = true;
        message.textContent = text;
      }
      function accept(result, w, hh) {
        if (!result.confident) { target = shown = null; stable = 0; message.textContent = '请拍全纸张四边，避开反光；也可直接拍照后调整'; return; }
        const next = result.quad.map((v, i) => v / (i % 2 ? hh : w));
        // 旋转时角点编号可能变化：将新边框与上一帧的角点对应，避免连线翻转。
        if (target) {
          const variants = Array.from({ length: 4 }, (_, j) => next.slice(j * 2).concat(next.slice(0, j * 2)));
          variants.sort((a, b) => a.reduce((s, v, i) => s + (v - target[i]) ** 2, 0) - b.reduce((s, v, i) => s + (v - target[i]) ** 2, 0));
          next.splice(0, 8, ...variants[0]);
        }
        const delta = target ? Math.max(...next.map((v, i) => Math.abs(v - target[i]))) : 1;
        stable = delta < .025 ? stable + 1 : 0;
        target = next; lastGood = performance.now();
        if (!shown || delta > .15) shown = next.slice();
        message.textContent = stable >= 2 ? '边框已稳定，点击拍照' : '已找到纸张，请保持平稳';
      }
      function paint() {
        if (ended || capturing) return;
        const W = main.clientWidth, H = main.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
        if (overlay.width !== Math.round(W * dpr) || overlay.height !== Math.round(H * dpr)) { overlay.width = Math.round(W * dpr); overlay.height = Math.round(H * dpr); }
        const x = overlay.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
        const size = video.videoWidth + ',' + video.videoHeight;
        if (lastSize !== size) { target = shown = null; stable = 0; lastSize = size; }
        if (target && performance.now() - lastGood >= 1200) { target = shown = null; stable = 0; message.textContent = '正在重新寻找纸张边框…'; }
        if (target && shown && performance.now() - lastGood < 1200 && video.videoWidth && video.videoHeight) {
          shown = shown.map((v, i) => v + (target[i] - v) * .35);
          const k = Math.min(W / video.videoWidth, H / video.videoHeight), w = video.videoWidth * k, hh = video.videoHeight * k;
          const ox = (W - w) / 2, oy = (H - hh) / 2, q = shown.map((v, i) => i % 2 ? oy + v * hh : ox + v * w);
          x.beginPath(); x.rect(ox, oy, w, hh); x.moveTo(q[0], q[1]); for (let i = 2; i < 8; i += 2) x.lineTo(q[i], q[i + 1]); x.closePath();
          x.fillStyle = 'rgba(0,0,0,.28)'; x.fill('evenodd');
          x.beginPath(); x.moveTo(q[0], q[1]); for (let i = 2; i < 8; i += 2) x.lineTo(q[i], q[i + 1]); x.closePath();
          x.lineWidth = 3; x.strokeStyle = stable >= 2 ? '#67e8a5' : '#9ab6ff'; x.stroke();
          for (let i = 0; i < 8; i += 2) { x.beginPath(); x.arc(q[i], q[i + 1], 5, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill(); }
        }
        animation = requestAnimationFrame(paint);
      }
      function frame(max) {
        const k = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
        const c = mk(video.videoWidth * k, video.videoHeight * k);
        ctx2(c).drawImage(video, 0, 0, c.width, c.height);
        return c;
      }
      function poll() {
        if (ended || capturing) return;
        if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) { timer = setTimeout(poll, 200); return; }
        let c;
        try { c = frame(480); }
        catch (e) { timer = setTimeout(poll, 200); return; }
        const size = video.videoWidth + ',' + video.videoHeight;
        inFlight = detector.detect(c, true).then((result) => {
          if (!ended && !capturing && size === video.videoWidth + ',' + video.videoHeight) accept(result, c.width, c.height);
        }).catch(() => {
          if (!ended && !capturing) { target = shown = null; message.textContent = '边框暂未识别，可直接拍照后调整'; }
        }).finally(() => { if (!ended && !capturing) timer = setTimeout(poll, 180); });
      }
      async function capture() {
        if (ended || capturing || !video.videoWidth || video.readyState < 2) return;
        capturing = true; shutter.disabled = true; clearTimeout(timer); cancelAnimationFrame(animation);
        message.textContent = '正在确认纸张边框…';
        try {
          // 先冻结按下快门时的画面，检测与保存都使用这一帧，不套用过时边框。
          const c = frame(MAX_SRC);
          const frozen = h('canvas', { style: { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain' } });
          frozen.width = c.width; frozen.height = c.height; ctx2(frozen).drawImage(c, 0, 0);
          main.append(frozen);
          await inFlight;
          if (ended) return;
          const result = await detector.detect(c);
          if (ended) return;
          const file = await new Promise((r) => c.toBlob(r, 'image/jpeg', .94));
          if (!file) throw new Error('拍摄图片无法保存');
          finish({ file, quad: result.quad, confident: result.confident });
        } catch (e) {
          if (!ended) fail('拍摄未完成，请返回重试，或使用系统相机');
        }
      }
      async function start() {
        if (!window.isSecureContext) { fail('实时边框需要 HTTPS 地址。当前地址可使用右上角「系统相机」，拍摄后再裁剪。'); return; }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { fail('当前浏览器不支持实时取景，请使用右上角「系统相机」。'); return; }
        try {
          const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
          if (ended) { acquired.getTracks().forEach((t) => t.stop()); return; }
          stream = acquired;
          for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => { if (!ended && !capturing) fail('相机已断开，请返回重试，或使用系统相机'); });
          video.srcObject = stream;
          await video.play();
          if (ended) return;
          detector = createCameraDetector();
          shutter.disabled = false;
          message.textContent = '请将整张纸放入画面，正在寻找边框…';
          paint(); poll();
        } catch (e) {
          const text = e.name === 'NotAllowedError' ? '未获得相机权限，请在 Safari 的网站设置中允许相机，或使用系统相机。'
            : e.name === 'NotFoundError' ? '没有找到可用相机，可返回后从相册选择。' : '相机无法打开，可能正被其他应用使用。请返回重试，或使用系统相机。';
          fail(text);
        }
      }
      start();
    });
  };

  /* ---------- 界面 ---------- */
  /**
   * 打开扫描界面。完成后返回 [{blob, w, h}]（w、h 是页面单位），取消返回 null
   */
  SC.start = function () {
    return new Promise((resolve) => {
      const pages = [];
      let cur = -1, view = 'crop', busy = false, adding = false, closed = false;
      let fit = { k: 1, ox: 0, oy: 0 }, drag = -1, dragPt = null;
      let preview = null; // 预览模式下处理好的画布

      const cv = h('canvas', { class: 'scan-cv' });
      const main = h('div', { class: 'scan-main' }, cv);
      const empty = h('div', { class: 'scan-empty' },
        h('div', { class: 'scan-empty-title' }, '把纸张平放，拍一张照片'),
        h('p', null, '拍照时可预览纸张边框。尽量拍全四边、避开反光，拍好后还能拖动四角微调。'),
        h('div', { class: 'scan-empty-btns' },
          h('button', { class: 'btn primary', onclick: () => add(true), html: Ink.icon('image') + '<span>拍照</span>' }),
          h('button', { class: 'btn', onclick: () => add(false), html: Ink.icon('import') + '<span>从相册或文件选择</span>' })));
      main.append(empty);
      const title = h('div', { class: 'scan-title' }, '扫描文档');
      const doneBtn = h('button', { class: 'btn primary', onclick: finish, disabled: true }, '完成');
      const viewSeg = h('div', { class: 'seg sm' });
      const filterRow = h('div', { class: 'scan-filters' });
      const detectionHint = h('span', { class: 'opt-hint', role: 'status' });
      const tools = h('div', { class: 'scan-tools' },
        viewSeg, detectionHint, h('span', { class: 'opt-sep' }), filterRow, h('span', { class: 'opt-sep' }),
        h('button', { class: 'btn ghost sm', onclick: () => edit((p) => (p.rot = (p.rot + 1) % 4)), html: Ink.icon('redo') + '<span>旋转</span>' }),
        h('button', { class: 'btn ghost sm', onclick: () => edit((p) => (p.quad = p.auto.slice())), html: Ink.icon('lasso') + '<span>自动识别</span>' }),
        h('button', { class: 'btn ghost sm', onclick: () => edit((p) => (p.quad = [0, 0, p.w, 0, p.w, p.h, 0, p.h])), html: Ink.icon('rect') + '<span>整张</span>' }),
        h('button', { class: 'btn ghost sm danger-text', onclick: removeCur, html: Ink.icon('trash') + '<span>删除本页</span>' }));
      const strip = h('div', { class: 'scan-strip' });
      const root = h('div', { class: 'scan', role: 'dialog', 'aria-label': '扫描文档' },
        h('header', { class: 'scan-top' }, h('button', { class: 'btn ghost', onclick: cancel }, '取消'), title, doneBtn),
        main, tools, strip);
      document.body.append(root);

      const ro = new ResizeObserver(() => drawMain());
      ro.observe(main);
      const onKey = (e) => { if (!adding && e.key === 'Escape') { e.stopPropagation(); cancel(); } };
      document.addEventListener('keydown', onKey, true);

      function close(v) {
        if (closed) return;
        closed = true;
        ro.disconnect();
        document.removeEventListener('keydown', onKey, true);
        root.remove();
        cache = { pg: null, src: null, data: null };
        resolve(v);
      }
      async function cancel() {
        if (pages.length && !(await Ink.confirm('放弃扫描', `已扫描的 ${pages.length} 页不会保存。`, '放弃', true))) return;
        close(null);
      }

      async function add(camera) {
        if (adding || busy || closed) return;
        adding = true;
        doneBtn.disabled = true;
        try {
          const shot = camera ? await SC.capturePhoto() : null;
          if (closed || (camera && !shot)) return;
          const files = camera ? (shot.files ? await shot.files : [shot.file]) : await pickImages(false);
          if (closed || !files || !files.length) return;
          for (const file of files) {
            try {
              const src = await decode(file, MAX_SRC);
              if (closed) return;
              await new Promise((r) => setTimeout(r, 0));
              // 实时相机返回的边框来自已冻结的同一张照片，直接用于后续裁剪。
              const detected = shot && shot.file === file ? shot : SC.detectDetailed(src), quad = detected.quad;
              const pg = { confident: detected.confident, file, w: src.width, h: src.height, quad, auto: quad.slice(), filter: 'enhance', rot: 0, thumb: null };
              pages.push(pg);
              cache = { pg, src, data: null };
              cur = pages.length - 1;
              makeThumb(pg);
            } catch (e) {
              console.error(e);
              Ink.toast('有一张图片无法读取，已跳过');
            }
          }
          preview = null;
          view = 'crop';
        } finally {
          adding = false;
          if (!closed) refresh();
        }
      }

      function edit(fn) {
        const p = pages[cur];
        if (!p) return;
        fn(p);
        preview = null;
        makeThumb(p);
        refresh();
      }
      async function removeCur() {
        if (cur < 0) return;
        pages.splice(cur, 1);
        cur = Math.min(cur, pages.length - 1);
        preview = null;
        refresh();
      }

      let thumbQ = Promise.resolve();
      function makeThumb(pg) {
        thumbQ = thumbQ.then(async () => {
          if (!pages.includes(pg)) return;
          const c = await processPage(pg, 260);
          pg.thumb = c.toDataURL('image/jpeg', 0.8);
          renderStrip();
        }).catch((e) => console.error(e));
      }

      function refresh() {
        empty.hidden = pages.length > 0;
        cv.hidden = !pages.length;
        tools.hidden = !pages.length;
        doneBtn.disabled = !pages.length || busy || adding;
        doneBtn.textContent = pages.length ? `完成（${pages.length} 页）` : '完成';
        title.textContent = pages.length ? `第 ${cur + 1} / ${pages.length} 页` : '扫描文档';
        viewSeg.innerHTML = '';
        [['crop', '调整边框'], ['preview', '预览效果']].forEach(([k, l]) => viewSeg.append(h('button', { class: view === k ? 'on' : '', onclick: () => { view = k; preview = null; refresh(); } }, l)));
        filterRow.innerHTML = '';
        const p = pages[cur];
        detectionHint.textContent = p && !p.confident ? '边框不确定，已保留整图，请拖动四角确认' : '';
        FILTERS.forEach(([k, l]) => filterRow.append(h('button', { class: 'chip' + (p && p.filter === k ? ' on' : ''), onclick: () => { edit((q) => (q.filter = k)); if (view === 'crop') { view = 'preview'; refresh(); } } }, l)));
        renderStrip();
        drawMain();
      }

      function renderStrip() {
        strip.innerHTML = '';
        pages.forEach((p, i) => {
          strip.append(h('button', { class: 'scan-thumb' + (i === cur ? ' on' : ''), onclick: () => { cur = i; preview = null; refresh(); } },
            p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('span', { class: 'scan-thumb-wait' }, '…'),
            h('span', { class: 'scan-thumb-n' }, String(i + 1))));
        });
        if (pages.length) {
          strip.append(h('button', { class: 'scan-add', onclick: () => add(true), html: Ink.icon('image') + '<span>继续拍</span>' }));
          strip.append(h('button', { class: 'scan-add', onclick: () => add(false), html: Ink.icon('import') + '<span>选图片</span>' }));
        }
      }

      let drawToken = 0;
      async function drawMain() {
        const p = pages[cur];
        if (!p) return;
        const tok = ++drawToken;
        const W = main.clientWidth, H = main.clientHeight;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        cv.style.width = W + 'px'; cv.style.height = H + 'px';
        const x = cv.getContext('2d');
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
        x.clearRect(0, 0, W, H);
        const m = 28;
        if (view === 'preview') {
          if (!preview) {
            x.fillStyle = '#aab'; x.font = '14px ' + Ink.render.FONT; x.textAlign = 'center';
            x.fillText('正在处理…', W / 2, H / 2);
            const c = await processPage(p, 1500);
            if (tok !== drawToken) return;
            preview = c;
          }
          const k = Math.min((W - 2 * m) / preview.width, (H - 2 * m) / preview.height);
          const dw = preview.width * k, dh = preview.height * k;
          x.clearRect(0, 0, W, H);
          x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = 16;
          x.drawImage(preview, (W - dw) / 2, (H - dh) / 2, dw, dh);
          return;
        }
        const src = await srcOf(p);
        if (tok !== drawToken) return;
        const k = Math.min((W - 2 * m) / src.width, (H - 2 * m) / src.height);
        fit = { k, ox: (W - src.width * k) / 2, oy: (H - src.height * k) / 2 };
        x.drawImage(src, fit.ox, fit.oy, src.width * k, src.height * k);
        const q = p.quad.map((v, i) => (i % 2 ? fit.oy + v * k : fit.ox + v * k));
        // 边框外压暗
        x.beginPath();
        x.rect(fit.ox, fit.oy, src.width * k, src.height * k);
        x.moveTo(q[0], q[1]); for (let i = 1; i < 4; i++) x.lineTo(q[i * 2], q[i * 2 + 1]); x.closePath();
        x.fillStyle = 'rgba(8,12,24,0.5)';
        x.fill('evenodd');
        x.beginPath();
        x.moveTo(q[0], q[1]); for (let i = 1; i < 4; i++) x.lineTo(q[i * 2], q[i * 2 + 1]); x.closePath();
        x.lineWidth = 2; x.strokeStyle = '#7ea0ff'; x.stroke();
        for (let i = 0; i < 4; i++) {
          x.beginPath(); x.arc(q[i * 2], q[i * 2 + 1], i === drag ? 14 : 11, 0, Math.PI * 2);
          x.fillStyle = 'rgba(255,255,255,0.95)'; x.fill();
          x.lineWidth = 3; x.strokeStyle = '#3a62d6'; x.stroke();
        }
        // 放大镜：手指会挡住角点，拖动时在角落放大显示
        if (drag >= 0 && dragPt) {
          const R0 = 62, Z = 3;
          const lx = q[drag * 2] < W / 2 ? W - R0 - 16 : R0 + 16, ly = R0 + 16;
          x.save();
          x.beginPath(); x.arc(lx, ly, R0, 0, Math.PI * 2); x.clip();
          x.fillStyle = '#000'; x.fillRect(lx - R0, ly - R0, R0 * 2, R0 * 2);
          const sx = p.quad[drag * 2], sy = p.quad[drag * 2 + 1];
          x.drawImage(src, sx - R0 / (k * Z), sy - R0 / (k * Z), (2 * R0) / (k * Z), (2 * R0) / (k * Z), lx - R0, ly - R0, 2 * R0, 2 * R0);
          x.strokeStyle = '#7ea0ff'; x.lineWidth = 1.5;
          x.beginPath(); x.moveTo(lx - 12, ly); x.lineTo(lx + 12, ly); x.moveTo(lx, ly - 12); x.lineTo(lx, ly + 12); x.stroke();
          x.restore();
          x.beginPath(); x.arc(lx, ly, R0, 0, Math.PI * 2); x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke();
        }
      }

      cv.addEventListener('pointerdown', (e) => {
        const p = pages[cur];
        if (!p || view !== 'crop') return;
        const r = cv.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        let bi = -1, bd = e.pointerType === 'mouse' ? 24 : 44;
        for (let i = 0; i < 4; i++) {
          const d = Math.hypot(fit.ox + p.quad[i * 2] * fit.k - mx, fit.oy + p.quad[i * 2 + 1] * fit.k - my);
          if (d < bd) { bd = d; bi = i; }
        }
        if (bi < 0) return;
        e.preventDefault();
        drag = bi;
        dragPt = [mx, my];
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        drawMain();
      });
      cv.addEventListener('pointermove', (e) => {
        if (drag < 0) return;
        const p = pages[cur];
        const r = cv.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        p.quad[drag * 2] = clamp((mx - fit.ox) / fit.k, 0, p.w);
        p.quad[drag * 2 + 1] = clamp((my - fit.oy) / fit.k, 0, p.h);
        dragPt = [mx, my];
        drawMain();
      });
      const endDrag = () => {
        if (drag < 0) return;
        drag = -1; dragPt = null;
        preview = null;
        const p = pages[cur];
        if (!convex(p.quad)) { Ink.toast('四个角的顺序乱了，已恢复自动识别的位置'); p.quad = p.auto.slice(); }
        makeThumb(p);
        drawMain();
      };
      cv.addEventListener('pointerup', endDrag);
      cv.addEventListener('pointercancel', endDrag);
      cv.style.touchAction = 'none';

      async function finish() {
        if (!pages.length || busy || adding || closed) return;
        busy = true;
        refresh();
        const pr = Ink.progress('正在生成扫描件');
        const out = [];
        try {
          for (let i = 0; i < pages.length; i++) {
            pr.set(`正在处理第 ${i + 1} / ${pages.length} 页`, i / pages.length);
            await new Promise((r) => setTimeout(r, 16));
            const c = await processPage(pages[i], MAX_OUT);
            const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
            const land = c.width > c.height;
            const w = land ? 1123 : 794;
            out.push({ blob, w, h: Math.round((w * c.height) / c.width) });
          }
          pr.close();
          close(out);
        } catch (e) {
          pr.close();
          console.error(e);
          busy = false;
          refresh();
          Ink.alert('处理失败', '生成扫描件时出错了：' + (e.message || e));
        }
      }

      refresh();
    });
  };

  function pickImages(camera) {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept: 'image/*', style: { position: 'fixed', left: '-9999px' } });
      if (camera) inp.setAttribute('capture', 'environment');
      else inp.multiple = true;
      inp.addEventListener('change', () => { resolve(Array.from(inp.files || [])); inp.remove(); });
      inp.addEventListener('cancel', () => { resolve(null); inp.remove(); });
      document.body.append(inp);
      inp.click();
    });
  }
})();
