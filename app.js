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
let images = [];

pickBtn.onclick = () => input.click();
input.onchange = (e) => setFiles([...e.target.files]);

['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, (e)=>{e.preventDefault(); dropZone.classList.add('drag');}));
['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, (e)=>{e.preventDefault(); dropZone.classList.remove('drag');}));
dropZone.addEventListener('drop', (e)=> setFiles([...e.dataTransfer.files]));

renderBtn.onclick = async () => {
  try {
    await ensureLoaded();
    render();
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
  images = [];
  renderBtn.disabled = files.length === 0;
  downloadBtn.disabled = true;
  status(`${files.length} image(s) selected.`);
}

function status(t){ statusEl.textContent = t; }

async function ensureLoaded(){
  if (images.length === files.length && images.length) return;
  images = [];
  for (const f of files){
    try {
      const bmp = await createImageBitmap(f);
      images.push(bmp);
    } catch {
      const fallback = await decodeViaImageTag(f);
      images.push(fallback);
    }
  }
}

function decodeViaImageTag(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      try {
        const bmp = await createImageBitmap(img);
        resolve(bmp);
      } catch {
        // final fallback: return HTMLImageElement-like wrapper
        resolve(img);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Unsupported image format: ${file.name}`));
    };
    img.src = url;
  });
}

function render(){
  if (!images.length) return;
  const gapRaw = Number($('gapInput').value);
  const padRaw = Number($('padInput').value);
  const hiRes = Boolean($('hiResInput')?.checked);
  const gap = Number.isFinite(gapRaw) ? Math.max(0, gapRaw) : 0;
  const pad = Number.isFinite(padRaw) ? Math.max(0, padRaw) : 0;

  const { width: W, height: H } = chooseOutputSize(images, hiRes);
  canvas.width = W;
  canvas.height = H;

  // background
  const grad = ctx.createLinearGradient(0,0,W,H);
  grad.addColorStop(0,'#0d1120');
  grad.addColorStop(1,'#0a0e17');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,W,H);

  const layout = buildDynamicLayout(images.length, W - pad * 2, H - pad * 2, gap);

  layout.forEach((r, i) => {
    const img = images[i % images.length];
    if (!img) return;
    const x = r.x + pad;
    const y = r.y + pad;
    drawCover(img, x, y, r.w, r.h);
  });

  status(`Rendered ${images.length} image(s) at ${W}×${H}.`);
  downloadBtn.disabled = false;
}

function chooseOutputSize(images, hiRes) {
  if (!hiRes) return { width: DEFAULT_W, height: DEFAULT_H };

  // Target a larger 9:16 canvas based on source pixel budget.
  const totalPx = images.reduce((s, im) => s + (im.width * im.height), 0);
  const meanPx = Math.max(1, Math.floor(totalPx / Math.max(1, images.length)));

  // Scale up from average source size, clamped for browser safety.
  const targetArea = Math.min(Math.max(meanPx * Math.min(images.length, 6), 9_000_000), 36_000_000);
  let w = Math.floor(Math.sqrt(targetArea * 9 / 16));
  w = Math.max(DEFAULT_W, Math.min(w, 4500));
  const h = Math.floor((w * 16) / 9);
  return { width: w, height: h };
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
