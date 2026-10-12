import { html } from '../util.js';
import { state, SUGGESTED_CATEGORIES, DEFAULT_KINDS, createDefaults, saveSettings, importData, validateBackup } from '../store.js';
import { toast, purposeLabel, purposeColor, dot, topbar } from '../ui.js';

export function welcomeView() {
  const step = state.kinds.length ? 'accounts' : 'categories';
  if (step === 'categories') {
    const byKind = DEFAULT_KINDS.map((k) => ({ k, cats: SUGGESTED_CATEGORIES.filter((c) => c.kind === k.key) }));
    return {
      live: true,
      html: html`<div class="welcome">
      <h1>Welcome</h1>
      <p class="lead">Track what you spend, where, and on what — on this phone only. Nothing is uploaded.</p>
      <div class="steps"><span class="on">1 Categories</span><span>2 Accounts</span></div>
      <p class="muted small">Pick a starting set. You can rename, delete or add your own anytime (e.g. “Tea”, “Car petrol”).</p>
      <form data-form="cats">
        ${byKind.map(({ k, cats }) => html`<div class="grp"><span>${k.name.toUpperCase()}</span>${k.group !== 'spending' && k.group !== 'income' ? html`<span>not counted as spending</span>` : ''}</div>
          <div class="list">${cats.map((c) => html`<label class="toggle-row"><span>${c.name}${c.labels?.length ? html`<small>Labels: ${c.labels.join(', ')}</small>` : ''}</span><input type="checkbox" name="cat" value="${c.name}" ${c.name !== 'Stocks' ? 'checked' : ''}></label>`)}</div>`)}
        <button class="btn btn-primary btn-block mt16" type="submit">Continue</button>
        <button type="button" class="btn btn-block mt8" data-act="none">Start with no categories</button>
      </form>
      <label class="btn btn-block mt8 file-btn">Restore from a backup file<input type="file" accept="application/json,.json" data-act="restore" hidden></label>
      </div>`,
      mount(el) {
        const form = el.querySelector('form');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const names = [...form.querySelectorAll('input[name="cat"]:checked')].map((i) => i.value);
          await createDefaults(names);
          location.hash = '#/welcome';
        });
        el.querySelector('[data-act="none"]').addEventListener('click', async () => { await createDefaults([]); location.hash = '#/welcome'; });
        el.querySelector('[data-act="restore"]').addEventListener('change', async (e) => {
          const file = e.target.files?.[0]; if (!file) return;
          try {
            const data = JSON.parse(await file.text());
            const err = validateBackup(data); if (err) throw new Error(err);
            await importData(data, 'replace'); toast('Restored'); location.hash = state.accounts.length ? '#/' : '#/welcome';
          } catch (x) { toast(x.message || 'Could not read that file'); }
        });
      },
    };
  }
  const accts = state.accounts;
  return {
    live: true,
    html: html`<div class="welcome">
    <h1>Your accounts</h1>
    <div class="steps"><span class="done">1 Categories</span><span class="on">2 Accounts</span></div>
    <p class="muted small">Add each bank account, card, wallet or cash you use. Name them your way and say what each is for — salary, spending, savings, investment… You can have several of each.</p>
    ${accts.length ? html`<div class="list">${accts.map((a) => html`<a class="list-row" href="#/settings/accounts/${a.id}">${dot(purposeColor(a.purpose))}<span class="grow"><span class="r1">${a.name}</span><span class="r2">${purposeLabel(a.purpose)}</span></span></a>`)}</div>` : ''}
    <a class="btn btn-block mt12 ${accts.length ? '' : 'btn-primary'}" href="#/settings/accounts/new?from=onboarding">+ Add ${accts.length ? 'another' : 'your first'} account</a>
    ${accts.length ? html`<button type="button" class="btn btn-primary btn-block mt8" data-act="done">Start tracking</button>` : ''}
    <p class="hint mt16">Later, in Settings → Monthly plan, add your EMIs, SIPs and bills so the app can tell you how to split your salary.</p>
    </div>`,
    mount(el) {
      el.querySelector('[data-act="done"]')?.addEventListener('click', async () => { await saveSettings({ onboarded: true }); location.hash = '#/'; });
    },
  };
}

export function helpView() {
  return {
    html: html`${topbar({ back: '#/settings', backLabel: 'Settings', title: 'Tips' })}
    <div class="prose">
    <h2>Quick add (Home)</h2>
    <p>Type an amount and a word: <code>40 tea</code>, <code>450 petrol bike</code>, <code>+5000 refund</code>. A leading <code>+</code> means money in. The category is picked from its name, labels and keywords, or from what you chose last time for the same payee. It goes to your quick-add default account.</p>
    <h2>From a screenshot</h2>
    <p>Tap <b>+</b> → <b>Screenshot</b> and pick the payment screen from GPay, PhonePe, Paytm or your bank. The text is read on your phone. Check the fields, then save. Adding a note in GPay while paying (e.g. “tea”) helps the app pick the category.</p>
    <p>The UPI reference is used to warn you about duplicates.</p>
    <h2>Paste a bank SMS</h2>
    <p>Copy a debit or credit SMS, tap <b>+</b> → <b>Paste text</b> → <b>Paste from clipboard</b>.</p>
    <h2>iPhone Shortcut (optional)</h2>
    <p>In the Shortcuts app create: <b>Get Latest Screenshots</b> (1) → <b>Extract Text from Image</b> → <b>Copy to Clipboard</b>. Run it after paying, then open Spend Tracker → + → Paste text → Paste from clipboard. Uses Apple’s own text recognition.</p>
    <h2>Monthly plan</h2>
    <p><b>Commitments</b> are what you pay every month (EMIs, SIPs, insurance, bills). Tick them off as they’re paid. <b>Salary split</b> works out how much each account needs this month. <b>Planned expenses</b> warns you early when a big cost won’t be covered.</p>
    <h2>Faster tidying</h2>
    <p>Press and hold any entry for quick actions: change category, duplicate, delete. <b>Tag now</b> on Home walks you through untagged entries one by one — tap a category and the next one appears.</p>
    <h2>Insights</h2>
    <p>Pick <b>All</b> or a single account at the top. <b>Worth a look</b> lists what stands out this month. Almost every number is tappable and opens the exact entries behind it.</p>
    <h2>App lock</h2>
    <p>Settings → App lock sets a 4-digit PIN, and Face ID if your phone supports it. The app locks after a minute away. It hides the screen — it doesn’t encrypt the data — and a forgotten PIN can only be reset by erasing the app’s data, so keep backups.</p>
    <h2>Your data</h2>
    <p>Everything is stored only in this app on this phone. Opening the link in Safari shows a separate, empty copy — always use the home-screen icon. Export a backup to iCloud Drive every week or two.</p>
    </div>`,
  };
}
