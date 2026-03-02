const DEFAULT_W = 2160, DEFAULT_H = 3840; // 4K portrait (9:16)
const $ = (id) => document.getElementById(id);

const input = $('fileInput');
const dropZone = $('dropZone');
const pickBtn = $('pickBtn');
const renderBtn = $('renderBtn');
const downloadBtn = $('downloadBtn');
const statusEl = $('status');
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
    await ensureMetaLoaded();
    await render();
  } catch (e) {
    status(`Render failed: ${e?.message || e}`);
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
}

function status(t){ statusEl.textContent = t; }

async function ensureMetaLoaded(){
  if (metas.length === files.length && metas.length) return;
  metas = [];
  for (let i = 0; i < files.length; i++){
    const f = files[i];
    const dim = await getImageDimensions(f);
    metas.push(dim);
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

  if (hiRes) {
    await renderPixelPerfect(files, metas, gap, pad);
    return;
  }

  const { width: W, height: H } = chooseOutputSize(false);
  canvas.width = W;
  canvas.height = H;

  // background
  const grad = ctx.createLinearGradient(0,0,W,H);
  grad.addColorStop(0,'#0d1120');
  grad.addColorStop(1,'#0a0e17');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,W,H);

  const layout = buildDynamicLayout(files.length, W - pad * 2, H - pad * 2, gap);

  for (let i = 0; i < layout.length; i++) {
    const r = layout[i];
    const x = r.x + pad;
    const y = r.y + pad;
    const { img, url } = await loadImageElement(files[i]);
    drawCover(img, x, y, r.w, r.h);
    URL.revokeObjectURL(url);
    if (i % 12 === 0) await new Promise(res => requestAnimationFrame(res));
  }

  status(`Rendered ${files.length} image(s) at ${W}×${H} (4K mode).`);
  downloadBtn.disabled = false;
}

function chooseOutputSize(hiRes) {
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

  // Keep strict 9:16 while preserving every source pixel (no scaling).
  const targetRatio = 9 / 16;
  let W = contentW;
  let H = contentH;
  if (W / H > targetRatio) {
    H = Math.ceil(W / targetRatio);
  } else {
    W = Math.ceil(H * targetRatio);
  }

  canvas.width = W;
  canvas.height = H;

  const grad = ctx.createLinearGradient(0,0,W,H);
  grad.addColorStop(0,'#0d1120');
  grad.addColorStop(1,'#0a0e17');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,W,H);

  const innerW = contentW - pad * 2;
  const innerH = contentH - pad * 2;
  const startX = Math.floor((W - innerW) / 2);
  const startY = Math.floor((H - innerH) / 2);

  const colX = [];
  let cx = startX;
  for (let c = 0; c < cols; c++) {
    colX[c] = cx;
    cx += colWidths[c] + gap;
  }

  const rowY = [];
  let ry = startY;
  for (let r = 0; r < rows; r++) {
    rowY[r] = ry;
    ry += rowHeights[r] + gap;
  }

  for (let i = 0; i < n; i++) {
    const dim = metas[i];
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = colX[c] + Math.floor((colWidths[c] - dim.width) / 2);
    const y = rowY[r] + Math.floor((rowHeights[r] - dim.height) / 2);

    const { img, url } = await loadImageElement(files[i]);
    ctx.drawImage(img, x, y, dim.width, dim.height);
    URL.revokeObjectURL(url);
    if (i % 8 === 0) await new Promise(res => requestAnimationFrame(res));
  }

  status(`Rendered ${n} image(s) at ${W}×${H} (pixel-perfect mode).`);
  downloadBtn.disabled = false;
}

function buildDynamicLayout(n, w, h, gap){
  if (n <= 1) return [{x:0,y:0,w,h}];
  if (n === 2) return [{x:0,y:0,w,h:(h-gap)/2},{x:0,y:(h+gap)/2,w,h:(h-gap)/2}];
  if (n === 3) {
    const top = (h*0.52);
    return [
      {x:0,y:0,w,h:top-gap/2},
      {x:0,y:top+gap/2,w:(w-gap)/2,h:h-top-gap/2},
      {x:(w+gap)/2,y:top+gap/2,w:(w-gap)/2,h:h-top-gap/2}
    ];
  }

  const cols = n <= 6 ? 2 : n <= 12 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const cellW = (w - gap * (cols - 1)) / cols;
  const cellH = (h - gap * (rows - 1)) / rows;
  const out = [];

  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    out.push({
      x: col * (cellW + gap),
      y: row * (cellH + gap),
      w: cellW,
      h: cellH,
    });
  }
  return out;
}

function drawCover(img, x, y, w, h){
  // "Contain" fit (no cropping): preserve full image in each tile.
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;

  // subtle tile background for letterboxed areas
  ctx.fillStyle = '#0a0d16';
  ctx.fillRect(x, y, w, h);

  ctx.drawImage(img, dx, dy, dw, dh);
}

function roundRectPath(x,y,w,h,r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}
