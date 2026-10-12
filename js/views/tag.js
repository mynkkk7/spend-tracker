// Tag untagged entries one at a time: pick a category, it moves to the next.
import { html, money, dayLabel, timeLabel, dayOf } from '../util.js';
import { state, saveTxn, category, kind } from '../store.js';
import { untaggedTxns } from '../calc.js';
import { suggestCategory } from '../parse.js';
import { topbar, dot, toast, accName, empty } from '../ui.js';

const skipped = new Set();

export function tagView() {
  const queue = untaggedTxns(state).filter((t) => !skipped.has(t.id));
  const total = untaggedTxns(state).length;
  const t = queue[0];
  if (!t) {
    skipped.clear();
    return { live: true, html: html`${topbar({ back: '#/', backLabel: 'Home', title: 'Tag entries' })}${empty(total ? 'You skipped the rest' : 'All tagged', total ? `${total} still without a category.` : 'Every expense has a category.', html`<a class="btn btn-primary mt12" href="#/">Done</a>`)}` };
  }
  const sug = suggestCategory(state, { text: t.note, payee: t.payee, vpa: t.vpa, direction: 'out' });
  const cats = state.categories.filter((c) => !c.archived && kind(c.kindId)?.group === 'spending');
  const ordered = sug ? [category(sug.categoryId), ...cats.filter((c) => c.id !== sug.categoryId)] : cats;

  return {
    live: true,
    html: html`${topbar({ back: '#/', backLabel: 'Done', title: 'Tag entries' })}
    <div class="card tag-card">
      <div class="small muted">${dayLabel(dayOf(t.date))} · ${timeLabel(t.date)} · ${accName(t.accountId)}</div>
      <div class="amt-big num">${money(t.amount)}</div>
      <div class="text">${t.note || t.payee || t.vpa || 'No note'}</div>
      ${t.payee && t.note ? html`<div class="small muted">${t.payee}</div>` : ''}
      ${t.vpa && t.vpa !== t.payee ? html`<div class="small muted">${t.vpa}</div>` : ''}
    </div>
    <div class="field"><span>What was it?${sug ? ' · first one is suggested' : ''}</span>
      <div class="chips">${ordered.map((c) => html`<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${sug?.categoryId === c.id}">${dot(c.color)}${c.name}</button>`)}</div></div>
    <label class="toggle-row mt12"><span>Essential</span><input type="checkbox" data-ess ${sug && category(sug.categoryId)?.essential ? 'checked' : ''}></label>
    <div class="row gap8 mt16"><button type="button" class="btn grow" data-skip>Skip</button><a class="btn grow" href="#/txn/${t.id}">Open full entry</a></div>
    <div class="tag-progress"><span>${total} left</span><span>Same payee next time is tagged automatically</span></div>`,
    mount(el) {
      let manual = false;
      el.querySelector('[data-ess]').addEventListener('change', () => { manual = true; });
      el.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', async () => {
        const c = category(b.dataset.cat);
        const ess = el.querySelector('[data-ess]');
        await saveTxn({ ...t, categoryId: c.id, kindId: c.kindId, label: null, essential: manual ? ess.checked : !!c.essential });
        toast(`${money(t.amount)} → ${c.name}`, { action: 'Undo', onAction: () => saveTxn(t) });
      }));
      el.querySelector('[data-skip]').addEventListener('click', () => { skipped.add(t.id); location.hash = '#/tag?s=' + skipped.size; });
    },
  };
}
