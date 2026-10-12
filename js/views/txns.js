import { html, money, monthKey, monthLabel, addMonths, dayOf, dayLabel, timeLabel, groupBy, sum, normalize, shortDate, parseLocal } from '../util.js';
import { state, category, account, kind } from '../store.js';
import { groupOfTxn, isUntagged, SMALL_SPEND, payeeKey } from '../calc.js';
import { txnRow, tabbar, empty, icon, bindTxnActions } from '../ui.js';

const WD = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** Filter used by the All screen, account pages and every Insights drill-down. */
export function filterTxns(f = {}) {
  const query = normalize(f.q);
  const spendingOnly = f.essential != null || f.small || f.payee || f.dow != null || f.late || f.weekend != null;
  return state.txns.filter((t) => {
    if (f.m && f.m !== 'all' && t.date.slice(0, 7) !== f.m) return false;
    if (f.from && t.date.slice(0, 7) < f.from) return false;
    if (f.day && t.date.slice(0, 10) !== f.day) return false;
    if (f.account && t.accountId !== f.account && t.toAccountId !== f.account) return false;
    if (f.cat && t.categoryId !== f.cat) return false;
    if (f.label && t.label !== f.label) return false;
    if (f.kind && t.kindId !== f.kind) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.untagged && !isUntagged(state, t)) return false;
    if (spendingOnly && groupOfTxn(state, t) !== 'spending') return false;
    if (f.essential === '1' && !t.essential) return false;
    if (f.essential === '0' && t.essential) return false;
    if (f.small && t.amount > SMALL_SPEND) return false;
    if (f.payee && payeeKey(t) !== f.payee) return false;
    if (f.dow != null && parseLocal(t.date).getDay() !== Number(f.dow)) return false;
    if (f.weekend != null) { const d = parseLocal(t.date).getDay(); const we = d === 0 || d === 6; if ((f.weekend === '1') !== we) return false; }
    if (f.late) { const h = Number(t.date.slice(11, 13)); if (!(h >= 22 || h < 5)) return false; }
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

// Drill-down keys that come from Insights and are shown as removable chips.
const DRILL = ['essential', 'small', 'payee', 'day', 'dow', 'late', 'weekend', 'kind', 'label', 'type', 'from'];
function drillLabel(k, v, list) {
  switch (k) {
    case 'essential': return v === '1' ? 'Essential spending' : 'Non-essential spending';
    case 'small': return `Small spends (≤ ${money(SMALL_SPEND)})`;
    case 'payee': return `Paid to ${list[0]?.payee || list[0]?.vpa || 'this payee'}`;
    case 'day': return shortDate(`${v}T00:00`);
    case 'dow': return `On ${WD[Number(v)]}`;
    case 'late': return 'Late night (10 pm–5 am)';
    case 'weekend': return v === '1' ? 'Weekends' : 'Weekdays';
    case 'kind': return kind(v)?.name || 'Kind';
    case 'label': return `Label: ${v}`;
    case 'type': return { adjust: 'Balance corrections', transfer: 'Transfers', in: 'Money in', out: 'Money out' }[v] || v;
    case 'from': return `Since ${monthLabel(v)}`;
    default: return v;
  }
}

export function txnsView(_p, query) {
  const untagged = query.untagged === '1';
  const m = query.m || (query.day ? query.day.slice(0, 7) : query.from ? 'all' : monthKey());
  const f = { ...query, m: untagged ? 'all' : m, untagged };
  const list = filterTxns(f);
  const spent = sum(list.filter((t) => groupOfTxn(state, t) === 'spending'), (t) => t.amount);
  const income = sum(list.filter((t) => t.type === 'in'), (t) => t.amount);
  const months = Array.from({ length: 13 }, (_, i) => addMonths(monthKey(), -i));
  const base = { ...query, m, untagged: untagged ? '1' : '' };
  const url = (patch) => '#/txns?' + new URLSearchParams(Object.entries({ ...base, ...patch }).filter(([, v]) => v != null && v !== '')).toString();
  const untaggedCount = state.txns.filter((t) => isUntagged(state, t)).length;
  const drills = DRILL.filter((k) => query[k] != null && query[k] !== '');

  return {
    tab: 'txns', live: true,
    html: html`
    <header class="page-head"><h1>Transactions</h1>${untaggedCount ? html`<a class="btn btn-sm" href="#/tag">Tag ${untaggedCount}</a>` : ''}</header>
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
    ${drills.length ? html`<div class="drills">${drills.map((k) => html`<a class="drill" href="${url({ [k]: '' })}" aria-label="Remove filter ${drillLabel(k, query[k], list)}">${drillLabel(k, query[k], list)} ${icon.close}</a>`)}</div>` : ''}
    <div class="row between small muted mt12"><span>${list.length} entr${list.length === 1 ? 'y' : 'ies'}</span><span>Spent <b class="text">${money(spent)}</b> · In <b class="credit">${money(income)}</b></span></div>
    ${list.length ? dayGroups(list) : empty(untagged ? 'Nothing to tag' : 'No entries', untagged ? 'Every expense has a category.' : 'Try another month or filter.')}
    <div class="hint center mt12">Tip: press and hold an entry for quick actions.</div>
    ${tabbar('txns')}`,
    mount(el) {
      el.querySelectorAll('[data-filter]').forEach((s) => s.addEventListener('change', () => { location.hash = url({ [s.dataset.filter]: s.value }); }));
      el.querySelector('[data-form="search"]').addEventListener('submit', (e) => { e.preventDefault(); location.hash = url({ q: e.target.q.value.trim() }); });
      bindTxnActions(el);
    },
  };
}
