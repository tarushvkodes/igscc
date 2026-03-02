const DEFAULT_W = 2160, DEFAULT_H = 3840; // 4K portrait (9:16)
const MAX_CANVAS_SIDE = 8192;
const MAX_CANVAS_PIXELS = 40_000_000;
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
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `igscc_${Date.now()}.png`;
  a.click();
};

function setFiles(newFiles){
  files = newFiles.filter(f => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  metas = [];
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
  const cols = chooseCols(n);
  const rows = Math.ceil(n / cols);

  const colWidths = new Array(cols).fill(0);
  const rowHeights = new Array(rows).fill(0);

  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    colWidths[c] = Math.max(colWidths[c], metas[i].width);
    rowHeights[r] = Math.max(rowHeights[r], metas[i].height);
  }

  const contentW = colWidths.reduce((a, b) => a + b, 0) + gap * Math.max(0, cols - 1) + pad * 2;
  const contentH = rowHeights.reduce((a, b) => a + b, 0) + gap * Math.max(0, rows - 1) + pad * 2;

  // Keep strict 9:16 while preserving every source pixel when possible.
  const targetRatio = 9 / 16;
  let W = contentW;
  let H = contentH;
  if (W / H > targetRatio) {
    H = Math.ceil(W / targetRatio);
  } else {
    W = Math.ceil(H * targetRatio);
  }

  const fitted = fitCanvasSize(W, H);
  W = fitted.width;
  H = fitted.height;
  const canvasScale = fitted.scale;

  canvas.width = W;
  canvas.height = H;

  const grad = ctx.createLinearGradient(0,0,W,H);
  grad.addColorStop(0,'#0d1120');
  grad.addColorStop(1,'#0a0e17');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,W,H);

  const spad = pad * canvasScale;
  const sgap = gap * canvasScale;
  const scolWidths = colWidths.map(v => v * canvasScale);
  const srowHeights = rowHeights.map(v => v * canvasScale);

  const innerW = contentW * canvasScale - spad * 2;
  const innerH = contentH * canvasScale - spad * 2;
  const startX = Math.floor((W - innerW) / 2);
  const startY = Math.floor((H - innerH) / 2);

  const colX = [];
  let cx = startX;
  for (let c = 0; c < cols; c++) {
    colX[c] = cx;
    cx += scolWidths[c] + sgap;
  }

  const rowY = [];
  let ry = startY;
  for (let r = 0; r < rows; r++) {
    rowY[r] = ry;
    ry += srowHeights[r] + sgap;
  }

  for (let i = 0; i < n; i++) {
    const dim = metas[i];
    const r = Math.floor(i / cols);
    const c = i % cols;

    const dw = Math.max(1, Math.floor(dim.width * canvasScale));
    const dh = Math.max(1, Math.floor(dim.height * canvasScale));
    const x = Math.floor(colX[c] + (scolWidths[c] - dw) / 2);
    const y = Math.floor(rowY[r] + (srowHeights[r] - dh) / 2);

    const { img, url } = await loadImageElement(files[i]);
    ctx.drawImage(img, x, y, dw, dh);
    URL.revokeObjectURL(url);
    setProgress(30 + ((i + 1) / Math.max(1, n)) * 70);
    if (i % 8 === 0) await new Promise(res => requestAnimationFrame(res));
  }

  setProgress(100);
  const modeLabel = canvasScale < 1 ? `pixel-safe (${Math.round(canvasScale * 100)}%)` : 'pixel-perfect';
  status(`Rendered ${n} image(s) at ${W}×${H} (${modeLabel} mode).`);
  downloadBtn.disabled = false;
}

function buildJustifiedLayout(metas, maxW, maxH, gap, targetRowH = 180) {
  const rects = [];
  let y = 0;
  let row = [];
  let aspectSum = 0;

  const flushRow = (force = false) => {
    if (!row.length) return;
    const gaps = gap * Math.max(0, row.length - 1);
    let rowH = targetRowH;
    if (!force) {
      rowH = (maxW - gaps) / Math.max(0.0001, aspectSum);
    }
    let x = 0;
    for (let i = 0; i < row.length; i++) {
      const m = row[i];
      const w = rowH * (m.width / Math.max(1, m.height));
      rects.push({ x, y, w, h: rowH });
      x += w + gap;
    }
    y += rowH + gap;
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

  const usedH = Math.max(1, y - gap);
  const fit = Math.min(1, maxH / usedH);

  if (fit < 1) {
    for (const r of rects) {
      r.x *= fit;
      r.y *= fit;
      r.w *= fit;
      r.h *= fit;
    }
  }

  const finalH = usedH * fit;
  const yOffset = Math.max(0, (maxH - finalH) / 2);
  for (const r of rects) r.y += yOffset;

  return rects;
}
