import { html, money, monthKey, monthLabel, shortDate, nowLocal, ordinal } from '../util.js';
import { state, activeAccounts, saveTxn, kindByKey, incomeKind, category, account } from '../store.js';
import { totalBalance, balance, pace, compareToPrevious, commitmentStatus, salarySplit, plannedProjection, untaggedTxns, commitmentsDueNow, cardBillsDue, afterCardDues, eventSummary } from '../calc.js';
import { markPaidSheet } from './plan.js';
import { parseQuick } from '../parse.js';
import { icon, bal, privacy, purposeLabel, purposeColor, txnRow, toast, progress, tabbar, empty, bindTxnActions } from '../ui.js';
import { exportBackup } from './settings.js';

export function homeView() {
  const mk = monthKey();
  const p = pace(state, mk);
  const cmp = compareToPrevious(state, mk);
  const accts = activeAccounts();
  const cs = commitmentStatus(state, mk);
  const split = salarySplit(state, mk);
  const plan = plannedProjection(state, mk);
  const untagged = untaggedTxns(state).length;
  const recent = state.txns.slice(0, 6);
  const hidden = state.settings.hideBalances;
  const backupDue = state.txns.length >= 5 && (!state.settings.lastBackupAt || Date.now() - Date.parse(state.settings.lastBackupAt) > 7 * 864e5);
  const hasPlan = cs.count || split.configured || state.planned.length;
  const nextPlanned = plan.rows[0];
  const dueNow = commitmentsDueNow(state);
  const bills = cardBillsDue(state);
  const today = nowLocal().slice(0, 10);
  const events = state.events.filter((e) => !e.archived && e.start && (e.end || e.start).slice(0, 10) >= addDaysStr(today, -14)).slice(0, 2).reverse();

  return {
    tab: 'home', live: true,
    html: html`
    <header class="page-head">
      <div><div class="muted small">${monthLabel(mk)}</div><h1>Spends</h1></div>
      ${hidden ? html`<button type="button" class="icon-btn" data-act="toggle-reveal" aria-label="${privacy.revealed ? 'Hide balances' : 'Show balances'}">${privacy.revealed ? icon.eye : icon.eyeOff}</button>` : ''}
    </header>

    <section class="card hero">
      <div class="row between"><span class="label">Total balance · ${accts.length} account${accts.length === 1 ? '' : 's'}</span></div>
      <div class="big num ${bal(0).includes('•') ? 'masked' : ''}">${bal(totalBalance(state))}</div>
      <div class="kpis">
        <div class="kpi"><div class="k">Spent in ${monthLabel(mk, false).split(' ')[0]}</div><div class="v num">${money(p.spent)}</div>
          ${cmp.spentChange != null ? html`<div class="s ${cmp.spentChange > 0 ? 'debit' : 'credit'}">${cmp.spentChange > 0 ? '▲' : '▼'} ${Math.abs(cmp.spentChange)}% vs last month</div>` : html`<div class="s muted">so far this month</div>`}
        </div>
        <div class="kpi">${p.budget ? html`<div class="k">Safe to spend</div><div class="v num">${money(p.safePerDay)}<span class="unit"> /day</span></div><div class="s muted">for ${p.remainingDays + 1} day${p.remainingDays ? 's' : ''} left</div>`
          : html`<div class="k">Monthly budget</div><div class="v">Not set</div><a class="s" href="#/settings/categories">Set budgets ›</a>`}</div>
      </div>
      ${p.budget ? html`<div class="row between small muted mt12"><span>${money(p.spent)} of ${money(p.budget)} budget</span><span>${Math.round((p.spent / p.budget) * 100)}%</span></div>${progress(p.spent, p.budget, { over: p.spent > p.budget })}` : ''}
    </section>

    ${hasPlan ? html`<section class="card plan">
      <div class="plan-head"><h2>${monthLabel(mk, false).split(' ')[0]} plan</h2>${split.configured && split.received ? html`<span class="muted small">Salary ${money(split.received)}</span>` : ''}</div>
      ${cs.count ? html`<a class="plan-row" href="#/commitments">
        <span class="grow"><b>Commitments · ${cs.paidCount} of ${cs.count} paid</b><small>${cs.next ? `Next: ${cs.next.c.name} ${money(cs.next.c.amount)} on ${ordinal(cs.next.c.dueDay)}` : 'All paid for this month'}</small></span>
        <span class="mini-bar"><i style="width:${cs.count ? Math.round((cs.paidCount / cs.count) * 100) : 0}%"></i></span>${icon.chev}</a>` : ''}
      ${split.configured ? html`<a class="plan-row" href="#/split">
        <span class="grow"><b>${split.received ? (split.totalToMove ? `Salary split · ${money(split.totalToMove)} to move` : 'Salary split · all moved') : 'Salary split · waiting for salary'}</b>
        <small class="${split.totalToMove ? 'warn-text' : ''}">${split.received ? (split.totalToMove ? `To ${split.rows.filter((r) => r.toMove).length} account${split.rows.filter((r) => r.toMove).length > 1 ? 's' : ''}` : 'Every account has what it needs') : `Add your salary as money in to ${account(split.salaryAccountId)?.name}`}</small></span>${icon.chev}</a>` : ''}
      ${state.planned.length ? html`<a class="plan-row" href="#/planned">
        <span class="grow"><b>${nextPlanned ? `Planned · next: ${nextPlanned.items[0].name} (${monthLabel(nextPlanned.mk, false).split(' ')[0]})` : 'Planned · nothing upcoming'}</b>
        <small class="${plan.firstShort ? 'debit' : ''}">${plan.firstShort ? `${monthLabel(plan.firstShort.mk, false).split(' ')[0]} is short by ${money(plan.firstShort.short)}` : (nextPlanned ? 'Covered by your set-aside' : '')}</small></span>${icon.chev}</a>` : ''}
    </section>` : html`<a class="card setup-nudge" href="#/commitments"><b>Set up your monthly plan</b><small>Add EMIs, SIPs and bills once — see what’s paid, and how to split your salary.</small></a>`}

    ${dueNow.length || bills.length ? html`<section class="card plan mt12">
      <div class="plan-head"><h2>Due now</h2><span class="muted small">tap to record</span></div>
      ${bills.map((b) => html`<div class="plan-row due-row"><span class="grow"><b>${b.card.name} bill · ${money(b.dueLeft ?? b.owed)}</b>
        <small class="${b.daysToDue < 0 ? 'debit' : b.daysToDue <= 3 ? 'warn-text' : ''}">${b.daysToDue < 0 ? `Overdue by ${-b.daysToDue} day${b.daysToDue === -1 ? '' : 's'}` : b.daysToDue === 0 ? 'Due today' : `Due in ${b.daysToDue} day${b.daysToDue === 1 ? '' : 's'} · ${shortDate(b.dueDate)}`}${b.payFromId ? ` · from ${account(b.payFromId)?.name}` : ''}</small></span>
        <a class="btn btn-sm btn-primary" href="#/add?type=transfer${b.payFromId ? `&account=${b.payFromId}` : ''}&to=${b.card.id}&amt=${(b.dueLeft ?? b.owed) / 100}&note=Card%20bill">Pay</a></div>`)}
      ${dueNow.map((i) => html`<div class="plan-row due-row"><span class="grow"><b>${i.c.name} · ${i.c.variable ? '~' : ''}${money(i.amount)}</b>
        <small class="${i.c.dueDay < Number(today.slice(8, 10)) ? 'debit' : ''}">${i.c.dueDay < Number(today.slice(8, 10)) ? 'Overdue · ' : i.c.dueDay === Number(today.slice(8, 10)) ? 'Today · ' : ''}${ordinal(i.c.dueDay)} · ${account(i.c.accountId)?.name || ''}${i.c.variable ? ' · confirm amount' : ''}</small></span>
        <button type="button" class="btn btn-sm" data-paid="${i.c.id}">Mark paid</button></div>`)}
    </section>` : ''}

    ${events.map((e) => { const s = eventSummary(state, e); return html`<a class="card plan-row mt12" href="#/event/${e.id}" style="display:flex">
      <span class="grow"><b>${e.name} · ${money(s.spent)}${s.budget ? ` of ${money(s.budget)}` : ''}</b>
      <small class="${s.budget && s.spent > s.budget ? 'debit' : 'muted'}">${s.status === 'upcoming' ? `In ${s.daysToGo} day${s.daysToGo === 1 ? '' : 's'}` : s.status === 'on' ? 'On now — entries are added to it automatically' : 'Finished'}${s.budget ? ` · ${s.left >= 0 ? `${money(s.left)} left` : `${money(-s.left)} over`}` : ''}</small>
      ${s.budget ? progress(s.spent, s.budget, { over: s.spent > s.budget }) : ''}</span>${icon.chev}</a>`; })}

    <form class="quick" data-form="quick" autocomplete="off">
      <label class="grow"><span class="sr">Quick add</span><input name="q" placeholder="Quick add: 40 tea" enterkeyhint="done" inputmode="text"></label>
      <button class="btn btn-primary" type="submit">Add</button>
    </form>
    <div class="hint">“+5000 salary” for money in · “450 petrol” picks the category for you</div>

    ${untagged ? html`<a class="banner warn" href="#/tag"><span class="grow">${untagged} entr${untagged === 1 ? 'y needs' : 'ies need'} a category</span><b>Tag now ›</b></a>` : ''}
    ${backupDue ? html`<div class="banner"><span class="grow">Last backup: ${state.settings.lastBackupAt ? `${Math.floor((Date.now() - Date.parse(state.settings.lastBackupAt)) / 864e5)} days ago` : 'never'}. Your data only lives on this phone.</span><button type="button" class="btn btn-sm btn-primary" data-act="backup">Back up now</button></div>` : ''}

    <div class="sec-head"><h2>Accounts</h2><a href="#/settings/accounts">Manage</a></div>
    <div class="acc-scroll">
      ${accts.map((a) => html`<a class="acc-card" href="#/account/${a.id}">
        <span class="role">${raw0(purposeColor(a.purpose))}${purposeLabel(a.purpose).toUpperCase()}</span>
        <span class="name">${a.name}</span>
        <span class="bal num ${balance(state, a.id) < 0 ? 'debit' : ''}">${bal(balance(state, a.id))}</span>
        ${(() => { const d = afterCardDues(state, a.id); return d && d.owed ? html`<span class="sub">after cards ${bal(d.after)}</span>` : ''; })()}</a>`)}
      <a class="acc-card add" href="#/settings/accounts/new">+ Add account</a>
    </div>

    <div class="sec-head"><h2>Recent</h2><a href="#/txns">See all</a></div>
    ${recent.length ? html`<div class="list">${recent.map((t) => txnRow(t))}</div>` : empty('No entries yet', 'Use quick add above or the + button.')}
    ${tabbar('home')}`,
    mount(el, { refresh }) {
      el.querySelector('[data-act="toggle-reveal"]')?.addEventListener('click', () => { privacy.revealed = !privacy.revealed; refresh(); });
      el.querySelector('[data-act="backup"]')?.addEventListener('click', exportBackup);
      bindTxnActions(el);
      el.querySelectorAll('[data-paid]').forEach((b) => b.addEventListener('click', () => markPaidSheet(state.commitments.find((c) => c.id === b.dataset.paid), mk)));
      el.querySelector('[data-form="quick"]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = e.target.q;
        const r = parseQuick(state, input.value);
        if (!r) { toast('Start with an amount, e.g. “40 tea”'); return; }
        const accountId = state.settings.defaultAccountId && account(state.settings.defaultAccountId) ? state.settings.defaultAccountId : activeAccounts()[0]?.id;
        if (!accountId) { toast('Add an account first'); return; }
        const c = r.categoryId ? category(r.categoryId) : null;
        const t = await saveTxn({
          type: r.direction, amount: r.amount, accountId,
          kindId: r.kindId || (r.direction === 'in' ? incomeKind()?.id : kindByKey('expense')?.id || state.kinds.find((k) => k.group === 'spending')?.id),
          categoryId: r.categoryId || null, label: r.label || null, note: r.note, payee: '',
          essential: c ? !!c.essential : false, date: nowLocal(), source: 'quick',
        });
        input.value = '';
        toast(`${r.direction === 'in' ? 'Added' : 'Logged'} ${money(t.amount)}${c ? ` · ${c.name}` : ' · needs a category'}`, { action: 'Edit', onAction: () => { location.hash = `#/txn/${t.id}`; } });
      });
    },
  };
}

const addDaysStr = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const raw0 = (color) => html`<i style="background:${color}"></i>`;
export { shortDate };
