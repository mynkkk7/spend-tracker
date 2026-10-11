// Small, dependency-free helpers shared by the whole app.
// Money is stored as integer paise everywhere; convert only at the edges.

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------- money ----------
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const toPaise = (rupees) => Math.round(Number(rupees) * 100);
export const toRupees = (paise) => (paise || 0) / 100;

/** ₹1,23,456 — whole rupees unless there are paise. Negative values get a real minus sign. */
export function money(paise, { sign = false, decimals = 'auto' } = {}) {
  const p = Math.round(paise || 0);
  const abs = Math.abs(p) / 100;
  const hasPaise = Math.abs(p) % 100 !== 0;
  const body = (decimals === 2 || (decimals === 'auto' && hasPaise)) ? inr2.format(abs) : inr0.format(Math.round(abs));
  const prefix = p < 0 ? '−' : (sign && p > 0 ? '+' : '');
  return `${prefix}₹${body}`;
}

/** Compact: ₹42.1k, ₹1.2L */
export function moneyShort(paise) {
  const r = Math.abs(paise || 0) / 100;
  const s = paise < 0 ? '−' : '';
  if (r >= 1e7) return `${s}₹${trim(r / 1e7)}Cr`;
  if (r >= 1e5) return `${s}₹${trim(r / 1e5)}L`;
  if (r >= 1e3) return `${s}₹${trim(r / 1e3)}k`;
  return `${s}₹${Math.round(r)}`;
}
const trim = (n) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ''));

/** Parse a user-typed amount ("1,250.50", "₹40") into paise, or null. */
export function parseAmount(str) {
  if (str == null) return null;
  const cleaned = String(str).replace(/[₹,\s]|rs\.?|inr/gi, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const p = toPaise(cleaned);
  return p > 0 ? p : null;
}

// ---------- dates (stored as local 'YYYY-MM-DDTHH:mm' strings) ----------
const pad = (n) => String(n).padStart(2, '0');
export const nowLocal = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const monthOf = (dateStr) => (dateStr || '').slice(0, 7);
export const dayOf = (dateStr) => (dateStr || '').slice(0, 10);

export function addMonths(mk, n) {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKey(d);
}
export function daysInMonth(mk) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export function monthDiff(a, b) { // b - a in months
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const monthLabel = (mk, long = true) => {
  const [y, m] = mk.split('-').map(Number);
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
};
export const monthShort = (mk) => MONTHS[Number(mk.split('-')[1]) - 1];

export function parseLocal(dateStr) {
  const [d, t = '00:00'] = dateStr.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return new Date(y, m - 1, day, hh || 0, mm || 0);
}
export function dayLabel(dayStr, today = dayOf(nowLocal())) {
  const d = parseLocal(dayStr);
  const base = `${WD[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (dayStr === today) return `Today · ${base}`;
  const y = new Date(parseLocal(today)); y.setDate(y.getDate() - 1);
  if (dayStr === dayOf(nowLocal(y))) return `Yesterday · ${base}`;
  return base;
}
export function timeLabel(dateStr) {
  const d = parseLocal(dateStr);
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${ap}`;
}
export function shortDate(dateStr) {
  const d = parseLocal(dateStr);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// ---------- HTML ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Raw HTML marker so nested templates are not double-escaped. */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

/** Tagged template: interpolations are escaped unless wrapped in raw() or produced by html``. Arrays are joined. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) {
    out += render(vals[i]) + strings[i + 1];
  }
  return new Raw(out);
}
function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

// ---------- misc ----------
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (f(x) || 0), 0);
export const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] ||= []).push(x); return m; }, {});
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
export const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').trim();
