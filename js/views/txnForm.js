import { html, money, parseAmount, nowLocal, toRupees, esc } from '../util.js';
import { state, saveTxn, deleteTxn, saveCategory, category, kind, categoriesOf, outKinds, incomeKind, activeAccounts, account } from '../store.js';
import { parsePaymentText, suggestCategory } from '../parse.js';
import { readImage } from '../ocr.js';
import { topbar, accountOptions, dot, toast, confirmSheet, icon, seg } from '../ui.js';

export function txnFormView({ id } = {}, query = {}) {
  const existing = id ? state.txns.find((t) => t.id === id) : null;
  if (id && !existing) return { html: html`${topbar({ back: '#/txns' })}<div class="empty">This entry no longer exists.</div>` };

  const defaultAcc = (state.settings.defaultAccountId && account(state.settings.defaultAccountId)?.id) || activeAccounts()[0]?.id || '';
  const expenseKind = state.kinds.find((k) => k.key === 'expense') || state.kinds.find((k) => k.group === 'spending') || outKinds()[0];
  const f = existing ? {
    ...existing, amountText: String(toRupees(existing.amount)), found: {}, manualEssential: true,
  } : {
    type: query.type === 'in' ? 'in' : query.type === 'transfer' ? 'transfer' : 'out',
    amountText: query.amt || '', accountId: query.account || defaultAcc, toAccountId: '',
    kindId: expenseKind?.id || null, categoryId: null, label: null, payee: '', vpa: '', note: query.note || '',
    upiRef: '', date: nowLocal(), essential: false, source: 'manual', found: {}, manualEssential: false,
  };
  if (f.type === 'in' && !existing) f.kindId = incomeKind()?.id || null;
  const dupOf = !existing && query.dup ? state.txns.find((t) => t.id === query.dup) : null;
  if (dupOf) Object.assign(f, {
    type: dupOf.type, amountText: String(toRupees(dupOf.amount)), accountId: dupOf.accountId, toAccountId: dupOf.toAccountId || '',
    kindId: dupOf.kindId, categoryId: dupOf.categoryId, label: dupOf.label, payee: dupOf.payee || '', vpa: dupOf.vpa || '', note: dupOf.note || '',
    essential: !!dupOf.essential, manualEssential: true,
  });
  const ui = { mode: existing ? 'manual' : (query.mode || (query.text ? 'paste' : 'manual')), pasteText: query.text || '', ocr: null, preview: null, busy: false, status: '' };
  if (!existing && f.note) applySuggestion(f, true);
  if (!existing && query.text) applyParsed(f, parsePaymentText(state, query.text), ui, 'paste');

  return {
    tab: null,
    html: render(f, ui, existing),
    mount(el) { mount(el, f, ui, existing); },
  };
}

function applySuggestion(f, onlyIfEmpty = false) {
  if (onlyIfEmpty && f.categoryId) return;
  const sug = suggestCategory(state, { text: f.note, payee: f.payee, vpa: f.vpa, direction: f.type });
  if (sug) { f.categoryId = sug.categoryId; f.kindId = sug.kindId; f.label = sug.label; f.found.category = true; if (!f.manualEssential) f.essential = !!category(sug.categoryId)?.essential; }
}

function applyParsed(f, r, ui, source) {
  if (r.amount) f.amountText = String(toRupees(r.amount));
  f.type = r.direction === 'in' ? 'in' : 'out';
  f.kindId = f.type === 'in' ? incomeKind()?.id : (r.kindId || f.kindId);
  if (r.payee) f.payee = r.payee;
  f.vpa = r.vpa || '';
  if (r.note) f.note = r.note;
  if (r.upiRef) f.upiRef = r.upiRef;
  if (r.date) f.date = r.date;
  if (r.accountId) f.accountId = r.accountId;
  if (r.categoryId) { f.categoryId = r.categoryId; f.label = r.label; f.essential = !!category(r.categoryId)?.essential; }
  f.source = source;
  f.found = { ...r.found };
  ui.parsed = r;
}

function render(f, ui, existing) {
  const isOut = f.type === 'out', isIn = f.type === 'in', isTr = f.type === 'transfer';
  const kinds = outKinds();
  const curKind = kind(f.kindId);
  const cats = isIn ? categoriesOf(incomeKind()?.id) : isOut ? categoriesOf(f.kindId) : [];
  const cat = category(f.categoryId);
  const dup = f.upiRef ? state.txns.find((t) => t.upiRef === f.upiRef && t.id !== existing?.id) : null;
  const tag = (k, txt = 'read') => (f.found?.[k] ? html`<span class="tag ${txt === 'suggested' ? 'sug' : ''}">${txt}</span>` : '');
  const linked = existing?.commitmentId ? state.commitments.find((c) => c.id === existing.commitmentId) : null;

  return html`
  <form data-form="txn" novalidate autocomplete="off">
  ${topbar({ back: existing ? '#/txns' : '#/', backLabel: 'Cancel', title: existing ? 'Edit entry' : 'New entry', right: html`<button type="submit" class="link-btn">Save</button>` })}

  ${existing ? '' : html`<div class="seg mt8" role="group" aria-label="How to add">
    ${[['manual', 'Manual'], ['screenshot', 'Screenshot'], ['paste', 'Paste text']].map(([v, l]) => html`<button type="button" data-mode="${v}" aria-pressed="${ui.mode === v}">${l}</button>`)}
  </div>`}

  ${ui.mode === 'screenshot' ? html`<div class="card mt12 shot">
      ${ui.preview ? html`<img class="shot-img" src="${ui.preview}" alt="Your screenshot">` : html`<div class="shot-ph">${icon.image}</div>`}
      <div class="grow">
        <b>${ui.busy ? 'Reading your screenshot…' : ui.parsed ? `Read from ${ui.parsed.app || 'screenshot'}` : 'Pick a payment screenshot'}</b>
        <div class="small muted">${ui.busy ? ui.status : ui.parsed ? `${Object.values(ui.parsed.found).filter(Boolean).length} details found. Check them, then save.` : 'GPay, PhonePe, Paytm or your bank app. Read on this phone — never uploaded.'}</div>
        ${ui.busy ? html`<div class="progress mt8"><i style="width:${Math.round((ui.progress || 0) * 100)}%"></i></div>` : ''}
        <label class="btn btn-sm mt8 file-btn">${ui.preview ? 'Choose another' : 'Choose screenshot'}<input type="file" accept="image/*" data-file hidden></label>
      </div>
    </div>
    ${ui.ocrText ? html`<details class="mt8"><summary>Show text read from image</summary><pre class="raw">${ui.ocrText}</pre></details>` : ''}` : ''}

  ${ui.mode === 'paste' ? html`<div class="mt12">
      <label class="field"><span>Paste a bank SMS, UPI message or text from a screenshot</span>
      <textarea data-paste rows="4" placeholder="e.g. Rs.386.00 debited from A/c XX1234 on 11-10-26 to VPA …">${ui.pasteText}</textarea></label>
      <div class="row mt8"><button type="button" class="btn btn-sm" data-act="clip">Paste from clipboard</button><button type="button" class="btn btn-sm btn-primary" data-act="read-paste">Read text</button></div>
    </div>` : ''}

  ${dup ? html`<a class="banner danger mt12" href="#/txn/${dup.id}"><span class="grow">Already saved: same UPI ref on ${esc(dup.date.slice(0, 10))} (${money(dup.amount)})</span><b>Open ›</b></a>` : ''}
  ${linked ? html`<div class="banner mt12"><span class="grow">Payment for commitment “${linked.name}” (${existing.commitmentMonth})</span></div>` : ''}

  <div class="mt16">${seg('type', [{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }, { value: 'transfer', label: 'Transfer' }], f.type)}</div>

  <label class="amount-wrap"><span class="sr">Amount</span>
    <span class="rupee">₹</span><input class="amount-input" name="amount" inputmode="decimal" placeholder="0" value="${f.amountText}" data-bind="amountText" required>${tag('amount')}
  </label>

  ${isOut ? html`<div class="field"><span>Kind</span>${seg('kind', kinds.map((k) => ({ value: k.id, label: k.name })), f.kindId)}</div>` : ''}

  ${!isTr ? html`<div class="field"><span>Category ${tag('category', 'suggested')}</span>
    ${cats.length ? html`<div class="chips">${cats.map((c) => html`<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${f.categoryId === c.id}">${dot(c.color)}${c.name}</button>`)}</div>`
      : html`<div class="small muted">No categories under ${isIn ? 'Income' : curKind?.name || 'this kind'} yet. <a href="#/settings/categories">Add one</a> — or save without.</div>`}
  </div>` : ''}

  ${cat ? html`<div class="field"><span>Label · ${cat.name} <small class="muted">(optional, e.g. Petrol, Washing)</small></span><div class="chips">
    ${(cat.labels || []).map((l) => html`<button type="button" class="chip" data-label="${l}" aria-pressed="${f.label === l}">${l}</button>`)}
    ${ui.addingLabel ? html`<span class="new-label"><input data-new-label placeholder="New label" maxlength="24" enterkeyhint="done"><button type="button" class="btn btn-sm btn-primary" data-act="add-label">Add</button></span>`
      : html`<button type="button" class="chip chip-add" data-act="new-label">+ New label</button>`}
  </div></div>` : ''}

  <div class="grid2">
    <label class="field"><span>${isTr ? 'From' : isIn ? 'Into account' : 'From account'} ${tag('account', 'matched')}</span>
      <select name="accountId" data-bind="accountId">${accountOptions(f.accountId)}</select></label>
    ${isTr ? html`<label class="field"><span>To</span><select name="toAccountId" data-bind="toAccountId">${accountOptions(f.toAccountId, { allowNone: true, noneLabel: 'Choose…' })}</select></label>`
      : html`<label class="field"><span>Date &amp; time ${tag('date')}</span><input type="datetime-local" name="date" value="${f.date}" data-bind="date"></label>`}
  </div>
  ${isTr ? html`<label class="field"><span>Date &amp; time</span><input type="datetime-local" name="date" value="${f.date}" data-bind="date"></label>` : ''}
  ${!isTr ? html`<label class="field"><span>${isIn ? 'From (payer)' : 'Paid to'} ${tag('payee')}</span><input name="payee" value="${f.payee}" data-bind="payee" placeholder="${isIn ? 'Who paid you' : 'Shop, person or UPI ID'}"></label>` : ''}
  <label class="field"><span>Note ${tag('note')}</span><input name="note" value="${f.note}" data-bind="note" data-suggest placeholder="What was it?"></label>
  ${!isTr ? html`<label class="field"><span>UPI ref (optional) ${tag('upiRef')}</span><input name="upiRef" value="${f.upiRef}" data-bind="upiRef" inputmode="numeric" placeholder="12-digit reference"></label>` : ''}
  ${isOut ? html`<label class="toggle-row"><span>Essential<small>Couldn’t have skipped this</small></span><input type="checkbox" name="essential" ${f.essential ? 'checked' : ''} data-essential></label>` : ''}

  <button type="submit" class="btn btn-primary btn-block mt16">${existing ? 'Save changes' : isTr ? 'Save transfer' : isIn ? 'Save money in' : 'Save'}</button>
  ${existing ? html`<button type="button" class="btn btn-block mt8" data-act="duplicate">Duplicate as new entry</button>
    <button type="button" class="btn btn-block btn-danger mt8" data-act="delete">${icon.trash} Delete entry</button>` : ''}
  </form>`;
}

function mount(el, f, ui, existing) {
  const rerender = () => {
    const y = window.scrollY;
    el.innerHTML = String(render(f, ui, existing));
    mount(el, f, ui, existing);
    window.scrollTo(0, y);
  };
  const form = el.querySelector('form');
  form.querySelectorAll('[data-bind]').forEach((inp) => inp.addEventListener('input', () => { f[inp.dataset.bind] = inp.value; }));
  form.querySelectorAll('[data-bind="accountId"],[data-bind="toAccountId"]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.bind] = s.value; }));
  form.querySelector('[data-suggest]')?.addEventListener('change', () => { if (!f.categoryId) { applySuggestion(f); rerender(); } });
  form.querySelector('[data-essential]')?.addEventListener('change', (e) => { f.essential = e.target.checked; f.manualEssential = true; });

  form.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { ui.mode = b.dataset.mode; rerender(); }));
  form.querySelectorAll('[data-seg="type"]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.value; if (t === f.type) return;
    f.type = t; f.categoryId = null; f.label = null;
    f.kindId = t === 'in' ? incomeKind()?.id : t === 'out' ? (outKinds().find((k) => k.group === 'spending') || outKinds()[0])?.id : null;
    rerender();
  }));
  form.querySelectorAll('[data-seg="kind"]').forEach((b) => b.addEventListener('click', () => {
    if (f.kindId === b.dataset.value) return;
    f.kindId = b.dataset.value; f.categoryId = null; f.label = null;
    if (!f.manualEssential) f.essential = kind(f.kindId)?.group === 'fixed';
    rerender();
  }));
  form.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    const c = category(b.dataset.cat);
    if (f.categoryId === c.id) { f.categoryId = null; f.label = null; } else { f.categoryId = c.id; f.kindId = c.kindId; f.label = null; if (!f.manualEssential) f.essential = !!c.essential; }
    f.found.category = false; rerender();
  }));
  form.querySelectorAll('[data-label]').forEach((b) => b.addEventListener('click', () => { f.label = f.label === b.dataset.label ? null : b.dataset.label; rerender(); }));
  form.querySelector('[data-act="new-label"]')?.addEventListener('click', () => { ui.addingLabel = true; rerender(); el.querySelector('[data-new-label]')?.focus(); });
  const addLabel = async () => {
    const inp = el.querySelector('[data-new-label]');
    const name = (inp?.value || '').trim().replace(/\s+/g, ' ');
    ui.addingLabel = false;
    if (name) {
      const c = category(f.categoryId);
      const existingLabel = (c.labels || []).find((l) => l.toLowerCase() === name.toLowerCase());
      if (!existingLabel) await saveCategory({ ...c, labels: [...(c.labels || []), name] });
      f.label = existingLabel || name;
      toast(existingLabel ? `Picked ${existingLabel}` : `Added label “${name}” to ${c.name}`);
    }
    rerender();
  };
  form.querySelector('[data-act="add-label"]')?.addEventListener('click', addLabel);
  form.querySelector('[data-new-label]')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLabel(); } });
  form.querySelector('[data-act="duplicate"]')?.addEventListener('click', () => {
    const q = new URLSearchParams({ dup: existing.id });
    location.hash = '#/add?' + q.toString();
  });

  // screenshot
  form.querySelector('[data-file]')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (ui.preview) URL.revokeObjectURL(ui.preview);
    ui.preview = URL.createObjectURL(file); ui.busy = true; ui.progress = 0.05; ui.status = 'Loading text reader… (first time takes a few seconds)'; ui.parsed = null; rerender();
    try {
      const text = await readImage(file, (p, s) => {
        ui.progress = p; ui.status = s;
        const bar = el.querySelector('.progress > i'); if (bar) bar.style.width = `${Math.round(p * 100)}%`;
        const st = el.querySelector('.shot .small'); if (st) st.textContent = s;
      });
      ui.ocrText = text;
      const r = parsePaymentText(state, text);
      applyParsed(f, r, ui, 'screenshot');
      if (!r.amount) toast('Couldn’t find the amount — type it in');
    } catch (err) {
      console.error(err); toast('Couldn’t read that image. Try Paste text instead.');
    }
    ui.busy = false; rerender();
  });

  // paste
  const ta = form.querySelector('[data-paste]');
  ta?.addEventListener('input', () => { ui.pasteText = ta.value; });
  form.querySelector('[data-act="clip"]')?.addEventListener('click', async () => {
    try { ui.pasteText = await navigator.clipboard.readText(); readPaste(); } catch { toast('Clipboard not available — long-press the box and Paste'); }
  });
  const readPaste = () => {
    if (!ui.pasteText.trim()) { toast('Paste some text first'); return; }
    const r = parsePaymentText(state, ui.pasteText);
    applyParsed(f, r, ui, 'paste');
    rerender();
    toast(r.amount ? `Found ${money(r.amount)}${r.payee ? ` to ${r.payee}` : ''}` : 'No amount found — fill it in below');
  };
  form.querySelector('[data-act="read-paste"]')?.addEventListener('click', readPaste);

  form.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    if (await confirmSheet({ title: 'Delete this entry?', body: `${money(existing.amount)} · ${existing.date.slice(0, 10)}. Account balances will update.`, ok: 'Delete', danger: true })) {
      const backup = { ...existing };
      await deleteTxn(existing.id);
      toast('Entry deleted', { action: 'Undo', onAction: () => saveTxn(backup) });
      location.hash = '#/txns';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseAmount(f.amountText);
    if (!amount) { toast('Enter an amount'); form.querySelector('[name="amount"]').focus(); return; }
    if (!f.accountId || !account(f.accountId)) { toast('Choose an account'); return; }
    if (f.type === 'transfer' && (!f.toAccountId || f.toAccountId === f.accountId)) { toast('Choose a different “to” account'); return; }
    const rec = {
      ...(existing || {}),
      type: f.type, amount, accountId: f.accountId,
      toAccountId: f.type === 'transfer' ? f.toAccountId : null,
      kindId: f.type === 'transfer' ? null : f.kindId,
      categoryId: f.type === 'transfer' ? null : f.categoryId,
      label: f.type === 'transfer' ? null : f.label,
      payee: (f.payee || '').trim(), vpa: f.vpa || '', note: (f.note || '').trim(), upiRef: (f.upiRef || '').trim(),
      essential: f.type === 'out' ? !!f.essential : false,
      date: f.date || nowLocal(), source: existing?.source || f.source,
    };
    await saveTxn(rec);
    toast(existing ? 'Saved' : `Saved ${money(amount)}`);
    if (existing) history.length > 1 ? history.back() : (location.hash = '#/txns');
    else location.hash = '#/';
  });
}
