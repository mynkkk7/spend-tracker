import { html, money, monthKey, monthLabel, addMonths, sum, parseAmount, toRupees, nowLocal, dayOf } from '../util.js';
import { state, account, saveAccount, deleteAccount, saveSettings, saveTxn, ACCOUNT_PURPOSES, activeAccounts } from '../store.js';
import { balance } from '../calc.js';
import { topbar, bal, privacy, icon, purposeLabel, purposeColor, sheet, toast, confirmSheet, formData, tabbar, empty } from '../ui.js';
import { filterTxns, dayGroups } from './txns.js';

export function accountView({ id }, query) {
  const a = account(id);
  if (!a) return { html: html`${topbar({ back: '#/' })}${empty('Account not found')}` };
  const m = query.m || monthKey();
  const mk = monthKey();
  const inMonth = state.txns.filter((t) => t.date.slice(0, 7) === mk);
  const moneyIn = sum(inMonth.filter((t) => (t.type === 'in' && t.accountId === id) || (t.type === 'transfer' && t.toAccountId === id)), (t) => t.amount);
  const moneyOut = sum(inMonth.filter((t) => (t.type === 'out' && t.accountId === id) || (t.type === 'transfer' && t.accountId === id)), (t) => t.amount);
  const transfersOut = sum(inMonth.filter((t) => t.type === 'transfer' && t.accountId === id), (t) => t.amount);
  const list = filterTxns({ m, account: id });
  const b = balance(state, id);
  const months = [mk, addMonths(mk, -1), addMonths(mk, -2)];

  return {
    live: true,
    html: html`
    ${topbar({ back: '#/', backLabel: 'Home', right: html`<a class="link-btn" href="#/settings/accounts/${a.id}">Edit</a>` })}
    <div class="acc-head">
      <div class="row wrap gap8"><span class="badge" style="--c:${purposeColor(a.purpose)}">${purposeLabel(a.purpose).toUpperCase()}</span>
        <span class="small muted">${[a.bank, a.last4 ? `•• ${a.last4}` : ''].filter(Boolean).join(' · ')}</span>${a.archived ? html`<span class="badge">ARCHIVED</span>` : ''}</div>
      <h1>${a.name}</h1>
      <div class="row gap8"><span class="big num ${b < 0 ? 'debit' : ''}">${bal(b)}</span>
        ${state.settings.hideBalances ? html`<button type="button" class="icon-btn sm" data-act="reveal" aria-label="${privacy.revealed ? 'Hide balance' : 'Show balance'}">${privacy.revealed ? icon.eye : icon.eyeOff}</button>` : ''}</div>
    </div>
    <div class="grid2 mt12">
      <div class="card kpi-card"><div class="k">Money in · ${monthLabel(mk, false).split(' ')[0]}</div><div class="v credit num">${money(moneyIn, { sign: true })}</div></div>
      <div class="card kpi-card"><div class="k">Money out · ${monthLabel(mk, false).split(' ')[0]}</div><div class="v num">${money(-moneyOut)}</div>${transfersOut ? html`<div class="s muted">incl. ${money(transfersOut)} transfers</div>` : ''}</div>
    </div>
    <div class="row gap8 mt12">
      <a class="btn btn-primary grow" href="#/add?account=${a.id}">+ Add</a>
      <button type="button" class="btn grow" data-act="fix">Fix balance</button>
      <a class="btn grow" href="#/txns?account=${a.id}&m=all">All entries</a>
    </div>
    <div class="pills mt16">${months.map((x) => html`<a class="pill ${x === m ? 'on' : ''}" href="#/account/${a.id}?m=${x}">${monthLabel(x, false).split(' ')[0]}</a>`)}<a class="pill ${m === 'all' ? 'on' : ''}" href="#/account/${a.id}?m=all">All</a></div>
    ${list.length ? dayGroups(list, { showAccount: false }) : empty('No entries in this period')}
    ${tabbar('home')}`,
    mount(el, { refresh }) {
      el.querySelector('[data-act="reveal"]')?.addEventListener('click', () => { privacy.revealed = !privacy.revealed; refresh(); });
      el.querySelector('[data-act="fix"]').addEventListener('click', () => {
        sheet(String(html`<h2 class="sheet-title">Fix balance</h2><p class="sheet-body">Enter what your bank app shows right now. The app adds a correction entry for the difference — it doesn’t count as spending.</p>
          <form data-fix><label class="field"><span>Actual balance</span><input name="v" inputmode="decimal" placeholder="₹0" autofocus></label>
          <div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">Save</button></div></form>`), {
          onMount(panel, close) {
            panel.querySelector('form').addEventListener('submit', async (e) => {
              e.preventDefault();
              const raw = e.target.v.value.trim();
              const neg = /^[-−]/.test(raw);
              const v = parseAmount(raw.replace(/^[-−]/, ''));
              if (v == null && raw !== '0') { toast('Enter a number'); return; }
              const target = (neg ? -1 : 1) * (v || 0);
              const diff = target - balance(state, a.id);
              if (diff) await saveTxn({ type: 'adjust', amount: diff, accountId: a.id, date: nowLocal(), note: 'Balance correction', source: 'adjust' });
              close(); toast(diff ? `Corrected by ${money(diff, { sign: true })}` : 'Balance already matches');
            });
          },
        });
      });
    },
  };
}

export function accountsListView() {
  const list = state.accounts;
  return {
    live: true,
    html: html`${topbar({ back: '#/settings', backLabel: 'Settings', title: 'Accounts' })}
    <p class="muted small">Name each account the way you think of it, then say what it’s for. You can have as many of each type as you need.</p>
    ${list.length ? html`<div class="list">${list.map((a) => html`<a class="list-row" href="#/settings/accounts/${a.id}">
      <span class="dot" style="background:${purposeColor(a.purpose)}"></span>
      <span class="grow"><span class="r1">${a.name}${a.archived ? ' (archived)' : ''}</span><span class="r2">${[purposeLabel(a.purpose), a.bank, a.last4 ? `•• ${a.last4}` : '', state.settings.defaultAccountId === a.id ? 'quick-add default' : ''].filter(Boolean).join(' · ')}</span></span>
      <span class="r-val num">${bal(balance(state, a.id))}</span>${icon.chev}</a>`)}</div>` : empty('No accounts yet')}
    <a class="btn btn-primary btn-block mt16" href="#/settings/accounts/new">+ Add account</a>`,
  };
}

export function accountFormView({ id } = {}) {
  const a = id && id !== 'new' ? account(id) : null;
  const isNew = !a;
  const f = a ? { ...a } : { name: '', bank: '', purpose: '', last4: '', openingBalance: 0, includeInTotal: true };
  const isDefault = a ? state.settings.defaultAccountId === a.id : !state.settings.defaultAccountId;
  const used = a ? state.txns.some((t) => t.accountId === a.id || t.toAccountId === a.id) || state.commitments.some((c) => c.accountId === a.id) : false;
  const openDay = a?.openingAt ? a.openingAt.slice(0, 10) : dayOf(nowLocal());

  return {
    html: html`
    <form data-form="acc" novalidate autocomplete="off">
    ${topbar({ back: '#/settings/accounts', backLabel: 'Cancel', title: isNew ? 'New account' : 'Edit account', right: html`<button class="link-btn" type="submit">Save</button>` })}
    <label class="field"><span>Name</span><input name="name" value="${f.name}" placeholder="Whatever you call it" required maxlength="40"></label>
    <label class="field"><span>Bank or app (optional)</span><input name="bank" value="${f.bank}" placeholder="e.g. the bank name" maxlength="40"></label>
    <div class="field"><span>What is this account for?</span>
      <div class="chips" role="radiogroup">${ACCOUNT_PURPOSES.map((p) => html`<label class="chip radio-chip"><input type="radio" name="purpose" value="${p.id}" ${f.purpose === p.id ? 'checked' : ''}><span>${p.label}</span></label>`)}</div>
      <div class="hint">Used to group accounts and plan your salary split.</div></div>
    <div class="grid2">
      <label class="field"><span>${isNew ? 'Current balance' : 'Opening balance'}</span><input name="openingBalance" inputmode="decimal" value="${f.openingBalance ? String(toRupees(f.openingBalance)) : ''}" placeholder="₹0"></label>
      <label class="field"><span>As on</span><input type="date" name="openingDay" value="${openDay}" max="${dayOf(nowLocal())}"></label>
    </div>
    <div class="hint">${isNew ? 'Entries after this date change the balance.' : 'Changing this recalculates the balance from that date.'} For a credit card, enter what you owe with a minus sign.</div>
    <label class="field"><span>Last 4 digits (optional)</span><input name="last4" value="${f.last4 || ''}" inputmode="numeric" maxlength="4" pattern="\\d{4}" placeholder="••••" class="w120"></label>
    <div class="hint">Lets screenshots and SMS pick this account automatically.</div>
    <div class="list mt16">
      <label class="toggle-row"><span>Default for quick add</span><input type="checkbox" name="isDefault" ${isDefault ? 'checked' : ''}></label>
      <label class="toggle-row"><span>Count in total balance</span><input type="checkbox" name="includeInTotal" ${f.includeInTotal !== false ? 'checked' : ''}></label>
    </div>
    <button class="btn btn-primary btn-block mt16" type="submit">Save account</button>
    ${a ? html`<button type="button" class="btn btn-block mt8" data-act="archive">${a.archived ? 'Unarchive' : 'Archive'} account</button>
      ${!used ? html`<button type="button" class="btn btn-block btn-danger mt8" data-act="delete">${icon.trash} Delete account</button>` : html`<div class="hint center">Accounts with entries can be archived, not deleted.</div>`}` : ''}
    </form>`,
    mount(el) {
      const form = el.querySelector('form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(form);
        if (!d.name.trim()) { toast('Give the account a name'); form.elements.namedItem('name').focus(); return; }
        if (!d.purpose) { toast('Choose what the account is for'); return; }
        if (d.last4 && !/^\d{4}$/.test(d.last4)) { toast('Last 4 digits should be 4 numbers'); return; }
        const rawBal = (d.openingBalance || '').trim();
        const neg = /^[-−]/.test(rawBal);
        const ob = rawBal ? parseAmount(rawBal.replace(/^[-−]/, '')) : 0;
        if (rawBal && ob == null && rawBal !== '0') { toast('Balance should be a number'); return; }
        const today = dayOf(nowLocal());
        const openingAt = d.openingDay && d.openingDay < today ? `${d.openingDay}T23:59` : (a && a.openingAt && a.openingAt.slice(0, 10) === d.openingDay ? a.openingAt : nowLocal());
        const rec = await saveAccount({
          ...(a || {}), name: d.name.trim(), bank: d.bank.trim(), purpose: d.purpose, last4: d.last4 || '',
          openingBalance: (neg ? -1 : 1) * (ob || 0), openingAt, includeInTotal: d.includeInTotal,
          openingSetAt: !a || a.openingAt !== openingAt || a.openingBalance !== (neg ? -1 : 1) * (ob || 0) ? new Date().toISOString() : (a.openingSetAt || a.createdAt),
          order: a?.order ?? state.accounts.length,
        });
        if (d.isDefault) await saveSettings({ defaultAccountId: rec.id });
        else if (state.settings.defaultAccountId === rec.id) await saveSettings({ defaultAccountId: null });
        const s = state.settings;
        if (isNew && rec.purpose === 'income' && !s.salaryAccountId) await saveSettings({ salaryAccountId: rec.id });
        if (isNew && rec.purpose === 'spending' && !s.dailyAccountId) await saveSettings({ dailyAccountId: rec.id });
        toast(isNew ? `Added ${rec.name}` : 'Saved');
        location.hash = isNew && location.hash.includes('from=onboarding') ? '#/welcome' : '#/settings/accounts';
      });
      el.querySelector('[data-act="archive"]')?.addEventListener('click', async () => {
        await saveAccount({ ...a, archived: !a.archived });
        toast(a.archived ? 'Unarchived' : 'Archived — hidden from lists, history kept');
        location.hash = '#/settings/accounts';
      });
      el.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
        if (await confirmSheet({ title: `Delete ${a.name}?`, body: 'This account has no entries. This can’t be undone.', ok: 'Delete', danger: true })) {
          await deleteAccount(a.id);
          const patch = {};
          for (const k of ['defaultAccountId', 'salaryAccountId', 'dailyAccountId', 'plannedAccountId']) if (state.settings[k] === a.id) patch[k] = null;
          if (Object.keys(patch).length) await saveSettings(patch);
          toast('Deleted'); location.hash = '#/settings/accounts';
        }
      });
    },
  };
}

export { activeAccounts };
