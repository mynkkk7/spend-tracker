import { html, raw, money, moneyShort, monthKey, monthLabel, monthShort, addMonths, sum, pct, shortDate } from '../util.js';
import { state, category, kind, account, activeAccounts } from '../store.js';
import {
  scope, pace, compareToPrevious, vsUsual, dailySpend, monthlyTrend, topPayees, categoryHabits, salarySplit, budgetTotal,
  budgetBurn, smallSpends, repeatPayments, burden, spendTiming, spikeDays, newPayees, accountFlow, balanceTrend, unlogged, balance,
} from '../calc.js';
import { findings } from '../findings.js';
import { donut, bars, stack } from '../charts.js';
import { icon, dot, tabbar, empty, progress, accName, purposeColor, purposeLabel, showBalances, bal, privacy } from '../ui.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FLOW_PURPOSES = ['income', 'savings', 'investment'];

export function insightsView(_p, query) {
  const cur = monthKey();
  const mk = query.m || cur;
  const accId = query.a && account(query.a) ? query.a : null;
  const a = accId ? account(accId) : null;
  const isCur = mk === cur;
  const nav = (patch) => '#/insights?' + new URLSearchParams(Object.entries({ m: mk, a: accId || '', ...patch }).filter(([, v]) => v)).toString();
  const dl = (patch) => '#/txns?' + new URLSearchParams(Object.entries({ m: mk, account: accId || '', ...patch }).filter(([, v]) => v != null && v !== '')).toString();
  const accts = activeAccounts();
  const p0 = pace(scope(state, accId), mk);

  const body = a && FLOW_PURPOSES.includes(a.purpose) ? flowBody(a, mk, isCur, dl, nav) : spendingBody(accId, mk, isCur, dl, nav);

  return {
    tab: 'insights', live: true,
    html: html`
    <header class="page-head"><h1>Insights</h1></header>
    <div class="acc-tabs" role="tablist" aria-label="Accounts">
      <a role="tab" class="pill ${!accId ? 'on' : ''}" aria-selected="${!accId}" href="${nav({ a: '' })}">All</a>
      ${accts.map((x) => html`<a role="tab" class="pill ${x.id === accId ? 'on' : ''}" aria-selected="${x.id === accId}" href="${nav({ a: x.id })}"><span class="dot" style="background:${purposeColor(x.purpose)}"></span>${x.name}</a>`)}
    </div>
    <div class="month-nav">
      <a class="icon-btn" href="${nav({ m: addMonths(mk, -1) })}" aria-label="Previous month">${icon.back}</a>
      <div class="center"><strong>${monthLabel(mk)}</strong><div class="small muted">${isCur ? `1–${p0.elapsed} ${monthShort(mk)} · ${p0.remainingDays} days left` : mk > cur ? 'Upcoming' : 'Full month'}</div></div>
      ${mk < cur ? html`<a class="icon-btn flip" href="${nav({ m: addMonths(mk, 1) })}" aria-label="Next month">${icon.back}</a>` : html`<span class="icon-btn" style="visibility:hidden" aria-hidden="true"></span>`}
    </div>
    ${a ? html`<div class="small muted acc-sub">${purposeLabel(a.purpose)} account${a.bank ? ` · ${a.bank}` : ''} · <a href="#/account/${a.id}">Open account</a></div>` : ''}
    ${body}
    ${tabbar('insights')}`,
    mount(el, { refresh }) {
      el.querySelector('[data-act="reveal"]')?.addEventListener('click', () => { privacy.revealed = !privacy.revealed; refresh(); });
      el.querySelector('.acc-tabs .on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    },
  };
}

// ---------- shared sections ----------
function worthALook(list) {
  if (!list.length) return html`<section class="card mt12 wal"><h2>Worth a look</h2><p class="muted small mt8">Nothing unusual so far. Findings appear here as patterns show up — the more you log, the sharper they get.</p></section>`;
  return html`<section class="card mt12 wal"><h2>Worth a look</h2>
    <div class="finds">${list.slice(0, 6).map((f) => {
      const inner = html`<span class="fdot ${f.level}" aria-hidden="true"></span><span class="grow"><span class="ft">${f.text}</span>${f.sub ? html`<span class="fs">${f.sub}</span>` : ''}</span>${f.href ? icon.chev : ''}`;
      return f.href ? html`<a class="find" href="${f.href}">${inner}</a>` : html`<div class="find">${inner}</div>`;
    })}</div></section>`;
}

function balanceCard(ids, mk, title) {
  if (!showBalances()) {
    return html`<section class="card mt12"><div class="row between"><h2>${title}</h2><button type="button" class="btn btn-sm" data-act="reveal">${icon.eye} Show</button></div><p class="small muted mt8">Balances are hidden.</p></section>`;
  }
  const tr = balanceTrend(state, ids, mk, 6);
  if (!tr.some((t) => t.value != null)) return '';
  const vals = tr.map((t) => ({ v: Math.abs(t.value || 0), label: monthShort(t.mk), tip: `${monthLabel(t.mk)} · ${t.value == null ? 'not tracked yet' : money(t.value)}`, color: (t.value || 0) < 0 ? 'var(--debit)' : 'var(--s3)' }));
  const known = tr.filter((t) => t.value != null);
  const change = known.length > 1 ? known[known.length - 1].value - known[0].value : null;
  return html`<section class="card mt12"><div class="row between"><h2>${title}</h2>${state.settings.hideBalances ? html`<button type="button" class="icon-btn sm" data-act="reveal" aria-label="Hide balances">${icon.eye}</button>` : ''}</div>
    <div class="sub">Month-end balance${change != null ? html` · <span class="${change >= 0 ? 'credit' : 'debit'}">${money(change, { sign: true })}</span> since ${monthShort(known[0].mk)}` : ''}</div>
    ${bars(vals, { annotate: vals.map((_, i) => i), label: title })}</section>`;
}

// ---------- spending view (All, or a spending / card / cash account) ----------
function spendingBody(accId, mk, isCur, dl, nav) {
  const st = scope(state, accId);
  const p = pace(st, mk);
  if (!p.count && !st.txns.some((t) => t.date.slice(0, 7) === mk)) return empty('No entries this month', accId ? 'Nothing recorded for this account in this month.' : 'Insights fill in as you add spending.');
  const cmp = compareToPrevious(st, mk);
  const vu = vsUsual(st, mk);
  const useUsual = vu.months > 0;
  const cats = Object.entries(p.byCategory).map(([id, v]) => ({ id, v, c: category(id) })).sort((x, y) => y.v - x.v);
  const kinds = Object.entries(p.byKind).map(([id, v]) => ({ id, v, k: kind(id) })).sort((x, y) => y.v - x.v);
  const daily = dailySpend(st, mk);
  const trend = monthlyTrend(st, mk, 6);
  const payees = topPayees(st, mk, 6);
  const top3 = sum(payees.slice(0, 3), (x) => x.total);
  const habits = categoryHabits(st, mk).sort((x, y) => y.count - x.count);
  const labelled = habits.filter((h) => Object.keys(h.labels).length);
  const burn = accId ? [] : budgetBurn(state, mk);
  const budget = accId ? 0 : budgetTotal(state);
  const sm = smallSpends(st, mk);
  const reps = repeatPayments(st, mk);
  const tm = spendTiming(st, mk);
  const spikes = spikeDays(st, mk);
  const np = newPayees(st, mk);
  const dim = daily.length;
  const fs = findings(state, mk, { accountId: accId });
  const a = accId ? account(accId) : null;
  const flow = a ? accountFlow(state, a.id, mk) : null;
  const ul = unlogged(st, mk);

  return html`
    <div class="kpi-grid">
      <a class="card kpi-card" href="${dl({})}"><span class="k">Spent</span><span class="v num">${money(p.spent)}</span>
        <span class="s">${useUsual && vu.spentExpected ? (() => { const ch = pct(p.spent - vu.spentExpected, vu.spentExpected); return html`<span class="${ch > 0 ? 'debit' : 'credit'}">${ch > 0 ? '▲' : '▼'} ${Math.abs(ch)}%</span> vs usual${isCur ? ' by now' : ''}`; })()
          : cmp.spentChange != null ? html`<span class="${cmp.spentChange > 0 ? 'debit' : 'credit'}">${cmp.spentChange > 0 ? '▲' : '▼'} ${Math.abs(cmp.spentChange)}%</span> vs ${monthShort(cmp.prevMonth)}` : 'No earlier month yet'}</span></a>
      ${accId ? html`<div class="card kpi-card"><span class="k">Money in</span><span class="v num credit">${money(flow.in)}</span><span class="s">${flow.transfersIn ? `${money(flow.transfersIn)} transferred in` : 'this month'}</span></div>`
        : html`<div class="card kpi-card"><span class="k">Saved or invested</span><span class="v num">${p.savingsRate != null ? `${p.savingsRate}%` : '—'}</span><span class="s">${p.income ? `of ${money(p.income)} income${vu.usualSavingsRate != null ? ` · usual ${vu.usualSavingsRate}%` : ''}` : 'Add income to see this'}</span></div>`}
      <div class="card kpi-card"><span class="k">Average per day</span><span class="v num">${money(p.avg)}</span><span class="s">${p.count} entr${p.count === 1 ? 'y' : 'ies'} · ${p.count ? money(Math.round(p.spent / Math.max(1, p.count) / 100) * 100) : '₹0'} each</span></div>
      ${isCur ? html`<div class="card kpi-card ${budget && p.projected > budget ? 'warn' : ''}"><span class="k">Projected month-end</span><span class="v num">${money(p.projected)}</span>
        <span class="s">${budget ? (p.projected > budget ? `${money(p.projected - budget)} over ${moneyShort(budget)} budget` : `within ${moneyShort(budget)} budget`) : useUsual ? `usual month ${moneyShort(vu.usualSpent)}` : 'at this pace'}</span></div>`
        : html`<div class="card kpi-card"><span class="k">${budget ? 'Budget used' : 'Usual month'}</span><span class="v num">${budget ? `${pct(p.spent, budget)}%` : useUsual ? money(vu.usualSpent) : '—'}</span><span class="s">${budget ? `${money(p.spent)} of ${money(budget)}` : useUsual ? `avg of ${vu.months} month${vu.months > 1 ? 's' : ''}` : 'Not enough history'}</span></div>`}
    </div>

    ${worthALook(fs)}

    ${kinds.length ? html`<section class="card mt12">
      <h2>All money out, by kind</h2>
      <div class="sub">${money(p.moneyOut)} · only ${state.kinds.filter((k) => k.group === 'spending').map((k) => k.name).join(', ')} counts as spending</div>
      ${stack(kinds.map((x) => ({ value: x.v, color: x.k?.color || '#8f8e88', label: x.k?.name || 'Other' })), { label: 'Money out by kind' })}
      <div class="mt8">${kinds.map((x) => html`<a class="lr link" href="${dl({ kind: x.id })}">${dot(x.k?.color)}<span class="grow">${x.k?.name || 'Other'}</span><span class="num b">${money(x.v)}</span><span class="pc">${pct(x.v, p.moneyOut)}%</span>${icon.chev}</a>`)}</div>
      ${p.spent ? html`<div class="split2 mt12">
        <a href="${dl({ essential: '1' })}" class="ess"><span class="small muted">Essential spending</span><b class="num">${money(p.essential)}</b><span class="small link-text">See ${pct(p.essential, p.spent)}% ›</span></a>
        <a href="${dl({ essential: '0' })}" class="ess"><span class="small muted">Non-essential</span><b class="num">${money(p.nonEssential)}</b><span class="small link-text">See ${pct(p.nonEssential, p.spent)}% ›</span></a></div>
        <div class="hint">${p.nonEssential ? 'Non-essential is where cuts are easiest. Tap to see every entry.' : 'All spending was marked essential.'}</div>` : ''}
    </section>` : ''}

    ${cats.length ? html`<section class="card mt12">
      <h2>Where it went</h2><div class="sub">Spending by category · ${useUsual ? `vs your usual (${vu.months}-month average${isCur ? ', to this date' : ''})` : `vs ${monthShort(cmp.prevMonth)}`}</div>
      ${donut(cats.map((x) => ({ value: x.v, color: x.c?.color || '#6e6d68', label: x.c?.name || 'Untagged' })), { center: money(p.spent), sub: isCur ? 'this month' : monthShort(mk), label: 'Spending by category' })}
      <table class="cat-table"><caption class="sr">Spending by category</caption><thead><tr><th>Category</th><th class="r">Spent</th><th class="r">${useUsual ? 'vs usual' : 'Change'}</th></tr></thead><tbody>
      ${cats.map((x) => {
        const ch = useUsual ? vu.rows[x.id]?.change : cmp.byCategory[x.id]?.change;
        return html`<tr><td><a class="row gap8" href="${x.c ? dl({ cat: x.id }) : '#/tag'}">${dot(x.c?.color || '#6e6d68')}${x.c ? x.c.name : 'Untagged'}</a></td><td class="r num b">${money(x.v)}</td>
        <td class="r num ${ch > 10 ? 'debit' : ch < -10 ? 'credit' : 'muted'}">${ch == null ? 'new' : ch === 0 ? '0%' : `${ch > 0 ? '▲' : '▼'} ${Math.abs(ch)}%`}</td></tr>`;
      })}
      </tbody></table></section>` : ''}

    ${burn.length ? html`<section class="card mt12"><div class="row between"><h2>Budgets</h2><a href="#/settings/categories" class="small">Edit</a></div>
      ${burn.map((b) => html`<a class="bg-row" href="${dl({ cat: b.c.id })}"><div class="row between small"><span>${b.c.name}</span><span><b class="num">${money(b.spent)}</b> / ${money(b.budget)}</span></div>${progress(b.spent, b.budget, { over: b.over })}
        <div class="small ${b.over ? 'debit' : b.crossDay ? 'warn-text' : 'muted'} mt4">${b.over ? `Over by ${money(b.spent - b.budget)}` : b.crossDay ? `At this pace, crosses on ${b.crossDay} ${monthShort(mk)}` : `${money(b.budget - b.spent)} left`}</div></a>`)}</section>` : ''}

    ${sm.count ? html`<section class="card mt12"><div class="row between"><h2>Small spends</h2><a class="small" href="${dl({ small: '1' })}">See all</a></div>
      <div class="sub">Payments of ₹200 or less</div>
      <div class="split2 mt12 no-border"><div><span class="small muted">Total</span><b class="num">${money(sm.total)}</b></div><div><span class="small muted">Payments</span><b class="num">${sm.count}</b></div></div>
      ${p.spent ? html`<div class="hint">${pct(sm.total, p.spent)}% of this month’s spending.</div>` : ''}
      <div class="mt8">${sm.byCategory.slice(0, 4).map(([id, v]) => html`<a class="lr link" href="${dl({ small: '1', cat: id === '_untagged' ? '' : id })}">${dot(category(id)?.color || '#6e6d68')}<span class="grow">${category(id)?.name || 'Untagged'}</span><span class="num b">${money(v)}</span>${icon.chev}</a>`)}</div></section>` : ''}

    <section class="card mt12"><h2>Daily spend</h2><div class="sub">Tap a bar to see that day’s entries.</div>
      ${bars(daily.map((v, i) => { const d = `${mk}-${String(i + 1).padStart(2, '0')}`; return { v, label: String(i + 1), tip: `${i + 1} ${monthShort(mk)} · ${money(v)}`, href: dl({ day: d, m: '' }) }; }), {
        ref: p.avg ? { value: p.avg, text: `avg ${moneyShort(p.avg)}` } : null,
        showLabels: [0, 4, 9, 14, 19, 24, dim - 1], annotate: [daily.indexOf(Math.max(...daily))], label: `Daily spending in ${monthLabel(mk)}`,
      })}
      ${spikes.length ? html`<div class="mt8">${spikes.slice(0, 3).map((s) => html`<a class="lr link" href="${dl({ day: s.day, m: '' })}"><span class="grow">${shortDate(s.day + 'T00:00')} · ${s.times}× a usual day${s.top ? html`<small class="muted block">${s.top.note || s.top.payee || category(s.top.categoryId)?.name || ''} ${money(s.top.amount)}</small>` : ''}</span><span class="num b">${money(s.total)}</span>${icon.chev}</a>`)}</div>` : ''}
    </section>

    ${tm.total ? html`<section class="card mt12"><h2>When you spend</h2>
      <div class="split2 mt12 no-border">
        <a href="${dl({ weekend: '0' })}" class="ess"><span class="small muted">Weekday, per day</span><b class="num">${money(tm.weekdayPerDay)}</b></a>
        <a href="${dl({ weekend: '1' })}" class="ess"><span class="small muted">Weekend, per day</span><b class="num">${money(tm.weekendPerDay)}</b></a></div>
      ${tm.weekdayPerDay && tm.weekendPerDay > tm.weekdayPerDay * 1.3 ? html`<div class="hint">Weekends cost ${Math.round((tm.weekendPerDay / tm.weekdayPerDay) * 10) / 10}× a weekday.</div>` : ''}
      ${bars(tm.byDow.map((v, i) => ({ v, label: WD[i], tip: `${WD[i]} · ${money(v)}`, href: dl({ dow: String(i) }) })), { height: 120, label: 'Spending by day of week' })}
      ${tm.late ? html`<a class="lr link" href="${dl({ late: '1' })}"><span class="grow">Late night (10 pm–5 am)<small class="muted block">${tm.lateCount} payment${tm.lateCount === 1 ? '' : 's'}</small></span><span class="num b">${money(tm.late)}</span>${icon.chev}</a>` : ''}
    </section>` : ''}

    ${reps.length ? html`<section class="card mt12"><h2>Regular payments</h2><div class="sub">Paid in ${reps.some((r) => r.monthsSeen === 3) ? '2–3' : '2'} of the last 3 months — subscriptions and habits. Not counting commitments.</div>
      ${reps.slice(0, 8).map((r) => html`<a class="lr link" href="${dl({ payee: r.key, m: '', from: addMonths(mk, -2) })}"><span class="grow">${r.name}<small class="muted block">${r.monthsSeen} months${r.steady ? ' · steady amount' : ''}${r.categoryId ? ` · ${category(r.categoryId)?.name || ''}` : ''}</small></span><span class="num b">~${money(r.monthly)}/mo</span>${icon.chev}</a>`)}
      <div class="hint">Together about ${money(sum(reps, (r) => r.monthly))} a month.</div></section>` : ''}

    ${!accId ? burdenCard(mk) : ''}

    <section class="card mt12"><h2>Last 6 months</h2><div class="sub">Total spending${budget ? ` vs ${moneyShort(budget)} monthly budget` : ''}</div>
      ${bars(trend.map((t) => ({ v: t.spent, label: monthShort(t.mk), tip: `${monthLabel(t.mk)} · ${money(t.spent)}`, color: t.mk === monthKey() ? 'var(--s1-dim)' : undefined, href: nav({ m: t.mk }) })), {
        ref: budget ? { value: budget, text: `budget ${moneyShort(budget)}` } : null, annotate: trend.map((_, i) => i), label: 'Monthly spending, last 6 months',
      })}
      ${!accId && trend.some((t) => t.savingsRate != null) ? html`<h3 class="mt12">Saved or invested, % of income</h3>
        ${raw(String(bars(trend.map((t) => ({ v: Math.max(0, t.savingsRate || 0) * 100, label: monthShort(t.mk), tip: `${monthLabel(t.mk)} · ${t.savingsRate == null ? 'no income' : t.savingsRate + '%'}`, color: 'var(--s3)' })), { height: 130, annotate: trend.map((_, i) => i), label: 'Savings rate by month' })).replace(/>₹(\d+)</g, '>$1%<'))}` : ''}
    </section>

    ${!accId ? splitCard(mk) : ''}

    ${habits.length ? html`<section class="card mt12"><h2>Habits</h2><div class="sub">How often, and how much each time</div>
      ${habits.slice(0, 8).map((h) => html`<a class="lr link" href="${dl({ cat: h.categoryId })}">${dot(category(h.categoryId)?.color)}<span class="grow">${category(h.categoryId)?.name}</span><span class="pc">${h.count}×</span><span class="num b w80">${money(h.avg)} avg</span>${icon.chev}</a>`)}</section>` : ''}

    ${labelled.length ? html`<section class="card mt12"><h2>By label</h2><div class="sub">e.g. petrol vs service vs washing</div>
      ${labelled.map((h) => html`<div class="lbl-block"><a class="row between" href="${dl({ cat: h.categoryId })}"><b class="text">${category(h.categoryId)?.name}</b><b class="num text">${money(h.total)}</b></a>
        <div class="chips mt8">${Object.entries(h.labels).sort((x, y) => y[1] - x[1]).map(([l, v]) => html`<a class="chip" href="${dl({ cat: h.categoryId, label: l })}">${l} · ${money(v)}</a>`)}
        ${h.total - sum(Object.values(h.labels)) > 0 ? html`<span class="chip muted">No label · ${money(h.total - sum(Object.values(h.labels)))}</span>` : ''}</div></div>`)}</section>` : ''}

    ${payees.length ? html`<section class="card mt12"><h2>Top payees</h2><div class="sub">${p.spent && payees.length >= 3 ? `Top 3 take ${pct(top3, p.spent)}% of spending` : 'Where your money goes most'}${np.count ? ` · ${np.count} new this month (${money(np.total)})` : ''}</div>
      ${payees.map((x) => html`<a class="lr link" href="${dl({ payee: x.key })}"><span class="grow">${x.name}</span><span class="pc">${x.count}×</span><span class="num b w80">${money(x.total)}</span>${icon.chev}</a>`)}</section>` : ''}

    ${ul.count ? html`<section class="card mt12"><div class="row between"><h2>Not logged</h2><a class="small" href="${dl({ type: 'adjust' })}">See fixes</a></div>
      <div class="sub">Found through balance fixes — money that moved without an entry</div>
      <div class="split2 mt12 no-border"><div><span class="small muted">Missing money out</span><b class="num">${money(ul.missingOut)}</b></div><div><span class="small muted">Missing money in</span><b class="num">${money(ul.missingIn)}</b></div></div></section>` : ''}

    ${!accId ? accountsCard(mk) : html`${cashflowCard(account(accId), flow, mk)}${balanceCard([accId], mk, 'Balance trend')}`}
  `;
}

function burdenCard(mk) {
  const b = burden(state, mk);
  if (!b.committed || !b.income) return '';
  const parts = [
    { value: b.loans, color: 'var(--s2)', label: 'EMIs' },
    { value: Math.max(0, b.fixed - b.loans), color: 'var(--s3)', label: 'Insurance & other fixed' },
    { value: b.saving, color: 'var(--s7)', label: 'SIPs & savings' },
    { value: b.bills, color: 'var(--s1)', label: 'Bills' },
    { value: Math.max(0, b.flexible), color: '#3a3a36', label: 'Flexible' },
  ];
  return html`<section class="card mt12"><div class="row between"><h2>Fixed vs flexible</h2><a class="small" href="#/commitments">Commitments</a></div>
    <div class="sub">How much of ${money(b.income)} income is committed before you spend anything</div>
    ${stack(parts, { label: 'Income split into committed and flexible' })}
    <div class="mt8">${parts.filter((x) => x.value > 0).map((x) => html`<div class="lr">${dot(x.color)}<span class="grow">${x.label}</span><span class="num b">${money(x.value)}</span><span class="pc">${pct(x.value, b.income)}%</span></div>`)}</div>
    ${b.loanPct != null && b.loans ? html`<div class="hint ${b.loanPct >= 40 ? 'debit' : ''}">EMIs are ${b.loanPct}% of income${b.loanPct >= 40 ? ' — above the ~40% comfort level.' : ' — within the ~40% comfort level.'}</div>` : ''}
    ${b.flexible < 0 ? html`<div class="hint debit">Commitments are ${money(-b.flexible)} more than income.</div>` : ''}</section>`;
}

function splitCard(mk) {
  const sp = salarySplit(state, mk);
  if (!sp.configured || !(sp.rows.length || sp.stays.needed)) return '';
  return html`<section class="card mt12"><div class="row between"><h2>Salary split</h2><a class="small" href="#/split?m=${mk}">Open</a></div>
    <div class="sub">${sp.received ? `${money(sp.received)} received` : 'Salary not recorded yet'} · needed vs moved</div>
    <table class="cat-table"><thead><tr><th>Account</th><th class="r">Needed</th><th class="r">Moved</th></tr></thead><tbody>
    ${sp.rows.map((r) => html`<tr><td>${accName(r.accountId)}</td><td class="r num">${moneyShort(r.needed)}</td><td class="r num ${r.toMove ? 'debit' : 'credit'}">${moneyShort(r.moved)}</td></tr>`)}</tbody></table></section>`;
}

function accountsCard(mk) {
  const rows = activeAccounts().map((a) => ({ a, f: accountFlow(state, a.id, mk) })).filter((r) => r.f.in || r.f.out);
  if (!rows.length) return '';
  return html`<section class="card mt12"><h2>By account</h2><div class="sub">Money in and out this month · tap for that account’s insights</div>
    <table class="cat-table"><thead><tr><th>Account</th><th class="r">In</th><th class="r">Out</th><th class="r">Net</th></tr></thead><tbody>
    ${rows.map(({ a, f }) => html`<tr><td><a class="row gap8" href="#/insights?m=${mk}&a=${a.id}">${dot(purposeColor(a.purpose))}${a.name}</a></td><td class="r num credit">${moneyShort(f.in)}</td><td class="r num">${moneyShort(f.out)}</td><td class="r num ${f.net < 0 ? 'debit' : ''}">${f.net < 0 ? '−' : '+'}${moneyShort(Math.abs(f.net))}</td></tr>`)}</tbody></table></section>`;
}

function cashflowCard(a, f, mk) {
  if (!f || (!f.in && !f.out)) return '';
  const lines = [
    ...Object.entries(f.from).map(([id, v]) => ({ label: `From ${accName(id)}`, v, cls: 'credit', href: `#/insights?m=${mk}&a=${id}` })),
    f.received ? { label: 'Money in', v: f.received, cls: 'credit', href: `#/txns?m=${mk}&account=${a.id}&type=in` } : null,
    f.spent ? { label: 'Spent', v: -f.spent, href: `#/txns?m=${mk}&account=${a.id}&type=out` } : null,
    f.fixed ? { label: 'EMIs, insurance & fixed', v: -f.fixed, href: `#/txns?m=${mk}&account=${a.id}&type=out` } : null,
    f.saving ? { label: 'Invested / saved', v: -f.saving, href: `#/txns?m=${mk}&account=${a.id}&type=out` } : null,
    ...Object.entries(f.to).map(([id, v]) => ({ label: `To ${accName(id)}`, v: -v, href: `#/insights?m=${mk}&a=${id}` })),
    f.adjust ? { label: 'Balance fixes', v: f.adjust, cls: 'muted', href: `#/txns?m=${mk}&account=${a.id}&type=adjust` } : null,
  ].filter(Boolean);
  return html`<section class="card mt12"><h2>Cash flow</h2><div class="sub">Where this account’s money came from and went</div>
    ${lines.map((l) => html`<a class="lr link" href="${l.href}"><span class="grow">${l.label}</span><span class="num b ${l.v > 0 ? l.cls || 'credit' : ''}">${money(l.v, { sign: true })}</span>${icon.chev}</a>`)}
    <div class="lr"><b class="grow">Net</b><b class="num ${f.net < 0 ? 'debit' : 'credit'}">${money(f.net, { sign: true })}</b><span style="width:18px"></span></div></section>`;
}

// ---------- salary / savings / investment account ----------
function flowBody(a, mk, isCur, dl, nav) {
  const f = accountFlow(state, a.id, mk);
  const fs = findings(state, mk, { accountId: a.id });
  const months = Array.from({ length: 6 }, (_, i) => addMonths(mk, i - 5));
  const nets = months.map((m) => ({ m, f: accountFlow(state, a.id, m) }));
  const st = scope(state, a.id);
  const p = pace(st, mk);
  const cats = Object.entries(p.byCategory).map(([id, v]) => ({ id, v, c: category(id) })).sort((x, y) => y.v - x.v);
  const isSalary = a.purpose === 'income';
  const keptPct = isSalary && f.in ? pct(Math.max(0, f.net), f.in) : null;
  const hasAny = f.in || f.out || st.txns.some((t) => t.date.slice(0, 7) === mk);
  if (!hasAny && !nets.some((n) => n.f.in || n.f.out)) return empty('No entries for this account yet', 'Transfers, money in and payments from this account show up here.');

  return html`
    <div class="kpi-grid">
      <a class="card kpi-card" href="${dl({})}"><span class="k">Money in</span><span class="v num credit">${money(f.in)}</span><span class="s">${f.received && f.transfersIn ? `${money(f.received)} income · ${money(f.transfersIn)} transfers` : f.received ? 'income' : f.transfersIn ? 'transferred in' : 'nothing yet'}</span></a>
      <a class="card kpi-card" href="${dl({})}"><span class="k">Money out</span><span class="v num">${money(f.out)}</span><span class="s">${f.transfersOut ? `${money(f.transfersOut)} moved to other accounts` : 'this month'}</span></a>
      <div class="card kpi-card ${f.net < 0 && !isSalary ? 'warn' : ''}"><span class="k">${isSalary ? 'Left in account' : 'Net added'}</span><span class="v num ${f.net < 0 ? 'debit' : 'credit'}">${money(f.net, { sign: !isSalary })}</span><span class="s">${isSalary ? (keptPct != null ? `${keptPct}% of what came in` : 'this month') : f.net >= 0 ? 'growing' : 'shrinking this month'}</span></div>
      <div class="card kpi-card"><span class="k">Balance</span><span class="v num">${bal(balanceNow(a.id))}</span><span class="s">${purposeLabel(a.purpose)}</span></div>
    </div>
    ${worthALook(fs)}
    ${cashflowCard(a, f, mk)}
    <section class="card mt12"><h2>${isSalary ? 'Kept in account, last 6 months' : 'Net added, last 6 months'}</h2><div class="sub">Money in minus money out each month · red means more went out</div>
      ${bars(nets.map(({ m, f: x }) => ({ v: Math.abs(x.net), label: monthShort(m), tip: `${monthLabel(m)} · ${money(x.net, { sign: true })} (in ${money(x.in)}, out ${money(x.out)})`, color: x.net < 0 ? 'var(--debit)' : 'var(--s3)', href: nav({ m }) })), { annotate: nets.map((_, i) => i), label: 'Net added by month' })}
    </section>
    ${cats.length ? html`<section class="card mt12"><h2>Paid directly from here</h2><div class="sub">Spending categories on this account</div>
      ${cats.map((x) => html`<a class="lr link" href="${dl({ cat: x.id })}">${dot(x.c?.color || '#6e6d68')}<span class="grow">${x.c?.name || 'Untagged'}</span><span class="num b">${money(x.v)}</span>${icon.chev}</a>`)}</section>` : ''}
    ${balanceCard([a.id], mk, 'Balance trend')}`;
}

const balanceNow = (id) => balance(state, id);
