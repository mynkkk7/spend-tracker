// Hand-drawn SVG charts (no library). Tap or hover a mark to see its value.
import { html, raw, esc, moneyShort, money } from './util.js';

const C = 2 * Math.PI * 70;

/** Donut of [{value, color, label}] with a centre label. */
export function donut(parts, { center = '', sub = '', label = 'Chart' } = {}) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return '';
  let offset = 0;
  const gap = parts.length > 1 ? 2 : 0;
  const segs = parts.filter((p) => p.value > 0).map((p) => {
    const len = (p.value / total) * C;
    const s = `<circle cx="90" cy="90" r="70" stroke="${p.color}" stroke-dasharray="${Math.max(0.5, len - gap).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" data-tip="${esc(p.label)} · ${esc(money(p.value))} · ${Math.round((p.value / total) * 100)}%"></circle>`;
    offset += len;
    return s;
  }).join('');
  return html`<div class="donut-wrap"><svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="${label}">
    <g transform="rotate(-90 90 90)" fill="none" stroke-width="22">${raw(segs)}</g></svg>
    <div class="donut-center"><b>${center}</b><span>${sub}</span></div></div>`;
}

/**
 * Vertical bars. values: [{v, label, tip, color?}], optional reference line {value, text}.
 * Labels shown only for indices in `showLabels` (or all if not given and few bars).
 */
export function bars(values, { ref = null, height = 160, color = 'var(--s1)', showLabels = null, annotate = [], label = 'Bar chart' } = {}) {
  const W = 340, plotH = height - 30, top = 16;
  const max = Math.max(1, ref?.value || 0, ...values.map((d) => d.v)) * 1.08;
  const n = values.length;
  const slot = (W - 8) / n;
  const bw = Math.max(3, Math.min(28, slot * 0.62));
  const y = (v) => top + (plotH - top) * (1 - v / max);
  let out = '';
  values.forEach((d, i) => {
    const cx = 4 + slot * i + slot / 2;
    const h = Math.max(0, plotH - y(d.v));
    if (d.v > 0) out += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(plotH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${(h + 4).toFixed(1)}" rx="4" fill="${d.color || color}"></rect>`;
    const hit = `<rect class="hit" x="${(cx - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${plotH}" fill="transparent" ${d.href ? '' : `data-tip="${esc(d.tip || `${d.label} · ${money(d.v)}`)}"`}></rect>`;
    out += d.href && d.v > 0 ? `<a href="${esc(d.href)}" aria-label="${esc(d.tip || d.label)}"><title>${esc(d.tip || d.label)}</title>${hit}</a>` : hit;
    const show = showLabels ? showLabels.includes(i) : n <= 8;
    if (show) out += `<text x="${cx.toFixed(1)}" y="${plotH + 18}" text-anchor="middle" class="ax">${esc(d.label)}</text>`;
    if (annotate.includes(i) && d.v > 0) out += `<text x="${cx.toFixed(1)}" y="${(plotH - h - 5).toFixed(1)}" text-anchor="middle" class="an">${esc(moneyShort(d.v))}</text>`;
  });
  let refLine = '';
  if (ref && ref.value > 0) {
    const ry = y(ref.value).toFixed(1);
    refLine = `<line x1="4" y1="${ry}" x2="${W - 4}" y2="${ry}" class="ref"></line><text x="${W - 4}" y="${(ry - 5)}" text-anchor="end" class="an">${esc(ref.text)}</text>`;
  }
  return html`<svg class="chart" viewBox="0 0 ${W} ${height}" width="100%" height="${height}" role="img" aria-label="${label}">
    <defs><clipPath id="clip-${height}"><rect x="0" y="0" width="${W}" height="${plotH}"></rect></clipPath></defs>
    <g clip-path="url(#clip-${height})">${raw(out.replace(/<text[^>]*class="ax"[^>]*>[^<]*<\/text>/g, ''))}</g>
    ${raw((out.match(/<text[^>]*class="ax"[^>]*>[^<]*<\/text>/g) || []).join(''))}
    <line x1="4" y1="${plotH}" x2="${W - 4}" y2="${plotH}" class="base"></line>
    ${raw(refLine)}
  </svg>`;
}

/** Horizontal stacked bar for parts [{value,color,label}]. */
export function stack(parts, { label = 'Breakdown' } = {}) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return '';
  return html`<div class="stack" role="img" aria-label="${label}">${parts.filter((p) => p.value > 0).map((p) => html`<i style="width:${((p.value / total) * 100).toFixed(2)}%;background:${p.color}" data-tip="${p.label} · ${money(p.value)}"></i>`)}</div>`;
}

// One shared tooltip for every chart mark carrying data-tip.
export function installTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.hidden = true; tip.setAttribute('role', 'status');
  document.body.appendChild(tip);
  let hideT;
  const show = (target, x, y) => {
    tip.textContent = target.getAttribute('data-tip');
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2)) + 'px';
    tip.style.top = Math.max(8, y - r.height - 14) + 'px';
    clearTimeout(hideT); hideT = setTimeout(() => { tip.hidden = true; }, 2500);
  };
  document.addEventListener('pointerover', (e) => { const t = e.target.closest?.('[data-tip]'); if (t && e.pointerType === 'mouse') show(t, e.clientX, e.clientY); });
  document.addEventListener('pointerout', (e) => { if (e.target.closest?.('[data-tip]') && e.pointerType === 'mouse') tip.hidden = true; });
  document.addEventListener('click', (e) => { const t = e.target.closest?.('[data-tip]'); if (t) show(t, e.clientX, e.clientY); else tip.hidden = true; });
}
