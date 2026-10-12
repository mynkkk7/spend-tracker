// "Worth a look": turns the numbers into a short list of plain-language findings, most important first.
import { money, monthShort, monthOf, nowLocal, shortDate, sum } from './util.js';
import {
  pace, vsUsual, budgetBurn, smallSpends, repeatPayments, unlogged, burden, spikeDays, spendTiming,
  newPayees, untaggedTxns, monthSummary, accountFlow, scope,
} from './calc.js';

const catName = (st, id) => st.categories.find((c) => c.id === id)?.name || 'Untagged';
const q = (o) => '#/txns?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

/**
 * @returns {{level: 'high'|'mid'|'low'|'good', text: string, sub?: string, href?: string}[]}
 */
export function findings(fullSt, mk, { accountId = null, today = nowLocal() } = {}) {
  const st = scope(fullSt, accountId);
  const out = [];
  const isCur = mk === monthOf(today);
  const p = pace(st, mk, today);
  const base = { m: mk, account: accountId || '' };
  const purpose = accountId ? fullSt.accounts.find((a) => a.id === accountId)?.purpose : null;

  // Savings / investment accounts: money taken out is the thing to notice.
  if (accountId && (purpose === 'savings' || purpose === 'investment')) {
    const f = accountFlow(fullSt, accountId, mk);
    const taken = f.transfersOut + f.spent;
    if (taken > 0) out.push({ level: 'high', text: `${money(taken)} was taken out of this account in ${monthShort(mk)}`, sub: 'Withdrawals slow down what you’re building here.', href: q({ ...base }) });
    if (f.in > 0 && !taken) out.push({ level: 'good', text: `${money(f.in)} added in ${monthShort(mk)}, nothing taken out` });
  }

  // Budget already over / will cross.
  for (const b of budgetBurn(st, mk, today)) {
    if (b.over) out.push({ level: 'high', text: `${b.c.name} is ${money(b.spent - b.budget)} over its ${money(b.budget)} budget`, href: q({ ...base, cat: b.c.id }) });
    else if (b.crossDay && isCur) out.push({ level: 'mid', text: `At this pace ${b.c.name} crosses its ${money(b.budget)} budget on ${b.crossDay} ${monthShort(mk)}`, sub: `${money(b.spent)} spent so far.`, href: q({ ...base, cat: b.c.id }) });
  }

  // Overall projection vs budget.
  if (isCur && p.budget && p.projected > p.budget && p.elapsed >= 5) {
    out.push({ level: 'high', text: `Heading for ${money(p.projected)} this month — ${money(p.projected - p.budget)} over your total budget`, sub: `Keep to ${money(p.safePerDay)} a day to stay within it.` });
  }

  // Category vs usual (needs history).
  const vu = vsUsual(st, mk, today);
  if (vu.months) {
    const rows = Object.entries(vu.rows).filter(([id, r]) => id !== '_untagged' && r.expected >= 30000 && r.change != null && r.change >= 30 && r.now - r.expected >= 50000)
      .sort((a, b) => (b[1].now - b[1].expected) - (a[1].now - a[1].expected)).slice(0, 2);
    for (const [id, r] of rows) {
      out.push({ level: r.change >= 60 ? 'high' : 'mid', text: r.change >= 200 ? `${catName(st, id)} is ${Math.round((r.now / r.expected) * 10) / 10}× your usual` : `${catName(st, id)} is ${r.change}% above your usual`, sub: `${money(r.now)} so far vs about ${money(r.expected)} by this point in a usual month.`, href: q({ ...base, cat: id }) });
    }
    const drop = Object.entries(vu.rows).filter(([id, r]) => id !== '_untagged' && r.expected >= 50000 && r.change != null && r.change <= -30)
      .sort((a, b) => (a[1].now - a[1].expected) - (b[1].now - b[1].expected))[0];
    if (drop) out.push({ level: 'good', text: `${catName(st, drop[0])} is ${Math.abs(drop[1].change)}% below your usual`, sub: `${money(drop[1].expected - drop[1].now)} less than a usual month by now.`, href: q({ ...base, cat: drop[0] }) });
    const s = monthSummary(st, mk);
    if (!accountId && s.savingsRate != null && vu.usualSavingsRate != null && !isCur && vu.usualSavingsRate - s.savingsRate >= 5) {
      out.push({ level: 'mid', text: `You saved ${s.savingsRate}% of income — down from your usual ${vu.usualSavingsRate}%` });
    }
  }

  // Small spends.
  const sm = smallSpends(st, mk);
  if (sm.count >= 8 && p.spent && sm.total / p.spent >= 0.05) {
    out.push({ level: 'mid', text: `${money(sm.total)} went on ${sm.count} small payments (≤ ₹200)`, sub: `Mostly ${catName(st, sm.byCategory[0]?.[0])}. Small amounts add up.`, href: q({ ...base, small: '1' }) });
  }

  // Unlogged money.
  const ul = unlogged(st, mk);
  if (ul.missingOut >= 10000) out.push({ level: 'mid', text: `${money(ul.missingOut)} left your accounts without an entry`, sub: 'Found through balance fixes. Logging it keeps insights accurate.', href: q({ ...base, type: 'adjust' }) });

  // Repeat payments.
  const reps = repeatPayments(st, mk).filter((r) => r.steady);
  if (reps.length >= 2) out.push({ level: 'low', text: `${reps.length} regular payments add up to ${money(sum(reps, (r) => r.monthly))} a month`, sub: reps.slice(0, 3).map((r) => r.name).join(', ') + (reps.length > 3 ? '…' : '') + ' — still worth it?' });

  // EMI burden (all-accounts view only).
  if (!accountId) {
    const b = burden(fullSt, mk);
    if (b.loanPct != null && b.loanPct >= 40) out.push({ level: 'high', text: `EMIs take ${b.loanPct}% of your income`, sub: 'Above the ~40% level lenders treat as comfortable.', href: '#/commitments' });
    else if (b.committedPct != null && b.committedPct >= 70) out.push({ level: 'mid', text: `${b.committedPct}% of income is committed before you spend anything`, sub: `Leaves ${money(b.flexible)} flexible.`, href: '#/commitments' });
  }

  // Spike day.
  const spike = spikeDays(st, mk, today)[0];
  if (spike) out.push({ level: 'low', text: `${shortDate(spike.day + 'T00:00')} was ${spike.times}× your usual day (${money(spike.total)})`, sub: spike.top ? `Biggest: ${spike.top.note || spike.top.payee || catName(st, spike.top.categoryId)} ${money(spike.top.amount)}.` : '', href: q({ ...base, day: spike.day }) });

  // Late night.
  const tm = spendTiming(st, mk, today);
  if (tm.total && tm.late / tm.total >= 0.12 && tm.lateCount >= 3) out.push({ level: 'low', text: `${money(tm.late)} spent late at night (10 pm–5 am)`, sub: `${tm.lateCount} payments.`, href: q({ ...base, late: '1' }) });

  // New payees.
  const np = newPayees(st, mk);
  if (np.count >= 5 && p.spent && np.total / p.spent >= 0.2) out.push({ level: 'low', text: `${np.count} new places this month took ${money(np.total)}` });

  // Untagged.
  if (!accountId) {
    const u = untaggedTxns(fullSt).length;
    if (u) out.push({ level: 'mid', text: `${u} entr${u === 1 ? 'y needs' : 'ies need'} a category`, sub: 'Untagged spending makes the category numbers less reliable.', href: '#/tag' });
  }

  const order = { high: 0, mid: 1, low: 2, good: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
