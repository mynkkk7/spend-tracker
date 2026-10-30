// One category in depth: 12-month trend against its budget, labels, payees and this month's entries.
import { html, money, monthKey, monthLabel, monthShort, addMonths } from '../util.js';
import { state, category, kind } from '../store.js';
import { categoryDetail } from '../calc.js';
import { topbar, empty, txnRow, bindTxnActions, tabbar, progress, icon } from '../ui.js';
import { bars } from '../charts.js';

export function categoryView({ id }, query) {
  const c = category(id);
  if (!c) return { html: html`${topbar({ back: '#/insights' })}${empty('Category not found')}` };
  const mk = query.m || monthKey();
  const d = categoryDetail(state, id, mk, 12);
  const k = kind(c.kindId);
  const diff = d.avg ? Math.round(((d.current - d.avg) / d.avg) * 100) : null;
  const firstWithData = d.months.findIndex((m) => m.v > 0);
  const months = firstWithData > 0 ? d.months.slice(Math.min(firstWithData, d.months.length - 3)) : d.months;
  return {
    live: true,
    html: html`${topbar({ back: '#/insights', backLabel: 'Insights', right: html`<a class="link-btn" href="#/settings/categories/${c.id}">Edit</a>` })}
    <div class="month-nav">
      <a class="icon-btn" href="#/category/${id}?m=${addMonths(mk, -1)}" aria-label="Previous month">${icon.back}</a>
      <strong>${monthLabel(mk)}</strong>
      <a class="icon-btn flip" href="#/category/${id}?m=${addMonths(mk, 1)}" aria-label="Next month">${icon.back}</a></div>
    <h1 class="page-title"><span class="dot" style="background:${c.color}"></span> ${c.name}</h1>
    <p class="muted small">${k?.name || ''}${c.essential ? ' · essential' : ''}${c.labels?.length ? ` · labels: ${c.labels.join(', ')}` : ''}</p>
    <div class="grid2 mt12">
      <div class="card kpi-card"><div class="k">${monthShort(mk)}</div><div class="v num">${money(d.current)}</div>
        ${diff != null ? html`<div class="s ${diff > 15 ? 'debit' : diff < -15 ? 'credit' : ''}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}% vs your usual</div>` : html`<div class="s">this month</div>`}</div>
      <div class="card kpi-card"><div class="k">Usual month</div><div class="v num">${money(d.avg)}</div><div class="s">${money(d.total12)} in 12 months</div></div>
    </div>
    ${c.budget ? html`<div class="card mt12"><div class="row between small"><span>${money(d.current)} of ${money(c.budget)} budget</span><span>${Math.round((d.current / c.budget) * 100)}%</span></div>${progress(d.current, c.budget, { over: d.current > c.budget, color: c.color })}</div>` : ''}
    <div class="sec-head"><h2>Month by month</h2></div>
    <div class="card">${bars(months.map((m) => ({ v: m.v, label: monthShort(m.mk), tip: `${monthLabel(m.mk)} · ${money(m.v)} · ${m.count} entries`, color: m.mk === mk ? c.color : 'var(--s1)', href: `#/category/${id}?m=${m.mk}` })), { ref: c.budget ? { value: c.budget, text: 'budget' } : null, showLabels: months.map((_, i) => i).filter((i) => months.length <= 8 || i % 2 === (months.length - 1) % 2) })}</div>
    ${d.labels.length > 1 || (d.labels[0] && d.labels[0][0] !== '—') ? html`<div class="sec-head"><h2>Labels</h2></div>
      <div class="list">${d.labels.map(([l, v]) => html`<a class="list-row" href="#/txns?m=${mk}&cat=${id}${l !== '—' ? `&label=${encodeURIComponent(l)}` : ''}"><span class="grow">${l === '—' ? 'No label' : l}</span><span class="num">${money(v)}</span>${icon.chev}</a>`)}</div>` : ''}
    ${d.payees.length ? html`<div class="sec-head"><h2>Where</h2></div>
      <div class="list">${d.payees.map((p) => html`<div class="list-row"><span class="grow"><span class="r1">${p.name}</span><span class="r2">${p.count}×</span></span><span class="num">${money(p.total)}</span></div>`)}</div>` : ''}
    <div class="sec-head"><h2>Entries</h2><a href="#/txns?m=${mk}&cat=${id}">See all</a></div>
    ${d.entries.length ? html`<div class="list">${d.entries.slice(0, 30).map((t) => txnRow(t))}</div>` : empty('Nothing this month')}
    ${tabbar('insights')}`,
    mount(el) { bindTxnActions(el); },
  };
}
