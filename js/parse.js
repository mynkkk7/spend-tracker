// Parsing user input and payment text (from OCR or pasted SMS). Pure functions.
import { normalize, toPaise, nowLocal } from './util.js';

const kindOf = (st, id) => st.kinds.find((k) => k.id === id);

// ---------- category suggestion ----------
/**
 * Suggest a category for free text (note / payee / VPA).
 * 1) Exact payee or VPA seen before → reuse that category (learned).
 * 2) Category name, label or keyword appears in the text.
 */
export function suggestCategory(st, { text = '', payee = '', vpa = '', direction = 'out' } = {}) {
  const wantIncome = direction === 'in';
  const okKind = (c) => { const g = kindOf(st, c.kindId)?.group; return wantIncome ? g === 'income' : g && g !== 'income'; };
  const cats = st.categories.filter((c) => !c.archived && okKind(c));

  const keyP = normalize(payee), keyV = normalize(vpa);
  if (keyP || keyV) {
    const prev = st.txns.find((t) => t.categoryId && ((keyV && normalize(t.vpa) === keyV) || (keyP && normalize(t.payee) === keyP)));
    if (prev && cats.some((c) => c.id === prev.categoryId)) return { categoryId: prev.categoryId, label: prev.label || null, kindId: prev.kindId, source: 'history' };
  }

  const hay = ` ${normalize([text, payee, vpa].join(' '))} `;
  const squashed = hay.replace(/\s+/g, '');
  let best = null;
  for (const c of cats) {
    let score = 0;
    const terms = [c.name, ...(c.keywords || [])].map(normalize).filter(Boolean);
    for (const term of terms) {
      if (hay.includes(` ${term} `)) score = Math.max(score, 10 + term.length);
      else if (term.length >= 4 && squashed.includes(term.replace(/\s+/g, ''))) score = Math.max(score, 5 + term.length);
    }
    let label = null;
    for (const l of c.labels || []) {
      const n = normalize(l);
      if (n && hay.includes(` ${n} `)) { label = l; score += 3; break; }
    }
    if (score > 0 && (!best || score > best.score)) best = { categoryId: c.id, label, kindId: c.kindId, score };
  }
  if (!best) {
    // A label word alone (e.g. "petrol") — pick the first category that owns that label.
    for (const c of cats) for (const l of c.labels || []) {
      const n = normalize(l);
      if (n && hay.includes(` ${n} `)) return { categoryId: c.id, label: l, kindId: c.kindId, source: 'label' };
    }
    return null;
  }
  return { ...best, source: 'keyword' };
}

// ---------- quick add: "40 thumbsup", "+5000 salary", "450 petrol bike" ----------
export function parseQuick(st, input) {
  const s = String(input || '').trim();
  const m = s.match(/^([+-]?)\s*₹?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(.*)$/) || s.match(/^(.*?)\s+([+-]?)₹?(\d[\d,]*(?:\.\d{1,2})?)$/);
  if (!m) return null;
  let sign, num, rest;
  if (/^[+-]?$/.test(m[1])) { sign = m[1]; num = m[2]; rest = m[3]; } else { rest = m[1]; sign = m[2]; num = m[3]; }
  const amount = toPaise(num.replace(/,/g, ''));
  if (!amount) return null;
  const note = (rest || '').trim();
  const direction = sign === '+' ? 'in' : 'out';
  const sug = note ? suggestCategory(st, { text: note, direction }) : null;
  return { amount, direction, note, ...(sug ? { categoryId: sug.categoryId, kindId: sug.kindId, label: sug.label } : {}) };
}

// ---------- payment text (OCR of GPay / PhonePe / Paytm / bank screens, or bank SMS) ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const STATUS_WORDS = /^(completed|successful|success|paid|payment successful|transaction successful|sent|received|done|pending|failed|split|share|view details|ok)$/i;

function fixOcr(text) {
  return text
    .replace(/\r/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/(\d)[oO](?=\d)/g, '$10') // 1o5 → 105
    .replace(/[ \t]+/g, ' ');
}

/** Return amount in paise, scanning for currency-marked numbers first. */
function findAmount(lines, full) {
  const cur = /(?:₹|rs\.?|inr|\binr\b)\s*:?\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;
  const tagged = [
    /(?:debited|credited|paid|sent|received|amount|amt)\D{0,25}?(?:₹|rs\.?|inr)\s*:?\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
    /(?:₹|rs\.?|inr)\s*:?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:has been\s*)?(?:debited|credited|paid|sent|received)/i,
  ];
  for (const re of tagged) { const m = full.match(re); if (m) return toPaise(m[1].replace(/,/g, '')); }
  for (const l of lines) { const m = l.match(cur); if (m) return toPaise(m[1].replace(/,/g, '')); }
  // OCR often reads ₹ as "%", "&", "F", "Z" or "2" on the big amount line. Accept a line that is only that.
  for (const l of lines) {
    const m = l.match(/^\s*[%&FZzR\]₹]?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d{1,6}(?:\.\d{1,2})?)\s*$/);
    if (m && !/^(19|20)\d{2}$/.test(m[1])) return toPaise(m[1].replace(/,/g, ''));
  }
  return null;
}

function findDirection(full) {
  if (/\b(credited|received|deposited|refund(ed)?|cashback)\b/i.test(full) && !/\b(debited|paid to|sent to)\b/i.test(full)) return 'in';
  return 'out';
}

function findVpa(full) {
  const m = full.match(/\b([a-z0-9][a-z0-9._-]{1,})\s?@\s?([a-z][a-z0-9]{1,})\b/i);
  return m ? `${m[1]}@${m[2]}`.toLowerCase() : '';
}

function findUpiRef(full) {
  const labelled = full.match(/(?:upi\s*(?:transaction\s*)?(?:id|ref(?:erence)?\.?\s*(?:no\.?|number)?)|utr(?:\s*no\.?)?|ref(?:erence)?\.?\s*(?:no\.?|number|id)?|rrn|txn\s*id)\s*[:#.-]?\s*(\d{12})\b/i);
  if (labelled) return labelled[1];
  const any = full.match(/(?<!\d)(\d{12})(?!\d)/);
  return any ? any[1] : '';
}

function findLast4(full) {
  const m = full.match(/(?:a\/c|acct|account|card|ending|xx+|\*+|•+|x{2,})\s*(?:no\.?)?\s*[:.-]?\s*(?:[x*•]+)?\s*(\d{4})\b/i)
    || full.match(/(?:[x*•]{2,}|\.{2,})(\d{4})\b/i)
    || full.match(/\b(?:bank|a\/c)\b[^\n]{0,20}?(\d{4})\b(?!\s*(?:am|pm|:))/i);
  return m ? m[1] : '';
}

function findPayee(lines, full, direction) {
  const pats = direction === 'in'
    ? [/(?:received from|from|by)\s*:?\s*(.+)/i]
    : [/(?:paid to|sent to|to vpa|to)\s*:?\s*(.+)/i];
  for (const l of lines) {
    for (const re of pats) {
      const m = l.match(re);
      if (m) {
        let v = m[1].replace(/\s+(on|ref|upi|via|at)\b.*$/i, '').replace(/[.,;:]+$/, '').trim();
        if (/^(your|a\/c|account|bank)\b/i.test(v)) continue;
        if (v && !/^\d+$/.test(v) && v.length <= 60) return v;
      }
    }
  }
  // Line after "Paid to" / "To" heading (GPay layout puts the name on the next line)
  for (let i = 0; i < lines.length - 1; i++) {
    if (/\bto\s*:?$/i.test(lines[i].trim()) && !/^(₹|rs|inr|\d)/i.test(lines[i + 1])) return lines[i + 1].trim();
  }
  return '';
}

function findNote(lines, amountIdx) {
  for (const l of lines) {
    const m = l.match(/^(?:note|message|remarks?|description|purpose)\s*[:-]?\s*(.+)$/i);
    if (m && m[1].trim()) return m[1].trim();
  }
  // GPay shows the note right under the big amount.
  if (amountIdx >= 0) {
    for (let i = amountIdx + 1; i < Math.min(lines.length, amountIdx + 3); i++) {
      const t = lines[i].trim();
      if (!t || STATUS_WORDS.test(t) || /\d{1,2}\s*[a-z]{3}|\d{1,2}[:/.-]\d{1,2}|@|₹|upi|bank|transaction|ref|to\b|from\b/i.test(t)) continue;
      if (t.length <= 40 && /[a-z]/i.test(t)) return t;
    }
  }
  return '';
}

function findDate(full, fallback = nowLocal()) {
  let y, mo, d, hh = null, mm = null;
  const TIME = /\b(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*(am|pm)?\b/i;
  const dateLine = full.split('\n').find((l) => /\b\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,9}\.?,?\s+\d{2,4}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b[a-z]{3,9}\s+\d{1,2},?\s+\d{4}\b/i.test(l)) || '';
  // Prefer the time on the date line, then any time with am/pm, then any time not on the first (status bar) line.
  const time = dateLine.match(TIME) || full.match(/\b(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*(am|pm)\b/i) || full.split('\n').slice(1).join('\n').match(TIME);
  if (time) {
    hh = Number(time[1]); mm = Number(time[2]);
    if (time[3]) { const pm = /pm/i.test(time[3]); if (hh === 12) hh = pm ? 12 : 0; else if (pm) hh += 12; }
    if (hh > 23 || mm > 59) { hh = null; mm = null; }
  }
  let m = full.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{2,4})\b/i);
  if (m && (MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()])) {
    d = Number(m[1]); mo = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()]; y = Number(m[3]);
  } else if ((m = full.match(/\b([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/i)) && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; d = Number(m[2]); y = Number(m[3]);
  } else if ((m = full.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) {
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
  } else if ((m = full.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/))) {
    d = Number(m[1]); mo = Number(m[2]); y = Number(m[3]);
  } else if ((m = full.match(/\b(\d{1,2})-([a-z]{3})-(\d{2,4})\b/i)) && MONTHS[m[2].toLowerCase()]) {
    d = Number(m[1]); mo = MONTHS[m[2].toLowerCase()]; y = Number(m[3]);
  }
  if (!y) return { date: hh != null ? fallback.slice(0, 10) + `T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : fallback, found: false };
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { date: fallback, found: false };
  const p = (n) => String(n).padStart(2, '0');
  const t = hh != null ? `${p(hh)}:${p(mm)}` : fallback.slice(11, 16);
  return { date: `${y}-${p(mo)}-${p(d)}T${t}`, found: true };
}

function detectApp(full) {
  if (/google\s*pay|gpay|google transaction id/i.test(full)) return 'Google Pay';
  if (/phonepe/i.test(full)) return 'PhonePe';
  if (/paytm/i.test(full)) return 'Paytm';
  if (/\bbhim\b/i.test(full)) return 'BHIM';
  if (/\b(dear customer|a\/c|acct)\b/i.test(full)) return 'Bank SMS';
  return '';
}

/** Extract payment details. Returns fields plus `found` flags so the UI can mark what was read. */
export function parsePaymentText(st, text, now = nowLocal()) {
  const full = fixOcr(String(text || ''));
  const lines = full.split('\n').map((l) => l.trim()).filter(Boolean);
  const amount = findAmount(lines, full);
  let amountIdx = lines.findIndex((l) => /₹|rs\.?\s*\d|inr\s*\d/i.test(l) || /^\s*[%&FZzR\]₹]?\s*\d[\d,]*(\.\d{1,2})?\s*$/.test(l));
  if (amountIdx > 0 && /^\d{1,2}[:.]\d{2}$/.test(lines[amountIdx])) amountIdx = -1;
  const direction = findDirection(full);
  const vpa = findVpa(full);
  const upiRef = findUpiRef(full);
  const last4 = findLast4(full);
  let payee = findPayee(lines, full, direction);
  if (!payee && vpa) payee = vpa.split('@')[0];
  if (payee && vpa && payee.toLowerCase() === vpa) payee = vpa.split('@')[0];
  const note = findNote(lines, amountIdx);
  const { date, found: dateFound } = findDate(full, now);
  const accountMatch = last4 ? st.accounts.find((a) => a.last4 && a.last4 === last4 && !a.archived) : null;
  const sug = suggestCategory(st, { text: note, payee, vpa, direction });
  const duplicate = upiRef ? st.txns.find((t) => t.upiRef === upiRef) : null;
  return {
    amount, direction, payee, vpa, upiRef, last4, note, date, app: detectApp(full),
    accountId: accountMatch?.id || null,
    categoryId: sug?.categoryId || null, kindId: sug?.kindId || null, label: sug?.label || null, suggestion: sug?.source || null,
    duplicateId: duplicate?.id || null,
    found: { amount: amount != null, payee: !!payee, note: !!note, date: dateFound, upiRef: !!upiRef, account: !!accountMatch, category: !!sug },
  };
}
