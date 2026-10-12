import test from 'node:test';
import assert from 'node:assert/strict';
import { vsUsual, smallSpends, repeatPayments, budgetBurn, burden, unlogged, accountFlow, balanceTrend, spendTiming, spikeDays, newPayees, scope } from '../js/calc.js';
import { findings } from '../js/findings.js';

const NOW = '2026-10-15T20:00';
const k = [
  { id: 'exp', key: 'expense', name: 'Expense', group: 'spending' },
  { id: 'loan', key: 'loan', name: 'Loan / EMI', group: 'fixed' },
  { id: 'inv', key: 'investment', name: 'Investment', group: 'saving' },
  { id: 'inc', key: 'income', name: 'Income', group: 'income' },
];
const cats = [
  { id: 'food', kindId: 'exp', name: 'Outside food', budget: 300000, keywords: [], labels: [] },
  { id: 'tea', kindId: 'exp', name: 'Thumbs Up', budget: 50000, keywords: [], labels: [] },
];
let n = 0;
const T = (o) => ({ id: 't' + n++, createdAt: 'x', type: 'out', kindId: 'exp', accountId: 'spend', essential: false, ...o });
function st() {
  n = 0;
  const txns = [];
  // three past months: food 3000/month, netflix 649 each month
  for (const m of ['2026-07', '2026-08', '2026-09']) {
    txns.push(T({ amount: 300000, categoryId: 'food', date: `${m}-10T13:00`, payee: 'Swiggy' }));
    txns.push(T({ amount: 64900, categoryId: null, date: `${m}-05T09:00`, payee: 'Netflix' }));
    txns.push(T({ type: 'in', kindId: 'inc', amount: 8500000, accountId: 'sal', date: `${m}-01T10:00` }));
  }
  // October so far (15 days): food 7000 vs a usual 3000 by this date, 12 small teas of 40
  txns.push(T({ amount: 700000, categoryId: 'food', date: '2026-10-12T23:30', payee: 'Zomato' }));
  for (let d = 1; d <= 12; d++) txns.push(T({ amount: 4000, categoryId: 'tea', date: `2026-10-${String(d).padStart(2, '0')}T17:00`, payee: 'Sharma Store' }));
  txns.push(T({ amount: 64900, categoryId: null, date: '2026-10-05T09:00', payee: 'Netflix' }));
  txns.push(T({ type: 'in', kindId: 'inc', amount: 8500000, accountId: 'sal', date: '2026-10-01T10:00' }));
  txns.push(T({ type: 'transfer', amount: 2000000, accountId: 'sal', toAccountId: 'spend', date: '2026-10-01T11:00' }));
  txns.push(T({ type: 'transfer', amount: 500000, accountId: 'save', toAccountId: 'spend', date: '2026-10-03T11:00' }));
  txns.push(T({ type: 'adjust', amount: -230000, accountId: 'spend', date: '2026-10-14T11:00' }));
  return {
    kinds: k, categories: cats, txns,
    accounts: [
      { id: 'sal', name: 'Salary', purpose: 'income', openingBalance: 0, openingAt: '2026-06-30T23:59', createdAt: '1' },
      { id: 'spend', name: 'Daily', purpose: 'spending', openingBalance: 0, openingAt: '2026-06-30T23:59', createdAt: '2' },
      { id: 'save', name: 'Savings', purpose: 'savings', openingBalance: 1000000, openingAt: '2026-06-30T23:59', createdAt: '3' },
    ],
    commitments: [{ id: 'hl', name: 'Home loan', amount: 3600000, kindId: 'loan', accountId: 'sal', dueDay: 5 }, { id: 'sip', name: 'SIP', amount: 1000000, kindId: 'inv', accountId: 'sal', dueDay: 10 }],
    planned: [], settings: {},
  };
}

test('vs usual pro-rates the 3-month average', () => {
  const v = vsUsual(st(), '2026-10', NOW);
  assert.equal(v.months, 3);
  assert.equal(v.rows.food.usualMonth, 300000);
  assert.equal(v.rows.food.expected, 300000); // food always lands on the 10th, before day 15
  assert.equal(v.rows.food.change, 133);
});

test('small spends, repeats, burn date', () => {
  const s = st();
  const sm = smallSpends(s, '2026-10');
  assert.equal(sm.count, 12); assert.equal(sm.total, 48000); assert.equal(sm.byCategory[0][0], 'tea');
  const reps = repeatPayments(s, '2026-10');
  const nf = reps.find((r) => r.key === 'netflix');
  assert.equal(nf.monthsSeen, 3); assert.equal(nf.monthly, 64900); assert.ok(nf.steady);
  const burn = budgetBurn(s, '2026-10', NOW);
  const tea = burn.find((b) => b.c.id === 'tea');
  assert.equal(tea.spent, 48000); assert.equal(tea.over, false); assert.equal(tea.crossDay, 16); // 3200/day → crosses on the 16th
  assert.equal(burn.find((b) => b.c.id === 'food').over, true);
});

test('burden, unlogged, flows, balance trend', () => {
  const s = st();
  const b = burden(s, '2026-10');
  assert.equal(b.income, 8500000); assert.equal(b.loans, 3600000); assert.equal(b.loanPct, 42); assert.equal(b.committedPct, 54);
  assert.deepEqual(unlogged(s, '2026-10'), { missingOut: 230000, missingIn: 0, count: 1 });
  const f = accountFlow(s, 'spend', '2026-10');
  assert.equal(f.transfersIn, 2500000); assert.equal(f.from.save, 500000); assert.equal(f.spent, 700000 + 48000 + 64900);
  const sv = accountFlow(s, 'save', '2026-10');
  assert.equal(sv.transfersOut, 500000); assert.equal(sv.net, -500000);
  const tr = balanceTrend(s, ['save'], '2026-10', 6, NOW);
  assert.equal(tr[0].value, null); // May — before the account existed
  assert.equal(tr[5].value, 500000);
  assert.equal(scope(s, 'save').txns.length, 1);
});

test('timing, spikes, new payees', () => {
  const s = st();
  const tm = spendTiming(s, '2026-10', NOW);
  assert.equal(tm.late, 700000); assert.equal(tm.lateCount, 1);
  const sp = spikeDays(s, '2026-10', NOW);
  assert.equal(sp[0].day, '2026-10-12');
  const np = newPayees(s, '2026-10');
  assert.equal(np.count, 2); // Zomato and Sharma Store are new; Netflix is not
});

test('findings surface the real issues first', () => {
  const s = st();
  const f = findings(s, '2026-10', { today: NOW });
  const texts = f.map((x) => x.text).join('\n');
  assert.match(texts, /EMIs take 42% of your income/);
  assert.match(texts, /Outside food is (\d+% above|[\d.]+×) your usual/);
  assert.match(texts, /At this pace Thumbs Up crosses its ₹500 budget on 16 Oct/);
  assert.match(texts, /₹2,300 left your accounts without an entry/);
  assert.match(texts, /small payments/);
  assert.match(texts, /4 entries need a category/);
  assert.equal(f[0].level, 'high');
  const save = findings(s, '2026-10', { accountId: 'save', today: NOW });
  assert.match(save[0].text, /₹5,000 was taken out of this account/);
});
