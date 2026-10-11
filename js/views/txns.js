import { html, money, monthKey, monthLabel, addMonths, dayOf, dayLabel, timeLabel, groupBy, sum, normalize } from '../util.js';
import { state, category, account } from '../store.js';
import { groupOfTxn, isUntagged } from '../calc.js';
import { txnRow, tabbar, empty, icon } from '../ui.js';

/** Filter used by the All screen and account pages. */
export function filterTxns({ m, account: acc, cat, untagged, q, kind: kindId } = {}) {
  const query = normalize(q);
  return state.txns.filter((t) => {
    if (m && m !== 'all' && t.date.slice(0, 7) !== m) return false;
    if (acc && t.accountId !== acc && t.toAccountId !== acc) return false;
    if (cat && t.categoryId !== cat) return false;
    if (kindId && t.kindId !== kindId) return false;
    if (untagged && !isUntagged(state, t)) return false;
    if (query) {
      const hay = normalize([t.note, t.payee, t.vpa, t.upiRef, category(t.categoryId)?.name, t.label, account(t.accountId)?.name, String(t.amount / 100)].join(' '));
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

export function dayGroups(list, { showAccount = true } = {}) {
  const groups = groupBy(list, (t) => dayOf(t.date));
  return Object.keys(groups).sort().reverse().map((d) => {
    const items = groups[d];
    const net = sum(items, (t) => (t.type === 'in' ? t.amount : t.type === 'out' ? -t.amount : 0));
    return html`<div class="tx-day"><span>${dayLabel(d)}</span><span class="num">${net ? money(net, { sign: true }) : ''}</span></div>
      <div class="list">${items.map((t) => txnRow(t, { showAccount, time: timeLabel(t.date) }))}</div>`;
  });
}

export function txnsView(_p, query) {
  const m = query.m || monthKey();
  const untagged = query.untagged === '1';
  const f = { m: untagged ? 'all' : m, account: query.account, cat: query.cat, untagged, q: query.q };
  const list = filterTxns(f);
  const spent = sum(list.filter((t) => groupOfTxn(state, t) === 'spending'), (t) => t.amount);
  const income = sum(list.filter((t) => t.type === 'in'), (t) => t.amount);
  const months = Array.from({ length: 13 }, (_, i) => addMonths(monthKey(), -i));
  const url = (patch) => '#/txns?' + new URLSearchParams(Object.entries({ m, account: query.account, cat: query.cat, untagged: untagged ? '1' : '', q: query.q, ...patch }).filter(([, v]) => v)).toString();
  const untaggedCount = state.txns.filter((t) => isUntagged(state, t)).length;

  return {
    tab: 'txns', live: true,
    html: html`
    <header class="page-head"><h1>Transactions</h1></header>
    <form class="search" data-form="search" role="search"><label class="search-box">${icon.search}<span class="sr">Search</span>
      <input type="search" name="q" value="${query.q || ''}" placeholder="Search payee, note, amount" enterkeyhint="search"></label></form>
    <div class="filters">
      <label class="fil"><span class="sr">Month</span><select data-filter="m" ${untagged ? 'disabled' : ''}>
        <option value="all" ${m === 'all' ? 'selected' : ''}>All time</option>
        ${months.map((mk) => html`<option value="${mk}" ${mk === m ? 'selected' : ''}>${monthLabel(mk)}</option>`)}</select></label>
      <label class="fil"><span class="sr">Account</span><select data-filter="account"><option value="">All accounts</option>
        ${state.accounts.map((a) => html`<option value="${a.id}" ${a.id === query.account ? 'selected' : ''}>${a.name}</option>`)}</select></label>
      <label class="fil"><span class="sr">Category</span><select data-filter="cat"><option value="">All categories</option>
        ${state.categories.filter((c) => !c.archived).map((c) => html`<option value="${c.id}" ${c.id === query.cat ? 'selected' : ''}>${c.name}</option>`)}</select></label>
      <a class="fil chip-link ${untagged ? 'on' : ''}" href="${url({ untagged: untagged ? '' : '1' })}">Untagged · ${untaggedCount}</a>
    </div>
    <div class="row between small muted mt12"><span>${list.length} entr${list.length === 1 ? 'y' : 'ies'}</span><span>Spent <b class="text">${money(spent)}</b> · In <b class="credit">${money(income)}</b></span></div>
    ${list.length ? dayGroups(list) : empty(untagged ? 'Nothing to tag' : 'No entries', untagged ? 'Every expense has a category.' : 'Try another month or filter.')}
    ${tabbar('txns')}`,
    mount(el) {
      el.querySelectorAll('[data-filter]').forEach((s) => s.addEventListener('change', () => { location.hash = url({ [s.dataset.filter]: s.value }); }));
      el.querySelector('[data-form="search"]').addEventListener('submit', (e) => { e.preventDefault(); location.hash = url({ q: e.target.q.value.trim() }); });
    },
  };
}
