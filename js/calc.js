// Pure calculations. Every function takes the state object explicitly so it can be unit-tested.
import { sum, monthOf, dayOf, addMonths, daysInMonth, monthKey, nowLocal, monthDiff, groupBy } from './util.js';

const kindOf = (st, id) => st.kinds.find((k) => k.id === id);
export const groupOfTxn = (st, t) => {
  if (t.type === 'in') return 'income';
  if (t.type !== 'out') return null; // transfers and balance fixes are neither
  return kindOf(st, t.kindId)?.group || 'spending';
};

// ---------- balances ----------
export function balance(st, accountId, until = null) {
  const a = st.accounts.find((x) => x.id === accountId);
  if (!a) return 0;
  if (until && until < (a.openingAt || '').slice(0, 10)) return null; // account didn't exist yet
  const from = a.openingAt || '';
  const setAt = a.openingSetAt || a.createdAt || '';
  let b = a.openingBalance || 0;
  for (const t of st.txns) {
    // Entries dated after the opening moment count. Entries in the very same minute count only if they were
    // added after the balance was typed in (otherwise they're already part of it).
    if (t.date < from.slice(0, 16) || (t.date.slice(0, 16) === from.slice(0, 16) && !(t.createdAt > setAt))) continue;
    if (until && t.date.slice(0, 10) > until) continue;
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

export const SMALL_SPEND = 20000; // ₹200 and under counts as a small spend
export const payeeKey = (t) => (t.vpa ? t.vpa.trim().toLowerCase() : (t.payee || '').trim().toLowerCase().replace(/\s+/g, ' '));
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
  const r100 = (v) => Math.round(v / 100) * 100; // whole rupees
  const avg = elapsed ? r100(s.spent / elapsed) : 0;
  const projected = elapsed ? r100((s.spent / elapsed) * dim) : 0;
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
    const k = payeeKey(t);
    if (groupOfTxn(st, t) !== 'spending' || !k) continue;
    (g[k] ||= { key: k, name: (t.payee || t.vpa).trim(), total: 0, count: 0 });
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

// =====================================================================
// Deeper insights (v1.1). All pure; `scope` narrows the data to one account.
// =====================================================================

/** State limited to entries touching one account (transfers included). */
export function scope(st, accountId) {
  if (!accountId) return st;
  return { ...st, txns: st.txns.filter((t) => t.accountId === accountId || t.toAccountId === accountId) };
}

/** Average full-month spending per category over the previous `n` months that have any data. */
export function usualByCategory(st, mk, n = 3) {
  const months = [];
  for (let i = 1; i <= 12 && months.length < n; i++) {
    const m = addMonths(mk, -i);
    if (txnsInMonth(st, m).some((t) => groupOfTxn(st, t) === 'spending')) months.push(m);
  }
  if (!months.length) return { months: 0, byCategory: {}, spent: 0, savingsRate: null };
  const byCategory = {};
  let spent = 0; const rates = [];
  for (const m of months) {
    const s = monthSummary(st, m);
    spent += s.spent;
    if (s.savingsRate != null) rates.push(s.savingsRate);
    for (const [k, v] of Object.entries(s.byCategory)) byCategory[k] = (byCategory[k] || 0) + v;
  }
  for (const k of Object.keys(byCategory)) byCategory[k] = Math.round(byCategory[k] / months.length);
  return { months: months.length, byCategory, spent: Math.round(spent / months.length), savingsRate: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null };
}

/**
 * Compare this month with the usual month. For the current month, "usual" is what you had spent by the same
 * day in previous months — so a bill that always lands on the 8th isn't flagged as a jump on the 9th.
 */
export function vsUsual(st, mk, today = nowLocal()) {
  const usual = usualByCategory(st, mk);
  const elapsed = daysElapsed(mk, today) || daysInMonth(mk);
  const months = [];
  for (let i = 1; i <= 12 && months.length < usual.months; i++) {
    const m = addMonths(mk, -i);
    if (txnsInMonth(st, m).some((t) => groupOfTxn(st, t) === 'spending')) months.push(m);
  }
  const byCat = {}; let spentSoFar = 0;
  for (const m of months) {
    const s = monthSummary(st, m, elapsed);
    spentSoFar += s.spent;
    for (const [k, v] of Object.entries(s.byCategory)) byCat[k] = (byCat[k] || 0) + v;
  }
  const r100 = (v) => Math.round(v / 100) * 100;
  const cur = monthSummary(st, mk);
  const rows = {};
  for (const id of new Set([...Object.keys(cur.byCategory), ...Object.keys(usual.byCategory)])) {
    const now = cur.byCategory[id] || 0;
    const expected = months.length ? r100((byCat[id] || 0) / months.length) : 0;
    rows[id] = { now, usualMonth: usual.byCategory[id] || 0, expected, change: expected ? Math.round(((now - expected) / expected) * 100) : null };
  }
  return { months: usual.months, rows, spentExpected: months.length ? r100(spentSoFar / months.length) : 0, usualSpent: usual.spent, usualSavingsRate: usual.savingsRate };
}

export function smallSpends(st, mk) {
  const list = txnsInMonth(st, mk).filter((t) => groupOfTxn(st, t) === 'spending' && t.amount <= SMALL_SPEND);
  const byCat = {};
  for (const t of list) byCat[t.categoryId || '_untagged'] = (byCat[t.categoryId || '_untagged'] || 0) + t.amount;
  return { count: list.length, total: sum(list, (t) => t.amount), byCategory: Object.entries(byCat).sort((a, b) => b[1] - a[1]) };
}

/** Payees paid in at least 2 of the last 3 months (incl. this one) with similar amounts — likely subscriptions or habits. */
export function repeatPayments(st, mk) {
  const months = [addMonths(mk, -2), addMonths(mk, -1), mk];
  const g = {};
  for (const t of st.txns) {
    if (t.commitmentId || groupOfTxn(st, t) !== 'spending') continue;
    const m = monthOf(t.date);
    if (!months.includes(m)) continue;
    const k = payeeKey(t); if (!k) continue;
    (g[k] ||= { key: k, name: (t.payee || t.vpa).trim(), perMonth: {}, amounts: [], categoryId: t.categoryId });
    g[k].perMonth[m] = (g[k].perMonth[m] || 0) + t.amount;
    g[k].amounts.push(t.amount);
  }
  const out = [];
  for (const p of Object.values(g)) {
    const totals = Object.values(p.perMonth);
    if (totals.length < 2) continue;
    const sorted = [...totals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const steady = totals.every((v) => Math.abs(v - median) <= Math.max(median * 0.25, 5000));
    out.push({ ...p, monthsSeen: totals.length, monthly: median, steady });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

/** When each budgeted category will cross its budget at the current pace (current month only). */
export function budgetBurn(st, mk, today = nowLocal()) {
  const elapsed = daysElapsed(mk, today);
  const dim = daysInMonth(mk);
  const s = monthSummary(st, mk);
  return st.categories.filter((c) => !c.archived && c.budget > 0 && kindOf(st, c.kindId)?.group === 'spending').map((c) => {
    const spent = s.byCategory[c.id] || 0;
    let crossDay = null;
    if (spent > c.budget) crossDay = 0;
    else if (elapsed && spent > 0 && mk === monthOf(today)) {
      const perDay = spent / elapsed;
      const day = Math.ceil(elapsed + (c.budget - spent) / perDay);
      if (day <= dim) crossDay = day;
    }
    return { c, spent, budget: c.budget, over: spent > c.budget, crossDay };
  }).sort((a, b) => b.spent / b.budget - a.spent / a.budget);
}

/** Commitments and fixed costs as a share of income. */
export function burden(st, mk) {
  const s = monthSummary(st, mk);
  const income = s.income || st.settings?.expectedSalary || 0;
  const active = st.commitments.filter((c) => isCommitmentActive(c, mk));
  const byGroup = (pred) => sum(active.filter((c) => pred(kindOf(st, c.kindId))), (c) => c.amount);
  const loans = byGroup((k) => k?.key === 'loan' || /loan|emi/i.test(k?.name || ''));
  const fixed = byGroup((k) => k?.group === 'fixed');
  const saving = byGroup((k) => k?.group === 'saving');
  const bills = byGroup((k) => k?.group === 'spending');
  const committed = sum(active, (c) => c.amount);
  const pc = (v) => (income ? Math.round((v / income) * 100) : null);
  return { income, loans, fixed, saving, bills, committed, flexible: income - committed, loanPct: pc(loans), fixedPct: pc(fixed), committedPct: pc(committed) };
}

/** Money that left (or appeared in) accounts without an entry — the sum of balance corrections. */
export function unlogged(st, mk) {
  const list = txnsInMonth(st, mk).filter((t) => t.type === 'adjust');
  return { missingOut: -sum(list.filter((t) => t.amount < 0), (t) => t.amount), missingIn: sum(list.filter((t) => t.amount > 0), (t) => t.amount), count: list.length };
}

export function newPayees(st, mk) {
  const seenBefore = new Set(st.txns.filter((t) => monthOf(t.date) < mk).map(payeeKey).filter(Boolean));
  const fresh = {};
  for (const t of txnsInMonth(st, mk)) {
    const k = payeeKey(t);
    if (!k || seenBefore.has(k) || groupOfTxn(st, t) !== 'spending') continue;
    (fresh[k] ||= { key: k, name: (t.payee || t.vpa).trim(), total: 0 }).total += t.amount;
  }
  const list = Object.values(fresh).sort((a, b) => b.total - a.total);
  return { count: list.length, total: sum(list, (x) => x.total), list };
}

export function spendTiming(st, mk, today = nowLocal()) {
  const list = txnsInMonth(st, mk).filter((t) => groupOfTxn(st, t) === 'spending');
  const elapsed = daysElapsed(mk, today) || daysInMonth(mk);
  let weDays = 0, wdDays = 0;
  const [y, m] = mk.split('-').map(Number);
  for (let d = 1; d <= elapsed; d++) { const w = new Date(y, m - 1, d).getDay(); if (w === 0 || w === 6) weDays++; else wdDays++; }
  const byDow = [0, 0, 0, 0, 0, 0, 0];
  let weekend = 0, weekday = 0, late = 0, lateCount = 0;
  for (const t of list) {
    const [yy, mm, dd] = t.date.slice(0, 10).split('-').map(Number);
    const w = new Date(yy, mm - 1, dd).getDay();
    byDow[w] += t.amount;
    if (w === 0 || w === 6) weekend += t.amount; else weekday += t.amount;
    const h = Number(t.date.slice(11, 13));
    if (h >= 22 || h < 5) { late += t.amount; lateCount++; }
  }
  const busiest = byDow.indexOf(Math.max(...byDow));
  return {
    weekendPerDay: weDays ? Math.round(weekend / weDays / 100) * 100 : 0, weekdayPerDay: wdDays ? Math.round(weekday / wdDays / 100) * 100 : 0,
    late, lateCount, byDow, busiest: byDow[busiest] ? busiest : null, total: sum(list, (t) => t.amount),
  };
}

export function spikeDays(st, mk, today = nowLocal()) {
  const days = dailySpend(st, mk);
  const elapsed = daysElapsed(mk, today) || days.length;
  const active = days.slice(0, elapsed);
  const avg = active.length ? active.reduce((a, b) => a + b, 0) / active.length : 0;
  const out = [];
  active.forEach((v, i) => {
    if (avg && v >= avg * 2 && v >= 50000) {
      const day = `${mk}-${String(i + 1).padStart(2, '0')}`;
      const top = st.txns.filter((t) => t.date.slice(0, 10) === day && groupOfTxn(st, t) === 'spending').sort((a, b) => b.amount - a.amount)[0];
      out.push({ day, total: v, times: Math.round((v / avg) * 10) / 10, top });
    }
  });
  return out.sort((a, b) => b.total - a.total);
}

/** Money in and out of one account in a month, with where transfers came from / went to. */
export function accountFlow(st, accountId, mk) {
  const list = txnsInMonth(st, mk);
  const flow = { received: 0, transfersIn: 0, spent: 0, fixed: 0, saving: 0, transfersOut: 0, adjust: 0, to: {}, from: {} };
  for (const t of list) {
    if (t.type === 'in' && t.accountId === accountId) flow.received += t.amount;
    else if (t.type === 'out' && t.accountId === accountId) {
      const g = groupOfTxn(st, t);
      if (g === 'fixed') flow.fixed += t.amount; else if (g === 'saving') flow.saving += t.amount; else flow.spent += t.amount;
    } else if (t.type === 'transfer') {
      if (t.accountId === accountId) { flow.transfersOut += t.amount; flow.to[t.toAccountId] = (flow.to[t.toAccountId] || 0) + t.amount; }
      if (t.toAccountId === accountId) { flow.transfersIn += t.amount; flow.from[t.accountId] = (flow.from[t.accountId] || 0) + t.amount; }
    } else if (t.type === 'adjust' && t.accountId === accountId) flow.adjust += t.amount;
  }
  flow.in = flow.received + flow.transfersIn;
  flow.out = flow.spent + flow.fixed + flow.saving + flow.transfersOut;
  flow.net = flow.in - flow.out + flow.adjust;
  return flow;
}

/** Month-end balances for the last n months (null before the account existed). */
export function balanceTrend(st, accountIds, endMk, n = 6, today = nowLocal()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const mk = addMonths(endMk, -i);
    const until = mk === monthOf(today) ? today.slice(0, 10) : `${mk}-${String(daysInMonth(mk)).padStart(2, '0')}`;
    let total = 0, any = false;
    for (const id of accountIds) { const b = balance(st, id, until); if (b != null) { total += b; any = true; } }
    out.push({ mk, value: any ? total : null });
  }
  return out;
}
