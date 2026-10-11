// Shared UI pieces: icons, masks, toast, bottom sheet, confirm, small components.
import { html, raw, esc, money } from './util.js';
import { state, account, category, kind, PURPOSE_COLOR, ACCOUNT_PURPOSES, NEUTRAL } from './store.js';

const svg = (d, extra = '') => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`);
export const icon = {
  home: svg('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.3"'),
  pie: svg('<path d="M21 12A9 9 0 1 1 11 3.06V12z"/><path d="M14 3.2A9 9 0 0 1 20.8 10H14z"/>'),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>', 'stroke-width="2.2"'),
  chev: svg('<path d="m9 6 6 6-6 6"/>'),
  eye: svg('<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.8 3.6M6.6 6.6C3.9 8.4 2.5 12 2.5 12s3.5 7 9.5 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>', 'stroke-width="2.6"'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  swap: svg('<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>'),
  image: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  alert: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 'stroke-width="2.2"'),
};

// ---------- privacy ----------
export const privacy = { revealed: false };
export const showBalances = () => !state.settings.hideBalances || privacy.revealed;
export const bal = (paise) => (showBalances() ? money(paise) : '₹ ••••');

// ---------- small components ----------
export function topbar({ back = '#/', backLabel = 'Back', title = '', right = '' } = {}) {
  return html`<div class="topbar">
    ${back ? html`<a class="back" href="${back}">${icon.back}<span>${backLabel}</span></a>` : html`<span></span>`}
    ${title ? html`<h1 class="tb-title">${title}</h1>` : ''}
    <div class="tb-right">${right}</div>
  </div>`;
}

export const dot = (color) => html`<span class="dot" style="background:${color || NEUTRAL}"></span>`;
export const purposeLabel = (p) => ACCOUNT_PURPOSES.find((x) => x.id === p)?.label || 'Other';
export const purposeColor = (p) => PURPOSE_COLOR[p] || NEUTRAL;
export const accName = (id) => account(id)?.name || 'Deleted account';

export function txnTitle(t) {
  if (t.type === 'transfer') return `${accName(t.accountId)} → ${accName(t.toAccountId)}`;
  if (t.type === 'adjust') return 'Balance fixed';
  return t.note || t.payee || category(t.categoryId)?.name || (t.type === 'in' ? 'Money in' : 'Untagged');
}
export function txnMeta(t, { showAccount = true } = {}) {
  const parts = [];
  if (t.type === 'transfer') parts.push('Transfer · not spending');
  else if (t.type === 'adjust') parts.push('Correction');
  else {
    const c = category(t.categoryId);
    const k = kind(t.kindId);
    if (c) parts.push(c.name + (t.label ? ` · ${t.label}` : ''));
    else if (t.type === 'out' && k && k.group !== 'spending') parts.push(k.name);
    else if (t.type === 'out') parts.push('Needs a category');
    if (t.payee && t.note && t.payee !== t.note) parts.push(t.payee);
  }
  if (showAccount && t.type !== 'transfer') parts.push(accName(t.accountId));
  return parts.join(' · ');
}
export function txnColor(t) {
  if (t.type === 'transfer' || t.type === 'adjust') return NEUTRAL;
  return category(t.categoryId)?.color || kind(t.kindId)?.color || NEUTRAL;
}
export function txnAmount(t) {
  if (t.type === 'in') return html`<span class="amt credit">${money(t.amount, { sign: true })}</span>`;
  if (t.type === 'out') return html`<span class="amt">${money(-t.amount)}</span>`;
  if (t.type === 'adjust') return html`<span class="amt muted">${money(t.amount, { sign: true })}</span>`;
  return html`<span class="amt muted">${money(t.amount)}</span>`;
}
export function txnRow(t, opts = {}) {
  const untagged = t.type === 'out' && !t.categoryId && (kind(t.kindId)?.group || 'spending') === 'spending';
  const letter = t.type === 'transfer' ? '⇄' : t.type === 'adjust' ? '±' : untagged ? '?' : (category(t.categoryId)?.name || kind(t.kindId)?.name || '•').trim()[0].toUpperCase();
  const color = txnColor(t);
  return html`<a class="tx" href="#/txn/${t.id}">
    <span class="ic" style="background:${untagged ? 'var(--surface-2)' : color + '33'};color:${untagged ? 'var(--muted)' : 'var(--text)'}">${letter}</span>
    <span class="tm"><span class="t1">${txnTitle(t)}</span><span class="t2 ${untagged ? 'warn-text' : ''}">${txnMeta(t, opts)}${opts.time ? ` · ${opts.time}` : ''}</span></span>
    ${txnAmount(t)}
  </a>`;
}

export const empty = (title, body = '', action = '') => html`<div class="empty"><div class="empty-t">${title}</div>${body ? html`<div class="empty-b">${body}</div>` : ''}${action}</div>`;

export function progress(value, max, { over = false, color } = {}) {
  const w = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return html`<div class="bar ${over ? 'over' : ''}"><i style="width:${w}%;${color ? `background:${color}` : ''}"></i></div>`;
}

// ---------- toast ----------
let toastTimer;
export function toast(msg, { action, onAction, ms = 3200 } = {}) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; onAction?.(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------- bottom sheet ----------
export function sheet(content, { onMount } = {}) {
  const root = document.getElementById('sheet');
  root.innerHTML = `<div class="sheet-backdrop" data-close></div><div class="sheet-panel" role="dialog" aria-modal="true">${content}</div>`;
  root.hidden = false;
  document.body.classList.add('no-scroll');
  const close = () => { root.hidden = true; root.innerHTML = ''; document.body.classList.remove('no-scroll'); };
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  onMount?.(root.querySelector('.sheet-panel'), close);
  return close;
}

export function confirmSheet({ title, body = '', ok = 'Confirm', danger = false, typeToConfirm = null }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v, close) => { if (!done) { done = true; close(); resolve(v); } };
    sheet(String(html`<h2 class="sheet-title">${title}</h2>${body ? html`<p class="sheet-body">${body}</p>` : ''}
      ${typeToConfirm ? html`<label class="field"><span>Type “${typeToConfirm}” to confirm</span><input id="confirm-type" autocomplete="off"></label>` : ''}
      <div class="sheet-actions"><button type="button" class="btn" data-no>Cancel</button><button type="button" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-yes ${typeToConfirm ? 'disabled' : ''}>${ok}</button></div>`), {
      onMount(panel, close) {
        const yes = panel.querySelector('[data-yes]');
        panel.querySelector('[data-no]').onclick = () => finish(false, close);
        yes.onclick = () => finish(true, close);
        panel.closest('#sheet').querySelector('.sheet-backdrop').addEventListener('click', () => finish(false, () => {}));
        const ti = panel.querySelector('#confirm-type');
        if (ti) ti.addEventListener('input', () => { yes.disabled = ti.value.trim() !== typeToConfirm; });
      },
    });
  });
}

// ---------- form helpers ----------
export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

export function accountOptions(selected, { includeArchived = false, allowNone = false, noneLabel = 'None' } = {}) {
  const list = state.accounts.filter((a) => includeArchived || !a.archived || a.id === selected);
  return html`${allowNone ? html`<option value="" ${!selected ? 'selected' : ''}>${noneLabel}</option>` : ''}${list.map((a) => html`<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${a.name}</option>`)}`;
}

export const chips = (name, options, selected, { multi = false } = {}) => html`<div class="chips" role="group">
  ${options.map((o) => html`<button type="button" class="chip" data-chip="${name}" data-value="${o.value}" aria-pressed="${(multi ? (selected || []).includes(o.value) : selected === o.value) ? 'true' : 'false'}">${o.color ? dot(o.color) : ''}${o.label}</button>`)}
</div>`;

export function seg(name, options, selected) {
  return html`<div class="seg" role="group">${options.map((o) => html`<button type="button" data-seg="${name}" data-value="${o.value}" aria-pressed="${selected === o.value}">${o.label}</button>`)}</div>`;
}

export function tabbar(active) {
  const t = (id, href, ic, label) => html`<a href="${href}" class="${active === id ? 'active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${ic}<span>${label}</span></a>`;
  return html`<nav class="tabbar" aria-label="Main">
    ${t('home', '#/', icon.home, 'Home')}
    ${t('txns', '#/txns', icon.list, 'All')}
    <a href="#/add" class="tab-add" aria-label="Add transaction">${icon.plus}</a>
    ${t('insights', '#/insights', icon.pie, 'Insights')}
    ${t('settings', '#/settings', icon.sliders, 'Settings')}
  </nav>`;
}
