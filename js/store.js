// In-memory state backed by IndexedDB. All writes go through here.
import * as db from './db.js';
import { uid, nowLocal } from './util.js';

export const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767', '#5598e7', '#e0a030', '#3fbf8a', '#b77fd6'];
export const NEUTRAL = '#8f8e88';

export const ACCOUNT_PURPOSES = [
  { id: 'income', label: 'Salary / income' },
  { id: 'spending', label: 'Spending' },
  { id: 'savings', label: 'Savings' },
  { id: 'investment', label: 'Investment' },
  { id: 'credit', label: 'Credit card' },
  { id: 'cash', label: 'Cash' },
  { id: 'other', label: 'Other' },
];
export const PURPOSE_COLOR = { income: '#e0a030', spending: '#3987e5', savings: '#199e70', investment: '#9085e9', credit: '#e66767', cash: '#8f8e88', other: '#6e6d68' };

export const KIND_GROUPS = [
  { id: 'spending', label: 'Counts as spending' },
  { id: 'fixed', label: 'Fixed cost (EMI, insurance…) — not spending' },
  { id: 'saving', label: 'Saving / investing — not spending' },
  { id: 'income', label: 'Money in' },
];

export const DEFAULT_KINDS = [
  { key: 'expense', name: 'Expense', group: 'spending', color: '#3987e5' },
  { key: 'loan', name: 'Loan / EMI', group: 'fixed', color: '#d95926' },
  { key: 'investment', name: 'Investment', group: 'saving', color: '#9085e9' },
  { key: 'insurance', name: 'Insurance', group: 'fixed', color: '#199e70' },
  { key: 'savings', name: 'Savings', group: 'saving', color: '#8f8e88' },
  { key: 'income', name: 'Income', group: 'income', color: '#3fbf8a' },
];

// Generic starter categories offered during setup (all editable / removable).
export const SUGGESTED_CATEGORIES = [
  { kind: 'expense', name: 'Food & dining', essential: false, keywords: ['swiggy', 'zomato', 'restaurant', 'cafe', 'hotel', 'dinner', 'lunch', 'snacks', 'tea', 'coffee'] },
  { kind: 'expense', name: 'Groceries', essential: true, keywords: ['dmart', 'bigbasket', 'blinkit', 'zepto', 'instamart', 'grocery', 'groceries', 'milk', 'vegetables', 'kirana'] },
  { kind: 'expense', name: 'Home & bills', essential: true, keywords: ['electricity', 'rent', 'maintenance', 'gas', 'cylinder', 'wifi', 'broadband', 'recharge', 'water'], labels: ['Electricity', 'Rent', 'Maintenance', 'Internet & mobile', 'Gas'] },
  { kind: 'expense', name: 'Transport', essential: true, keywords: ['uber', 'ola', 'rapido', 'metro', 'train', 'bus', 'auto', 'cab', 'irctc'] },
  { kind: 'expense', name: 'Vehicle', essential: true, keywords: ['petrol', 'diesel', 'fuel', 'service', 'hpcl', 'bpcl', 'iocl', 'indian oil', 'fastag', 'toll', 'parking'], labels: ['Petrol', 'Service', 'Parking / toll', 'Insurance'] },
  { kind: 'expense', name: 'Shopping', essential: false, keywords: ['amazon', 'flipkart', 'myntra', 'meesho', 'ajio', 'nykaa'] },
  { kind: 'expense', name: 'Health', essential: true, keywords: ['pharmacy', 'medical', 'medicine', 'hospital', 'doctor', 'apollo', 'clinic', 'lab'] },
  { kind: 'expense', name: 'Education', essential: true, keywords: ['course', 'books', 'fees', 'udemy', 'coursera', 'tuition', 'exam'] },
  { kind: 'expense', name: 'Entertainment', essential: false, keywords: ['netflix', 'movie', 'bookmyshow', 'prime', 'hotstar', 'spotify', 'youtube'] },
  { kind: 'expense', name: 'Personal', essential: false, keywords: ['salon', 'haircut', 'gym', 'clothes'] },
  { kind: 'expense', name: 'Other', essential: false, keywords: [] },
  { kind: 'income', name: 'Salary', essential: false, keywords: ['salary', 'payroll', 'consulting'] },
  { kind: 'income', name: 'Refund / cashback', essential: false, keywords: ['refund', 'cashback', 'reversal'] },
  { kind: 'income', name: 'Other income', essential: false, keywords: ['interest', 'dividend'] },
  { kind: 'investment', name: 'Mutual fund / SIP', essential: false, keywords: ['sip', 'mutual fund', 'mf', 'groww', 'zerodha', 'coin', 'kuvera'] },
  { kind: 'investment', name: 'Stocks', essential: false, keywords: ['stocks', 'shares', 'equity'] },
  { kind: 'investment', name: 'PPF / NPS', essential: false, keywords: ['ppf', 'nps'] },
  { kind: 'loan', name: 'Home loan', essential: true, keywords: ['home loan', 'hl'] },
  { kind: 'loan', name: 'Vehicle loan', essential: true, keywords: ['car loan', 'bike loan', 'bike emi', 'car emi'] },
  { kind: 'loan', name: 'Other EMI', essential: true, keywords: ['emi'] },
  { kind: 'insurance', name: 'Life / term', essential: true, keywords: ['term insurance', 'lic', 'life insurance'] },
  { kind: 'insurance', name: 'Health insurance', essential: true, keywords: ['mediclaim', 'health insurance'] },
  { kind: 'savings', name: 'Emergency fund', essential: false, keywords: ['emergency'] },
];

export const DEFAULT_SETTINGS = {
  id: 'settings',
  onboarded: false,
  hideBalances: true,
  defaultAccountId: null,
  salaryAccountId: null,
  expectedSalary: 0,
  dailyAccountId: null,
  dailyAmount: 0,
  plannedAccountId: null,
  plannedMonthly: 0,
  plannedSaved: 0,
  plannedContribMonth: null,
  leftoverSplit: [], // [{accountId, pct}]
  splitReminder: true,
  lastBackupAt: null,
  schema: 1,
};

export const state = {
  accounts: [], kinds: [], categories: [], txns: [], commitments: [], planned: [],
  settings: { ...DEFAULT_SETTINGS },
  ready: false,
};

const listeners = new Set();
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => listeners.forEach((fn) => fn());

export async function load() {
  const all = await db.loadAll();
  Object.assign(state, {
    accounts: all.accounts, kinds: all.kinds, categories: all.categories,
    txns: all.txns, commitments: all.commitments, planned: all.planned,
  });
  const s = all.meta.find((m) => m.id === 'settings');
  state.settings = { ...DEFAULT_SETTINGS, ...(s || {}) };
  sortAll();
  state.ready = true;
}

function sortAll() {
  state.accounts.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt));
  state.kinds.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  state.categories.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  state.txns.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  state.commitments.sort((a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name));
  state.planned.sort((a, b) => a.month.localeCompare(b.month));
}

const stamp = (o) => {
  const now = new Date().toISOString();
  return { ...o, id: o.id || uid(), createdAt: o.createdAt || now, updatedAt: now };
};

async function upsert(store, obj) {
  const rec = stamp(obj);
  const list = state[store];
  const i = list.findIndex((x) => x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  sortAll();
  await db.put(store, rec);
  db.requestPersistence();
  emit();
  return rec;
}
async function remove(store, id) {
  state[store] = state[store].filter((x) => x.id !== id);
  await db.del(store, id);
  emit();
}

// ---------- public API ----------
export const saveAccount = (a) => upsert('accounts', a);
export const saveKind = (k) => upsert('kinds', k);
export const saveCategory = (c) => upsert('categories', c);
export const saveTxn = (t) => upsert('txns', t);
export const saveCommitment = (c) => upsert('commitments', c);
export const savePlanned = (p) => upsert('planned', p);
export const deleteTxn = (id) => remove('txns', id);
export const deleteCommitment = (id) => remove('commitments', id);
export const deletePlanned = (id) => remove('planned', id);

export async function deleteAccount(id) {
  // Only allowed when nothing references it (enforced in UI); archive otherwise.
  await remove('accounts', id);
}
export async function deleteCategory(id) {
  // Detach transactions so they show as untagged instead of pointing nowhere.
  const affected = state.txns.filter((t) => t.categoryId === id).map((t) => ({ ...t, categoryId: null, label: null }));
  state.txns = state.txns.map((t) => (t.categoryId === id ? { ...t, categoryId: null, label: null } : t));
  if (affected.length) await db.putMany('txns', affected);
  await remove('categories', id);
}
export async function deleteKind(id) {
  await remove('kinds', id);
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.put('meta', state.settings);
  emit();
}

export async function addMany(store, objs) {
  const recs = objs.map(stamp);
  state[store].push(...recs);
  sortAll();
  await db.putMany(store, recs);
  emit();
  return recs;
}

// ---------- lookups ----------
export const account = (id) => state.accounts.find((a) => a.id === id);
export const kind = (id) => state.kinds.find((k) => k.id === id);
export const category = (id) => state.categories.find((c) => c.id === id);
export const kindByKey = (key) => state.kinds.find((k) => k.key === key);
export const activeAccounts = () => state.accounts.filter((a) => !a.archived);
export const categoriesOf = (kindId) => state.categories.filter((c) => c.kindId === kindId && !c.archived);
export const outKinds = () => state.kinds.filter((k) => k.group !== 'income');
export const incomeKind = () => state.kinds.find((k) => k.group === 'income');

// ---------- setup ----------
export async function createDefaults(selectedCategoryNames) {
  if (!state.kinds.length) {
    await addMany('kinds', DEFAULT_KINDS.map((k, i) => ({ ...k, order: i })));
  }
  const byKey = Object.fromEntries(state.kinds.map((k) => [k.key, k]));
  const chosen = SUGGESTED_CATEGORIES.filter((c) => selectedCategoryNames.includes(c.name));
  const counters = {};
  const cats = chosen.map((c) => {
    const k = byKey[c.kind];
    const n = (counters[k.id] = (counters[k.id] ?? state.categories.filter((x) => x.kindId === k.id).length) + 1);
    return {
      kindId: k.id, name: c.name, essential: c.essential, keywords: c.keywords, labels: c.labels || [],
      color: k.group === 'spending' ? PALETTE[(n - 1) % PALETTE.length] : k.color, budget: 0, order: n,
    };
  });
  if (cats.length) await addMany('categories', cats);
}

// ---------- backup ----------
export function exportData() {
  return {
    app: 'spend-tracker', version: 1, exportedAt: new Date().toISOString(),
    accounts: state.accounts, kinds: state.kinds, categories: state.categories,
    txns: state.txns, commitments: state.commitments, planned: state.planned,
    meta: [state.settings],
  };
}

export function validateBackup(data) {
  if (!data || data.app !== 'spend-tracker') return 'This file is not a Spend Tracker backup.';
  for (const s of ['accounts', 'kinds', 'categories', 'txns']) if (!Array.isArray(data[s])) return `Backup is missing “${s}”.`;
  return null;
}

/** Replace everything, or merge records whose ids are new. A "starter" file may carry only kinds/categories. */
export async function importData(data, mode = 'replace') {
  const err = validateBackup(data);
  if (err) throw new Error(err);
  const incoming = {
    accounts: data.accounts, kinds: data.kinds, categories: data.categories, txns: data.txns,
    commitments: data.commitments || [], planned: data.planned || [], meta: data.meta || [],
  };
  if (mode === 'merge') {
    for (const s of ['accounts', 'kinds', 'categories', 'txns', 'commitments', 'planned']) {
      const have = new Set(state[s].map((x) => x.id));
      const add = incoming[s].filter((x) => !have.has(x.id));
      if (add.length) { state[s].push(...add); await db.putMany(s, add); }
    }
    sortAll();
    emit();
    return;
  }
  const settings = { ...DEFAULT_SETTINGS, ...(incoming.meta.find((m) => m.id === 'settings') || {}), onboarded: incoming.accounts.length > 0 };
  incoming.meta = [settings];
  await db.replaceAll(incoming);
  await load();
  emit();
}

export async function eraseEverything() {
  await db.replaceAll({});
  await load();
  emit();
}

export { nowLocal };
