// Events: a trip, a wedding, a festival — spending spread over weeks, tracked against one budget.
import { html, money, parseAmount, toRupees, shortDate, sum, nowLocal, monthShort } from '../util.js';
import { state, saveEvent, deleteEvent, category, saveTxn, addMany } from '../store.js';
import { eventSummary } from '../calc.js';
import { topbar, toast, confirmSheet, formData, empty, progress, icon, dot, txnRow, bindTxnActions, tabbar, accName } from '../ui.js';
import { bars, stack } from '../charts.js';
import { NEUTRAL } from '../store.js';

export function eventsView() {
  const list = state.events;
  return {
    live: true,
    html: html`${topbar({ back: '#/settings', backLabel: 'Settings', title: 'Events', right: html`<a class="btn btn-sm" href="#/events/new">+ Add</a>` })}
    <p class="muted small">Group spending that happens over weeks — flights booked months ahead, the stay, money spent there — and see it against one budget.</p>
    ${list.length ? html`<div class="list">${list.map((e) => { const s = eventSummary(state, e); return html`<a class="list-row" href="#/event/${e.id}">
      <span class="grow"><span class="r1">${e.name}${e.archived ? ' (archived)' : ''}</span><span class="r2">${e.start ? `${shortDate(e.start)} → ${shortDate(e.end || e.start)}` : 'No dates'} · ${s.list.length} entr${s.list.length === 1 ? 'y' : 'ies'}</span></span>
      <span class="r-val num">${money(s.spent)}</span>${icon.chev}</a>`; })}</div>`
      : empty('No events yet', 'Add a trip or occasion, then link entries to it — from the entry screen or by pressing and holding an entry.', html`<a class="btn btn-primary mt12" href="#/events/new">+ Add event</a>`)}`,
  };
}

export function eventFormView({ id }) {
  const e = id && id !== 'new' ? state.events.find((x) => x.id === id) : null;
  const f = e ? { ...e } : { name: '', start: '', end: '', budget: 0, currency: '', perInr: '', excludeFromInsights: false };
  return {
    html: html`<form novalidate autocomplete="off">
    ${topbar({ back: e ? `#/event/${e.id}` : '#/events', backLabel: 'Cancel', title: e ? 'Edit event' : 'New event', right: html`<button class="link-btn" type="submit">Save</button>` })}
    <label class="field"><span>Name</span><input name="name" value="${f.name}" placeholder="e.g. Vietnam trip" maxlength="40" required></label>
    <div class="grid2">
      <label class="field"><span>Starts</span><input type="datetime-local" name="start" value="${f.start || ''}"></label>
      <label class="field"><span>Ends</span><input type="datetime-local" name="end" value="${f.end || ''}"></label>
    </div>
    <div class="hint">New entries dated between these are linked to the event automatically. Bookings made earlier can be linked by hand.</div>
    <label class="field"><span>Budget</span><input name="budget" inputmode="decimal" value="${f.budget ? toRupees(f.budget) : ''}" placeholder="₹0"></label>
    <div class="grid2">
      <label class="field"><span>Local currency (optional)</span><input name="currency" value="${f.currency || ''}" maxlength="3" placeholder="e.g. VND" style="text-transform:uppercase"></label>
      <label class="field"><span>How many for ₹1</span><input name="perInr" inputmode="decimal" value="${f.perInr || ''}" placeholder="e.g. 300"></label>
    </div>
    <div class="hint">Then you can type amounts in that currency and the app converts them. Check today’s rate in your card or forex app.</div>
    <div class="list mt12">
      <label class="toggle-row"><span>Keep out of monthly insights<small>The trip won’t swamp your normal month’s numbers. It still shows here and in balances.</small></span><input type="checkbox" name="excludeFromInsights" ${f.excludeFromInsights ? 'checked' : ''}></label>
      ${e ? html`<label class="toggle-row"><span>Archived<small>Hide from the entry screen</small></span><input type="checkbox" name="archived" ${e.archived ? 'checked' : ''}></label>` : ''}
    </div>
    <button class="btn btn-primary btn-block mt16" type="submit">Save event</button>
    ${e ? html`<button type="button" class="btn btn-danger btn-block mt8" data-act="delete">${icon.trash} Delete event</button><div class="hint center">Entries stay — they’re just unlinked.</div>` : ''}
    </form>`,
    mount(el) {
      const form = el.querySelector('form');
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const d = formData(form);
        if (!d.name.trim()) { toast('Give it a name'); return; }
        if (d.start && d.end && d.end < d.start) { toast('End is before start'); return; }
        const rec = await saveEvent({
          ...(e || {}), name: d.name.trim(), start: d.start || '', end: d.end || d.start || '', budget: parseAmount(d.budget || '') || 0,
          currency: (d.currency || '').trim().toUpperCase(), perInr: parseFloat(d.perInr) || null, excludeFromInsights: d.excludeFromInsights, archived: !!d.archived,
        });
        toast('Saved'); location.hash = `#/event/${rec.id}`;
      });
      el.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
        if (await confirmSheet({ title: `Delete ${e.name}?`, body: 'Linked entries stay in your history, just without the event.', ok: 'Delete', danger: true })) {
          await deleteEvent(e.id); toast('Deleted'); location.hash = '#/events';
        }
      });
    },
  };
}

export function eventView({ id }) {
  const e = state.events.find((x) => x.id === id);
  if (!e) return { html: html`${topbar({ back: '#/events' })}${empty('Event not found')}` };
  const s = eventSummary(state, e);
  const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]).map(([cid, v]) => ({ c: category(cid), v, cid }));
  const fx = s.list.filter((t) => t.fxAmount && t.fxCurrency);
  const fxTotal = sum(fx, (t) => t.fxAmount);
  const showDays = s.days.length && s.days.length <= 31 && s.phases.during > 0;
  return {
    live: true,
    html: html`${topbar({ back: '#/events', backLabel: 'Events', right: html`<a class="link-btn" href="#/events/${e.id}">Edit</a>` })}
    <h1 class="page-title">${e.name}</h1>
    <p class="muted small">${e.start ? `${shortDate(e.start)} ${e.start.slice(11, 16)} → ${shortDate(e.end)} ${(e.end || '').slice(11, 16)}` : 'No dates'}${s.tripDays ? ` · ${s.tripDays} days` : ''}${s.status === 'upcoming' ? ` · in ${s.daysToGo} days` : s.status === 'on' ? ' · on now' : ''}</p>
    <section class="card hero">
      <span class="label">Spent so far</span>
      <div class="big num">${money(s.spent)}</div>
      ${s.budget ? html`<div class="row between small muted mt8"><span>of ${money(s.budget)} budget</span><span class="${s.left < 0 ? 'debit' : ''}">${s.left >= 0 ? `${money(s.left)} left` : `${money(-s.left)} over`}</span></div>${progress(s.spent, s.budget, { over: s.spent > s.budget })}` : html`<a class="small" href="#/events/${e.id}">Set a budget ›</a>`}
      <div class="phase3 mt12">
        <div class="kpi"><div class="k">Before</div><div class="v num">${money(s.phases.before)}</div><div class="s">bookings</div></div>
        <div class="kpi"><div class="k">During</div><div class="v num">${money(s.phases.during)}</div><div class="s">${s.perDayDuring ? `${money(s.perDayDuring)}/day` : 'there'}</div></div>
        <div class="kpi"><div class="k">After</div><div class="v num">${money(s.phases.after)}</div><div class="s">settling up</div></div>
      </div>
      ${s.budget && s.status !== 'done' && s.tripDays ? html`<div class="small muted mt12">${s.left > 0 ? `That leaves about ${money(100 * Math.round(s.left / 100 / (s.status === 'on' ? Math.max(1, s.tripDays - Math.round((Date.parse(nowLocal().slice(0, 10)) - Date.parse(e.start.slice(0, 10))) / 864e5)) : s.tripDays)))} a day for the rest of the trip.` : 'Already over budget.'}</div>` : ''}
      ${fx.length ? html`<div class="small muted mt8">${fxTotal.toLocaleString('en-IN')} ${fx[0].fxCurrency} entered in local currency.</div>` : ''}
    </section>

    ${cats.length ? html`<div class="sec-head"><h2>By category</h2></div>
      <div class="card">${stack(cats.map((x) => ({ value: x.v, color: x.c?.color || NEUTRAL, label: x.c?.name || 'Needs a category' })))}
      <div class="list mt8">${cats.map((x) => html`<div class="list-row">${dot(x.c?.color || NEUTRAL)}<span class="grow">${x.c?.name || 'Needs a category'}</span><span class="num">${money(x.v)}</span></div>`)}</div></div>` : ''}

    ${showDays ? html`<div class="sec-head"><h2>Each day there</h2></div>
      <div class="card">${bars(s.days.map((d) => ({ v: d.v, label: d.day.slice(8), tip: `${shortDate(d.day)} · ${money(d.v)}` })), { showLabels: s.days.map((_, i) => i).filter((i) => i % 2 === 0) })}</div>` : ''}

    ${Object.keys(s.byAccount).length > 1 ? html`<div class="sec-head"><h2>Paid from</h2></div>
      <div class="list">${Object.entries(s.byAccount).sort((a, b) => b[1] - a[1]).map(([aid, v]) => html`<div class="list-row"><span class="grow">${accName(aid)}</span><span class="num">${money(v)}</span></div>`)}</div>` : ''}

    ${s.suggest.length ? html`<div class="banner warn mt16"><span class="grow">${s.suggest.length} entr${s.suggest.length === 1 ? 'y' : 'ies'} during these dates ${s.suggest.length === 1 ? 'isn’t' : 'aren’t'} linked (${money(sum(s.suggest, (t) => t.amount))})</span><button type="button" class="btn btn-sm" data-act="link-all">Link all</button></div>` : ''}

    <div class="sec-head"><h2>Entries</h2><span class="small muted">${s.list.length}</span></div>
    ${s.list.length ? html`<div class="list">${s.list.map((t) => txnRow(t))}</div>` : empty('Nothing linked yet', 'Press and hold any entry → Add to event. Bookings made months ahead count too.')}
    ${tabbar('home')}`,
    mount(el) {
      bindTxnActions(el);
      el.querySelector('[data-act="link-all"]')?.addEventListener('click', async () => {
        const list = s.suggest.map((t) => ({ ...t, eventId: e.id }));
        for (const t of list) await saveTxn(t);
        toast(`Linked ${list.length} to ${e.name}`);
      });
    },
  };
}

export { addMany, monthShort };
