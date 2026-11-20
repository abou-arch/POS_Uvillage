import { describe, expect, it } from 'vitest';
import { expectedByMethod, expectedCash, sessionReport } from './cashSession';
import { buildCustomerPayment, isCustomerPayment, isLocalCustomerPayment, MAX_PAYMENT, paymentError } from './customerPayment';
import { buildPaymentReceipt, buildSessionReceipt } from './receipt';
import { buildOpening, openedSession } from './cashSession';
import { formatMad } from './totals.js';

const SESSION = '3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f';
const now = new Date('2026-11-19T10:15:00.789Z');
const input = (over: Partial<Parameters<typeof buildCustomerPayment>[0]> = {}) => ({
  id: '5d1e8c2a-7b3f-4a9e-8c21-0f4b6a7d9e13', storeId: 'st_2', registerId: 'reg_3', sessionId: SESSION, customerId: 'c_1',
  method: 'cash' as const, amount: 5000 as number | null, balance: 7500 as number | null, note: '  règlement   octobre ', createdBy: 'u_2',
  now, ...over,
});
const store = { name: 'Supérette', address: [], ice: '' };

describe('règlement d’une dette à la caisse (§4, contrat 0.8)', () => {
  it('montant : positif, plausible, jamais plus que le reste dû connu ; client qui ne doit rien refusé', () => {
    expect(paymentError(5000, 7500)).toBeNull();
    expect(paymentError(7500, 7500)).toBeNull();
    expect(paymentError(7501, 7500)).toBe(`Le client ne doit que ${formatMad(7500)}.`);
    expect(paymentError(null, 7500)).toBe('Montant invalide.');
    expect(paymentError(0, 7500)).toBe('Le montant doit être supérieur à 0.');
    expect(paymentError(MAX_PAYMENT + 1, null)).toMatch(/vérifiez le montant/);
    expect(paymentError(100, 0)).toBe('Ce client ne doit rien.');
    expect(paymentError(100, -500)).toBe('Ce client ne doit rien.'); // avoir
  });

  it('hors ligne (reste dû inconnu) : le règlement reste possible, l’API le signalera s’il dépasse', () => {
    expect(paymentError(900_000, null)).toBeNull();
  });

  it('ce qui est envoyé : format du contrat, date à la seconde, note nettoyée', () => {
    const payment = buildCustomerPayment(input());
    expect(payment).toEqual({
      id: '5d1e8c2a-7b3f-4a9e-8c21-0f4b6a7d9e13', store_id: 'st_2', register_id: 'reg_3', session_id: SESSION, customer_id: 'c_1',
      method: 'cash', amount: 5000, note: 'règlement octobre', created_by: 'u_2', created_at: '2026-11-19T10:15:00Z',
    });
    expect(isCustomerPayment(payment)).toBe(true);
    expect(buildCustomerPayment(input({ note: '   ' })).note).toBeNull();
    expect(() => buildCustomerPayment(input({ amount: 9000 }))).toThrow(/ne doit que/);
    expect(() => buildCustomerPayment(input({ method: 'credit' as never }))).toThrow('Moyen de paiement invalide.');
  });

  it('relecture : règlement abîmé refusé', () => {
    const p = buildCustomerPayment(input());
    for (const bad of [{ ...p, amount: 0 }, { ...p, amount: 10.5 }, { ...p, method: 'credit' }, { ...p, session_id: 'x' }, { ...p, note: '' }, null]) {
      expect(isCustomerPayment(bad), JSON.stringify(bad)).toBe(false);
    }
    const local = { ...p, customer_name: 'Ahmed', cashier_name: 'Caissier 1', balance_before: 7500 };
    expect(isLocalCustomerPayment(local)).toBe(true);
    expect(isLocalCustomerPayment({ ...local, balance_before: undefined })).toBe(false);
  });

  it('compté dans les attendus de la session, moyen par moyen (§9)', () => {
    const payments = [{ method: 'cash' as const, amount: 5000 }, { method: 'card' as const, amount: 2000 }, { method: 'mobile' as const, amount: 300 }];
    expect(expectedCash(10000, [], [], [], payments)).toBe(15000);
    expect(expectedByMethod(10000, [], [{ type: 'out', amount: 1000 }], [], payments)).toEqual({ cash: 14000, card: 2000, mobile: 300 });
    const report = sessionReport({ opening_cash: 10000, counts: null }, [], [], [], payments);
    expect([report.paymentsCount, report.paymentsTotal, report.cashPayments]).toEqual([3, 7300, 5000]);
    expect(report.paymentsByMethod).toEqual([{ method: 'cash', amount: 5000 }, { method: 'card', amount: 2000 }, { method: 'mobile', amount: 300 }]);
    expect(report.totals.ttc).toBe(0); // un règlement n'est pas une vente : pas de chiffre d'affaires ni de TVA
  });

  it('rapport X : bloc des règlements et ligne dans les espèces ; rien quand il n’y en a pas', () => {
    const open = openedSession(buildOpening({
      id: SESSION, storeId: 'st_2', registerId: 'reg_3', openedBy: 'u_2', openingCash: 10000, note: '', now,
    }), 'Caissier 1');
    const base = { session: open, sales: [], movements: [], registerName: 'Caisse 1', printedAt: now, store, timeZone: 'UTC', pending: 0 };
    const x = buildSessionReceipt({ ...base, payments: [{ method: 'cash', amount: 5000 }, { method: 'card', amount: 2000 }] });
    expect(x.payments).toEqual([
      { label: 'Nombre de règlements', value: '2' }, { label: 'Total reçu', value: `+${formatMad(7000)}` },
      { label: '  Espèces', value: `+${formatMad(5000)}` }, { label: '  Carte', value: `+${formatMad(2000)}` },
    ]);
    expect(x.cash).toContainEqual({ label: 'Règlements clients', value: `+${formatMad(5000)}` });
    expect(x.result[0].rows[0]).toEqual({ label: 'Espèces', value: formatMad(15000), strong: true });
    expect(buildSessionReceipt(base).payments).toEqual([]);
  });

  it('reçu remis au client : montant, moyen, reste dû avant et après quand il était connu', () => {
    const payment = { ...buildCustomerPayment(input()), customer_name: 'Ahmed', cashier_name: 'Caissier 1', balance_before: 7500 };
    const r = buildPaymentReceipt({ payment, registerName: 'Caisse 1', store, timeZone: 'UTC', copy: false });
    expect(r.amount).toEqual({ label: 'MONTANT REÇU', value: formatMad(5000) });
    expect(r.info).toContainEqual({ label: 'Client', value: 'Ahmed' });
    expect(r.info).toContainEqual({ label: 'Payé en', value: 'espèces' });
    expect(r.balance).toEqual([{ label: 'Reste dû avant', value: formatMad(7500) }, { label: 'Reste dû après', value: formatMad(2500) }]);
    expect(r.note).toBe('règlement octobre');
    const offline = buildPaymentReceipt({ payment: { ...payment, balance_before: null }, registerName: 'Caisse 1', store, timeZone: 'UTC', copy: true });
    expect(offline.balance).toEqual([]);
    expect(offline.copy).toBe(true);
  });
});
