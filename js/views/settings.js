import { html, money, parseAmount, toRupees, monthKey, nowLocal } from '../util.js';
import {
  state, saveSettings, account, kind, category, saveCategory, deleteCategory, saveKind, deleteKind, categoriesOf,
  exportData, importData, validateBackup, eraseEverything, PALETTE, KIND_GROUPS, activeAccounts,
} from '../store.js';
import { budgetTotal, commitmentStatus } from '../calc.js';
import { topbar, icon, dot, toast, confirmSheet, sheet, accountOptions, formData, tabbar, empty, purposeColor, purposeLabel, accName } from '../ui.js';

const ago = (iso) => {
  if (!iso) return 'never';
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

async function deliverFile(name, type, text) {
  const blob = new Blob([text], { type });
  const file = new File([blob], name, { type });
  if (navigator.canShare?.({ files: [file] }) && /iphone|ipad|android/i.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}

function toCsv() {
  const cols = ['date', 'type', 'amount', 'account', 'to_account', 'kind', 'category', 'label', 'payee', 'note', 'upi_ref', 'essential'];
  const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = state.txns.slice().reverse().map((t) => [
    t.date.replace('T', ' '), t.type, (t.amount / 100).toFixed(2), accName(t.accountId), t.toAccountId ? accName(t.toAccountId) : '',
    kind(t.kindId)?.name || '', category(t.categoryId)?.name || '', t.label || '', t.payee || '', t.note || '', t.upiRef || '', t.type === 'out' ? (t.essential ? 'yes' : 'no') : '',
  ].map(q).join(','));
  return [cols.join(','), ...rows].join('\n');
}

export function settingsView() {
  const s = state.settings;
  const cs = commitmentStatus(state, monthKey());
  const backupOld = !s.lastBackupAt || Date.now() - Date.parse(s.lastBackupAt) > 7 * 864e5;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return {
    tab: 'settings', live: true,
    html: html`
    <header class="page-head"><h1>Settings</h1></header>
    <div class="sec">PRIVACY</div>
    <div class="list"><label class="toggle-row"><span>Hide balances by default<small>Tap the eye to show them for a moment</small></span><input type="checkbox" data-set="hideBalances" ${s.hideBalances ? 'checked' : ''}></label></div>

    <div class="sec">ACCOUNTS</div>
    <div class="list">
      ${state.accounts.filter((a) => !a.archived).map((a) => html`<a class="list-row" href="#/settings/accounts/${a.id}">${dot(purposeColor(a.purpose))}<span class="grow"><span class="r1">${a.name}</span><span class="r2">${[purposeLabel(a.purpose), a.bank, a.last4 ? `•• ${a.last4}` : ''].filter(Boolean).join(' · ')}</span></span>${icon.chev}</a>`)}
      <a class="list-row add" href="#/settings/accounts/new">+ Add account</a>
      ${state.accounts.some((a) => a.archived) ? html`<a class="list-row" href="#/settings/accounts"><span class="grow muted">Show archived accounts</span>${icon.chev}</a>` : ''}
    </div>

    <div class="sec">MONTHLY PLAN</div>
    <div class="list">
      <a class="list-row" href="#/commitments"><span class="grow"><span class="r1">Commitments</span><span class="r2">EMIs, SIPs, insurance, bills · ${cs.count} this month</span></span><span class="r-val num">${money(cs.total)}</span>${icon.chev}</a>
      <a class="list-row" href="#/planned"><span class="grow"><span class="r1">Planned expenses</span><span class="r2">${s.plannedMonthly ? `Set aside ${money(s.plannedMonthly)}/month` : 'Big one-time costs ahead'}</span></span><span class="r-val num">${state.planned.filter((p) => !p.paidTxnId).length}</span>${icon.chev}</a>
      <a class="list-row" href="#/settings/plan"><span class="grow"><span class="r1">Salary split</span><span class="r2">${s.salaryAccountId ? `Salary lands in ${accName(s.salaryAccountId)}` : 'Not set up'}</span></span>${icon.chev}</a>
    </div>

    <div class="sec">CATEGORIES</div>
    <div class="list">
      <a class="list-row" href="#/settings/categories"><span class="grow"><span class="r1">Categories &amp; budgets</span><span class="r2">${state.categories.filter((c) => !c.archived).length} categories${budgetTotal(state) ? ` · ${money(budgetTotal(state))}/month budget` : ''}</span></span>${icon.chev}</a>
      <a class="list-row" href="#/settings/kinds"><span class="grow"><span class="r1">Kinds</span><span class="r2">${state.kinds.map((k) => k.name).join(', ')}</span></span>${icon.chev}</a>
    </div>

    <div class="sec" id="backup">BACKUP</div>
    ${backupOld && state.txns.length ? html`<div class="banner warn">Last backup ${ago(s.lastBackupAt)} — back up now. Your data lives only on this phone.</div>` : ''}
    <div class="list">
      <button type="button" class="list-row" data-act="export"><span class="grow"><span class="r1">Export backup</span><span class="r2">JSON file → save to iCloud Drive / Files · last ${ago(s.lastBackupAt)}</span></span>${icon.chev}</button>
      <label class="list-row"><span class="grow"><span class="r1">Restore from backup</span><span class="r2">Replace everything, or add what’s new</span></span>${icon.chev}<input type="file" accept="application/json,.json" data-act="import" hidden></label>
      <button type="button" class="list-row" data-act="csv"><span class="grow"><span class="r1">Export CSV</span><span class="r2">All entries — open in Numbers or Google Sheets</span></span>${icon.chev}</button>
    </div>

    <div class="sec">THIS APP</div>
    <div class="list">
      ${standalone ? '' : html`<div class="list-row"><span class="grow"><span class="r1">Install on your iPhone</span><span class="r2">In Safari: Share → Add to Home Screen. Use it from the icon — Safari and the icon keep separate data.</span></span></div>`}
      <a class="list-row" href="#/help"><span class="grow"><span class="r1">Tips &amp; shortcuts</span><span class="r2">Quick add, screenshots, iPhone Shortcuts</span></span>${icon.chev}</a>
      <button type="button" class="list-row danger" data-act="erase"><span class="grow"><span class="r1">Erase all data</span><span class="r2">Start fresh on this device</span></span></button>
    </div>
    <div class="foot">Your data stays on this device. Nothing is uploaded.<br>Spend Tracker v1.0</div>
    ${tabbar('settings')}`,
    mount(el) {
      el.querySelector('[data-set="hideBalances"]').addEventListener('change', (e) => saveSettings({ hideBalances: e.target.checked }));
      el.querySelector('[data-act="export"]').addEventListener('click', async () => {
        const ok = await deliverFile(`spend-tracker-backup-${nowLocal().slice(0, 10)}.json`, 'application/json', JSON.stringify(exportData(), null, 1));
        if (ok) { await saveSettings({ lastBackupAt: new Date().toISOString() }); toast('Backup created — keep it somewhere safe'); }
      });
      el.querySelector('[data-act="csv"]').addEventListener('click', () => deliverFile(`spend-tracker-${nowLocal().slice(0, 10)}.csv`, 'text/csv', toCsv()));
      el.querySelector('[data-act="import"]').addEventListener('change', async (e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (!file) return;
        let data;
        try { data = JSON.parse(await file.text()); } catch { toast('That file isn’t valid JSON'); return; }
        const err = validateBackup(data);
        if (err) { toast(err); return; }
        sheet(String(html`<h2 class="sheet-title">Restore backup</h2><p class="sheet-body">${data.accounts.length} accounts · ${data.categories.length} categories · ${data.txns.length} entries${data.exportedAt ? ` · made ${data.exportedAt.slice(0, 10)}` : ''}</p>
          <div class="stack-btns"><button type="button" class="btn btn-primary" data-mode="merge">Add what’s new</button><button type="button" class="btn btn-danger-solid" data-mode="replace">Replace everything</button><button type="button" class="btn" data-close>Cancel</button></div>`), {
          onMount(panel, close) {
            panel.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', async () => {
              close();
              if (b.dataset.mode === 'replace' && !(await confirmSheet({ title: 'Replace everything?', body: 'All data on this device is replaced by the backup.', ok: 'Replace', danger: true }))) return;
              try { await importData(data, b.dataset.mode); toast('Restored'); location.hash = '#/'; } catch (x) { toast(x.message); }
            }));
          },
        });
      });
      el.querySelector('[data-act="erase"]').addEventListener('click', async () => {
        if (await confirmSheet({ title: 'Erase all data?', body: 'Every account, entry and setting on this device is deleted. Export a backup first if you might need it.', ok: 'Erase', danger: true, typeToConfirm: 'ERASE' })) {
          await eraseEverything(); toast('All data erased'); location.hash = '#/welcome';
        }
      });
    },
  };
}

// ---------- monthly plan settings ----------
export function planSettingsView() {
  const s = state.settings;
  const rows = [...(s.leftoverSplit || []), {}, {}].slice(0, Math.max(2, (s.leftoverSplit || []).length + 1));
  return {
    html: html`<form data-form="plan" novalidate>
    ${topbar({ back: '#/settings', backLabel: 'Settings', title: 'Salary split', right: html`<button class="link-btn" type="submit">Save</button>` })}
    <p class="muted small">Each month the app works out how much each account needs — its commitments plus anything below — and tells you what to move from your salary account.</p>
    <label class="field"><span>Salary arrives in</span><select name="salaryAccountId">${accountOptions(s.salaryAccountId, { allowNone: true, noneLabel: 'Not set' })}</select></label>
    <label class="field"><span>Expected monthly salary (optional)</span><input name="expectedSalary" inputmode="decimal" value="${s.expectedSalary ? toRupees(s.expectedSalary) : ''}" placeholder="Used until the salary is recorded"></label>
    <div class="grid2">
      <label class="field"><span>Day-to-day money goes to</span><select name="dailyAccountId">${accountOptions(s.dailyAccountId, { allowNone: true, noneLabel: 'Not set' })}</select></label>
      <label class="field"><span>Amount each month</span><input name="dailyAmount" inputmode="decimal" value="${s.dailyAmount ? toRupees(s.dailyAmount) : ''}" placeholder="₹0"></label>
    </div>
    <div class="hint">Your everyday spending money, on top of the bills paid from that account.</div>
    <div class="field mt16"><span>Leftover split (optional)</span><div class="hint mt0">After everything above, split what remains by percentage.</div></div>
    ${rows.map((r, i) => html`<div class="grid2 ls-row"><label class="field"><span class="sr">Account ${i + 1}</span><select name="ls_acc_${i}">${accountOptions(r.accountId, { allowNone: true, noneLabel: 'Choose account' })}</select></label>
      <label class="field"><span class="sr">Percent ${i + 1}</span><input name="ls_pct_${i}" inputmode="numeric" value="${r.pct || ''}" placeholder="%"></label></div>`)}
    <div class="list mt12"><label class="toggle-row"><span>Remind me to split<small>Shows on Home after salary arrives</small></span><input type="checkbox" name="splitReminder" ${s.splitReminder ? 'checked' : ''}></label></div>
    <a class="list-row card mt12" href="#/planned"><span class="grow"><span class="r1">Planned-expense set-aside</span><span class="r2">${s.plannedMonthly ? `${money(s.plannedMonthly)}/month → ${accName(s.plannedAccountId)}` : 'Set it on the Planned screen'}</span></span>${icon.chev}</a>
    <button class="btn btn-primary btn-block mt16" type="submit">Save</button>
    </form>`,
    mount(el) {
      const form = el.querySelector('form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(form);
        const split = [];
        for (let i = 0; i < rows.length; i++) {
          const acc = d[`ls_acc_${i}`], p = parseInt(d[`ls_pct_${i}`], 10);
          if (acc && p > 0) split.push({ accountId: acc, pct: Math.min(100, p) });
        }
        if (split.reduce((a, x) => a + x.pct, 0) > 100) { toast('Leftover split adds up to more than 100%'); return; }
        await saveSettings({
          salaryAccountId: d.salaryAccountId || null, expectedSalary: parseAmount(d.expectedSalary) || 0,
          dailyAccountId: d.dailyAccountId || null, dailyAmount: parseAmount(d.dailyAmount) || 0,
          leftoverSplit: split, splitReminder: d.splitReminder,
        });
        toast('Saved'); location.hash = state.settings.salaryAccountId ? '#/split' : '#/settings';
      });
    },
  };
}

// ---------- categories ----------
export function categoriesView() {
  return {
    live: true,
    html: html`${topbar({ back: '#/settings', backLabel: 'Settings', title: 'Categories' })}
    <p class="muted small">Keywords and labels help quick add and screenshots pick the right category. Budgets apply to spending categories.</p>
    ${state.kinds.map((k) => {
      const cats = categoriesOf(k.id);
      const budget = cats.reduce((a, c) => a + (c.budget || 0), 0);
      return html`<div class="grp"><span>${k.name.toUpperCase()}${k.group !== 'spending' && k.group !== 'income' ? ' · NOT SPENDING' : ''}</span>${k.group === 'spending' && budget ? html`<span class="num">${money(budget)}/mo</span>` : ''}</div>
      <div class="list">${cats.map((c) => html`<a class="list-row" href="#/settings/categories/${c.id}">${dot(c.color)}<span class="grow"><span class="r1">${c.name}</span><span class="r2">${[c.labels?.length ? `Labels: ${c.labels.join(', ')}` : '', c.keywords?.length ? c.keywords.slice(0, 4).join(', ') + (c.keywords.length > 4 ? '…' : '') : ''].filter(Boolean).join(' · ') || 'No keywords'}</span></span>
        ${k.group === 'spending' ? html`<span class="r-val num">${c.budget ? money(c.budget) : '—'}</span>` : ''}${icon.chev}</a>`)}
        <a class="list-row add" href="#/settings/categories/new?kind=${k.id}">+ Add to ${k.name}</a></div>`;
    })}
    ${state.categories.some((c) => c.archived) ? html`<div class="grp"><span>ARCHIVED</span></div><div class="list">${state.categories.filter((c) => c.archived).map((c) => html`<a class="list-row" href="#/settings/categories/${c.id}">${dot(c.color)}<span class="grow muted">${c.name}</span>${icon.chev}</a>`)}</div>` : ''}`,
  };
}

export function categoryFormView({ id }, query) {
  const c = id && id !== 'new' ? category(id) : null;
  const k0 = c ? kind(c.kindId) : kind(query.kind) || state.kinds[0];
  const used = new Set(state.categories.map((x) => x.color));
  const f = c ? { ...c } : { name: '', kindId: k0?.id, color: PALETTE.find((p) => !used.has(p)) || PALETTE[0], budget: 0, labels: [], keywords: [], essential: false };
  const count = c ? state.txns.filter((t) => t.categoryId === c.id).length : 0;
  return {
    html: html`<form data-form="cat" novalidate autocomplete="off">
    ${topbar({ back: '#/settings/categories', backLabel: 'Cancel', title: c ? 'Edit category' : 'New category', right: html`<button class="link-btn" type="submit">Save</button>` })}
    <label class="field"><span>Name</span><input name="name" value="${f.name}" placeholder="e.g. Tea & snacks" maxlength="30"></label>
    <label class="field"><span>Kind</span><select name="kindId" data-kind>${state.kinds.map((k) => html`<option value="${k.id}" ${k.id === f.kindId ? 'selected' : ''}>${k.name}</option>`)}</select></label>
    <div class="field"><span>Colour</span><div class="swatches">${PALETTE.map((p) => html`<label class="sw"><input type="radio" name="color" value="${p}" ${p === f.color ? 'checked' : ''}><i style="background:${p}"></i><span class="sr">${p}</span></label>`)}</div></div>
    <label class="field budget-field ${kind(f.kindId)?.group === 'spending' ? '' : 'hidden'}"><span>Monthly budget (optional)</span><input name="budget" inputmode="decimal" value="${f.budget ? toRupees(f.budget) : ''}" placeholder="₹0"></label>
    <label class="field"><span>Labels (optional, comma separated)</span><input name="labels" value="${(f.labels || []).join(', ')}" placeholder="e.g. Petrol, Service, Insurance"></label>
    <div class="hint">Sub-types shown when you pick this category.</div>
    <label class="field"><span>Keywords (comma separated)</span><input name="keywords" value="${(f.keywords || []).join(', ')}" placeholder="words in notes or payee names"></label>
    <div class="hint">If a note or payee contains one of these, this category is suggested.</div>
    <div class="list mt12"><label class="toggle-row"><span>Essential by default</span><input type="checkbox" name="essential" ${f.essential ? 'checked' : ''}></label></div>
    <button class="btn btn-primary btn-block mt16" type="submit">Save category</button>
    ${c ? html`<button type="button" class="btn btn-block mt8" data-act="archive">${c.archived ? 'Unarchive' : 'Archive (hide from pickers)'}</button>
      <button type="button" class="btn btn-danger btn-block mt8" data-act="delete">${icon.trash} Delete category</button>
      ${count ? html`<div class="hint center">${count} entr${count === 1 ? 'y uses' : 'ies use'} it — deleting marks them untagged.</div>` : ''}` : ''}
    </form>`,
    mount(el) {
      const form = el.querySelector('form');
      form.querySelector('[data-kind]').addEventListener('change', (e) => { form.querySelector('.budget-field').classList.toggle('hidden', kind(e.target.value)?.group !== 'spending'); });
      const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(form);
        if (!d.name.trim()) { toast('Give the category a name'); return; }
        const dupe = state.categories.find((x) => x.id !== c?.id && x.kindId === d.kindId && x.name.toLowerCase() === d.name.trim().toLowerCase());
        if (dupe) { toast('A category with that name already exists'); return; }
        await saveCategory({ ...(c || {}), name: d.name.trim(), kindId: d.kindId, color: d.color || f.color, budget: kind(d.kindId)?.group === 'spending' ? parseAmount(d.budget) || 0 : 0, labels: list(d.labels), keywords: list(d.keywords).map((x) => x.toLowerCase()), essential: d.essential, order: c?.order ?? state.categories.length + 1 });
        toast('Saved'); location.hash = '#/settings/categories';
      });
      el.querySelector('[data-act="archive"]')?.addEventListener('click', async () => { await saveCategory({ ...c, archived: !c.archived }); toast(c.archived ? 'Unarchived' : 'Archived'); location.hash = '#/settings/categories'; });
      el.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
        if (await confirmSheet({ title: `Delete ${c.name}?`, body: count ? `${count} entries will become untagged.` : 'This can’t be undone.', ok: 'Delete', danger: true })) { await deleteCategory(c.id); toast('Deleted'); location.hash = '#/settings/categories'; }
      });
    },
  };
}

// ---------- kinds ----------
export function kindsView() {
  return {
    live: true,
    html: html`${topbar({ back: '#/settings', backLabel: 'Settings', title: 'Kinds' })}
    <p class="muted small">A kind groups categories by what the money does. Only “counts as spending” kinds appear in spending totals and budgets.</p>
    <div class="list">${state.kinds.map((k) => html`<button type="button" class="list-row" data-kind="${k.id}">${dot(k.color)}<span class="grow"><span class="r1">${k.name}</span><span class="r2">${KIND_GROUPS.find((g) => g.id === k.group)?.label}</span></span>${icon.chev}</button>`)}
    <button type="button" class="list-row add" data-kind="new">+ Add kind</button></div>`,
    mount(el) {
      el.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => kindSheet(b.dataset.kind === 'new' ? null : kind(b.dataset.kind))));
    },
  };
}

function kindSheet(k) {
  const used = k ? state.txns.some((t) => t.kindId === k.id) || state.categories.some((c) => c.kindId === k.id) || state.commitments.some((c) => c.kindId === k.id) : false;
  const onlyIncome = k?.group === 'income' && state.kinds.filter((x) => x.group === 'income').length === 1;
  sheet(String(html`<h2 class="sheet-title">${k ? 'Edit kind' : 'New kind'}</h2><form>
    <label class="field"><span>Name</span><input name="name" value="${k?.name || ''}" maxlength="24" placeholder="e.g. Donations"></label>
    <label class="field"><span>Counts as</span><select name="group" ${onlyIncome ? 'disabled' : ''}>${KIND_GROUPS.map((g) => html`<option value="${g.id}" ${g.id === (k?.group || 'fixed') ? 'selected' : ''}>${g.label}</option>`)}</select></label>
    <div class="field"><span>Colour</span><div class="swatches">${PALETTE.map((p) => html`<label class="sw"><input type="radio" name="color" value="${p}" ${p === (k?.color || PALETTE[6]) ? 'checked' : ''}><i style="background:${p}"></i></label>`)}</div></div>
    <div class="sheet-actions">${k && !used ? html`<button type="button" class="btn btn-danger" data-del>Delete</button>` : html`<button type="button" class="btn" data-close>Cancel</button>`}<button class="btn btn-primary">Save</button></div>
    ${k && used ? html`<div class="hint center">In use, so it can be renamed but not deleted.</div>` : ''}</form>`), {
    onMount(panel, close) {
      panel.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(e.target);
        if (!d.name.trim()) { toast('Give it a name'); return; }
        await saveKind({ ...(k || {}), name: d.name.trim(), group: onlyIncome ? 'income' : d.group, color: d.color, order: k?.order ?? state.kinds.length });
        close(); toast('Saved');
      });
      panel.querySelector('[data-del]')?.addEventListener('click', async () => { await deleteKind(k.id); close(); toast('Deleted'); });
    },
  });
}

export { activeAccounts, account };
