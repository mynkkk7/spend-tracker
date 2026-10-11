// Commitments, planned expenses and the salary split.
import { html, money, monthKey, monthLabel, addMonths, parseAmount, toRupees, nowLocal, ordinal, sum, daysInMonth } from '../util.js';
import { state, account, kind, category, saveCommitment, deleteCommitment, savePlanned, deletePlanned, saveTxn, deleteTxn, saveSettings, outKinds, categoriesOf } from '../store.js';
import { commitmentStatus, salarySplit, plannedProjection } from '../calc.js';
import { topbar, icon, dot, sheet, toast, confirmSheet, accountOptions, formData, tabbar, empty, progress, accName } from '../ui.js';
import { stack } from '../charts.js';

const monthNav = (base, mk) => html`<div class="month-nav">
  <a class="icon-btn" href="${base}?m=${addMonths(mk, -1)}" aria-label="Previous month">${icon.back}</a>
  <strong>${monthLabel(mk)}</strong>
  <a class="icon-btn flip" href="${base}?m=${addMonths(mk, 1)}" aria-label="Next month">${icon.back}</a></div>`;

function dueDate(mk, day) { return `${mk}-${String(Math.min(day, daysInMonth(mk))).padStart(2, '0')}`; }

// ---------- commitments ----------
export function commitmentsView(_p, query) {
  const mk = query.m || monthKey();
  const cs = commitmentStatus(state, mk);
  const filter = query.f || 'all';
  const byKind = {};
  for (const it of cs.items) (byKind[it.c.kindId] ||= []).push(it);
  const today = nowLocal().slice(0, 10);

  return {
    live: true,
    html: html`
    ${topbar({ back: '#/', backLabel: 'Home', right: html`<a class="btn btn-sm" href="#/commitments/new">+ Add</a>` })}
    <h1 class="page-title">Commitments</h1>
    <p class="muted">Fixed every month — EMIs, SIPs, insurance, bills.</p>
    ${monthNav('#/commitments', mk)}
    ${cs.count ? html`
    <div class="card">
      <div class="row between"><b>${cs.paidCount} of ${cs.count} paid</b><span class="muted small">${money(cs.total)} total</span></div>
      ${progress(cs.paidTotal, cs.total, { color: 'var(--credit)' })}
      <div class="row between small mt8"><span class="credit">Paid ${money(cs.paidTotal)}</span><span class="muted">${cs.next ? `Still due ${money(cs.dueTotal)} · next ${ordinal(cs.next.c.dueDay)}` : 'All done'}</span></div>
    </div>
    <div class="pills mt12">${[['all', 'All'], ['due', `Due · ${cs.count - cs.paidCount}`], ['paid', `Paid · ${cs.paidCount}`]].map(([v, l]) => html`<a class="pill ${filter === v ? 'on' : ''}" href="#/commitments?m=${mk}&f=${v}">${l}</a>`)}</div>
    ${Object.entries(byKind).map(([kid, items]) => {
      const shown = items.filter((i) => filter === 'all' || (filter === 'paid' ? i.paid : !i.paid));
      if (!shown.length) return '';
      return html`<div class="grp"><span>${(kind(kid)?.name || 'Other').toUpperCase()}</span><span class="num">${money(sum(items, (i) => i.amount))}</span></div>
      <div class="list">${shown.map(({ c, paid, paidTxn, amount }) => {
        const overdue = !paid && dueDate(mk, c.dueDay) < today;
        return html`<div class="cm-row ${paid ? 'paid' : ''}">
          <button type="button" class="ck ${paid ? 'done' : ''}" data-toggle="${c.id}" aria-label="${paid ? `Mark ${c.name} unpaid` : `Mark ${c.name} paid`}" aria-pressed="${paid}">${paid ? icon.check : ''}</button>
          <a class="grow cm-main" href="#/commitments/${c.id}"><span class="r1">${c.name}</span>
            <span class="r2 ${overdue ? 'debit' : ''}">${ordinal(c.dueDay)}${overdue ? ' · overdue' : ''} · ${accName(c.accountId)}${c.variable ? ' · amount varies' : ''}${c.essential ? ' · essential' : ''}</span></a>
          <span class="cm-amt num">${c.variable && !paid ? '~' : ''}${money(amount)}</span>
        </div>`;
      })}</div>`;
    })}` : empty('No commitments yet', 'Add the things you pay every month: loan EMIs, SIPs, insurance premiums, rent, bills. Each month you tick them off.', html`<a class="btn btn-primary mt12" href="#/commitments/new">+ Add commitment</a>`)}
    ${tabbar('home')}`,
    mount(el) {
      el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
        const it = cs.items.find((i) => i.c.id === b.dataset.toggle);
        if (it.paid) {
          if (await confirmSheet({ title: `Mark ${it.c.name} as not paid?`, body: 'This removes the payment entry that was recorded for it.', ok: 'Mark unpaid' })) { await deleteTxn(it.paidTxn.id); toast('Marked unpaid'); }
          return;
        }
        markPaidSheet(it.c, mk);
      }));
    },
  };
}

function markPaidSheet(c, mk) {
  const date = mk === monthKey() ? nowLocal() : `${dueDate(mk, c.dueDay)}T10:00`;
  sheet(String(html`<h2 class="sheet-title">Mark ${c.name} paid</h2>
    <form data-pay>
      <div class="grid2"><label class="field"><span>Amount</span><input name="amount" inputmode="decimal" value="${toRupees(c.amount)}"></label>
      <label class="field"><span>Paid from</span><select name="accountId">${accountOptions(c.accountId)}</select></label></div>
      <label class="field"><span>Date</span><input type="datetime-local" name="date" value="${date}"></label>
      <div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">Mark paid</button></div>
    </form>`), {
    onMount(panel, close) {
      panel.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(e.target);
        const amount = parseAmount(d.amount);
        if (!amount) { toast('Enter the amount'); return; }
        await saveTxn({
          type: 'out', amount, accountId: d.accountId, kindId: c.kindId, categoryId: c.categoryId || null, label: c.label || null,
          note: c.name, payee: '', essential: !!c.essential, date: d.date || nowLocal(), source: 'commitment', commitmentId: c.id, commitmentMonth: mk,
        });
        close(); toast(`${c.name} marked paid`);
      });
    },
  });
}

export function commitmentFormView({ id }) {
  const c = id && id !== 'new' ? state.commitments.find((x) => x.id === id) : null;
  const kinds = outKinds();
  const f = c ? { ...c } : { name: '', amount: 0, kindId: (kinds.find((k) => k.key === 'loan') || kinds[0])?.id, categoryId: '', accountId: state.settings.salaryAccountId || state.accounts[0]?.id, dueDay: 5, essential: true, variable: false, endMonth: '' };
  const renderCats = (kid) => html`<option value="">None</option>${categoriesOf(kid).map((x) => html`<option value="${x.id}" ${x.id === f.categoryId ? 'selected' : ''}>${x.name}</option>`)}`;
  return {
    html: html`<form data-form="cm" novalidate autocomplete="off">
    ${topbar({ back: '#/commitments', backLabel: 'Cancel', title: c ? 'Edit commitment' : 'New commitment', right: html`<button class="link-btn" type="submit">Save</button>` })}
    <label class="field"><span>Name</span><input name="name" value="${f.name}" placeholder="e.g. Home loan EMI" required maxlength="50"></label>
    <div class="grid2">
      <label class="field"><span>Amount each month</span><input name="amount" inputmode="decimal" value="${f.amount ? toRupees(f.amount) : ''}" placeholder="₹0"></label>
      <label class="field"><span>Due on day</span><input name="dueDay" type="number" min="1" max="31" value="${f.dueDay}"></label>
    </div>
    <label class="field"><span>Kind</span><select name="kindId" data-kind>${kinds.map((k) => html`<option value="${k.id}" ${k.id === f.kindId ? 'selected' : ''}>${k.name}</option>`)}</select></label>
    <label class="field"><span>Category (optional)</span><select name="categoryId" data-cats>${renderCats(f.kindId)}</select></label>
    <label class="field"><span>Paid from account</span><select name="accountId">${accountOptions(f.accountId)}</select></label>
    <label class="field"><span>Last month (optional)</span><input type="month" name="endMonth" value="${f.endMonth || ''}"></label>
    <div class="hint">For EMIs that end. Leave empty if it never ends.</div>
    <div class="list mt12">
      <label class="toggle-row"><span>Essential</span><input type="checkbox" name="essential" ${f.essential ? 'checked' : ''}></label>
      <label class="toggle-row"><span>Amount varies<small>e.g. electricity — you confirm the amount when paying</small></span><input type="checkbox" name="variable" ${f.variable ? 'checked' : ''}></label>
    </div>
    <button class="btn btn-primary btn-block mt16" type="submit">Save commitment</button>
    ${c ? html`<button type="button" class="btn btn-danger btn-block mt8" data-act="delete">${icon.trash} Delete commitment</button><div class="hint center">Past payments stay in your history.</div>` : ''}
    </form>`,
    mount(el) {
      const form = el.querySelector('form');
      form.querySelector('[data-kind]').addEventListener('change', (e) => { f.categoryId = ''; form.querySelector('[data-cats]').innerHTML = String(renderCats(e.target.value)); form.elements.namedItem('essential').checked = kind(e.target.value)?.group === 'fixed' || kind(e.target.value)?.group === 'spending'; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(form);
        const amount = parseAmount(d.amount);
        if (!d.name.trim()) { toast('Give it a name'); return; }
        if (!amount) { toast('Enter the monthly amount'); return; }
        const day = Math.max(1, Math.min(31, parseInt(d.dueDay, 10) || 1));
        if (!d.accountId) { toast('Choose the account it’s paid from'); return; }
        await saveCommitment({ ...(c || {}), name: d.name.trim(), amount, dueDay: day, kindId: d.kindId, categoryId: d.categoryId || null, accountId: d.accountId, endMonth: d.endMonth || null, essential: d.essential, variable: d.variable, startMonth: c?.startMonth || monthKey(), active: true });
        toast('Saved'); location.hash = '#/commitments';
      });
      el.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
        if (await confirmSheet({ title: `Delete ${c.name}?`, body: 'It stops appearing each month. Payments already recorded stay.', ok: 'Delete', danger: true })) {
          await deleteCommitment(c.id); toast('Deleted'); location.hash = '#/commitments';
        }
      });
    },
  };
}

// ---------- planned expenses ----------
export function plannedView() {
  const mk = monthKey();
  const p = plannedProjection(state, mk);
  const s = state.settings;
  const paid = state.planned.filter((x) => x.paidTxnId);
  return {
    live: true,
    html: html`
    ${topbar({ back: '#/', backLabel: 'Home', right: html`<a class="btn btn-sm" href="#/planned/new">+ Add</a>` })}
    <h1 class="page-title">Planned expenses</h1>
    <p class="muted">Big one-time costs coming up, and whether your set-aside covers them.</p>
    <div class="kpis3">
      <button type="button" class="kpi-card card" data-act="fund"><span class="k">Set aside / month</span><span class="v num">${money(s.plannedMonthly)}</span></button>
      <button type="button" class="kpi-card card" data-act="fund"><span class="k">Saved so far</span><span class="v num">${money(s.plannedSaved)}</span></button>
      <div class="kpi-card card"><span class="k">Planned</span><span class="v num">${money(p.totalPlanned)}</span></div>
    </div>
    <div class="hint">${s.plannedAccountId ? `Set-aside goes to ${accName(s.plannedAccountId)} each month.` : 'Tap the numbers to set your monthly set-aside.'}${s.plannedContribMonth === mk ? ' This month’s set-aside is done.' : ''}</div>
    ${p.firstShort ? html`<div class="banner danger mt12"><span class="grow"><b>${monthLabel(p.firstShort.mk, false).split(' ')[0]} is short by ${money(p.firstShort.short)}</b><br><small>${p.requiredMonthly ? `Raise the set-aside to ${money(p.requiredMonthly)} a month, or move something later.` : 'Too close to save for — move it later or pay from savings.'}</small></span>
      ${p.requiredMonthly ? html`<button type="button" class="btn btn-sm" data-act="apply-fix" data-v="${p.requiredMonthly}">Use ${money(p.requiredMonthly)}</button>` : ''}</div>` : ''}
    ${p.rows.length ? html`<div class="list mt12">${p.rows.map((r) => html`<div class="pl-month ${r.short ? 'short' : ''}">
      <span class="mn">${monthLabel(r.mk, false).split(' ')[0].toUpperCase()}<small>${r.mk.slice(0, 4)}</small></span>
      <span class="grow">${r.items.map((it) => html`<a class="pl-item" href="#/planned/${it.id}"><span class="grow">${it.name}${it.month < mk ? ' (overdue)' : ''}</span><b class="num">${money(it.amount)}</b></a>`)}
        <span class="r2">Fund ${money(r.fundStart)} → ${r.short ? html`<span class="debit">short ${money(r.short)}</span>` : html`<span class="credit">${money(r.fundEnd)} left</span>`}</span></span></div>`)}</div>`
      : empty('Nothing planned', 'Add costs like insurance renewals, trips, school fees or a new phone — with the month they’re due.', html`<a class="btn btn-primary mt12" href="#/planned/new">+ Add planned expense</a>`)}
    ${paid.length ? html`<div class="grp"><span>DONE</span></div><div class="list">${paid.map((x) => html`<a class="list-row" href="#/planned/${x.id}"><span class="grow"><span class="r1">${x.name}</span><span class="r2">${monthLabel(x.month)} · paid</span></span><span class="r-val num">${money(x.amount)}</span></a>`)}</div>` : ''}
    <div class="hint mt12">When the time comes, open an item and tap “Record as paid”. It then counts in that month’s spending.</div>
    ${tabbar('home')}`,
    mount(el) {
      el.querySelectorAll('[data-act="fund"]').forEach((b) => b.addEventListener('click', fundSheet));
      el.querySelector('[data-act="apply-fix"]')?.addEventListener('click', async (e) => { await saveSettings({ plannedMonthly: Number(e.currentTarget.dataset.v) }); toast('Set-aside updated'); });
    },
  };
}

function fundSheet() {
  const s = state.settings;
  sheet(String(html`<h2 class="sheet-title">Planned-expense fund</h2>
    <form data-fund>
      <label class="field"><span>Set aside each month</span><input name="monthly" inputmode="decimal" value="${s.plannedMonthly ? toRupees(s.plannedMonthly) : ''}" placeholder="₹0"></label>
      <label class="field"><span>Saved so far</span><input name="saved" inputmode="decimal" value="${s.plannedSaved ? toRupees(s.plannedSaved) : ''}" placeholder="₹0"></label>
      <label class="field"><span>Kept in account</span><select name="accountId">${accountOptions(s.plannedAccountId, { allowNone: true, noneLabel: 'Not set' })}</select></label>
      <label class="toggle-row"><span>This month’s set-aside is already done</span><input type="checkbox" name="done" ${s.plannedContribMonth === monthKey() ? 'checked' : ''}></label>
      <div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">Save</button></div>
    </form>`), {
    onMount(panel, close) {
      panel.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(e.target);
        await saveSettings({ plannedMonthly: parseAmount(d.monthly) || 0, plannedSaved: parseAmount(d.saved) || 0, plannedAccountId: d.accountId || null, plannedContribMonth: d.done ? monthKey() : (s.plannedContribMonth === monthKey() ? null : s.plannedContribMonth) });
        close(); toast('Saved');
      });
    },
  });
}

export function plannedFormView({ id }) {
  const p = id && id !== 'new' ? state.planned.find((x) => x.id === id) : null;
  const expenseCats = state.categories.filter((c) => !c.archived && kind(c.kindId)?.group === 'spending');
  const f = p ? { ...p } : { name: '', amount: 0, month: addMonths(monthKey(), 1), categoryId: '' };
  return {
    html: html`<form data-form="pl" novalidate autocomplete="off">
    ${topbar({ back: '#/planned', backLabel: 'Cancel', title: p ? 'Edit planned' : 'New planned expense', right: html`<button class="link-btn" type="submit">Save</button>` })}
    <label class="field"><span>What is it?</span><input name="name" value="${f.name}" placeholder="e.g. Car insurance renewal" maxlength="50"></label>
    <div class="grid2">
      <label class="field"><span>Amount</span><input name="amount" inputmode="decimal" value="${f.amount ? toRupees(f.amount) : ''}" placeholder="₹0"></label>
      <label class="field"><span>Month due</span><input type="month" name="month" value="${f.month}"></label>
    </div>
    <label class="field"><span>Category when paid (optional)</span><select name="categoryId"><option value="">Choose later</option>${expenseCats.map((c) => html`<option value="${c.id}" ${c.id === f.categoryId ? 'selected' : ''}>${c.name}</option>`)}</select></label>
    <button class="btn btn-primary btn-block mt16" type="submit">Save</button>
    ${p && !p.paidTxnId ? html`<button type="button" class="btn btn-block mt8" data-act="paid">${icon.check} Record as paid</button>` : ''}
    ${p?.paidTxnId ? html`<a class="btn btn-block mt8" href="#/txn/${p.paidTxnId}">Open the payment entry</a>` : ''}
    ${p ? html`<button type="button" class="btn btn-danger btn-block mt8" data-act="delete">${icon.trash} Delete</button>` : ''}
    </form>`,
    mount(el) {
      const form = el.querySelector('form');
      const read = () => {
        const d = formData(form);
        const amount = parseAmount(d.amount);
        if (!d.name.trim()) { toast('Give it a name'); return null; }
        if (!amount) { toast('Enter the amount'); return null; }
        if (!d.month) { toast('Choose the month'); return null; }
        return { ...(p || {}), name: d.name.trim(), amount, month: d.month, categoryId: d.categoryId || null };
      };
      form.addEventListener('submit', async (e) => { e.preventDefault(); const r = read(); if (!r) return; await savePlanned(r); toast('Saved'); location.hash = '#/planned'; });
      el.querySelector('[data-act="paid"]')?.addEventListener('click', () => {
        const r = read(); if (!r) return;
        sheet(String(html`<h2 class="sheet-title">Record ${r.name} as paid</h2><form>
          <div class="grid2"><label class="field"><span>Amount</span><input name="amount" inputmode="decimal" value="${toRupees(r.amount)}"></label>
          <label class="field"><span>Paid from</span><select name="accountId">${accountOptions(state.settings.plannedAccountId || state.settings.defaultAccountId)}</select></label></div>
          <label class="toggle-row"><span>Take it out of the planned fund (${money(state.settings.plannedSaved)})</span><input type="checkbox" name="fromFund" checked></label>
          <div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">Record</button></div></form>`), {
          onMount(panel, close) {
            panel.querySelector('form').addEventListener('submit', async (e) => {
              e.preventDefault();
              const d = formData(e.target);
              const amount = parseAmount(d.amount); if (!amount) { toast('Enter the amount'); return; }
              const cat = r.categoryId ? category(r.categoryId) : null;
              const t = await saveTxn({ type: 'out', amount, accountId: d.accountId, kindId: cat?.kindId || state.kinds.find((k) => k.group === 'spending')?.id, categoryId: r.categoryId, note: r.name, payee: '', essential: !!cat?.essential, date: nowLocal(), source: 'planned', plannedId: r.id });
              await savePlanned({ ...r, paidTxnId: t.id, paidAmount: amount });
              if (d.fromFund) await saveSettings({ plannedSaved: Math.max(0, state.settings.plannedSaved - amount) });
              close(); toast(`${r.name} recorded`); location.hash = '#/planned';
            });
          },
        });
      });
      el.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
        if (await confirmSheet({ title: `Delete ${p.name}?`, ok: 'Delete', danger: true, body: p.paidTxnId ? 'The payment entry stays in your history.' : '' })) { await deletePlanned(p.id); toast('Deleted'); location.hash = '#/planned'; }
      });
    },
  };
}

// ---------- salary split ----------
export function splitView(_p, query) {
  const mk = query.m || monthKey();
  const sp = salarySplit(state, mk);
  if (!sp.configured) {
    return { html: html`${topbar({ back: '#/', backLabel: 'Home' })}<h1 class="page-title">Salary split</h1>
      ${empty('Tell the app where your salary lands', 'Pick your salary account in Settings → Monthly plan. The split is then worked out from your commitments.', html`<a class="btn btn-primary mt12" href="#/settings/plan">Set up</a>`)}${tabbar('home')}` };
  }
  const S = account(sp.salaryAccountId);
  const colors = ['var(--s1)', 'var(--s7)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s2)'];
  const parts = [{ value: sp.stays.needed, color: '#4a4945', label: `Stays in ${S.name}` }, ...sp.rows.map((r, i) => ({ value: r.needed, color: colors[i % colors.length], label: accName(r.accountId) }))];
  if (sp.leftover > 0) parts.push({ value: sp.leftover, color: '#2a2a27', label: 'Leftover' });
  const itemsText = (items) => items.map((i) => i.kind === 'commitment' ? i.label : i.label).join(' · ');

  return {
    live: true,
    html: html`
    ${topbar({ back: '#/', backLabel: 'Home', right: html`<a class="link-btn" href="#/commitments">Commitments</a>` })}
    <h1 class="page-title">Salary split</h1>
    ${monthNav('#/split', mk)}
    <p class="muted">${sp.received ? `${money(sp.received)} arrived in ${S.name}.` : `No salary recorded in ${S.name} for this month yet${sp.expected ? ` — using expected ${money(sp.expected)}` : ''}.`}</p>
    ${!sp.received ? html`<a class="btn btn-sm" href="#/add?type=in&account=${S.id}&note=Salary">+ Record salary</a>` : ''}
    ${stack(parts, { label: 'How the salary is split' })}
    <div class="hint">Worked out from what each account has to pay this month.</div>
    ${sp.short ? html`<div class="banner danger mt12"><span class="grow">Commitments and set-asides are ${money(sp.short)} more than the salary.</span></div>` : ''}

    <div class="card split-row mt12"><div class="row between"><span class="grow"><b>Stays in ${S.name}</b><small>${sp.stays.items.length ? `${sp.stays.items.length} payment${sp.stays.items.length > 1 ? 's' : ''} from here · ${itemsText(sp.stays.items)}` : 'Nothing is paid from here'}${sp.leftover > 0 ? ` · plus leftover ${money(sp.leftover)}` : ''}</small></span><b class="num">${money(sp.stays.needed + Math.max(0, sp.leftover))}</b></div></div>

    ${sp.rows.map((r) => html`<div class="card split-row mt8 ${r.toMove ? 'pending' : ''}">
      <div class="row between"><span class="grow"><b>→ ${accName(r.accountId)}</b><small>${itemsText(r.items)}</small></span><span class="num right"><b>${money(r.needed)}</b>${r.moved ? html`<small>${money(r.moved)} moved</small>` : ''}</span></div>
      ${r.moved && r.toMove ? progress(r.moved, r.needed) : ''}
      ${r.toMove ? html`<div class="row between mt8"><span class="small warn-text">${money(r.toMove)} still to move</span><button type="button" class="btn btn-sm" data-move="${r.accountId}" data-amt="${r.toMove}">Mark ${money(r.toMove)} moved</button></div>`
        : html`<div class="small credit mt8">${icon.check} Done</div>`}
    </div>`)}
    ${!sp.rows.length ? empty('Nothing to move yet', 'Add commitments paid from other accounts, or set day-to-day spending money in Settings → Monthly plan.') : ''}
    <div class="hint mt12">The app doesn’t move money. Make the transfer in your bank app, then tap “Mark moved” — it records a transfer so every balance stays right.</div>
    ${tabbar('home')}`,
    mount(el) {
      el.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
        const to = b.dataset.move, amt = Number(b.dataset.amt);
        await saveTxn({ type: 'transfer', amount: amt, accountId: sp.salaryAccountId, toAccountId: to, date: mk === monthKey() ? nowLocal() : `${mk}-01T12:00`, note: 'Salary split', source: 'split' });
        const s = state.settings;
        if (to === s.plannedAccountId && s.plannedMonthly && s.plannedContribMonth !== mk) await saveSettings({ plannedSaved: (s.plannedSaved || 0) + s.plannedMonthly, plannedContribMonth: mk });
        toast(`Recorded ${money(amt)} to ${accName(to)}`);
      }));
    },
  };
}
