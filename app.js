const DEFAULT_W = 2160, DEFAULT_H = 3840; // 4K portrait (9:16)
const MAX_CANVAS_SIDE = 8192;
const MAX_CANVAS_PIXELS = 40_000_000;
let renderedPages = [];
const $ = (id) => document.getElementById(id);

const input = $('fileInput');
const dropZone = $('dropZone');
const pickBtn = $('pickBtn');
const renderBtn = $('renderBtn');
const downloadBtn = $('downloadBtn');
const statusEl = $('status');
const progressBarEl = $('progressBar');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

let files = [];
let metas = [];

pickBtn.onclick = () => input.click();
input.onchange = (e) => setFiles([...e.target.files]);

['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, (e)=>{e.preventDefault(); dropZone.classList.add('drag');}));
['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, (e)=>{e.preventDefault(); dropZone.classList.remove('drag');}));
dropZone.addEventListener('drop', (e)=> setFiles([...e.dataTransfer.files]));

renderBtn.onclick = async () => {
  try {
    setProgress(0);
    await ensureMetaLoaded();
    await render();
  } catch (e) {
    status(`Render failed: ${e?.message || e}`);
    setProgress(0);
  }
};

downloadBtn.onclick = () => {
  if (renderedPages.length > 1) {
    renderedPages.forEach((dataUrl, i) => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `igscc_${Date.now()}_p${i + 1}.png`;
      a.click();
    });
    return;
  }
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `igscc_${Date.now()}.png`;
  a.click();
};

function setFiles(newFiles){
  files = newFiles.filter(f => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  metas = [];
  renderedPages = [];
  renderBtn.disabled = files.length === 0;
  downloadBtn.disabled = true;
  status(`${files.length} image(s) selected.`);
  setProgress(0);
}

function status(t){ statusEl.textContent = t; }
function setProgress(p){ if (progressBarEl) progressBarEl.style.width = `${Math.max(0,Math.min(100,p))}%`; }

async function ensureMetaLoaded(){
  if (metas.length === files.length && metas.length) return;
  metas = [];
  for (let i = 0; i < files.length; i++){
    const f = files[i];
    const dim = await getImageDimensions(f);
    metas.push(dim);
    setProgress(((i + 1) / Math.max(1, files.length)) * 25);
    if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
  }
}

function getImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const out = { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
      URL.revokeObjectURL(url);
      resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Unsupported image format: ${file.name}`));
    };
    img.src = url;
  });
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Unsupported image format: ${file.name}`));
    };
    img.src = url;
  });
}

async function render(){
  if (!files.length) return;
  const gapRaw = Number($('gapInput').value);
  const padRaw = Number($('padInput').value);
  const hiRes = Boolean($('hiResInput')?.checked);
  const gap = Number.isFinite(gapRaw) ? Math.max(0, gapRaw) : 0;
  const pad = Number.isFinite(padRaw) ? Math.max(0, padRaw) : 0;
  setProgress(30);

  renderedPages = [];
  if (hiRes) {
    await renderPixelPerfect(files, metas, gap, pad);
    return;
  }

  const { width: W, height: H } = chooseOutputSize();
  canvas.width = W;
  canvas.height = H;

  // background
  const grad = ctx.createLinearGradient(0,0,W,H);
  grad.addColorStop(0,'#0d1120');
  grad.addColorStop(1,'#0a0e17');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,W,H);

  const layout = buildJustifiedLayout(
    metas,
    W - pad * 2,
    H - pad * 2,
    gap,
    Math.max(90, Math.floor((H - pad * 2) / Math.max(3, Math.ceil(Math.sqrt(files.length)))))
  );

  for (let i = 0; i < layout.length; i++) {
    const r = layout[i];
    const x = r.x + pad;
    const y = r.y + pad;
    const { img, url } = await loadImageElement(files[i]);
    // no crop: draw full image into an aspect-matched rect
    ctx.drawImage(img, x, y, r.w, r.h);
    URL.revokeObjectURL(url);
    setProgress(30 + ((i + 1) / Math.max(1, layout.length)) * 70);
    if (i % 12 === 0) await new Promise(res => requestAnimationFrame(res));
  }

  setProgress(100);
  status(`Rendered ${files.length} image(s) at ${W}×${H} (4K mode, justified fit).`);
  downloadBtn.disabled = false;
}

function fitCanvasSize(w, h) {
  let scale = 1;
  if (w > MAX_CANVAS_SIDE || h > MAX_CANVAS_SIDE) {
    scale = Math.min(scale, MAX_CANVAS_SIDE / Math.max(w, h));
  }
  if (w * h > MAX_CANVAS_PIXELS) {
    scale = Math.min(scale, Math.sqrt(MAX_CANVAS_PIXELS / (w * h)));
  }
  if (scale < 1) {
    w = Math.floor(w * scale);
    h = Math.floor(h * scale);
  }
  return { width: Math.max(1, w), height: Math.max(1, h), scale };
}

function chooseOutputSize() {
  // Standard mode: fixed 4K portrait.
  return { width: DEFAULT_W, height: DEFAULT_H };
}

function chooseCols(n) {
  if (n <= 3) return n;
  if (n <= 6) return 2;
  if (n <= 12) return 3;
  return 4;
}

async function renderPixelPerfect(files, metas, gap, pad) {
  const n = metas.length;

  // Build pixel-true rows (no scaling of source images), minimizing leftover row gaps.
  const totalArea = metas.reduce((s, m) => s + m.width * m.height, 0);
  const targetRowW = Math.max(1200, Math.floor(Math.sqrt(totalArea * (9 / 16))));

  const rows = [];
  let row = [];
  let rowW = 0;
  let rowH = 0;

  const flush = () => {
    if (!row.length) return;
    rows.push({ items: row, rowW, rowH });
    row = [];
    rowW = 0;
    rowH = 0;
  };

  for (let i = 0; i < n; i++) {
    const m = metas[i];
    const nextW = rowW + (row.length ? gap : 0) + m.width;
    if (row.length && nextW > targetRowW) flush();
    row.push({ index: i, w: m.width, h: m.height });
    rowW = rowW + (row.length > 1 ? gap : 0) + m.width;
    rowH = Math.max(rowH, m.height);
  }
  flush();

  const contentW = Math.max(...rows.map(r => r.rowW), 1) + pad * 2;
  const contentH = rows.reduce((s, r) => s + r.rowH, 0) + gap * Math.max(0, rows.length - 1) + pad * 2;

  // Enforce 9:16 by extending the shorter side only.
  const targetRatio = 9 / 16;
  let W = contentW;
  let H = contentH;
  if (W / H > targetRatio) H = Math.ceil(W / targetRatio);
  else W = Math.ceil(H * targetRatio);

  // If full pixel-perfect canvas would exceed browser limits, paginate instead of downscaling.
  const fitted = fitCanvasSize(W, H);
  if (fitted.scale < 1) {
    await renderPixelPerfectPaged(rows, files, contentW, contentH, gap, pad, n);
    return;
  }

  canvas.width = W;
  canvas.height = H;

  const grad = ctx.createLinearGradient(0,0,W,H);
  grad.addColorStop(0,'#0d1120');
  grad.addColorStop(1,'#0a0e17');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,W,H);

  const xBase = Math.floor((W - contentW) / 2);
  const yBase = Math.floor((H - contentH) / 2);

  let y = yBase + pad;
  let drawn = 0;
  for (const r of rows) {
    let x = xBase + Math.floor((contentW - r.rowW) / 2);
    for (const it of r.items) {
      const { img, url } = await loadImageElement(files[it.index]);
      ctx.drawImage(img, x, y, it.w, it.h);
      URL.revokeObjectURL(url);
      x += it.w + gap;
      drawn += 1;
      setProgress(30 + (drawn / Math.max(1, n)) * 70);
      if (drawn % 8 === 0) await new Promise(res => requestAnimationFrame(res));
    }
    y += r.rowH + gap;
  }

  renderedPages = [canvas.toDataURL('image/png')];
  setProgress(100);
  status(`Rendered ${n} image(s) at ${W}×${H} (pixel-perfect mode).`);
  downloadBtn.disabled = false;
}

async function renderPixelPerfectPaged(rows, files, contentW, contentH, gap, pad, totalImages) {
  const targetRatio = 9 / 16;
  const pageW = Math.min(MAX_CANVAS_SIDE, Math.max(1080, contentW));
  const pageH = Math.min(MAX_CANVAS_SIDE, Math.floor(pageW / targetRatio));

  const availableH = pageH - pad * 2;
  const pages = [];
  let cur = [];
  let curH = 0;
  for (const r of rows) {
    const need = (cur.length ? gap : 0) + r.rowH;
    if (cur.length && curH + need > availableH) {
      pages.push(cur);
      cur = [r];
      curH = r.rowH;
    } else {
      cur.push(r);
      curH += need;
    }
  }
  if (cur.length) pages.push(cur);

  renderedPages = [];
  let drawn = 0;
  for (let p = 0; p < pages.length; p++) {
    canvas.width = pageW;
    canvas.height = pageH;

    const grad = ctx.createLinearGradient(0,0,pageW,pageH);
    grad.addColorStop(0,'#0d1120');
    grad.addColorStop(1,'#0a0e17');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,pageW,pageH);

    const rowsPage = pages[p];
    const rowsH = rowsPage.reduce((s, r) => s + r.rowH, 0) + gap * Math.max(0, rowsPage.length - 1);
    let y = Math.floor((pageH - rowsH) / 2);

    for (const r of rowsPage) {
      let x = Math.floor((pageW - r.rowW) / 2);
      for (const it of r.items) {
        const { img, url } = await loadImageElement(files[it.index]);
        ctx.drawImage(img, x, y, it.w, it.h);
        URL.revokeObjectURL(url);
        x += it.w + gap;
        drawn += 1;
        setProgress(30 + (drawn / Math.max(1, totalImages)) * 70);
      }
      y += r.rowH + gap;
      await new Promise(res => requestAnimationFrame(res));
    }

    renderedPages.push(canvas.toDataURL('image/png'));
  }

  // keep first page visible on canvas
  if (renderedPages.length) {
    const img = new Image();
    img.src = renderedPages[0];
    await img.decode();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0);
  }

  setProgress(100);
  status(`Rendered ${totalImages} image(s) as ${renderedPages.length} pixel-perfect page(s) ${pageW}×${pageH}. Download saves all pages.`);
  downloadBtn.disabled = false;
}

function buildJustifiedLayout(metas, maxW, maxH, gap, targetRowH = 180) {
  const rows = [];
  let row = [];
  let aspectSum = 0;

  const flushRow = (force = false) => {
    if (!row.length) return;
    const gaps = gap * Math.max(0, row.length - 1);
    const rowH = force ? targetRowH : (maxW - gaps) / Math.max(0.0001, aspectSum);
    const items = row.map(m => ({ w: rowH * (m.width / Math.max(1, m.height)), h: rowH }));
    const rowW = items.reduce((s, it) => s + it.w, 0) + gaps;
    rows.push({ items, rowW, rowH });
    row = [];
    aspectSum = 0;
  };

  for (let i = 0; i < metas.length; i++) {
    const m = metas[i];
    const ar = m.width / Math.max(1, m.height);
    row.push(m);
    aspectSum += ar;

    const estW = aspectSum * targetRowH + gap * Math.max(0, row.length - 1);
    if (estW >= maxW) flushRow(false);
  }
  flushRow(true);

  const usedW = Math.max(...rows.map(r => r.rowW), 1);
  const usedH = rows.reduce((s, r) => s + r.rowH, 0) + gap * Math.max(0, rows.length - 1);

  // Scale up/down to fill frame better while preserving layout proportions
  const scale = Math.min(maxW / usedW, maxH / usedH);

  const rects = [];
  const finalW = usedW * scale;
  const finalH = usedH * scale;
  const xBase = (maxW - finalW) / 2;
  const yBase = 0;

  let y = yBase;
  for (const r of rows) {
    const rowW = r.rowW * scale;
    let x = xBase + (finalW - rowW) / 2;
    for (const it of r.items) {
      rects.push({ x, y, w: it.w * scale, h: it.h * scale });
      x += it.w * scale + gap * scale;
    }
    y += r.rowH * scale + gap * scale;
  }

  return rects;
}
