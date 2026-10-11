// Router + app bootstrap.
import { state, load, subscribe } from './store.js';
import { installTooltips } from './charts.js';
import { toast } from './ui.js';
import { homeView } from './views/home.js';
import { txnFormView } from './views/txnForm.js';
import { txnsView } from './views/txns.js';
import { accountView, accountsListView, accountFormView } from './views/accounts.js';
import { commitmentsView, commitmentFormView, plannedView, plannedFormView, splitView } from './views/plan.js';
import { insightsView } from './views/insights.js';
import { settingsView, planSettingsView, categoriesView, categoryFormView, kindsView } from './views/settings.js';
import { welcomeView, helpView } from './views/welcome.js';

const routes = [
  [/^\/$/, homeView],
  [/^\/welcome$/, welcomeView],
  [/^\/add$/, txnFormView],
  [/^\/txn\/(?<id>[^/]+)$/, txnFormView],
  [/^\/txns$/, txnsView],
  [/^\/account\/(?<id>[^/]+)$/, accountView],
  [/^\/insights$/, insightsView],
  [/^\/commitments$/, commitmentsView],
  [/^\/commitments\/(?<id>[^/]+)$/, commitmentFormView],
  [/^\/planned$/, plannedView],
  [/^\/planned\/(?<id>[^/]+)$/, plannedFormView],
  [/^\/split$/, splitView],
  [/^\/settings$/, settingsView],
  [/^\/settings\/plan$/, planSettingsView],
  [/^\/settings\/accounts$/, accountsListView],
  [/^\/settings\/accounts\/(?<id>[^/]+)$/, accountFormView],
  [/^\/settings\/categories$/, categoriesView],
  [/^\/settings\/categories\/(?<id>[^/]+)$/, categoryFormView],
  [/^\/settings\/kinds$/, kindsView],
  [/^\/help$/, helpView],
];

const ONBOARDING_OK = [/^\/welcome$/, /^\/settings\/accounts\/[^/]+$/];

let current = null;
const view = document.getElementById('view');

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  const anchor = path.includes('#') ? path.split('#')[1] : null;
  return { path: path.split('#')[0] || '/', query: Object.fromEntries(new URLSearchParams(qs)), anchor };
}

function render() {
  const { path, query, anchor } = parseHash();
  if (!state.settings.onboarded && !ONBOARDING_OK.some((r) => r.test(path))) { location.replace('#/welcome'); return; }
  let match = null;
  for (const [re, fn] of routes) { const m = path.match(re); if (m) { match = { fn, params: m.groups || {} }; break; } }
  if (!match) { location.replace('#/'); return; }
  let v;
  try { v = match.fn(match.params, query); } catch (e) { console.error(e); v = { html: `<div class="empty"><div class="empty-t">Something went wrong</div><div class="empty-b">${String(e.message)}</div><a class="btn mt12" href="#/">Go home</a></div>` }; }
  current = { ...v, path, query };
  view.innerHTML = String(v.html);
  v.mount?.(view, { refresh });
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
}

function refresh() {
  if (!current) return;
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

let lastPath = null;
window.addEventListener('hashchange', () => {
  const { path } = parseHash();
  render();
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
});

// Live screens re-render when data changes; forms keep what the user is typing.
subscribe(() => { if (current?.live) refresh(); });

async function start() {
  try {
    await load();
  } catch (e) {
    console.error(e);
    view.innerHTML = '<div class="empty"><div class="empty-t">Storage is not available</div><div class="empty-b">Private browsing blocks saving data. Open the app normally.</div></div>';
    return;
  }
  installTooltips();
  lastPath = parseHash().path;
  render();
  document.documentElement.classList.add('ready');
}
start();

// ---------- service worker (offline + updates) ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const prompt = (w) => toast('A new version is ready', { action: 'Update', ms: 15000, onAction: () => w.postMessage('skipWaiting') });
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

// Expose for debugging in the console and for tests.
window.__spend = { state };
