// Bulk import: bank SMS (many at once) and credit-card statements (text lines from a PDF).
// Pure functions — they return candidate entries; the Import screen lets you review before saving.
import { toPaise, nowLocal, normalize } from './util.js';
import { parsePaymentText, suggestCategory } from './parse.js';

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const p2 = (n) => String(n).padStart(2, '0');
const num = (s) => toPaise(String(s).replace(/[,\s`₹]/g, ''));

/** Short stable hash (FNV-1a) used to remember what was already imported. */
export function hashText(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// ---------- merchant names ----------
const ALIASES = [
  [/^ASSPL\b/i, 'Amazon'], [/^AMAZON/i, 'Amazon'], [/WWWVODAFONE|VODAFONE/i, 'Vodafone Idea'], [/^MYJIO|JIO\b/i, 'Jio'],
  [/BOOKMYSHOW/i, 'BookMyShow'], [/^PVR\b/i, 'PVR'], [/^ANTHROPIC/i, 'Anthropic (Claude)'], [/MAKEMYTRIP/i, 'MakeMyTrip'],
  [/VIETJET/i, 'VietJet Air'], [/SWIGGY/i, 'Swiggy'], [/ZOMATO/i, 'Zomato'], [/APPLE\.COM|APPLE SERVICES/i, 'Apple'],
];
export function cleanMerchant(desc) {
  let s = String(desc || '').trim().replace(/^PAY\*|^PAYU\*|^RAZ\*|^PYU\*/i, '');
  for (const [re, name] of ALIASES) if (re.test(s)) return name;
  s = s.split(/\s{2,}/)[0]; // first column (RBL puts city / country in separate columns)
  s = s.replace(/\s+(IND|IN|VN|US|USA|GB|SG|AE)$/i, '').replace(/\s+(MUMBAI|BANGALORE|BENGALURU|GURGAON|NEW DELHI|DELHI|PALGHAR|HA NOI|HANOI|THANE|PUNE)$/i, '');
  return s.replace(/\s+/g, ' ').trim();
}

// ---------- SMS ----------
/** Split an inbox file or a long paste into individual messages. */
export function splitMessages(text) {
  const t = String(text || '').replace(/\r/g, '').trim();
  if (!t) return [];
  let parts = t.split(/\n\s*(?:-{3,}|={3,}|#{3,})\s*\n/);
  if (parts.length === 1) parts = t.split(/\n\s*\n/);
  if (parts.length === 1) parts = t.split(/(?=Dear Customer|Dear Card ?member|Your A\/c|Your a\/c|INR [\d,]+(?:\.\d+)? (?:debited|credited)|Rs\.? ?[\d,]+(?:\.\d+)? (?:debited|credited|paid|sent))/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const TXN_HINT = /(debited|credited|spent|paid|sent|received|withdrawn|transferred|purchase|txn|transaction)/i;
const NOISE = /\b(otp|one time password|do not share|will be debited|is due|due on|minimum amount|statement is|offer|cashback upto|pre-approved|loan of upto|request.*declined|failed)\b/i;

function smsBalance(text) {
  const m = text.match(/(?:avl\.?\s*bal|avail\.?\s*bal(?:ance)?|available balance|bal(?:ance)?)\s*(?:is|:)?\s*(?:inr|rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  return m ? num(m[1]) : null;
}

/**
 * Turn SMS text (one or many messages) into import candidates.
 * Each message may carry a "captured at" line from the iPhone Shortcut — used only when the SMS has no date.
 */
export function parseSmsBatch(st, text, now = nowLocal()) {
  const out = [];
  for (const raw of splitMessages(text)) {
    let msg = raw;
    let captured = null;
    const cap = msg.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})[^\n]*\n/);
    if (cap) { captured = `${cap[1]}T${cap[2]}:${cap[3]}`; msg = msg.slice(cap[0].length); }
    if (!TXN_HINT.test(msg) || NOISE.test(msg)) continue;
    const r = parsePaymentText(st, msg, captured || now);
    if (!r.amount) continue;
    out.push({
      key: 'sms:' + hashText(msg.replace(/\s+/g, ' ').trim()),
      source: 'sms', raw: msg.trim(),
      type: r.direction === 'in' ? 'in' : 'out',
      amount: r.amount, date: r.date, accountId: r.accountId, last4: r.last4,
      payee: smsPayee(msg) || (r.payee ? cleanName(r.payee) : ''), vpa: r.vpa, upiRef: r.upiRef, note: r.note,
      categoryId: r.categoryId, label: r.label, kindId: r.kindId,
      balanceAfter: smsBalance(msg),
    });
  }
  return pairTransfers(out);
}

const cleanName = (s) => s.replace(/\s*;.*$/, '').replace(/\s+/g, ' ').trim();

/** Who the money went to / came from, using the shapes Indian bank SMS use. */
export function smsPayee(msg) {
  let m;
  if ((m = msg.match(/UPI\/(?:[A-Z]{2,4}\/)?\d{6,}\/([^/\n]{2,40})\//i))) return cleanName(m[1]);
  if ((m = msg.match(/\b(?:to|from|at)\s+(?:VPA\s+)?([A-Za-z][A-Za-z0-9 .&'_-]{1,40}?)\s*(?:;|,|\.(?:\s|$)|\(|\bUPI\b|\bRef\b|\bon\b|\bAvl|\bBal|-\s*[A-Z][a-z]+ ?Bank|$)/))) {
    const name = cleanName(m[1]);
    if (!/^(your|a\/c|acct|account|ac)\b/i.test(name)) return name;
  }
  if ((m = msg.match(/\b([a-z0-9._-]{2,}@[a-z]{2,})\b/i))) return m[1].split('@')[0];
  return '';
}

/** A debit on one of your accounts and a credit of the same amount on another, within a day, is a transfer. */
export function pairTransfers(list) {
  const used = new Set();
  const result = [];
  for (let i = 0; i < list.length; i++) {
    if (used.has(i)) continue;
    const a = list[i];
    if (a.type === 'out' && a.accountId) {
      const j = list.findIndex((b, k) => k !== i && !used.has(k) && b.type === 'in' && b.accountId && b.accountId !== a.accountId && b.amount === a.amount && Math.abs(Date.parse(b.date) - Date.parse(a.date)) <= 864e5);
      if (j >= 0) {
        used.add(i); used.add(j);
        result.push({ ...a, type: 'transfer', toAccountId: list[j].accountId, key: a.key, pairKey: list[j].key, payee: '', vpa: '', categoryId: null, kindId: null, label: null, note: 'Between your accounts' });
        continue;
      }
    }
    used.add(i);
    result.push(a);
  }
  return result;
}

// ---------- credit-card statements ----------
const DATE_DMY = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const DATE_DMONY = /\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]* (\d{4})\b/i;
const MONTH_LONG = /\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})\b/;
const AMT = /(-?[\d,]+\.\d{2})\s*(CR|Cr|cr|DR|Dr)?\s*$/;

function isoFrom(m, kind) {
  if (kind === 'dmy') return `${m[3]}-${m[2]}-${m[1]}`;
  if (kind === 'dmony') return `${m[3]}-${p2(MON[m[2].toLowerCase().slice(0, 3)])}-${p2(m[1])}`;
  if (kind === 'long') return `${m[3]}-${p2(MON[m[1].toLowerCase().slice(0, 3)])}-${p2(m[2])}`;
  return null;
}
function anyDate(s) {
  let m;
  if ((m = s.match(DATE_DMY))) return isoFrom(m, 'dmy');
  if ((m = s.match(DATE_DMONY))) return isoFrom(m, 'dmony');
  if ((m = s.match(MONTH_LONG))) return isoFrom(m, 'long');
  if ((m = s.match(/\b(\d{2})-(\d{2})-(\d{4})\b/))) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
const firstAmount = (s) => { const m = String(s || '').match(/([\d,]+\.\d{2})/); return m ? num(m[1]) : null; };
const after = (lines, re, look = 3) => {
  const i = lines.findIndex((l) => re.test(l));
  if (i < 0) return null;
  const same = lines[i].replace(re, '');
  if (firstAmount(same) != null && !anyDate(same)) return firstAmount(same);
  for (let k = i + 1; k <= i + look && k < lines.length; k++) { const a = firstAmount(lines[k]); if (a != null) return a; }
  return null;
};

function classifyRow(desc, credit) {
  const d = desc.toUpperCase();
  if (credit && /(PAYMENT RECEIVED|PAYMENT RECD|AUTODEBIT|AUTO DEBIT|BBPS|NEFT|IMPS|UPI PAYMENT|THANK YOU)/.test(d)) return 'payment';
  if (/PRINCIPAL AMOUNT AMORTI/.test(d)) return 'emi-principal';
  if (/(INTEREST AMOUNT AMORTI|FINANCE CHARGE|INTEREST CHARGE|LATE (PAYMENT )?FEE|DCC FEE|MARK ?UP|CROSS CURRENCY|SGST|CGST|IGST|GST|PROCESSING FEE|ANNUAL FEE|OVERLIMIT)/.test(d)) return credit ? 'refund' : 'fee';
  if (credit) return 'refund';
  return 'purchase';
}

/**
 * Parse text lines from an ICICI / RBL (or similar) card statement.
 * Lines should be in reading order; columns separated by two or more spaces.
 */
export function parseCardStatement(lines) {
  const text = lines.join('\n');
  const banks = { ICICI: /icici/gi, RBL: /\bRBL\b|rbl\.bank/gi, HDFC: /hdfc/gi, Axis: /\baxis bank/gi, SBI: /sbi ?card/gi, Kotak: /kotak/gi };
  const bank = Object.entries(banks).map(([k, re]) => [k, (text.match(re) || []).length]).sort((a, b) => b[1] - a[1]).find(([, n]) => n > 0)?.[0] || 'Card';
  // Card number: the masked number that appears most often next to transactions, else the first one.
  const cards = [...text.matchAll(/\b(\d{4}|X{4})X{4,}(\d{2,4})\b|X{6,}(\d{2,4})\b/g)].filter((m) => m[1] !== '0000').map((m) => m[2] || m[3]);
  const last4 = cards.sort((a, b) => cards.filter((x) => x === b).length - cards.filter((x) => x === a).length)[0] || '';

  let statementDate = null, dueDate = null, periodStart = null;
  const per = text.match(/(?:statement period\s*:?\s*)([^\n]*?)\s+to\s+([^\n]*?\d{4})/i);
  if (per) { periodStart = anyDate(per[1]); statementDate = anyDate(per[2]); }
  const sd = lines.findIndex((l) => /statement date/i.test(l));
  if (sd >= 0) statementDate = anyDate(lines[sd].replace(/.*statement date/i, '')) || anyDate(lines[sd + 1] || '') || statementDate;
  const okDue = (d) => d && (!statementDate || (d > statementDate && Date.parse(d) - Date.parse(statementDate) <= 40 * 864e5));
  for (let i = 0; i < lines.length && !dueDate; i++) {
    if (!/payment due date|due date/i.test(lines[i])) continue;
    dueDate = [lines[i].replace(/.*due date/i, ''), ...lines.slice(i + 1, i + 6)].map(anyDate).find(okDue) || null;
  }
  if (!dueDate) dueDate = lines.filter((l) => !/period|statement date/i.test(l)).map(anyDate).filter(okDue).sort()[0] || null;
  const totalDue = after(lines, /total amount due/i, 3);
  const minDue = after(lines, /min(imum)?\.? (amount|amt)\.? due/i, 3);
  const limit = after(lines, /(total )?credit limit/i, 4);
  const previousBalance = after(lines, /last bill amount|previous (statement )?balance|opening balance/i, 0);

  const rows = [];
  for (const line of lines) {
    let m, date, rest;
    if ((m = line.match(DATE_DMY))) { date = isoFrom(m, 'dmy'); rest = line.slice(m.index + m[0].length); }
    else if ((m = line.match(DATE_DMONY))) { date = isoFrom(m, 'dmony'); rest = line.slice(m.index + m[0].length); }
    else continue;
    if (DATE_DMY.test(rest) || DATE_DMONY.test(rest)) continue; // EMI tables and fee examples carry two dates
    const am = rest.match(AMT);
    if (!am) continue;
    let desc = rest.slice(0, am.index).trim();
    if (!desc || /statement|due date|period|to \d/i.test(desc) && !/[a-z]{3}/i.test(desc.replace(/statement|due|date|period/gi, ''))) continue;
    // ICICI: drop the 11-digit serial number and reward points; keep a foreign amount as a note.
    desc = desc.replace(/^\d{9,12}\s+/, '');
    let intl = null;
    const fx = desc.match(/\s+([\d,.]+)\s+(USD|EUR|GBP|VND|SGD|AED|THB)\s*$/);
    if (fx) { intl = `${fx[1]} ${fx[2]}`; desc = desc.slice(0, fx.index); }
    desc = desc.replace(/\s+-?\d{1,6}\s*$/, '').trim(); // reward points column
    const amount = num(am[1].replace('-', ''));
    if (!amount) continue;
    const credit = /^cr$/i.test(am[2] || '') || /PAYMENT RECEIVED|SURCHARGE REV|REVERSAL|REFUND|CASHBACK|\bREV\b/i.test(desc);
    rows.push({ date, desc, amount, credit, intl, kind: classifyRow(desc, credit) });
  }
  // An EMI conversion shows as a credit equal to an earlier purchase from the same merchant.
  const emis = [];
  const emiLine = lines.findIndex((l) => /EMI\s*\/\s*PERSONAL LOAN|EMI SUMMARY|EMI DETAILS/i.test(l));
  if (emiLine >= 0) {
    for (const l of lines.slice(emiLine, emiLine + 20)) {
      const m = l.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+([\d,]+\.\d{2})\s+(\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/);
      if (m) emis.push({ start: isoFrom(m[1].match(DATE_DMY), 'dmy'), end: isoFrom(m[2].match(DATE_DMY), 'dmy'), months: Number(m[3]), principal: num(m[4]), pending: Number(m[5]), outstanding: num(m[6]), monthly: num(m[7]) });
    }
  }
  // Keep only rows inside the statement period (statements also print sample tables with old dates).
  if (periodStart || statementDate) {
    const lo = periodStart ? new Date(Date.parse(periodStart) - 5 * 864e5).toISOString().slice(0, 10) : '0000';
    const hi = statementDate ? new Date(Date.parse(statementDate) + 2 * 864e5).toISOString().slice(0, 10) : '9999';
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].date < lo || rows[i].date > hi) rows.splice(i, 1);
  }
  for (const r of rows) {
    if (r.kind === 'refund' && rows.some((p) => !p.credit && p.amount === r.amount && cleanMerchant(p.desc) === cleanMerchant(r.desc) && p.date <= r.date)) {
      if (emis.length || /EMI/i.test(r.desc) || rows.some((x) => x.kind === 'emi-principal')) r.kind = 'emi-conversion';
    }
  }
  // A small charge from the same merchant on the day of an EMI conversion is the processing fee.
  for (const conv of rows.filter((r) => r.kind === 'emi-conversion')) {
    for (const r of rows) if (r.kind === 'purchase' && r.date === conv.date && cleanMerchant(r.desc) === cleanMerchant(conv.desc) && r.amount < conv.amount * 0.02) { r.kind = 'fee'; r.desc = `PROCESSING FEE ${r.desc}`; }
  }
  return { bank, last4, statementDate, dueDate, periodStart, totalDue, minDue, limit, previousBalance, rows, emis };
}

/** Plain-English name for a card charge. */
export function feeNote(desc) {
  const d = desc.toUpperCase();
  if (/GST/.test(d)) return 'GST on card charges';
  if (/INTEREST AMOUNT AMORTI/.test(d)) return 'EMI interest';
  if (/DCC|MARK ?UP|CROSS CURRENCY/.test(d)) return 'DCC / forex fee';
  if (/PROCESSING/.test(d)) return 'Processing fee';
  if (/LATE/.test(d)) return 'Late payment fee';
  if (/FINANCE|INTEREST/.test(d)) return 'Interest';
  if (/ANNUAL/.test(d)) return 'Annual fee';
  return `${cleanMerchant(desc)} charge`;
}

/** Candidates for one card account from a parsed statement. */
export function statementCandidates(st, parsed, cardId, { feeCategoryId = null, refundCategoryId = null } = {}) {
  const card = st.accounts.find((a) => a.id === cardId);
  const payFrom = card?.payFromId || null;
  return parsed.rows.filter((r) => r.amount > 0).map((r) => {
    const base = {
      key: `stmt:${parsed.last4}:${r.date}:${r.amount}:${hashText(r.desc)}:${r.kind}`,
      source: 'statement', raw: r.desc + (r.intl ? ` (${r.intl})` : ''), date: `${r.date}T12:00`, amount: r.amount,
      payee: cleanMerchant(r.desc), accountId: cardId, statementKind: r.kind, note: '',
      ...(r.intl ? { fxAmount: parseFloat(r.intl.split(' ')[0].replace(/,/g, '')), fxCurrency: r.intl.split(' ')[1] } : {}),
    };
    if (r.kind === 'payment') return { ...base, type: payFrom ? 'transfer' : 'in', accountId: payFrom || cardId, toAccountId: payFrom ? cardId : null, payee: '', note: 'Card bill payment' };
    if (r.kind === 'emi-principal') return { ...base, type: 'adjust', amount: -r.amount, note: `EMI instalment: ${cleanMerchant(r.desc.replace(/.*AMORTI[A-Z]*\s*-?\s*(<\d+\/\d+>)?/i, '')) || 'principal'}`, payee: '' };
    if (r.kind === 'emi-conversion') return { ...base, type: 'adjust', amount: r.amount, note: `Converted to EMI: ${cleanMerchant(r.desc)}`, payee: '' };
    if (r.kind === 'fee') return { ...base, type: 'out', categoryId: feeCategoryId, payee: '', note: feeNote(r.desc) };
    if (r.kind === 'refund') return { ...base, type: 'in', categoryId: refundCategoryId, note: r.desc };
    const sug = suggestCategory(st, { text: r.desc, payee: base.payee, direction: 'out' });
    return { ...base, type: 'out', categoryId: sug?.categoryId || null, kindId: sug?.kindId || null, label: sug?.label || null };
  });
}

/** Mark candidates that are already in the app (same import key, same UPI ref, or same account/amount within a day). */
export function markDuplicates(st, cands, importedKeys = new Set()) {
  const near = (a, b, days) => Math.abs(Date.parse(a) - Date.parse(b)) <= days * 864e5;
  for (const c of cands) {
    let dup = null;
    if (importedKeys.has(c.key) || st.txns.some((t) => t.importKey === c.key)) dup = 'Already imported';
    else if (c.upiRef && st.txns.some((t) => t.upiRef === c.upiRef)) dup = 'Same UPI ref already saved';
    else {
      const amt = Math.abs(c.amount);
      const match = st.txns.find((t) => t.amount === amt && near(t.date, c.date, c.source === 'statement' ? 3 : 1) && (
        (c.type === 'transfer' && t.type === 'transfer' && t.toAccountId === c.toAccountId) ||
        (c.type !== 'transfer' && c.type !== 'adjust' && t.type === c.type && t.accountId === c.accountId) ||
        (c.type === 'transfer' && t.type === 'out' && t.accountId === c.accountId)));
      if (match) dup = `Looks like “${match.note || match.payee || 'an entry'}” on ${match.date.slice(0, 10)}`;
    }
    c.duplicate = dup;
    c.selected = !dup;
  }
  return cands;
}

/** Find the newest bank-reported balance per account in a batch of SMS candidates. */
export function latestBalances(cands) {
  const by = {};
  for (const c of cands) {
    if (c.balanceAfter == null || !c.accountId) continue;
    if (!by[c.accountId] || c.date > by[c.accountId].date) by[c.accountId] = { date: c.date, balance: c.balanceAfter };
  }
  return by;
}

export { normalize };

/** ICICI-style EMI amortization schedule: plan details and the interest in each instalment. */
export function parseEmiSchedule(lines) {
  const text = lines.join('\n');
  if (!/amorti[sz]ationschedule/i.test(text.replace(/\s+/g, ''))) return null;
  const last4 = (text.match(/X{4,}(\d{4})/) || [])[1] || '';
  const rate = Number((text.match(/IRR\s*:?\s*([\d.]+)\s*%/i) || [])[1]) || null;
  const fee = num((text.match(/processing fee\s*:?\s*`?\s*([\d,]+\.\d{2})/i) || [])[1] || '0');
  const rows = [];
  for (const l of lines) {
    const m = l.match(/^\s*(\d{1,3})\s+(\d{2}-[A-Za-z]{3}-\d{4})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(.*)$/);
    if (!m) continue;
    const [d, mon, y] = m[2].split('-');
    const tail = [...m[6].matchAll(/([\d,]+\.\d{2})/g)].map((x) => num(x[1]));
    const balance = tail.length ? tail[tail.length - 1] : null;
    const gst = tail.length > 1 ? tail.slice(0, -1).reduce((a, b) => a + b, 0) : 0;
    rows.push({ n: Number(m[1]), date: `${y}-${p2(MON[mon.toLowerCase()])}-${d}`, emi: num(m[3]), principal: num(m[4]), interest: num(m[5]), gst, balance });
  }
  if (!rows.length) return null;
  return {
    last4, rate, processingFee: fee, rows,
    principal: rows.reduce((a, r) => a + r.principal, 0),
    interest: rows.reduce((a, r) => a + r.interest, 0),
    gst: rows.reduce((a, r) => a + r.gst, 0),
    start: rows[0].date, end: rows[rows.length - 1].date, months: rows.length, monthly: rows[0].emi,
  };
}

/** Work out what a PDF is: a card statement, an EMI schedule, or neither. */
export function readCardDocument(lines) {
  const schedule = parseEmiSchedule(lines);
  if (schedule) return { type: 'emi-schedule', schedule };
  const st = parseCardStatement(lines);
  if (st.statementDate && (st.rows.length || st.totalDue != null)) return { type: 'statement', statement: st };
  return { type: 'unknown' };
}

/** How a statement row moves the card balance (negative = you owe more). */
export function rowEffect(r) {
  if (r.kind === 'payment' || r.kind === 'refund' || r.kind === 'emi-conversion') return r.amount;
  return -r.amount; // purchase, fee, emi-principal
}

/** Card balance just before the statement period, worked back from the total due. */
export function statementOpening(parsed) {
  if (parsed.previousBalance != null) return -parsed.previousBalance;
  if (parsed.totalDue == null) return null;
  const effects = parsed.rows.reduce((a, r) => a + rowEffect(r), 0);
  return -parsed.totalDue - effects;
}

/** Card fields to update from a statement: last statement, cycle days, limit, EMIs. */
export function cardPatchFromStatement(card, parsed) {
  const emis = [...(card.emis || [])];
  for (const e of parsed.emis || []) {
    const i = emis.findIndex((x) => x.start === e.start && x.principal === e.principal);
    if (i >= 0) emis[i] = { ...emis[i], ...e }; else emis.push({ ...e, name: guessEmiName(parsed, e) });
  }
  const newer = !card.lastStatement || card.lastStatement.date <= parsed.statementDate;
  return {
    ...card,
    limit: parsed.limit || card.limit || 0,
    statementDay: parsed.statementDate ? Number(parsed.statementDate.slice(8, 10)) : card.statementDay,
    dueDay: parsed.dueDate ? Number(parsed.dueDate.slice(8, 10)) : card.dueDay,
    lastStatement: newer ? { date: parsed.statementDate, dueDate: parsed.dueDate, totalDue: parsed.totalDue, minDue: parsed.minDue } : card.lastStatement,
    emis,
  };
}
function guessEmiName(parsed, e) {
  const conv = parsed.rows.find((r) => r.kind === 'emi-conversion' && r.amount === e.principal);
  return conv ? cleanMerchant(conv.desc) : 'EMI';
}

/** Attach an amortization schedule (interest per instalment) to the matching card EMI. */
export function cardPatchFromSchedule(card, sch) {
  const emis = [...(card.emis || [])];
  const i = emis.findIndex((e) => e.principal === sch.principal || e.start === sch.start);
  const info = { schedule: sch.rows.map((r) => ({ date: r.date, emi: r.emi, principal: r.principal, interest: r.interest, gst: r.gst, balance: r.balance })), rate: sch.rate, interest: sch.interest, gst: sch.gst, processingFee: sch.processingFee };
  if (i >= 0) emis[i] = { ...emis[i], ...info };
  else emis.push({ name: 'EMI', start: sch.start, end: sch.end, months: sch.months, principal: sch.principal, monthly: sch.monthly, outstanding: sch.rows.reduce((a, r) => a + r.emi, 0), pending: sch.months, ...info });
  return { ...card, emis };
}
