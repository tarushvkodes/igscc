const W = 1080, H = 1920;
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
  await ensureLoaded();
  render();
};

downloadBtn.onclick = () => {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `igscc_${Date.now()}.png`;
  a.click();
};

function setFiles(newFiles){
  files = newFiles.filter(f => /^image\//.test(f.type));
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
    const bmp = await createImageBitmap(f);
    images.push(bmp);
  }
}

function render(){
  if (!images.length) return;
  const gap = Number($('gapInput').value) || 12;
  const pad = Number($('padInput').value) || 32;
  const jitter = Number($('jitterInput').value) || 0;

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
    drawCover(img, x, y, r.w, r.h, jitter);
  });

  status(`Rendered ${images.length} image(s) at 1080×1920.`);
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

function drawCover(img, x, y, w, h, jitter = 0){
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;

  const j = jitter ? (jitter / 100) : 0;
  const ox = (img.width - sw) / 2 + (Math.random() - 0.5) * j * sw;
  const oy = (img.height - sh) / 2 + (Math.random() - 0.5) * j * sh;

  ctx.save();
  roundRectPath(x, y, w, h, 12);
  ctx.clip();
  ctx.drawImage(img, ox, oy, sw, sh, x, y, w, h);
  ctx.restore();
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
