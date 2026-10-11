// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick, parsePaymentText, suggestCategory } from '../js/parse.js';
import { balance, monthSummary, pace, commitmentStatus, salarySplit, plannedProjection, compareToPrevious } from '../js/calc.js';
import { money, moneyShort, parseAmount, addMonths, monthDiff } from '../js/util.js';

const NOW = '2026-10-11T21:50';

function fixture() {
  const kinds = [
    { id: 'k-exp', name: 'Expense', group: 'spending' },
    { id: 'k-loan', name: 'Loan / EMI', group: 'fixed' },
    { id: 'k-inv', name: 'Investment', group: 'saving' },
    { id: 'k-in', name: 'Income', group: 'income' },
  ];
  const categories = [
    { id: 'c-tu', kindId: 'k-exp', name: 'Thumbs Up', keywords: ['thumbsup', 'thums up'], labels: [], budget: 50000 },
    { id: 'c-food', kindId: 'k-exp', name: 'Outside food', keywords: ['swiggy', 'zomato'], labels: [], budget: 300000 },
    { id: 'c-bike', kindId: 'k-exp', name: 'Bike expense', keywords: ['bike'], labels: ['Petrol', 'Service'], budget: 200000 },
    { id: 'c-car', kindId: 'k-exp', name: 'Car expense', keywords: ['car'], labels: ['Petrol', 'Service'], budget: 0 },
    { id: 'c-sal', kindId: 'k-in', name: 'Salary', keywords: ['salary'], labels: [] },
    { id: 'c-sip', kindId: 'k-inv', name: 'SIP', keywords: ['sip'], labels: [] },
  ];
  const accounts = [
    { id: 'a-sal', name: 'Pay', purpose: 'income', openingBalance: 1000000, openingAt: '2026-09-30T23:59', last4: '1111', createdAt: '1' },
    { id: 'a-spend', name: 'Daily', purpose: 'spending', openingBalance: 0, openingAt: '2026-09-30T23:59', last4: '2222', createdAt: '2' },
    { id: 'a-inv', name: 'Invest', purpose: 'investment', openingBalance: 0, openingAt: '2026-09-30T23:59', createdAt: '3' },
  ];
  const txns = [
    { id: 't1', type: 'in', amount: 8500000, accountId: 'a-sal', kindId: 'k-in', categoryId: 'c-sal', date: '2026-10-01T10:00', createdAt: 'x' },
    { id: 't2', type: 'transfer', amount: 2000000, accountId: 'a-sal', toAccountId: 'a-spend', date: '2026-10-01T11:00', createdAt: 'x' },
    { id: 't3', type: 'out', amount: 4000, accountId: 'a-spend', kindId: 'k-exp', categoryId: 'c-tu', payee: 'Sharma Store', vpa: 'sharma@okaxis', date: '2026-10-05T21:00', essential: false, createdAt: 'x' },
    { id: 't4', type: 'out', amount: 50000, accountId: 'a-spend', kindId: 'k-exp', categoryId: 'c-bike', label: 'Petrol', date: '2026-10-06T20:00', essential: true, createdAt: 'x' },
    { id: 't5', type: 'out', amount: 1800000, accountId: 'a-sal', kindId: 'k-loan', commitmentId: 'cm-hl', commitmentMonth: '2026-10', date: '2026-10-05T09:00', createdAt: 'x' },
    { id: 't6', type: 'out', amount: 30000, accountId: 'a-spend', kindId: 'k-exp', categoryId: null, payee: 'paytmqr123', date: '2026-10-07T12:00', createdAt: 'x' },
    { id: 't7', type: 'out', amount: 100000, accountId: 'a-spend', kindId: 'k-exp', categoryId: 'c-food', date: '2026-09-05T12:00', createdAt: 'x' },
    { id: 't8', type: 'out', amount: 999999, accountId: 'a-sal', kindId: 'k-exp', date: '2026-09-20T12:00', createdAt: 'x' }, // before opening — ignored in balance
  ];
  const commitments = [
    { id: 'cm-hl', name: 'Home loan EMI', amount: 1800000, kindId: 'k-loan', accountId: 'a-sal', dueDay: 5 },
    { id: 'cm-sip', name: 'Index SIP', amount: 1000000, kindId: 'k-inv', accountId: 'a-inv', dueDay: 10 },
    { id: 'cm-old', name: 'Ended EMI', amount: 100000, kindId: 'k-loan', accountId: 'a-sal', dueDay: 3, endMonth: '2026-08' },
  ];
  const settings = { salaryAccountId: 'a-sal', expectedSalary: 8500000, dailyAccountId: 'a-spend', dailyAmount: 1500000, plannedAccountId: null, plannedMonthly: 1000000, plannedSaved: 1000000, plannedContribMonth: null, leftoverSplit: [] };
  const planned = [
    { id: 'p1', name: 'Insurance', amount: 1400000, month: '2026-11' },
    { id: 'p2', name: 'Trip', amount: 4500000, month: '2027-01' },
  ];
  return { kinds, categories, accounts, txns, commitments, settings, planned };
}

test('money formatting uses Indian grouping', () => {
  assert.equal(money(12345600), '₹1,23,456');
  assert.equal(money(-4000), '−₹40');
  assert.equal(money(4050), '₹40.50');
  assert.equal(money(500000, { sign: true }), '+₹5,000');
  assert.equal(moneyShort(4210000), '₹42.1k');
  assert.equal(moneyShort(15000000), '₹1.5L');
  assert.equal(parseAmount('₹1,250.50'), 125050);
  assert.equal(parseAmount('abc'), null);
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(monthDiff('2026-10', '2027-01'), 3);
});

test('quick add parses amount, sign, category and label', () => {
  const st = fixture();
  assert.deepEqual(parseQuick(st, '40 thumbsup'), { amount: 4000, direction: 'out', note: 'thumbsup', categoryId: 'c-tu', kindId: 'k-exp', label: null });
  const inc = parseQuick(st, '+5000 salary');
  assert.equal(inc.direction, 'in'); assert.equal(inc.amount, 500000); assert.equal(inc.categoryId, 'c-sal');
  const bike = parseQuick(st, '450 petrol bike');
  assert.equal(bike.categoryId, 'c-bike'); assert.equal(bike.label, 'Petrol');
  const car = parseQuick(st, '2000 car petrol');
  assert.equal(car.categoryId, 'c-car'); assert.equal(car.label, 'Petrol');
  assert.equal(parseQuick(st, '1,250.50 swiggy').amount, 125050);
  assert.equal(parseQuick(st, '99').categoryId, undefined);
  assert.equal(parseQuick(st, 'hello'), null);
  assert.equal(parseQuick(st, 'thums up 40').categoryId, 'c-tu');
});

test('suggestion learns from past payees', () => {
  const st = fixture();
  const s = suggestCategory(st, { payee: 'Sharma Store' });
  assert.equal(s.categoryId, 'c-tu'); assert.equal(s.source, 'history');
  assert.equal(suggestCategory(st, { vpa: 'SHARMA@okaxis' }).categoryId, 'c-tu');
});

test('parses a Google Pay style screenshot', () => {
  const st = fixture();
  const text = `9:43\n₹40\nthumbsup\nCompleted\n11 Oct 2026, 9:42 pm\nTo: Sharma General Store\nsharma.store@okaxis\nFrom: Mayank (HDFC Bank)\nXXXXXX2222\nUPI transaction ID\n528112345678\nGoogle transaction ID\nCICAgKDp8aXyQw`;
  const r = parsePaymentText(st, text, NOW);
  assert.equal(r.amount, 4000);
  assert.equal(r.direction, 'out');
  assert.equal(r.note, 'thumbsup');
  assert.equal(r.payee, 'Sharma General Store');
  assert.equal(r.vpa, 'sharma.store@okaxis');
  assert.equal(r.upiRef, '528112345678');
  assert.equal(r.date, '2026-10-11T21:42');
  assert.equal(r.accountId, 'a-spend');
  assert.equal(r.categoryId, 'c-tu');
  assert.equal(r.app, 'Google Pay');
});

test('parses PhonePe and Paytm style text', () => {
  const st = fixture();
  const pp = parsePaymentText(st, `Paid to\nHP Petrol Pump\n₹500\nTransaction Successful\n08:15 pm on 10 Oct 2026\nTransaction ID T2610102015\nUTR: 528198765432\nDebited from XXXXXXXX2222\nPhonePe`, NOW);
  assert.equal(pp.amount, 50000); assert.equal(pp.payee, 'HP Petrol Pump'); assert.equal(pp.upiRef, '528198765432');
  assert.equal(pp.date, '2026-10-10T20:15'); assert.equal(pp.accountId, 'a-spend'); assert.equal(pp.app, 'PhonePe');
  const pt = parsePaymentText(st, `Paid Successfully to\nSwiggy\n₹ 1,386.50\nUPI Ref No: 528100001111\n10 Oct 2026, 09:30 PM\nFrom: HDFC Bank - 1111\nPaytm`, NOW);
  assert.equal(pt.amount, 138650); assert.equal(pt.payee, 'Swiggy'); assert.equal(pt.categoryId, 'c-food'); assert.equal(pt.accountId, 'a-sal');
});

test('parses bank SMS (debit and credit)', () => {
  const st = fixture();
  const d = parsePaymentText(st, 'Rs.386.00 debited from A/c XX2222 on 11-10-26 to VPA paytmqr28100505@paytm (UPI Ref No 528112349999). Not you? Call 1800', NOW);
  assert.equal(d.amount, 38600); assert.equal(d.direction, 'out'); assert.equal(d.vpa, 'paytmqr28100505@paytm');
  assert.equal(d.upiRef, '528112349999'); assert.equal(d.accountId, 'a-spend'); assert.equal(d.date.slice(0, 10), '2026-10-11');
  const c = parsePaymentText(st, 'Dear Customer, INR 85,000.00 credited to your A/c XX1111 on 01-Oct-26 by NEFT from AIRFI. Avl Bal INR 1,00,000', NOW);
  assert.equal(c.amount, 8500000); assert.equal(c.direction, 'in'); assert.equal(c.accountId, 'a-sal'); assert.equal(c.date.slice(0, 10), '2026-10-01');
});

test('duplicate UPI ref is flagged', () => {
  const st = fixture();
  st.txns.push({ id: 'dup', type: 'out', amount: 4000, upiRef: '528112345678', date: '2026-10-11T21:42', createdAt: 'x' });
  assert.equal(parsePaymentText(st, '₹40\nUPI transaction ID 528112345678', NOW).duplicateId, 'dup');
});

test('balances respect opening date and transfers', () => {
  const st = fixture();
  assert.equal(balance(st, 'a-sal'), 1000000 + 8500000 - 2000000 - 1800000);
  assert.equal(balance(st, 'a-spend'), 2000000 - 4000 - 50000 - 30000);
});

test('month summary separates spending, fixed, saving and income', () => {
  const st = fixture();
  const s = monthSummary(st, '2026-10');
  assert.equal(s.spent, 4000 + 50000 + 30000);
  assert.equal(s.fixed, 1800000);
  assert.equal(s.income, 8500000);
  assert.equal(s.untagged, 1);
  assert.equal(s.essential, 50000);
  assert.equal(s.savingsRate, Math.round(((8500000 - 84000 - 1800000) / 8500000) * 100));
  const p = pace(st, '2026-10', NOW);
  assert.equal(p.elapsed, 11);
  assert.equal(p.budget, 550000);
  assert.equal(p.safePerDay, Math.floor((550000 - 84000) / 21 / 100) * 100);
  const cmp = compareToPrevious(st, '2026-10', NOW);
  assert.equal(cmp.prevSpent, 100000); // Sep 1–11 only
});

test('commitment status by month', () => {
  const st = fixture();
  const c = commitmentStatus(st, '2026-10');
  assert.equal(c.count, 2); // ended one excluded
  assert.equal(c.paidCount, 1);
  assert.equal(c.dueTotal, 1000000);
  assert.equal(c.next.c.id, 'cm-sip');
});

test('salary split is driven by commitments and daily money', () => {
  const st = fixture();
  const s = salarySplit(st, '2026-10');
  assert.equal(s.salary, 8500000);
  assert.equal(s.stays.needed, 1800000);
  const spend = s.rows.find((r) => r.accountId === 'a-spend');
  assert.equal(spend.needed, 1500000); assert.equal(spend.moved, 2000000); assert.equal(spend.toMove, 0);
  const inv = s.rows.find((r) => r.accountId === 'a-inv');
  assert.equal(inv.toMove, 1000000);
  assert.equal(s.leftover, 8500000 - 1800000 - 1500000 - 1000000);
  st.settings.leftoverSplit = [{ accountId: 'a-inv', pct: 50 }];
  const s2 = salarySplit(st, '2026-10');
  assert.equal(s2.rows.find((r) => r.accountId === 'a-inv').needed, 1000000 + Math.floor(4200000 / 2));
});

test('planned projection finds the short month and the fix', () => {
  const st = fixture();
  const p = plannedProjection(st, '2026-10');
  // Oct +10k → 20k; Nov +10k → 30k −14k = 16k; Dec +10k → 26k; Jan +10k → 36k −45k = −9k
  assert.deepEqual(p.rows.map((r) => [r.mk, r.fundEnd]), [['2026-11', 1600000], ['2027-01', -900000]]);
  assert.deepEqual(p.firstShort, { mk: '2027-01', short: 900000 });
  assert.equal(p.requiredMonthly, Math.ceil((5900000 - 1000000) / 4));
  st.settings.plannedMonthly = p.requiredMonthly;
  assert.equal(plannedProjection(st, '2026-10').firstShort, null);
});

test('real OCR output from a GPay screen (₹ lost or read as R)', () => {
  const st = fixture();
  const a = parsePaymentText(st, '9:43\n\nTo Sharma General Store\n\n40\n\nthumbsup\n\nv Completed\n11 Oct 2026, 9:42 pm\n\nTo: Sharma General Store\nsharma.store @okaxis\n\nFrom: Mayank Rai (HDFC Bank)\nXXXXXX2222\n\nUPI transaction ID\n528112345678\n', NOW);
  assert.equal(a.amount, 4000); assert.equal(a.note, 'thumbsup'); assert.equal(a.vpa, 'sharma.store@okaxis');
  assert.equal(a.payee, 'Sharma General Store'); assert.equal(a.categoryId, 'c-tu'); assert.equal(a.date, '2026-10-11T21:42');
  const b = parsePaymentText(st, 'To Swiggy\nR1,386\nCompleted\n', NOW);
  assert.equal(b.amount, 138600);
});

test('entries added in the same minute as the opening balance still count', () => {
  const st = fixture();
  st.accounts.push({ id: 'a-new', openingBalance: 500000, openingAt: '2026-10-11T23:11', openingSetAt: '2026-10-11T17:41:05.000Z', createdAt: '2026-10-11T17:41:05.000Z' });
  st.txns.push({ id: 'n1', type: 'out', amount: 4000, accountId: 'a-new', date: '2026-10-11T23:11', createdAt: '2026-10-11T17:41:30.000Z' });
  st.txns.push({ id: 'n2', type: 'out', amount: 1000, accountId: 'a-new', date: '2026-10-11T23:11', createdAt: '2026-10-11T17:40:00.000Z' }); // typed before the balance
  st.txns.push({ id: 'n3', type: 'out', amount: 2000, accountId: 'a-new', date: '2026-10-11T22:00', createdAt: '2026-10-11T17:42:00.000Z' }); // earlier today
  assert.equal(balance(st, 'a-new'), 500000 - 4000);
});
