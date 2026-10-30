// Import many entries at once: bank SMS (pasted or from the iPhone Shortcut's text file) and card statement PDFs.
// Nothing is saved until you review the list and tap Import.
import { html, money, nowLocal, shortDate, esc } from '../util.js';
import { state, account, category, kind, saveAccount, saveCategory, saveSettings, addMany, saveTxn, incomeKind, kindByKey, PALETTE } from '../store.js';
import { balance, eventForDate } from '../calc.js';
import {
  parseSmsBatch, readCardDocument, statementCandidates, markDuplicates, latestBalances,
  statementOpening, cardPatchFromStatement, cardPatchFromSchedule,
} from '../importers.js';
import { readPdfLines } from '../pdftext.js';
import { topbar, toast, accountOptions, bal, icon, seg, dot } from '../ui.js';

const FEE_CAT = 'Bank charges & fees';
const SKIP_CAP = 3000;

export function importView(_p, query) {
  const ui = {
    src: query.src === 'pdf' ? 'pdf' : 'sms', text: '', busy: false, error: '',
    cands: null, doc: null, cardId: '', newCard: null, setOpening: false, done: null,
  };
  return { html: render(ui), mount(el) { mount(el, ui); } };
}

let newCardName = 'New card';
const accLabel = (id) => (id === '__newcard' ? newCardName : account(id)?.name);
const creditCards = () => state.accounts.filter((a) => a.purpose === 'credit' && !a.archived);
const feeCategory = () => state.categories.find((c) => !c.archived && c.name.toLowerCase() === FEE_CAT.toLowerCase());
const refundCategory = () => state.categories.find((c) => !c.archived && kind(c.kindId)?.group === 'income' && /refund|cashback/i.test(c.name));
const skipped = () => new Set(state.settings.importSkipped || []);

function catOptions(c) {
  const group = c.type === 'in' ? ['income'] : ['spending', 'fixed', 'saving'];
  const kinds = state.kinds.filter((k) => group.includes(k.group));
  return html`<option value="">${c.type === 'in' ? 'No category' : 'Needs a category'}</option>
    ${kinds.map((k) => html`<optgroup label="${k.name}">${state.categories.filter((x) => x.kindId === k.id && !x.archived).map((x) => html`<option value="${x.id}" ${x.id === c.categoryId ? 'selected' : ''}>${x.name}</option>`)}</optgroup>`)}
    ${c.statementKind === 'fee' && !feeCategory() ? html`<option value="__fee" ${c.categoryId === '__fee' || !c.categoryId ? 'selected' : ''}>${FEE_CAT} (new)</option>` : ''}`;
}

function candTitle(c) {
  if (c.type === 'transfer') return `${accLabel(c.accountId) || 'Card bill'} → ${accLabel(c.toAccountId) || 'card'}`;
  if (c.type === 'adjust') return c.note;
  return c.payee || c.note || c.raw.slice(0, 40);
}
function candAmount(c) {
  if (c.type === 'in') return html`<span class="amt credit">${money(c.amount, { sign: true })}</span>`;
  if (c.type === 'out') return html`<span class="amt">${money(-c.amount)}</span>`;
  return html`<span class="amt muted">${money(Math.abs(c.amount))}</span>`;
}

function render(ui) {
  const cards = creditCards();
  newCardName = ui.newCard?.name || 'New card';
  return html`
  ${topbar({ back: '#/add', backLabel: 'Back', title: 'Import' })}
  ${ui.done ? renderDone(ui) : html`
  ${seg('src', [{ value: 'sms', label: 'Bank SMS' }, { value: 'pdf', label: 'Card statement' }], ui.src)}
  ${ui.src === 'sms' ? html`<div class="mt12">
    <label class="field"><span>Paste one or many bank SMS</span>
      <textarea data-text rows="6" placeholder="Dear Customer, Acct XXXX2360 debited with INR 120.00 …&#10;---&#10;Next message…">${ui.text}</textarea></label>
    <div class="row wrap gap8 mt8">
      <button type="button" class="btn btn-sm" data-act="clip">Paste from clipboard</button>
      <label class="btn btn-sm file-btn">Open SMS file<input type="file" accept=".txt,text/plain" data-sms-file hidden></label>
      <button type="button" class="btn btn-sm btn-primary" data-act="read-sms">Read messages</button>
    </div>
    <div class="hint">Set up the iPhone Shortcut once (<a href="#/help#sms-shortcut">how</a>) and your bank SMS collect in a file. Open it here every few days — already-imported messages are skipped.</div>
  </div>` : html`<div class="mt12">
    <label class="btn btn-block file-btn ${ui.cands ? '' : 'btn-primary'}">${ui.busy ? 'Reading PDF…' : 'Choose statement PDF'}<input type="file" accept="application/pdf,.pdf" data-pdf hidden></label>
    <div class="hint">ICICI and RBL statements and EMI schedules work. The PDF is read on this phone — never uploaded.</div>
  </div>`}

  ${ui.error ? html`<div class="banner danger mt12"><span class="grow">${ui.error}</span></div>` : ''}

  ${ui.doc?.type === 'statement' ? renderStatementHead(ui, cards) : ''}
  ${ui.doc?.type === 'emi-schedule' ? renderSchedule(ui, cards) : ''}
  ${ui.cands ? renderReview(ui) : ''}`}`;
}

function renderStatementHead(ui, cards) {
  const p = ui.doc.statement;
  const card = account(ui.cardId);
  return html`<div class="card mt12">
    <div class="row between"><b>${p.bank} card ${p.last4 ? `•• ${p.last4}` : ''}</b><span class="small muted">Statement ${shortDate(p.statementDate)}</span></div>
    <div class="kpis mt8">
      <div class="kpi"><div class="k">Total due</div><div class="v num">${p.totalDue != null ? money(p.totalDue) : '—'}</div><div class="s muted">by ${p.dueDate ? shortDate(p.dueDate) : '—'}</div></div>
      <div class="kpi"><div class="k">Minimum due</div><div class="v num">${p.minDue != null ? money(p.minDue) : '—'}</div>${p.limit ? html`<div class="s muted">Limit ${money(p.limit)}</div>` : ''}</div>
    </div>
    ${p.emis.length ? html`<div class="small mt8">EMI: ${p.emis.map((e) => `${money(e.monthly)}/month, ${e.pending} left, ends ${shortDate(e.end)}`).join(' · ')}</div>` : ''}
    <label class="field mt12"><span>Which card account?</span><select data-card>
      ${cards.map((a) => html`<option value="${a.id}" ${a.id === ui.cardId ? 'selected' : ''}>${a.name}${a.last4 ? ` •• ${a.last4}` : ''}</option>`)}
      <option value="new" ${ui.cardId === 'new' ? 'selected' : ''}>+ New card account</option></select></label>
    ${ui.cardId === 'new' ? html`<div class="grid2">
      <label class="field"><span>Card name</span><input data-new-name value="${ui.newCard.name}" maxlength="40"></label>
      <label class="field"><span>Bill paid from</span><select data-new-payfrom>${accountOptions(ui.newCard.payFromId, { allowNone: true, noneLabel: 'Choose…' })}</select></label>
    </div><div class="hint">The card starts at ${money(statementOpening(p) ?? 0)} (what you owed before this statement), so its balance matches the bank after import.</div>`
    : card && !card.payFromId ? html`<label class="field"><span>Bill paid from</span><select data-payfrom>${accountOptions('', { allowNone: true, noneLabel: 'Choose… (makes bill payments transfers)' })}</select></label>` : ''}
    ${ui.cardId !== 'new' && card ? html`<label class="toggle-row mt8"><span>Set the card’s starting balance from this statement<small>${money(statementOpening(p) ?? 0)} on ${shortDate(dayBefore(p.periodStart || p.statementDate))}. Use this the first time.</small></span><input type="checkbox" data-set-opening ${ui.setOpening ? 'checked' : ''}></label>` : ''}
  </div>`;
}

function renderSchedule(ui, cards) {
  const s = ui.doc.schedule;
  return html`<div class="card mt12">
    <b>EMI schedule ${s.last4 ? `· card •• ${s.last4}` : ''}</b>
    <div class="kpis mt8">
      <div class="kpi"><div class="k">Amount on EMI</div><div class="v num">${money(s.principal)}</div><div class="s muted">${s.months} × ${money(s.monthly)}</div></div>
      <div class="kpi"><div class="k">Interest + GST</div><div class="v num debit">${money(s.interest + s.gst)}</div><div class="s muted">${s.rate ? `${s.rate}% a year` : ''}${s.processingFee ? ` · fee ${money(s.processingFee)}` : ''}</div></div>
    </div>
    <div class="small muted mt8">${shortDate(s.start)} → ${shortDate(s.end)}. Interest is charged on the card each month and comes in with your statements.</div>
    ${cards.length ? html`<label class="field mt12"><span>Attach to card</span><select data-sched-card>${cards.map((a) => html`<option value="${a.id}" ${a.last4 && s.last4 && s.last4.endsWith(a.last4) ? 'selected' : ''}>${a.name}</option>`)}</select></label>
      <button type="button" class="btn btn-primary btn-block mt8" data-act="save-schedule">Save to card</button>`
      : html`<div class="hint">Import a statement for this card first, then this schedule.</div>`}
  </div>`;
}

function renderReview(ui) {
  const list = ui.cands;
  const sel = list.filter((c) => c.selected);
  const dups = list.filter((c) => c.duplicate).length;
  const events = state.events.filter((e) => !e.archived);
  if (!list.length) return html`<div class="empty mt16"><div class="empty-t">No transactions found</div><div class="empty-b">${ui.src === 'sms' ? 'Messages need an amount and words like debited / credited / spent.' : 'This PDF has no entries in the statement period.'}</div></div>`;
  return html`
  <div class="sec-head"><h2>${list.length} found</h2><span class="small muted">${dups ? `${dups} already in the app` : 'all new'}</span></div>
  <div class="row gap8"><button type="button" class="btn btn-sm" data-act="all">Select all new</button><button type="button" class="btn btn-sm" data-act="none">Select none</button></div>
  <div class="list mt8 imp-list">${list.map((c, i) => html`<div class="imp-row ${c.selected ? '' : 'off'}">
    <label class="imp-ck"><input type="checkbox" data-sel="${i}" ${c.selected ? 'checked' : ''} aria-label="Import this entry"></label>
    <div class="grow">
      <div class="row between gap8"><span class="t1 ell">${candTitle(c)}</span>${candAmount(c)}</div>
      <div class="t2">${shortDate(c.date)}${c.date.slice(11, 16) && c.source === 'sms' ? ` · ${c.date.slice(11, 16)}` : ''} · ${c.type === 'transfer' ? 'Transfer · not spending' : c.type === 'adjust' ? 'EMI · not spending' : accLabel(c.accountId) || 'No account matched'}${c.fxAmount ? ` · ${c.fxAmount} ${c.fxCurrency}` : ''}${c.note && c.type !== 'adjust' && c.note !== c.payee ? ` · ${c.note}` : ''}</div>
      ${c.duplicate ? html`<div class="t2 warn-text">${c.duplicate}</div>` : ''}
      ${!c.accountId && c.type !== 'transfer' ? html`<select class="mini-sel mt4" data-acc="${i}">${accountOptions('', { allowNone: true, noneLabel: 'Choose account…' })}</select>` : ''}
      ${c.type === 'out' || c.type === 'in' ? html`<div class="row gap8 mt4"><select class="mini-sel grow" data-cat="${i}">${catOptions(c)}</select>
        ${events.length && c.type === 'out' ? html`<select class="mini-sel" data-ev="${i}"><option value="">No event</option>${events.map((e) => html`<option value="${e.id}" ${c.eventId === e.id ? 'selected' : ''}>${e.name}</option>`)}</select>` : ''}</div>` : ''}
    </div></div>`)}</div>
  <div class="imp-bar"><button type="button" class="btn btn-primary btn-block" data-act="import" ${sel.length ? '' : 'disabled'}>Import ${sel.length} entr${sel.length === 1 ? 'y' : 'ies'}</button></div>`;
}

function renderDone(ui) {
  const d = ui.done;
  return html`<div class="empty"><div class="empty-t">${icon.check} Imported ${d.count} entr${d.count === 1 ? 'y' : 'ies'}</div>
    <div class="empty-b">${d.untagged ? `${d.untagged} need a category.` : 'All tagged.'}${d.card ? ` ${d.card} updated.` : ''}</div></div>
    ${d.checks.length ? html`<div class="sec-head"><h2>Balance check</h2></div>
      <p class="small muted">Your bank’s SMS tells you the balance after each payment. Where the app differs, something wasn’t logged.</p>
      <div class="list">${d.checks.map((c, i) => html`<div class="list-row">
        <span class="grow"><span class="r1">${account(c.accountId)?.name}</span>
        <span class="r2 ${c.diff ? 'warn-text' : 'credit'}">${c.diff ? `Off by ${money(Math.abs(c.diff))} on ${shortDate(c.date)} · bank ${bal(c.bank)}, app ${bal(c.app)}` : `Matches the bank · ${bal(c.bank)}`}</span></span>
        ${c.diff && !c.fixed ? html`<button type="button" class="btn btn-sm" data-fix="${i}">Match bank</button>` : c.fixed ? html`<span class="small credit">Fixed</span>` : ''}</div>`)}</div>` : ''}
    <div class="stack-btns mt16">
      ${d.untagged ? html`<a class="btn btn-primary" href="#/tag">Tag ${d.untagged} now</a>` : ''}
      <a class="btn" href="${d.accountHref || '#/txns'}">See entries</a>
      <a class="btn" href="#/import?src=${ui.src}">Import more</a>
    </div>`;
}

const dayBefore = (day) => new Date(Date.parse(day + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);

function prepare(cands) {
  const skip = skipped();
  markDuplicates(state, cands);
  for (const c of cands) {
    if (!c.duplicate && skip.has(c.key)) { c.duplicate = 'You skipped this last time'; c.selected = false; }
    if (c.type === 'out' && !c.eventId) c.eventId = eventForDate(state, c.date)?.id || null;
  }
  return cands;
}

function buildStatementCands(ui) {
  const p = ui.doc.statement;
  let st = state;
  let cardId = ui.cardId;
  if (cardId === 'new') {
    cardId = '__newcard';
    st = { ...state, accounts: [...state.accounts, { id: cardId, purpose: 'credit', payFromId: ui.newCard.payFromId || null }] };
  }
  const fee = feeCategory();
  const cands = statementCandidates(st, p, cardId, { feeCategoryId: fee?.id || null, refundCategoryId: refundCategory()?.id || null });
  for (const c of cands) if (c.statementKind === 'fee' && !c.categoryId) c.categoryId = '__fee';
  ui.cands = prepare(cands);
}

function mount(el, ui) {
  const rerender = () => { const y = window.scrollY; el.innerHTML = String(render(ui)); mount(el, ui); window.scrollTo(0, y); };
  el.querySelectorAll('[data-seg="src"]').forEach((b) => b.addEventListener('click', () => {
    if (ui.src === b.dataset.value) return;
    Object.assign(ui, { src: b.dataset.value, cands: null, doc: null, error: '' }); rerender();
  }));

  // ----- SMS -----
  const ta = el.querySelector('[data-text]');
  ta?.addEventListener('input', () => { ui.text = ta.value; });
  const readSms = () => {
    if (!ui.text.trim()) { toast('Paste some messages first'); return; }
    ui.error = ''; ui.doc = null;
    ui.cands = prepare(parseSmsBatch(state, ui.text, nowLocal()));
    rerender();
  };
  el.querySelector('[data-act="read-sms"]')?.addEventListener('click', readSms);
  el.querySelector('[data-act="clip"]')?.addEventListener('click', async () => {
    try { ui.text = await navigator.clipboard.readText(); readSms(); } catch { toast('Clipboard not available — long-press the box and Paste'); }
  });
  el.querySelector('[data-sms-file]')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    ui.text = await f.text(); readSms();
  });

  // ----- PDF -----
  el.querySelector('[data-pdf]')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    Object.assign(ui, { busy: true, error: '', cands: null, doc: null }); rerender();
    try {
      let lines;
      try { lines = await readPdfLines(f); } catch (err) {
        if (err?.name !== 'PasswordException') throw err;
        const password = prompt('This PDF has a password (often part of your name + date of birth). Enter it:');
        if (!password) throw new Error('No password given');
        lines = await readPdfLines(f, { password });
      }
      const doc = readCardDocument(lines);
      ui.doc = doc;
      if (doc.type === 'unknown') ui.error = 'This doesn’t look like a card statement. Try the PDF your bank emails each month.';
      if (doc.type === 'statement') {
        const p = doc.statement;
        const match = creditCards().find((a) => a.last4 && p.last4 && (a.last4 === p.last4 || a.last4.endsWith(p.last4) || p.last4.endsWith(a.last4)));
        ui.cardId = match ? match.id : 'new';
        ui.newCard = { name: `${p.bank} card`, payFromId: '' };
        ui.setOpening = !!match && !state.txns.some((t) => t.accountId === match.id || t.toAccountId === match.id) && !match.openingBalance;
        buildStatementCands(ui);
      }
    } catch (err) {
      console.error(err);
      ui.error = 'Couldn’t read that PDF.';
    }
    ui.busy = false; rerender();
  });
  el.querySelector('[data-card]')?.addEventListener('change', (e) => { ui.cardId = e.target.value; const a = account(ui.cardId); ui.setOpening = !!a && !state.txns.some((t) => t.accountId === a.id || t.toAccountId === a.id) && !a.openingBalance; buildStatementCands(ui); rerender(); });
  el.querySelector('[data-new-name]')?.addEventListener('input', (e) => { ui.newCard.name = e.target.value; });
  el.querySelector('[data-new-payfrom]')?.addEventListener('change', (e) => { ui.newCard.payFromId = e.target.value; buildStatementCands(ui); rerender(); });
  el.querySelector('[data-payfrom]')?.addEventListener('change', async (e) => {
    const a = account(ui.cardId); if (!a || !e.target.value) return;
    await saveAccount({ ...a, payFromId: e.target.value }); toast(`Bill payments now come from ${account(e.target.value).name}`);
    buildStatementCands(ui); rerender();
  });
  el.querySelector('[data-set-opening]')?.addEventListener('change', (e) => { ui.setOpening = e.target.checked; });

  el.querySelector('[data-act="save-schedule"]')?.addEventListener('click', async () => {
    const a = account(el.querySelector('[data-sched-card]').value); if (!a) return;
    await saveAccount(cardPatchFromSchedule(a, ui.doc.schedule));
    toast(`EMI schedule saved to ${a.name}`); location.hash = `#/account/${a.id}`;
  });

  // ----- review -----
  el.querySelectorAll('[data-sel]').forEach((b) => b.addEventListener('change', () => { ui.cands[b.dataset.sel].selected = b.checked; rerender(); }));
  el.querySelectorAll('[data-cat]').forEach((s) => s.addEventListener('change', () => { ui.cands[s.dataset.cat].categoryId = s.value || null; ui.cands[s.dataset.cat].picked = true; }));
  el.querySelectorAll('[data-ev]').forEach((s) => s.addEventListener('change', () => { ui.cands[s.dataset.ev].eventId = s.value || null; }));
  el.querySelectorAll('[data-acc]').forEach((s) => s.addEventListener('change', () => { ui.cands[s.dataset.acc].accountId = s.value || null; }));
  el.querySelector('[data-act="all"]')?.addEventListener('click', () => { ui.cands.forEach((c) => { c.selected = !c.duplicate; }); rerender(); });
  el.querySelector('[data-act="none"]')?.addEventListener('click', () => { ui.cands.forEach((c) => { c.selected = false; }); rerender(); });
  el.querySelector('[data-act="import"]')?.addEventListener('click', () => doImport(ui, rerender));

  // ----- after import -----
  el.querySelectorAll('[data-fix]').forEach((b) => b.addEventListener('click', async () => {
    const c = ui.done.checks[b.dataset.fix];
    await saveTxn({ type: 'adjust', amount: c.diff, accountId: c.accountId, date: c.date, note: 'Matched to bank SMS balance', source: 'adjust' });
    c.fixed = true; toast(`Corrected by ${money(c.diff, { sign: true })}`); rerender();
  }));
}

async function doImport(ui, rerender) {
  const chosen = ui.cands.filter((c) => c.selected);
  if (chosen.some((c) => !c.accountId && c.type !== 'transfer')) { toast('Choose an account for every selected entry'); return; }
  let cardName = null, cardId = null;

  // Card account (new or existing) and its statement details.
  if (ui.doc?.type === 'statement') {
    const p = ui.doc.statement;
    let card = account(ui.cardId);
    const opening = statementOpening(p);
    const openingAt = `${dayBefore(p.periodStart || p.statementDate)}T23:59`;
    if (ui.cardId === 'new') {
      if (!ui.newCard.name.trim()) { toast('Give the card a name'); return; }
      card = await saveAccount({
        name: ui.newCard.name.trim(), bank: p.bank, purpose: 'credit', last4: p.last4 || '', openingBalance: opening ?? 0, openingAt,
        openingSetAt: new Date().toISOString(), includeInTotal: true, payFromId: ui.newCard.payFromId || null, order: state.accounts.length,
      });
      for (const c of ui.cands) { if (c.accountId === '__newcard') c.accountId = card.id; if (c.toAccountId === '__newcard') c.toAccountId = card.id; }
    } else if (ui.setOpening && opening != null) {
      card = { ...card, openingBalance: opening, openingAt, openingSetAt: new Date().toISOString() };
    }
    card = await saveAccount(cardPatchFromStatement(card, p));
    cardName = card.name; cardId = card.id;
  }

  // "Bank charges & fees" is created only when a fee is imported.
  let fee = feeCategory();
  if (chosen.some((c) => c.categoryId === '__fee') && !fee) {
    const k = kindByKey('expense') || state.kinds.find((x) => x.group === 'spending');
    fee = await saveCategory({ kindId: k.id, name: FEE_CAT, essential: false, keywords: ['interest', 'gst', 'late fee', 'processing fee', 'dcc', 'markup', 'annual fee'], labels: ['Interest', 'GST', 'Forex / DCC', 'Processing fee', 'Late fee'], color: PALETTE[7], budget: 0, order: state.categories.length });
  }
  const expenseKind = kindByKey('expense') || state.kinds.find((x) => x.group === 'spending');
  const feeLabel = (c) => { const d = (c.note || c.raw || '').toUpperCase(); return /GST/.test(d) ? 'GST' : /INTEREST|FINANCE/.test(d) ? 'Interest' : /DCC|MARK ?UP|CROSS CURRENCY/.test(d) ? 'Forex / DCC' : /PROCESSING/.test(d) ? 'Processing fee' : /LATE/.test(d) ? 'Late fee' : null; };

  const recs = chosen.map((c) => {
    const catId = c.categoryId === '__fee' ? fee?.id : c.categoryId;
    const cat = catId ? category(catId) : null;
    const isFee = c.statementKind === 'fee' && cat?.id === fee?.id;
    return {
      type: c.type, amount: c.type === 'adjust' ? c.amount : Math.abs(c.amount), accountId: c.accountId, toAccountId: c.type === 'transfer' ? c.toAccountId : null,
      kindId: c.type === 'transfer' || c.type === 'adjust' ? null : (cat?.kindId || (c.type === 'in' ? incomeKind()?.id : c.kindId || expenseKind?.id)),
      categoryId: c.type === 'transfer' || c.type === 'adjust' ? null : (cat?.id || null),
      label: isFee ? feeLabel(c) : (cat && c.label && (cat.labels || []).includes(c.label) ? c.label : null),
      payee: c.payee || '', vpa: c.vpa || '', note: c.type === 'adjust' ? c.note : (c.note || ''), upiRef: c.upiRef || '',
      essential: c.type === 'out' ? !!cat?.essential : false, date: c.date,
      source: c.statementKind?.startsWith('emi') ? 'card-emi' : c.source, importKey: c.key, eventId: c.type === 'out' ? (c.eventId || null) : null,
      ...(c.fxAmount ? { fxAmount: c.fxAmount, fxCurrency: c.fxCurrency } : {}),
    };
  });
  await addMany('txns', recs);

  // Remember what was left unticked so it doesn't come back pre-selected.
  const left = ui.cands.filter((c) => !c.selected && !c.duplicate).map((c) => c.key);
  if (left.length) await saveSettings({ importSkipped: [...(state.settings.importSkipped || []), ...left].slice(-SKIP_CAP) });

  // Balance check against the newest "Bal INR …" in the SMS.
  const checks = [];
  if (ui.src === 'sms') {
    for (const [accountId, { date, balance: bank }] of Object.entries(latestBalances(ui.cands))) {
      const app = balance(state, accountId, date);
      if (app == null) continue;
      checks.push({ accountId, date: date.slice(0, 16), bank, app, diff: bank - app });
    }
  }
  const untagged = recs.filter((r) => r.type === 'out' && !r.categoryId).length;
  ui.done = { count: recs.length, untagged, card: cardName, checks, accountHref: cardId ? `#/account/${cardId}` : '#/txns' };
  toast(`Imported ${recs.length}`);
  rerender();
}

export { esc, dot };
