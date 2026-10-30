// Read a PDF on the device (pdf.js, vendored) and return its text as lines in reading order.
// Columns on the same line are joined with two spaces so parsers can tell them apart.

export async function linesFromPdf(pdfjs, data, { password } = {}) {
  const doc = await pdfjs.getDocument({ data, password, isEvalSupported: false, useSystemFonts: true }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], w: it.width || 0, s: it.str.trim() });
    }
    for (const [, items] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      items.sort((a, b) => a.x - b.x);
      let line = '';
      let prevEnd = null;
      for (const it of items) {
        if (prevEnd != null) line += it.x - prevEnd > 6 ? '  ' : ' ';
        line += it.s;
        prevEnd = it.x + it.w;
      }
      out.push(line.replace(/` +/g, ''));
    }
  }
  return out;
}

let pdfjsPromise = null;
/** Browser: load pdf.js lazily (only when someone imports a statement). */
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href).then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    }).catch((e) => { pdfjsPromise = null; throw e; });
  }
  return pdfjsPromise;
}

export async function readPdfLines(file, opts) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  return linesFromPdf(pdfjs, data, opts);
}
