import { describe, expect, it } from 'vitest';
import { emptyCart } from '../state/cart';
import { DENOMINATIONS } from '../config/cash';
import type { CartLine, Customer, Payment, Sale } from '../types';
import { buildSale } from './buildSale';
import {
  buildClosing, buildMovement, buildOpening, cashOfSale, closeBlocker, closedSession, closingError, countedError, countTotal,
  denominationLabel, expectedByMethod, expectedCash, isClosing, isLocalMovement, isLocalSession, MAX_COUNTED, MAX_MOVEMENT, MAX_OPENING_CASH,
  MAX_PIECES, methodCounts, movementAmountError, movementError, openedSession, openingError, parseCashCount, sessionReport,
  sessionsToPrune, type Counted, type LocalCashSession,
} from './cashSession';

const SESSION = '3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f';
const now = new Date('2026-11-12T08:02:00.456Z');
const ahmed: Customer = { id: 'c_1', name: 'Ahmed', phone: null, matricule: null };

const line = (product_id: string, quantity: number, unit_price_ttc: number, tva_rate: number, discount = 0): CartLine =>
  ({ product_id, name: product_id, quantity, unit_price_ttc, discount, tva_rate, stock: 100 });

let counter = 0;
function sale(lines: CartLine[], payments: Payment[], amountReceived: number, extra: { globalDiscount?: number; otherCharges?: number } = {}): Sale {
  counter += 1;
  return buildSale({
    cart: { ...emptyCart, lines, customer: ahmed, globalDiscount: extra.globalDiscount ?? 0, otherCharges: extra.otherCharges ?? 0 },
    storeId: 'st_2', registerId: 'reg_3', sessionId: SESSION, cashierId: 'u_2', payments, amountReceived,
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`, counter, now,
    lineIds: lines.map((_, i) => `10000000-0000-4000-8000-${String(counter * 100 + i).padStart(12, '0')}`),
  });
}
const cash = (amount: number): Payment => ({ method: 'cash', amount });
const card = (amount: number): Payment => ({ method: 'card', amount });

// Le scénario du critère de l'étape 6b : fond 500 DH, vente espèces 120 DH, vente carte 80 DH, sortie 50 DH.
const cashSale = sale([line('p_9', 12, 1000, 20)], [cash(12000)], 20000); // le client donne 200 DH, on lui rend 80
const cardSale = sale([line('p_1', 40, 200, 0)], [card(8000)], 0);
const out50 = { type: 'out' as const, amount: 5000 };

// Clôture du critère : attendu 570 DH en espèces, 80 DH par carte, rien en mobile.
const EXPECTED = { cash: 57000, card: 8000, mobile: 0 };
const counted = (cash: number | null, card: number | null = 8000, mobile: number | null = 0): Counted => ({ cash, card, mobile });
type ClosingInput = Parameters<typeof buildClosing>[0];
const closingInput = (over: Partial<ClosingInput> = {}): ClosingInput => ({
  counted: counted(56000), expected: EXPECTED, cashCount: null, note: 'Erreur de rendu', role: 'cashier', threshold: 2000,
  closedBy: 'u_2', now, ...over,
});

describe('espèces attendues (§9)', () => {
  it('critère 6b : 500 + 120 (espèces) − 50 (sortie) = 570 DH ; la vente carte ne compte pas', () => {
    expect(expectedCash(50000, [cashSale, cardSale], [out50])).toBe(57000);
  });

  it('les espèces d’une vente sont nettes du rendu de monnaie', () => {
    expect(cashSale.amount_received).toBe(20000);
    expect(cashSale.change_given).toBe(8000);
    expect(cashOfSale(cashSale)).toBe(12000);
  });

  it('paiement mixte : seule la part en espèces entre dans le tiroir ; le crédit n’y entre pas', () => {
    const mixed = sale([line('p_9', 3, 1000, 20)], [cash(1000), card(1500), { method: 'credit', amount: 500 }], 1000);
    expect(cashOfSale(mixed)).toBe(1000);
    expect(expectedCash(0, [mixed], [])).toBe(1000);
  });

  it('entrées et sorties ; session vide = fond de caisse', () => {
    expect(expectedCash(10000, [], [])).toBe(10000);
    expect(expectedCash(10000, [], [{ type: 'in', amount: 2000 }, { type: 'out', amount: 500 }, { type: 'in', amount: 1 }])).toBe(11501);
  });
});

describe('montants attendus par moyen de paiement (§9)', () => {
  it('critère 6b : espèces 570 DH, carte 80 DH, mobile 0 DH', () => {
    expect(expectedByMethod(50000, [cashSale, cardSale], [out50])).toEqual(EXPECTED);
  });

  it('paiement mixte : chaque part va à son moyen ; le crédit n’est compté nulle part', () => {
    const mixed = sale([line('p_9', 4, 1000, 20)], [cash(1000), card(1500), { method: 'mobile', amount: 1000 }, { method: 'credit', amount: 500 }], 1000);
    expect(expectedByMethod(0, [mixed], [])).toEqual({ cash: 1000, card: 1500, mobile: 1000 });
  });
});

describe('retours dans les montants attendus (§9, contrat 0.5)', () => {
  // Retours faits dans la session : 20 DH rendus en espèces, 90 DH par carte, 5 DH déduits du crédit.
  const refunds = [
    { payments: [cash(2000)], totals: { ht: 1667, tva: 333, ttc: 2000 } },
    { payments: [card(9000)], totals: { ht: 7500, tva: 1500, ttc: 9000 } },
    { payments: [{ method: 'credit' as const, amount: 500 }], totals: { ht: 500, tva: 0, ttc: 500 } },
  ];

  it('chaque remboursement est déduit de son moyen ; le crédit n’est compté nulle part', () => {
    expect(expectedCash(50000, [cashSale, cardSale], [out50], refunds)).toBe(55000);
    // Carte : 80 DH de ventes − 90 DH remboursés = −10 DH (total du terminal négatif).
    expect(expectedByMethod(50000, [cashSale, cardSale], [out50], refunds)).toEqual({ cash: 55000, card: -1000, mobile: 0 });
  });
  it('carte et mobile : un compté négatif est accepté ; pas pour les espèces', () => {
    expect(countedError(-1000, 'card')).toBeNull();
    expect(countedError(-1000, 'mobile')).toBeNull();
    expect(countedError(-1000)).toMatch(/Espèces : montant compté invalide/);
    expect(countedError(-MAX_COUNTED - 1, 'card')).toMatch(/vérifiez/);
    const expected = { cash: 55000, card: -1000, mobile: 0 };
    const closing = buildClosing({
      counted: { cash: 55000, card: -1000, mobile: 0 }, expected, cashCount: null, note: '', role: 'cashier', threshold: 2000,
      closedBy: 'u_2', now,
    });
    expect(closing.counts).toEqual([
      { method: 'cash', expected: 55000, counted: 55000, difference: 0 },
      { method: 'card', expected: -1000, counted: -1000, difference: 0 },
      { method: 'mobile', expected: 0, counted: 0, difference: 0 },
    ]);
    expect(isClosing(closing)).toBe(true);
    expect(isClosing({ ...closing, counts: closing.counts.map((c) => (c.method === 'cash' ? { ...c, expected: -1, counted: -1 } : c)) }))
      .toBe(false);
  });
  it('rapport : nombre et total des retours, par moyen, espèces rendues', () => {
    const report = sessionReport({ opening_cash: 50000, counts: null }, [cashSale, cardSale], [out50], refunds);
    expect(report).toMatchObject({
      refundsCount: 3, refundTotals: { ht: 9667, tva: 1833, ttc: 11500 }, cashRefunds: 2000,
      expected: { cash: 55000, card: -1000, mobile: 0 },
    });
    expect(report.refundsByMethod).toEqual([
      { method: 'cash', amount: 2000 }, { method: 'card', amount: 9000 }, { method: 'mobile', amount: 0 }, { method: 'credit', amount: 500 },
    ]);
  });
});

describe('comptage des espèces par billets et pièces', () => {
  it('la liste des billets et pièces : de 200 DH à 0,10 DH, sans doublon, du plus grand au plus petit', () => {
    const values = DENOMINATIONS.map((d) => d.value);
    expect(values).toEqual([20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10]);
    expect(DENOMINATIONS.filter((d) => d.kind === 'billet').map((d) => d.value)).toEqual([20000, 10000, 5000, 2000]);
  });

  it('libellés courts : « 200 DH », « 0,50 DH »', () => {
    expect(denominationLabel(20000)).toBe('200 DH');
    expect(denominationLabel(50)).toBe('0,50 DH');
    expect(denominationLabel(10)).toBe('0,10 DH');
  });

  it('critère 6b : 2 × 200 + 1 × 100 + 1 × 50 + 1 × 10 = 560 DH ; cases vides et zéros ignorés', () => {
    const { lines, error } = parseCashCount({ 1000: '1', 20000: '2', 50: '', 5000: ' 1 ', 10000: '1', 200: '0' });
    expect(error).toBeNull();
    expect(lines).toEqual([
      { value: 20000, quantity: 2 }, { value: 10000, quantity: 1 }, { value: 5000, quantity: 1 }, { value: 1000, quantity: 1 },
    ]);
    expect(countTotal(lines)).toBe(56000);
  });

  it('rien de compté : tiroir vide, 0 DH', () => {
    expect(parseCashCount({})).toEqual({ lines: [], error: null });
    expect(parseCashCount({ 20000: ' ' })).toEqual({ lines: [], error: null });
  });

  it('nombres refusés : décimal, négatif, texte, aberrant', () => {
    expect(parseCashCount({ 20000: '1,5' }).error).toMatch(/200 DH : nombre invalide/);
    expect(parseCashCount({ 50: '-1' }).error).toMatch(/0,50 DH : nombre invalide/);
    expect(parseCashCount({ 100: 'abc' }).error).toMatch(/invalide/);
    expect(parseCashCount({ 100: String(MAX_PIECES + 1) }).error).toMatch(/vérifiez/);
    expect(parseCashCount({ 20000: String(MAX_PIECES) }).error).toMatch(/vérifiez le comptage/); // 2 000 000 DH
  });
});

describe('saisies du caissier', () => {
  it('fond de caisse : 0 accepté, montant illisible ou aberrant refusé', () => {
    expect(openingError(0)).toBeNull();
    expect(openingError(50000)).toBeNull();
    expect(openingError(MAX_OPENING_CASH)).toBeNull();
    expect(openingError(null)).toMatch(/invalide/);
    expect(openingError(MAX_OPENING_CASH + 1)).toMatch(/vérifiez/);
  });

  it('mouvement : montant > 0 et plausible, motif obligatoire', () => {
    expect(movementError('in', 2000, 'Appoint de monnaie', 0)).toBeNull();
    expect(movementError('in', null, 'x', 0)).toMatch(/invalide/);
    expect(movementError('in', 0, 'x', 0)).toMatch(/supérieur à 0/);
    expect(movementError('in', MAX_MOVEMENT + 1, 'x', 0)).toMatch(/vérifiez/);
    expect(movementError('in', 2000, '   ', 0)).toBe('Le motif est obligatoire.');
  });

  it('sortie : jamais plus que les espèces attendues dans la caisse', () => {
    expect(movementError('out', 5000, 'Achat de sacs', 57000)).toBeNull();
    expect(movementError('out', 57000, 'Dépôt en banque', 57000)).toBeNull();
    expect(movementError('out', 57001, 'Dépôt en banque', 57000)).toMatch(/il n’y a que 570,00/);
  });

  it('pendant la saisie, le montant se vérifie avant que le motif soit écrit', () => {
    expect(movementAmountError('out', 5000, 57000)).toBeNull();
    expect(movementAmountError('out', 57001, 57000)).toMatch(/Sortie impossible/);
    expect(movementAmountError('in', 57001, 57000)).toBeNull(); // une entrée ne dépend pas du tiroir
    expect(countedError(56000)).toBeNull();
    expect(countedError(0)).toBeNull(); // tiroir vide : 0 est un comptage valable
    expect(countedError(null)).toMatch(/Espèces : montant compté invalide/);
    expect(countedError(null, 'card')).toMatch(/Carte : montant compté invalide/);
    expect(countedError(MAX_COUNTED + 1)).toMatch(/vérifiez/);
  });

  it('clôture : écart de −10 DH → note obligatoire ; pas d’écart → note facultative', () => {
    const error = (over: Partial<ClosingInput>) => closingError(closingInput(over));
    expect(error({ note: '' })).toMatch(/note \(obligatoire\)/);
    expect(error({})).toBeNull();
    expect(error({ counted: counted(58000), note: '' })).toMatch(/obligatoire/); // un excédent est aussi un écart
    expect(error({ counted: counted(57000), note: '' })).toBeNull();
    expect(error({ counted: counted(57000, 7000), note: '' })).toMatch(/obligatoire/); // écart sur la carte
    expect(error({ counted: counted(null) })).toMatch(/Espèces : montant compté invalide/);
    expect(error({ counted: counted(57000, null) })).toMatch(/Carte : montant compté invalide/);
    expect(error({ counted: counted(MAX_COUNTED + 1) })).toMatch(/vérifiez/);
  });

  it('attendu, compté et écart de chaque moyen ; rien tant qu’un montant manque', () => {
    expect(methodCounts(EXPECTED, counted(56000))).toEqual([
      { method: 'cash', expected: 57000, counted: 56000, difference: -1000 },
      { method: 'card', expected: 8000, counted: 8000, difference: 0 },
      { method: 'mobile', expected: 0, counted: 0, difference: 0 },
    ]);
    expect(methodCounts(EXPECTED, counted(56000, null))).toBeNull();
  });

  it('seuil d’écart de 20 DH : un caissier ne valide pas au-delà ; manager et admin si', () => {
    const over = { counted: counted(54000), note: 'Billet manquant' }; // −30 DH
    expect(closingError(closingInput(over))).toMatch(/Écart de plus de 20,00 DH \(espèces\) : faites valider la clôture par un responsable/);
    expect(closingError(closingInput({ ...over, role: 'manager' }))).toBeNull();
    expect(closingError(closingInput({ ...over, role: 'admin' }))).toBeNull();
    expect(closingError(closingInput({ counted: counted(55000) }))).toBeNull(); // −20 DH : pile le seuil, autorisé
    expect(closingError(closingInput({ counted: counted(59500) }))).toMatch(/responsable/); // +25 DH : un excédent aussi
    expect(closingError(closingInput({ counted: counted(57000, 5000), note: 'Terminal' }))).toMatch(/\(carte\)/);
    expect(closingError(closingInput({ counted: counted(56000), threshold: 0 }))).toMatch(/responsable/); // seuil 0 : tout écart
  });

  it('le détail des billets et pièces doit donner les espèces comptées', () => {
    const cashCount = [{ value: 20000, quantity: 2 }, { value: 10000, quantity: 1 }, { value: 5000, quantity: 1 }, { value: 1000, quantity: 1 }];
    expect(closingError(closingInput({ cashCount }))).toBeNull();
    expect(closingError(closingInput({ cashCount: cashCount.slice(1) }))).toMatch(/ne donne pas les espèces comptées/);
  });

  it('clôture impossible avec des ventes en attente ou un panier en cours', () => {
    expect(closeBlocker(0, 0)).toBeNull();
    expect(closeBlocker(1, 0)).toMatch(/Une vente est en attente/);
    expect(closeBlocker(2, 3)).toMatch(/2 ventes sont en attente/);
    expect(closeBlocker(0, 3)).toMatch(/panier est en cours/);
  });
});

describe('ce qui est envoyé à l’API (§9)', () => {
  it('ouverture : date à la seconde, note vide → null, note nettoyée', () => {
    const opening = buildOpening({ id: SESSION, storeId: 'st_2', registerId: 'reg_3', openedBy: 'u_2', openingCash: 50000, note: '', now });
    expect(opening).toEqual({
      id: SESSION, store_id: 'st_2', register_id: 'reg_3', opened_by: 'u_2', opened_at: '2026-11-12T08:02:00Z',
      opening_cash: 50000, opening_note: null,
    });
    expect(buildOpening({ id: SESSION, storeId: 'st_2', registerId: 'reg_3', openedBy: 'u_2', openingCash: 0, note: '  Billets   de 20 ', now })
      .opening_note).toBe('Billets de 20');
    expect(() => buildOpening({ id: SESSION, storeId: 'st_2', registerId: 'reg_3', openedBy: 'u_2', openingCash: null, note: '', now })).toThrow();
  });

  it('mouvement : motif nettoyé, refus des saisies invalides', () => {
    const m = buildMovement({ id: 'a1c2e3f4-0000-4000-8000-000000000001', sessionId: SESSION, type: 'out', amount: 5000,
      reason: ' Achat  de sacs ', createdBy: 'u_2', available: 57000, now });
    expect(m).toEqual({ id: 'a1c2e3f4-0000-4000-8000-000000000001', session_id: SESSION, type: 'out', amount: 5000,
      reason: 'Achat de sacs', created_by: 'u_2', created_at: '2026-11-12T08:02:00Z' });
    expect(() => buildMovement({ id: 'x', sessionId: SESSION, type: 'out', amount: 5000, reason: '', createdBy: 'u_2', available: 57000, now }))
      .toThrow('Le motif est obligatoire.');
  });

  it('clôture du critère : espèces comptées 560, attendues 570 → écart −10 DH, avec la note ; carte 80 = 80', () => {
    const cashCount = [{ value: 20000, quantity: 2 }, { value: 10000, quantity: 1 }, { value: 5000, quantity: 1 }, { value: 1000, quantity: 1 }];
    expect(buildClosing(closingInput({ cashCount }))).toEqual({
      closed_by: 'u_2', closed_at: '2026-11-12T08:02:00Z',
      counts: [
        { method: 'cash', expected: 57000, counted: 56000, difference: -1000 },
        { method: 'card', expected: 8000, counted: 8000, difference: 0 },
        { method: 'mobile', expected: 0, counted: 0, difference: 0 },
      ],
      cash_count: cashCount,
      closing_note: 'Erreur de rendu',
    });
    expect(buildClosing(closingInput()).cash_count).toBeNull(); // total saisi directement
    expect(() => buildClosing(closingInput({ note: ' ' }))).toThrow(/obligatoire/);
    expect(() => buildClosing(closingInput({ counted: counted(50000), note: 'x' }))).toThrow(/responsable/);
    expect(buildClosing(closingInput({ counted: counted(57000), note: '' })).closing_note).toBeNull();
  });

  it('session gardée sur la caisse : relue telle quelle ouverte puis clôturée, refusée si abîmée', () => {
    const opening = buildOpening({ id: SESSION, storeId: 'st_2', registerId: 'reg_3', openedBy: 'u_2', openingCash: 50000, note: '', now });
    const open = openedSession(opening, 'Caissier 1');
    expect(isLocalSession(open)).toBe(true);
    const cashCount = [{ value: 20000, quantity: 2 }, { value: 10000, quantity: 1 }, { value: 5000, quantity: 1 }, { value: 1000, quantity: 1 }];
    const closed = closedSession(open, buildClosing(closingInput({ cashCount, closedBy: 'u_1', role: 'admin' })), 'Falcon');
    expect(closed).toMatchObject({ status: 'closed', closed_by_name: 'Falcon', opened_by_name: 'Caissier 1' });
    expect(closed.counts?.[0]).toEqual({ method: 'cash', expected: 57000, counted: 56000, difference: -1000 });
    expect(isLocalSession(closed)).toBe(true);
    const counts = closed.counts ?? [];
    expect(isLocalSession({ ...closed, counts: [{ ...counts[0], difference: 0 }, ...counts.slice(1)] })).toBe(false); // écart incohérent
    expect(isLocalSession({ ...closed, counts: counts.slice(0, 2) })).toBe(false); // un moyen manque
    expect(isLocalSession({ ...closed, counts: [counts[0], counts[0], counts[2]] })).toBe(false); // un moyen en double
    expect(isLocalSession({ ...closed, cash_count: cashCount.slice(1) })).toBe(false); // le détail ne donne pas le compté
    expect(isLocalSession({ ...closed, cash_count: null })).toBe(true);
    expect(isLocalSession({ ...closed, closing_note: null })).toBe(false); // écart sans note
    expect(isLocalSession({ ...closed, counted_cash: 56000, counts: undefined })).toBe(false); // ancienne clôture v0.4 d'essai
    expect(isLocalSession({ ...open, counts: [] })).toBe(false); // ouverte mais à moitié clôturée
    expect(isLocalSession({ ...open, opening_cash: -1 })).toBe(false);
    expect(isLocalSession({ ...open, id: 'pas-un-uuid' })).toBe(false);
  });

  it('mouvement gardé sur la caisse : relu, ou refusé s’il est abîmé', () => {
    const m = { ...buildMovement({ id: 'a1c2e3f4-0000-4000-8000-000000000001', sessionId: SESSION, type: 'in', amount: 100,
      reason: 'Monnaie', createdBy: 'u_2', available: 0, now }), cashier_name: 'Caissier 1' };
    expect(isLocalMovement(m)).toBe(true);
    expect(isLocalMovement({ ...m, amount: 0 })).toBe(false);
    expect(isLocalMovement({ ...m, reason: '' })).toBe(false);
    expect(isLocalMovement({ ...m, type: 'transfer' })).toBe(false);
    expect(isLocalMovement({ ...m, created_by: undefined, cashier_id: 'u_2' })).toBe(false); // ancien format
  });
});

describe('rapport de session (X / Z)', () => {
  it('critère 6b : 2 ventes, totaux par moyen de paiement, sortie, fond, attendus, comptés, écarts', () => {
    const counts = methodCounts(EXPECTED, counted(56000));
    const report = sessionReport({ opening_cash: 50000, counts }, [cashSale, cardSale], [out50]);
    expect(report).toMatchObject({
      salesCount: 2, totals: { ttc: 20000 }, cashSales: 12000, cashIn: 0, cashOut: 5000,
      openingCash: 50000, expected: EXPECTED, counts,
    });
    expect(report.byMethod).toEqual([
      { method: 'cash', amount: 12000 }, { method: 'card', amount: 8000 }, { method: 'mobile', amount: 0 }, { method: 'credit', amount: 0 },
    ]);
  });

  it('HT / TVA par taux : somme des récapitulatifs des ventes (§7), remise globale comprise ; HT + TVA = TTC', () => {
    const a = sale([line('p_9', 1, 1000, 20), line('p_1', 2, 500, 0)], [cash(1700)], 1700, { globalDiscount: 300 });
    const b = sale([line('p_5', 3, 100, 7)], [card(300)], 0);
    const report = sessionReport({ opening_cash: 0, counts: null }, [a, b], []);
    // a : 3 DH de remise répartis 20 % / 0 % au prorata (10 et 10 DH) → 1,50 DH chacun.
    expect(report.vat).toEqual([
      { rate: 20, ht: 708, tva: 142, ttc: 850 },
      { rate: 7, ht: 280, tva: 20, ttc: 300 },
      { rate: 0, ht: 850, tva: 0, ttc: 850 },
    ]);
    const sum = report.vat.reduce((s, g) => ({ ht: s.ht + g.ht, tva: s.tva + g.tva, ttc: s.ttc + g.ttc }), { ht: 0, tva: 0, ttc: 0 });
    expect(sum).toEqual(report.totals);
    expect(report.totals.ttc).toBe(a.totals.ttc + b.totals.ttc);
  });

  it('rapport X (session ouverte) : ni compté ni écart ; session sans vente', () => {
    const report = sessionReport({ opening_cash: 50000, counts: null }, [], [{ type: 'in', amount: 1000 }]);
    expect(report).toMatchObject({
      salesCount: 0, totals: { ht: 0, tva: 0, ttc: 0 }, vat: [], cashIn: 1000, expected: { cash: 51000, card: 0, mobile: 0 }, counts: null,
    });
  });
});

describe('ménage de la base locale', () => {
  const opening = buildOpening({ id: SESSION, storeId: 'st_2', registerId: 'reg_3', openedBy: 'u_2', openingCash: 0, note: '', now });
  const closedOn = (id: string, closed_at: string): LocalCashSession =>
    ({ ...closedSession(openedSession({ ...opening, id }, 'C'), buildClosing(closingInput({ counted: counted(0, 0, 0), expected: { cash: 0, card: 0, mobile: 0 }, note: '' })), 'C'), closed_at });

  it('seules les sessions clôturées depuis plus de 31 jours, sans rien à envoyer, quittent le poste', () => {
    const old = closedOn('old', '2026-10-01T20:00:00Z');
    const recent = closedOn('recent', '2026-11-01T20:00:00Z');
    const oldPending = closedOn('old-pending', '2026-09-01T20:00:00Z');
    const open = openedSession({ ...opening, id: 'open', opened_at: '2026-01-01T08:00:00Z' }, 'C');
    expect(sessionsToPrune([old, recent, oldPending, open], new Date('2026-11-12T08:00:00Z'), new Set(['old-pending']))).toEqual(['old']);
  });
});
