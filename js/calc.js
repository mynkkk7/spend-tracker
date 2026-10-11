// Pure calculations. Every function takes the state object explicitly so it can be unit-tested.
import { sum, monthOf, dayOf, addMonths, daysInMonth, monthKey, nowLocal, monthDiff, groupBy } from './util.js';

const kindOf = (st, id) => st.kinds.find((k) => k.id === id);
export const groupOfTxn = (st, t) => {
  if (t.type === 'in') return 'income';
  if (t.type !== 'out') return null; // transfers and balance fixes are neither
  return kindOf(st, t.kindId)?.group || 'spending';
};

// ---------- balances ----------
export function balance(st, accountId) {
  const a = st.accounts.find((x) => x.id === accountId);
  if (!a) return 0;
  const from = a.openingAt || '';
  const setAt = a.openingSetAt || a.createdAt || '';
  let b = a.openingBalance || 0;
  for (const t of st.txns) {
    // Entries dated after the opening moment count. Entries in the very same minute count only if they were
    // added after the balance was typed in (otherwise they're already part of it).
    if (t.date < from.slice(0, 16) || (t.date.slice(0, 16) === from.slice(0, 16) && !(t.createdAt > setAt))) continue;
    if (t.type === 'in' && t.accountId === accountId) b += t.amount;
    else if (t.type === 'out' && t.accountId === accountId) b -= t.amount;
    else if (t.type === 'transfer') {
      if (t.accountId === accountId) b -= t.amount;
      if (t.toAccountId === accountId) b += t.amount;
    } else if (t.type === 'adjust' && t.accountId === accountId) b += t.amount;
  }
  return b;
}
export const totalBalance = (st) =>
  sum(st.accounts.filter((a) => !a.archived && a.includeInTotal !== false), (a) => balance(st, a.id));

// ---------- month slices ----------
export const txnsInMonth = (st, mk) => st.txns.filter((t) => monthOf(t.date) === mk);

/** Totals for a month, optionally only up to day N (for fair month-to-month comparison). */
export function monthSummary(st, mk, uptoDay = 31) {
  const list = txnsInMonth(st, mk).filter((t) => Number(t.date.slice(8, 10)) <= uptoDay);
  const out = { spent: 0, income: 0, fixed: 0, saving: 0, essential: 0, nonEssential: 0, untagged: 0, byKind: {}, byCategory: {}, count: 0 };
  for (const t of list) {
    const g = groupOfTxn(st, t);
    if (!g) continue;
    out.count++;
    if (g === 'income') { out.income += t.amount; continue; }
    out.byKind[t.kindId] = (out.byKind[t.kindId] || 0) + t.amount;
    if (g === 'spending') {
      out.spent += t.amount;
      if (t.essential) out.essential += t.amount; else out.nonEssential += t.amount;
      const key = t.categoryId || '_untagged';
      out.byCategory[key] = (out.byCategory[key] || 0) + t.amount;
      if (!t.categoryId) out.untagged++;
    } else if (g === 'fixed') out.fixed += t.amount;
    else if (g === 'saving') out.saving += t.amount;
  }
  out.moneyOut = out.spent + out.fixed + out.saving;
  out.savingsRate = out.income > 0 ? Math.round(((out.income - out.spent - out.fixed) / out.income) * 100) : null;
  return out;
}

export const isUntagged = (st, t) => t.type === 'out' && !t.categoryId && groupOfTxn(st, t) === 'spending';
export const untaggedTxns = (st) => st.txns.filter((t) => isUntagged(st, t));

export function budgetTotal(st) {
  return sum(st.categories.filter((c) => !c.archived && kindOf(st, c.kindId)?.group === 'spending'), (c) => c.budget || 0);
}

/** Elapsed days in month mk as of `today` (full month for past months, 0 for future). */
export function daysElapsed(mk, today = nowLocal()) {
  const cur = monthOf(today);
  if (mk < cur) return daysInMonth(mk);
  if (mk > cur) return 0;
  return Number(today.slice(8, 10));
}

export function pace(st, mk, today = nowLocal()) {
  const s = monthSummary(st, mk);
  const elapsed = daysElapsed(mk, today);
  const dim = daysInMonth(mk);
  const avg = elapsed ? Math.round(s.spent / elapsed) : 0;
  const projected = elapsed ? Math.round((s.spent / elapsed) * dim) : 0;
  const budget = budgetTotal(st);
  const remainingDays = Math.max(1, dim - elapsed + 1); // include today
  const left = budget - s.spent;
  const safePerDay = budget ? Math.max(0, Math.floor(left / remainingDays / 100) * 100) : null;
  return { ...s, elapsed, dim, avg, projected, budget, left, safePerDay, remainingDays: dim - elapsed };
}

/** Compare a month to the previous one over the same number of days. */
export function compareToPrevious(st, mk, today = nowLocal()) {
  const elapsed = daysElapsed(mk, today) || daysInMonth(mk);
  const prev = addMonths(mk, -1);
  const cur = monthSummary(st, mk, elapsed);
  const old = monthSummary(st, prev, Math.min(elapsed, daysInMonth(prev)));
  const change = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  const byCategory = {};
  for (const id of new Set([...Object.keys(cur.byCategory), ...Object.keys(old.byCategory)])) {
    byCategory[id] = { now: cur.byCategory[id] || 0, before: old.byCategory[id] || 0, change: change(cur.byCategory[id] || 0, old.byCategory[id] || 0) };
  }
  return { spentChange: change(cur.spent, old.spent), prevSpent: old.spent, byCategory, prevMonth: prev };
}

export function dailySpend(st, mk) {
  const dim = daysInMonth(mk);
  const days = Array.from({ length: dim }, () => 0);
  for (const t of txnsInMonth(st, mk)) if (groupOfTxn(st, t) === 'spending') days[Number(t.date.slice(8, 10)) - 1] += t.amount;
  return days;
}

export function monthlyTrend(st, endMk, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const mk = addMonths(endMk, -i);
    const s = monthSummary(st, mk);
    out.push({ mk, spent: s.spent, income: s.income, savingsRate: s.savingsRate });
  }
  return out;
}

export function topPayees(st, mk, n = 5) {
  const g = {};
  for (const t of txnsInMonth(st, mk)) {
    if (groupOfTxn(st, t) !== 'spending' || !t.payee) continue;
    const k = t.payee.trim().toLowerCase();
    (g[k] ||= { name: t.payee.trim(), total: 0, count: 0 });
    g[k].total += t.amount; g[k].count++;
  }
  return Object.values(g).sort((a, b) => b.total - a.total).slice(0, n);
}

export function categoryHabits(st, mk) {
  const g = {};
  for (const t of txnsInMonth(st, mk)) {
    if (groupOfTxn(st, t) !== 'spending' || !t.categoryId) continue;
    (g[t.categoryId] ||= { categoryId: t.categoryId, total: 0, count: 0, labels: {} });
    g[t.categoryId].total += t.amount; g[t.categoryId].count++;
    if (t.label) g[t.categoryId].labels[t.label] = (g[t.categoryId].labels[t.label] || 0) + t.amount;
  }
  return Object.values(g).map((x) => ({ ...x, avg: Math.round(x.total / x.count) }));
}

// ---------- commitments ----------
export const isCommitmentActive = (c, mk) =>
  c.active !== false && (!c.startMonth || c.startMonth <= mk) && (!c.endMonth || mk <= c.endMonth);

export function commitmentStatus(st, mk) {
  const items = st.commitments.filter((c) => isCommitmentActive(c, mk)).map((c) => {
    const paidTxn = st.txns.find((t) => t.commitmentId === c.id && t.commitmentMonth === mk);
    return { c, paid: !!paidTxn, paidTxn, amount: paidTxn ? paidTxn.amount : c.amount };
  });
  const total = sum(items, (i) => i.amount);
  const paidTotal = sum(items.filter((i) => i.paid), (i) => i.amount);
  const due = items.filter((i) => !i.paid).sort((a, b) => a.c.dueDay - b.c.dueDay);
  return { items, total, paidTotal, dueTotal: total - paidTotal, paidCount: items.length - due.length, count: items.length, next: due[0] || null };
}

// ---------- salary split ----------
export function salarySplit(st, mk) {
  const s = st.settings;
  const S = s.salaryAccountId;
  if (!S || !st.accounts.some((a) => a.id === S)) return { configured: false };
  const list = txnsInMonth(st, mk);
  const received = sum(list.filter((t) => t.type === 'in' && t.accountId === S), (t) => t.amount);
  const salary = received || s.expectedSalary || 0;
  const rows = {};
  const row = (id) => (rows[id] ||= { accountId: id, items: [], needed: 0, moved: 0 });
  for (const c of st.commitments.filter((x) => isCommitmentActive(x, mk))) {
    if (!c.accountId) continue;
    row(c.accountId).items.push({ label: c.name, amount: c.amount, kind: 'commitment' });
  }
  if (s.dailyAccountId && s.dailyAmount) row(s.dailyAccountId).items.push({ label: 'Day-to-day spending money', amount: s.dailyAmount, kind: 'daily' });
  if (s.plannedAccountId && s.plannedMonthly) row(s.plannedAccountId).items.push({ label: 'Set-aside for planned expenses', amount: s.plannedMonthly, kind: 'planned' });
  const committed = sum(Object.values(rows), (r) => sum(r.items, (i) => i.amount));
  let leftover = salary - committed;
  if (leftover > 0 && s.leftoverSplit?.length) {
    const base = leftover;
    for (const ls of s.leftoverSplit) {
      if (!ls.accountId || !ls.pct || ls.accountId === S) continue;
      const amt = Math.floor((base * ls.pct) / 100);
      if (amt > 0) { row(ls.accountId).items.push({ label: `${ls.pct}% of leftover`, amount: amt, kind: 'leftover' }); leftover -= amt; }
    }
  }
  for (const r of Object.values(rows)) {
    r.needed = sum(r.items, (i) => i.amount);
    r.moved = sum(list.filter((t) => t.type === 'transfer' && t.accountId === S && t.toAccountId === r.accountId), (t) => t.amount);
    r.toMove = Math.max(0, r.needed - r.moved);
  }
  const stays = rows[S] || { accountId: S, items: [], needed: 0, moved: 0, toMove: 0 };
  delete rows[S];
  const others = Object.values(rows).sort((a, b) => b.needed - a.needed);
  return {
    configured: true, salaryAccountId: S, received, expected: s.expectedSalary || 0, salary,
    stays, rows: others, committed, leftover, short: leftover < 0 ? -leftover : 0,
    totalToMove: sum(others, (r) => r.toMove),
  };
}

// ---------- planned expenses ----------
export function plannedProjection(st, fromMk = monthKey()) {
  const s = st.settings;
  const monthly = s.plannedMonthly || 0;
  const saved = s.plannedSaved || 0;
  const contributedNow = s.plannedContribMonth === fromMk;
  const open = st.planned.filter((p) => !p.paidTxnId).map((p) => ({ ...p, dueMonth: p.month < fromMk ? fromMk : p.month }));
  if (!open.length) return { rows: [], saved, monthly, totalPlanned: 0, firstShort: null, requiredMonthly: null };
  const byMonth = groupBy(open, (p) => p.dueMonth);
  const last = open.reduce((m, p) => (p.dueMonth > m ? p.dueMonth : m), fromMk);
  const span = monthDiff(fromMk, last);
  let fund = saved, cumulative = 0, contributions = 0, firstShort = null, required = 0, impossible = false;
  const rows = [];
  for (let i = 0; i <= span; i++) {
    const mk = addMonths(fromMk, i);
    if (i > 0 || !contributedNow) { fund += monthly; contributions++; }
    const items = byMonth[mk] || [];
    const total = sum(items, (p) => p.amount);
    const fundStart = fund;
    fund -= total;
    cumulative += total;
    if (total) {
      if (contributions > 0) required = Math.max(required, Math.ceil((cumulative - saved) / contributions));
      else if (cumulative > saved) impossible = true;
      const short = fund < 0 ? -fund : 0;
      if (short && !firstShort) firstShort = { mk, short };
      rows.push({ mk, items, total, fundStart, fundEnd: fund, short });
    }
  }
  return {
    rows, saved, monthly, totalPlanned: sum(open, (p) => p.amount), firstShort,
    requiredMonthly: firstShort ? (impossible ? null : Math.max(required, monthly)) : null,
  };
}

export { nowLocal, monthKey, dayOf };
