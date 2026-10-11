// On-device OCR with Tesseract.js (vendored, runs offline after first use). Nothing is uploaded.
let workerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load the text reader.'));
    document.head.appendChild(s);
  });
}

async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript('vendor/tesseract/tesseract.min.js');
      const base = new URL('vendor/tesseract/', location.href).href;
      const w = await window.Tesseract.createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base + 'core/',
        langPath: base + 'lang',
        gzip: true,
        cacheMethod: 'none', // the service worker caches the files instead
        logger: (m) => onProgress?.(m),
      });
      // Automatic page segmentation finds the big amount on payment screens; the default single-block mode misses it.
      await w.setParameters({ tessedit_pageseg_mode: '3' });
      return w;
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

/** Normalise size and turn dark-mode screenshots into dark-on-light text. No hard thresholding (it erases big amounts). */
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const scale = bmp.width < 700 ? 2 : bmp.width > 1400 ? 1100 / bmp.width : 1;
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let sumL = 0;
  for (let i = 0; i < d.length; i += 16) sumL += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const dark = sumL / (d.length / 16) < 110;
  if (dark) {
    for (let i = 0; i < d.length; i += 4) {
      const l = 255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = d[i + 1] = d[i + 2] = l;
    }
    ctx.putImageData(img, 0, 0);
  }
  return canvas;
}

export async function readImage(file, onProgress) {
  const worker = await getWorker((m) => {
    if (m.status === 'recognizing text') onProgress?.(0.3 + m.progress * 0.7, 'Reading text…');
    else onProgress?.(0.1 + (m.progress || 0) * 0.2, 'Loading text reader…');
  });
  const canvas = await prepare(file);
  const { data } = await worker.recognize(canvas);
  onProgress?.(1, 'Done');
  return data.text || '';
}
