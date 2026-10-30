import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSmsBatch, splitMessages, smsPayee, parseCardStatement, statementCandidates, markDuplicates, statementOpening, parseEmiSchedule, readCardDocument, cardPatchFromStatement, rowEffect } from '../js/importers.js';
import { balance, cardStatus, afterCardDues, burden, unlogged, eventSummary, eventForDate, monthSummary, categoryDetail, cardBillsDue, commitmentsDueNow } from '../js/calc.js';
import { suggestCategory } from '../js/parse.js';

const kinds = [{ id: 'k-exp', key: 'expense', name: 'Expense', group: 'spending' }, { id: 'k-loan', key: 'loan', name: 'Loan / EMI', group: 'fixed' }, { id: 'k-in', name: 'Income', group: 'income' }];
const categories = [
  { id: 'c-veh', kindId: 'k-exp', name: 'Bike', keywords: ['hpcl'], labels: ['Petrol', 'Service'] },
  { id: 'c-food', kindId: 'k-exp', name: 'Outside food', keywords: ['zomato', 'swiggy'], labels: [] },
  { id: 'c-travel', kindId: 'k-exp', name: 'Travel', keywords: ['makemytrip', 'vietjet'], labels: [] },
];
const st0 = () => ({
  kinds, categories,
  accounts: [
    { id: 'canara', name: 'Canara', purpose: 'spending', last4: '2360', openingBalance: 400000, openingAt: '2026-10-01T00:00', createdAt: 'a' },
    { id: 'icici', name: 'ICICI', purpose: 'income', last4: '7853', openingBalance: 10000000, openingAt: '2026-10-01T00:00', createdAt: 'b' },
    { id: 'card', name: 'ICICI card', purpose: 'credit', last4: '8005', openingBalance: -233728, openingAt: '2026-09-10T23:59', payFromId: 'icici', limit: 95000000, createdAt: 'c' },
  ],
  txns: [], commitments: [], planned: [], events: [], settings: {},
});

test('Canara credit SMS: amount, account, payer, UPI ref and balance', () => {
  const [c] = parseSmsBatch(st0(), 'Dear Customer, Acct XXXX2360 credited with INR 332.00 on 18/10/26 from ROHIT TIWARI; UPI:629123655501; Bal INR 5,043.20-CanaraBank', '2026-10-30T10:00');
  assert.equal(c.type, 'in');
  assert.equal(c.amount, 33200);
  assert.equal(c.accountId, 'canara');
  assert.equal(c.payee, 'ROHIT TIWARI');
  assert.equal(c.upiRef, '629123655501');
  assert.equal(c.balanceAfter, 504320);
  assert.equal(c.date.slice(0, 10), '2026-10-18');
});

test('SMS batch: split, skip OTP, pair a transfer between own accounts', () => {
  const text = `2026-10-19T09:10:00+05:30
Rs.250.00 debited from A/c XX2360 on 19-10-26 to VPA zomato@hdfc (UPI Ref No 629212345678). Not you? Call 1800-Canara Bank
---
2026-10-20T10:00:00+05:30
Dear Customer, Acct XXXX7853 debited with INR 5,000.00 on 20/10/26 to Mayank; UPI:629300000001
---
2026-10-20T10:01:00+05:30
Dear Customer, Acct XXXX2360 credited with INR 5,000.00 on 20/10/26 from MAYANK RAI; UPI:629300000002; Bal INR 9,923.20-CanaraBank
---
2026-10-21T10:00:00+05:30
123456 is your OTP for transaction. Do not share it with anyone.`;
  assert.equal(splitMessages(text).length, 4);
  const list = parseSmsBatch(st0(), text, '2026-10-30T10:00');
  assert.equal(list.length, 2);
  assert.equal(list[0].type, 'out');
  assert.equal(list[0].categoryId, 'c-food');
  assert.equal(list[1].type, 'transfer');
  assert.equal(list[1].accountId, 'icici');
  assert.equal(list[1].toAccountId, 'canara');
});

test('SMS payee shapes', () => {
  assert.equal(smsPayee('INR 120.00 DEBITED to your account XXX2360 towards UPI/629212345678/Thumbs up shop/q123@ybl. Bal INR 4,923.20'), 'Thumbs up shop');
  assert.equal(smsPayee('INR 1,200.00 spent on ICICI Bank Card XX8005 on 21-Oct-26 at HPCL PETROL PUMP. Avl Limit: INR 9,00,000.00'), 'HPCL PETROL PUMP');
});

test('a label matches the start of a word (petroleum → Petrol)', () => {
  const s = suggestCategory(st0(), { text: 'BHARAT PETROLEUM CORP', direction: 'out' });
  assert.equal(s.categoryId, 'c-veh');
  assert.equal(s.label, 'Petrol');
});

test('already-imported SMS and same UPI ref are flagged', () => {
  const st = st0();
  const sms = 'Dear Customer, Acct XXXX2360 credited with INR 332.00 on 18/10/26 from ROHIT TIWARI; UPI:629123655501; Bal INR 5,043.20-CanaraBank';
  const [c] = parseSmsBatch(st, sms);
  st.txns.push({ id: 't', type: 'in', amount: 33200, accountId: 'canara', date: '2026-10-18T14:00', importKey: c.key, createdAt: 'x' });
  const [again] = markDuplicates(st, parseSmsBatch(st, sms));
  assert.equal(again.duplicate, 'Already imported');
  assert.equal(again.selected, false);
});

// A trimmed ICICI statement in the shape pdf.js gives us.
const ICICI = [
  'ICICI Bank Credit Card Statement',
  'STATEMENT DATE  October 10, 2026',
  'Statement period : September 11, 2026 to October 10, 2026',
  'PAYMENT DUE DATE',
  'October 28, 2026',
  'Total Amount due',
  '24,192.47',
  'Minimum Amount due',
  '10,130.00',
  'Credit Limit (Including cash)',
  '9,50,000.00',
  '4748XXXXXXXX8005',
  '27/09/2026  12345678901  BBPS Payment received  0  2,337.28 CR',
  '05/10/2026  12345678902  MAKEMYTRIP INDIA PVT LTD NEW DELHI IN  95  47,595.00',
  '05/10/2026  12345678903  MAKEMYTRIP INDIA PVT LTD NEW DELHI IN  0  47,595.00 CR',
  '05/10/2026  12345678904  MAKEMYTRIP INDIA PVT LTD NEW DELHI IN  0  299.00',
  '06/10/2026  12345678905  VIETJET AIR HA NOI VN  25  12,533.80',
  '10/10/2026  12345678906  PRINCIPAL AMOUNT AMORTIZATION - <1/6>  0  7,672.33',
  '10/10/2026  12345678907  INTEREST AMOUNT AMORTIZATION - <1/6>  0  634.20',
  '10/10/2026  12345678908  IGST-CI@18%  0  168.96',
  '15/01/2019  12345678909  SAMPLE OLD TABLE ROW  0  999.00',
  'EMI / PERSONAL LOAN ON CREDIT CARDS',
  'Merchant EMI  05/10/2026  05/03/2027  6  47,595.00  5  41,532.66  8,306.53',
];

test('ICICI statement: dates, totals, rows and kinds', () => {
  const p = parseCardStatement(ICICI);
  assert.equal(p.bank, 'ICICI');
  assert.equal(p.last4, '8005');
  assert.equal(p.statementDate, '2026-10-10');
  assert.equal(p.dueDate, '2026-10-28');
  assert.equal(p.totalDue, 2419247);
  assert.equal(p.limit, 95000000);
  const kindsOf = p.rows.map((r) => r.kind);
  assert.deepEqual(kindsOf, ['payment', 'purchase', 'emi-conversion', 'fee', 'purchase', 'emi-principal', 'fee', 'fee']);
  assert.equal(readCardDocument(ICICI).type, 'statement');
});

test('statement candidates: payment is a transfer, EMI moves are corrections, fees go to the fee category', () => {
  const st = st0();
  const p = parseCardStatement(ICICI);
  const c = statementCandidates(st, p, 'card', { feeCategoryId: 'c-fee' });
  const pay = c.find((x) => x.statementKind === 'payment');
  assert.equal(pay.type, 'transfer'); assert.equal(pay.accountId, 'icici'); assert.equal(pay.toAccountId, 'card');
  assert.equal(c.find((x) => x.statementKind === 'emi-principal').amount, -767233);
  assert.equal(c.find((x) => x.statementKind === 'emi-conversion').amount, 4759500);
  assert.ok(c.filter((x) => x.statementKind === 'fee').every((x) => x.categoryId === 'c-fee'));
  assert.equal(c.find((x) => x.payee === 'VietJet Air').categoryId, 'c-travel');
});

test('opening balance worked back from the total due matches the card', () => {
  const p = parseCardStatement(ICICI);
  const eff = p.rows.reduce((a, r) => a + rowEffect(r), 0);
  assert.equal(statementOpening(p), -p.totalDue - eff);
  // Importing every row onto a card opened at that balance lands on the total due.
  const st = st0();
  st.accounts[2].openingBalance = statementOpening(p);
  const cands = statementCandidates(st, p, 'card', {});
  st.txns = cands.map((x, i) => ({ id: 'i' + i, ...x, amount: x.type === 'adjust' ? x.amount : Math.abs(x.amount), createdAt: 'z' }));
  assert.equal(balance(st, 'card', '2026-10-10'), -p.totalDue);
});

test('card status: billed, paid, unbilled and money left after card dues', () => {
  const st = st0();
  const p = parseCardStatement(ICICI);
  st.accounts[2] = cardPatchFromStatement({ ...st.accounts[2], openingBalance: -p.totalDue, openingAt: '2026-10-10T23:59' }, p);
  st.txns.push({ id: 'p1', type: 'out', amount: 200000, accountId: 'card', kindId: 'k-exp', categoryId: 'c-veh', label: 'Petrol', date: '2026-10-15T10:00', createdAt: 'x' });
  let s = cardStatus(st, 'card', '2026-10-20T10:00');
  assert.equal(s.owed, 2619247);
  assert.equal(s.dueLeft, 2419247);
  assert.equal(s.unbilled, 200000);
  assert.equal(s.daysToDue, 8);
  assert.equal(s.emis.length, 1);
  assert.equal(cardBillsDue(st, '2026-10-20T10:00').length, 1);
  const d = afterCardDues(st, 'icici', '2026-10-20T10:00');
  assert.equal(d.after, 10000000 - 2619247);
  st.txns.push({ id: 'p2', type: 'transfer', amount: 2419247, accountId: 'icici', toAccountId: 'card', date: '2026-10-27T10:00', createdAt: 'x' });
  s = cardStatus(st, 'card', '2026-10-28T10:00');
  assert.equal(s.dueLeft, 0);
  assert.equal(cardBillsDue(st, '2026-10-28T10:00').length, 0);
  // Card EMIs count in the EMI burden; EMI corrections aren't "unlogged money".
  assert.equal(burden(st, '2026-11').cardEmi, 830653);
  st.txns.push({ id: 'e1', type: 'adjust', amount: -767233, accountId: 'card', source: 'card-emi', date: '2026-10-10T12:00', createdAt: 'x' });
  assert.equal(unlogged(st, '2026-10').count, 0);
});

test('EMI schedule PDF is recognised, not mistaken for a statement', () => {
  const lines = ['A m o r t i z a t i o n  S c h e d u l e', 'File No. :  98838667  Card No. :  4748XXXXXXXX8005  IRR :  15.99%', 'TXN Date :  05-Oct-2026  Foreclosure Fee :  3%  Processing Fee :  299.00',
    '1  05-Oct-2026  8,306.53  7,672.33  634.20  57.08  57.08  39,922.67', '2  05-Nov-2026  8,306.53  7,774.56  531.97  47.88  47.88  32,148.11'];
  const d = readCardDocument(lines);
  assert.equal(d.type, 'emi-schedule');
  assert.equal(d.schedule.rate, 15.99);
  assert.equal(d.schedule.rows[1].balance, 3214811);
  assert.equal(parseEmiSchedule(ICICI), null);
});

test('events: auto-link by date, before/during/after, exclude from monthly insights', () => {
  const st = st0();
  const ev = { id: 'vn', name: 'Vietnam', start: '2026-12-02T20:00', end: '2026-12-11T01:00', budget: 25000000 };
  st.events = [ev];
  assert.equal(eventForDate(st, '2026-12-05T10:00')?.id, 'vn');
  assert.equal(eventForDate(st, '2026-12-12T10:00'), null);
  st.txns.push(
    { id: 'f', type: 'out', amount: 4759500, accountId: 'card', kindId: 'k-exp', categoryId: 'c-travel', eventId: 'vn', date: '2026-10-05T12:00', createdAt: 'x' },
    { id: 'd', type: 'out', amount: 500000, accountId: 'canara', kindId: 'k-exp', categoryId: 'c-food', eventId: 'vn', date: '2026-12-04T20:00', createdAt: 'x' },
    { id: 'u', type: 'out', amount: 10000, accountId: 'canara', kindId: 'k-exp', categoryId: 'c-food', date: '2026-12-05T20:00', createdAt: 'x' },
  );
  const s = eventSummary(st, ev, '2026-12-05T10:00');
  assert.equal(s.spent, 5259500);
  assert.equal(s.phases.before, 4759500);
  assert.equal(s.phases.during, 500000);
  assert.equal(s.status, 'on');
  assert.equal(s.suggest.length, 1);
  assert.equal(monthSummary(st, '2026-10').spent, 4759500);
  ev.excludeFromInsights = true;
  assert.equal(monthSummary(st, '2026-10').spent, 0);
});

test('category detail and commitments due now', () => {
  const st = st0();
  st.txns.push(
    { id: 'a', type: 'out', amount: 100000, accountId: 'canara', kindId: 'k-exp', categoryId: 'c-veh', label: 'Petrol', payee: 'HPCL', date: '2026-09-05T10:00', createdAt: 'x' },
    { id: 'b', type: 'out', amount: 150000, accountId: 'canara', kindId: 'k-exp', categoryId: 'c-veh', label: 'Petrol', payee: 'HPCL', date: '2026-10-05T10:00', createdAt: 'x' },
  );
  const d = categoryDetail(st, 'c-veh', '2026-10', 12);
  assert.equal(d.current, 150000);
  assert.equal(d.avg, 100000);
  assert.equal(d.payees[0].count, 1);
  st.commitments = [{ id: 'bike', name: 'Bike EMI', amount: 992000, dueDay: 3, kindId: 'k-loan', accountId: 'icici', startMonth: '2026-10', active: true }, { id: 'hl', name: 'HL', amount: 2312300, dueDay: 10, kindId: 'k-loan', accountId: 'icici', startMonth: '2026-10', active: true }];
  assert.deepEqual(commitmentsDueNow(st, '2026-11-03T08:00').map((i) => i.c.id), ['bike']);
});
