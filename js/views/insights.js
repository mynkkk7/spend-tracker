import { html, raw, money, moneyShort, monthKey, monthLabel, monthShort, addMonths, sum, pct } from '../util.js';
import { state, category, kind, account } from '../store.js';
import { pace, compareToPrevious, dailySpend, monthlyTrend, topPayees, categoryHabits, salarySplit, budgetTotal } from '../calc.js';
import { donut, bars, stack } from '../charts.js';
import { icon, dot, tabbar, empty, progress, accName } from '../ui.js';

export function insightsView(_p, query) {
  const cur = monthKey();
  const mk = query.m || cur;
  const p = pace(state, mk);
  const cmp = compareToPrevious(state, mk);
  const isCur = mk === cur;
  const cats = Object.entries(p.byCategory).map(([id, v]) => ({ id, v, c: category(id) })).sort((a, b) => b.v - a.v);
  const kinds = Object.entries(p.byKind).map(([id, v]) => ({ id, v, k: kind(id) })).sort((a, b) => b.v - a.v);
  const daily = dailySpend(state, mk);
  const trend = monthlyTrend(state, mk, 6);
  const payees = topPayees(state, mk);
  const habits = categoryHabits(state, mk).sort((a, b) => b.count - a.count);
  const labelled = habits.filter((h) => Object.keys(h.labels).length);
  const sp = salarySplit(state, mk);
  const budgets = state.categories.filter((c) => !c.archived && c.budget > 0 && kind(c.kindId)?.group === 'spending')
    .map((c) => ({ c, spent: p.byCategory[c.id] || 0 })).sort((a, b) => b.spent / b.c.budget - a.spent / a.c.budget);
  const budget = budgetTotal(state);
  const hasData = p.count > 0;
  const dim = daily.length;

  return {
    tab: 'insights', live: true,
    html: html`
    <header class="page-head"><h1>Insights</h1></header>
    <div class="month-nav">
      <a class="icon-btn" href="#/insights?m=${addMonths(mk, -1)}" aria-label="Previous month">${icon.back}</a>
      <div class="center"><strong>${monthLabel(mk)}</strong><div class="small muted">${isCur ? `1–${p.elapsed} ${monthShort(mk)} · ${p.remainingDays} days left` : mk > cur ? 'Upcoming' : 'Full month'}</div></div>
      ${mk < cur ? html`<a class="icon-btn flip" href="#/insights?m=${addMonths(mk, 1)}" aria-label="Next month">${icon.back}</a>` : html`<span class="icon-btn" style="visibility:hidden" aria-hidden="true"></span>`}
    </div>
    ${!hasData ? empty('No entries this month', 'Insights fill in as you add spending.') : html`
    <div class="kpi-grid">
      <div class="card kpi-card"><span class="k">Spent</span><span class="v num">${money(p.spent)}</span>
        <span class="s">${cmp.spentChange != null ? html`<span class="${cmp.spentChange > 0 ? 'debit' : 'credit'}">${cmp.spentChange > 0 ? '▲' : '▼'} ${Math.abs(cmp.spentChange)}%</span> vs ${monthShort(cmp.prevMonth)}${isCur ? ', same days' : ''}` : 'No earlier month to compare'}</span></div>
      <div class="card kpi-card"><span class="k">Saved or invested</span><span class="v num">${p.savingsRate != null ? `${p.savingsRate}%` : '—'}</span><span class="s">${p.income ? `of ${money(p.income)} income` : 'Add income to see this'}</span></div>
      <div class="card kpi-card"><span class="k">Average per day</span><span class="v num">${money(p.avg)}</span><span class="s">over ${p.elapsed} day${p.elapsed === 1 ? '' : 's'}</span></div>
      ${isCur ? html`<div class="card kpi-card ${budget && p.projected > budget ? 'warn' : ''}"><span class="k">Projected month-end</span><span class="v num">${money(p.projected)}</span>
        <span class="s">${budget ? (p.projected > budget ? `${money(p.projected - budget)} over ${moneyShort(budget)} budget at this pace` : `within ${moneyShort(budget)} budget`) : 'Set budgets to compare'}</span></div>`
        : html`<div class="card kpi-card"><span class="k">Budget</span><span class="v num">${budget ? `${pct(p.spent, budget)}%` : '—'}</span><span class="s">${budget ? `${money(p.spent)} of ${money(budget)}` : 'No budgets set'}</span></div>`}
    </div>

    <section class="card mt12">
      <h2>All money out, by kind</h2>
      <div class="sub">${money(p.moneyOut)} · only ${state.kinds.filter((k) => k.group === 'spending').map((k) => k.name).join(', ')} counts as spending</div>
      ${stack(kinds.map((x) => ({ value: x.v, color: x.k?.color || '#8f8e88', label: x.k?.name || 'Other' })), { label: 'Money out by kind' })}
      <div class="mt8">${kinds.map((x) => html`<div class="lr">${dot(x.k?.color)}<span class="grow">${x.k?.name || 'Other'}</span><span class="num b">${money(x.v)}</span><span class="pc">${pct(x.v, p.moneyOut)}%</span></div>`)}</div>
      ${p.spent ? html`<div class="split2 mt12">
        <div><span class="small muted">Essential spending</span><b class="num">${money(p.essential)}</b></div>
        <div><span class="small muted">Non-essential</span><b class="num">${money(p.nonEssential)}</b></div></div>
        <div class="hint">${p.nonEssential ? `${pct(p.nonEssential, p.spent)}% of spending was optional — that’s where cuts are easiest.` : 'All spending was marked essential.'}</div>` : ''}
    </section>

    ${cats.length ? html`<section class="card mt12">
      <h2>Where it went</h2><div class="sub">Spending by category · change vs ${monthShort(cmp.prevMonth)}</div>
      ${donut(cats.map((x) => ({ value: x.v, color: x.c?.color || '#6e6d68', label: x.c?.name || 'Untagged' })), { center: money(p.spent), sub: isCur ? 'this month' : monthShort(mk), label: 'Spending by category' })}
      <table class="cat-table"><caption class="sr">Spending by category</caption><thead><tr><th>Category</th><th class="r">Spent</th><th class="r">Change</th></tr></thead><tbody>
      ${cats.map((x) => { const ch = cmp.byCategory[x.id]?.change; return html`<tr><td><span class="row gap8">${dot(x.c?.color || '#6e6d68')}${x.c ? html`<a href="#/txns?m=${mk}&cat=${x.id}">${x.c.name}</a>` : html`<a href="#/txns?untagged=1">Untagged</a>`}</span></td><td class="r num b">${money(x.v)}</td>
        <td class="r num ${ch > 0 ? 'debit' : ch < 0 ? 'credit' : 'muted'}">${ch == null ? 'new' : ch === 0 ? '0%' : `${ch > 0 ? '▲' : '▼'} ${Math.abs(ch)}%`}</td></tr>`; })}
      </tbody></table></section>` : ''}

    ${budgets.length ? html`<section class="card mt12"><div class="row between"><h2>Budgets</h2><a href="#/settings/categories" class="small">Edit</a></div>
      ${budgets.slice(0, 6).map(({ c, spent }) => { const over = spent > c.budget; return html`<div class="bg-row"><div class="row between small"><span>${c.name}</span><span><b class="num">${money(spent)}</b> / ${money(c.budget)}${over ? html` · <span class="debit">over by ${money(spent - c.budget)}</span>` : ''}</span></div>${progress(spent, c.budget, { over })}</div>`; })}
      ${budgets.length > 6 ? html`<div class="hint">${budgets.length - 6} more within budget</div>` : ''}</section>` : ''}

    <section class="card mt12"><h2>Daily spend</h2><div class="sub">Tap a bar for the amount. Tall days are worth a look.</div>
      ${bars(daily.map((v, i) => ({ v, label: String(i + 1), tip: `${i + 1} ${monthShort(mk)} · ${money(v)}` })), {
        ref: p.avg ? { value: p.avg, text: `avg ${moneyShort(p.avg)}` } : null,
        showLabels: [0, 4, 9, 14, 19, 24, dim - 1], annotate: [daily.indexOf(Math.max(...daily))], label: `Daily spending in ${monthLabel(mk)}`,
      })}</section>

    <section class="card mt12"><h2>Last 6 months</h2><div class="sub">Total spending${budget ? ` vs ${moneyShort(budget)} monthly budget` : ''}</div>
      ${bars(trend.map((t) => ({ v: t.spent, label: monthShort(t.mk), tip: `${monthLabel(t.mk)} · ${money(t.spent)}`, color: t.mk === cur ? 'var(--s1-dim)' : undefined })), {
        ref: budget ? { value: budget, text: `budget ${moneyShort(budget)}` } : null, annotate: trend.map((_, i) => i), label: 'Monthly spending, last 6 months',
      })}
      ${trend.some((t) => t.savingsRate != null) ? html`<h3 class="mt12">Saved or invested, % of income</h3>
        ${raw(String(bars(trend.map((t) => ({ v: Math.max(0, t.savingsRate || 0) * 100, label: monthShort(t.mk), tip: `${monthLabel(t.mk)} · ${t.savingsRate == null ? 'no income' : t.savingsRate + '%'}`, color: 'var(--s3)' })), { height: 130, annotate: trend.map((_, i) => i), label: 'Savings rate by month' })).replace(/>₹(\d+)</g, '>$1%<'))}` : ''}
    </section>

    ${sp.configured && (sp.rows.length || sp.stays.needed) ? html`<section class="card mt12"><div class="row between"><h2>Salary split</h2><a class="small" href="#/split?m=${mk}">Open</a></div>
      <div class="sub">${sp.received ? `${money(sp.received)} received` : 'Salary not recorded yet'} · needed vs moved</div>
      <table class="cat-table"><thead><tr><th>Account</th><th class="r">Needed</th><th class="r">Moved</th></tr></thead><tbody>
      ${sp.rows.map((r) => html`<tr><td>${accName(r.accountId)}</td><td class="r num">${moneyShort(r.needed)}</td><td class="r num ${r.toMove ? 'debit' : 'credit'}">${moneyShort(r.moved)}</td></tr>`)}</tbody></table></section>` : ''}

    ${habits.length ? html`<section class="card mt12"><h2>Habits</h2><div class="sub">How often, and how much each time</div>
      ${habits.slice(0, 6).map((h) => html`<div class="lr">${dot(category(h.categoryId)?.color)}<span class="grow">${category(h.categoryId)?.name}</span><span class="pc">${h.count}×</span><span class="num b w80">${money(h.avg)} avg</span></div>`)}</section>` : ''}

    ${labelled.length ? html`<section class="card mt12"><h2>By label</h2><div class="sub">e.g. petrol vs service for each vehicle</div>
      ${labelled.map((h) => html`<div class="lbl-block"><div class="row between"><b>${category(h.categoryId)?.name}</b><b class="num">${money(h.total)}</b></div>
        <div class="small muted">${Object.entries(h.labels).sort((a, b) => b[1] - a[1]).map(([l, v]) => `${l} ${money(v)}`).join(' · ')}${h.total - sum(Object.values(h.labels)) > 0 ? ` · No label ${money(h.total - sum(Object.values(h.labels)))}` : ''}</div></div>`)}</section>` : ''}

    ${payees.length ? html`<section class="card mt12"><h2>Top payees</h2><div class="sub">Where your money goes most</div>
      ${payees.map((x) => html`<div class="lr"><span class="grow">${x.name}</span><span class="pc">${x.count}×</span><span class="num b w80">${money(x.total)}</span></div>`)}</section>` : ''}
    `}
    ${tabbar('insights')}`,
  };
}
