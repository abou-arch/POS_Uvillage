import { describe, expect, it } from 'vitest';
import { STORE_INFO, storeInfo } from '../config/store';
import { emptyCart } from '../state/cart';
import { loadLastReceipt, saveLastReceipt } from '../state/lastReceipt';
import type { CartLine, Customer, Payment } from '../types';
import { buildSale } from './buildSale';
import { buildClosing, buildMovement, buildOpening, closedSession, openedSession } from './cashSession';
import { buildRefund } from './buildRefund';
import { buildMovementReceipt, buildReceipt, buildRefundReceipt, buildSessionReceipt, receiptDate, signedMad } from './receipt';
import { formatMad } from './totals.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

const line = (product_id: string, name: string, quantity: number, unit_price_ttc: number, tva_rate: number, discount = 0): CartLine =>
  ({ product_id, name, quantity, unit_price_ttc, discount, tva_rate, stock: 100 });
const client: Customer = { id: 'c_1', name: 'Fatima Zahra', phone: null, matricule: '2024001' };

// Pain à 0 % et thon à 20 % : le cas du critère de l'étape 5.
function sale({ otherCharges = 0, globalDiscount = 0, payments, amountReceived, customer = null as Customer | null }:
  { otherCharges?: number; globalDiscount?: number; payments: Payment[]; amountReceived: number; customer?: Customer | null }) {
  return buildSale({
    cart: {
      ...emptyCart, customer, otherCharges, globalDiscount,
      lines: [line('p_1', 'PAIN NORMAL', 2, 150, 0), line('p_9', 'THON ISABEL TOMATE', 1, 1000, 20, 100)],
    },
    storeId: 'st_2', registerId: 'reg_3', sessionId: '3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f', cashierId: 'u_2', payments, amountReceived,
    lineIds: ['5d2e8f1a-7b3c-4e9d-8a6f-1c2b3d4e5f60', 'a3c5e7f9-1b2d-4f6a-8c0e-2d4f6a8c0e1b'],
    id: '0f8b7c2e-5c1d-4c6e-9a4b-2f1e3d4c5b6a', counter: 12, now: new Date('2026-10-22T18:58:08Z'),
  });
}
const store = STORE_INFO.st_2;
const mad = (cents: number) => formatMad(cents);

describe('ticket', () => {
  const cash = sale({ payments: [{ method: 'cash', amount: 1200 }], amountReceived: 2000 });
  const receipt = buildReceipt({ sale: cash, cashier: 'Caissier 1', customer: null }, store, 'UTC');

  it('en-tête : magasin, numéro, date, caissier, client de passage', () => {
    expect(receipt.store).toEqual(store);
    expect(receipt.number).toBe('ST2-REG3-000012');
    expect(receipt.date).toBe('22/10/2026 18:58');
    expect(receipt.cashier).toBe('Caissier 1');
    expect(receipt.customer).toBe('Client de passage');
  });

  it('lignes : désignation, quantité × prix, remise, total de la ligne', () => {
    expect(receipt.lines).toEqual([
      { name: 'PAIN NORMAL', detail: `2 × ${mad(150)}`, discount: null, total: mad(300) },
      { name: 'THON ISABEL TOMATE', detail: `1 × ${mad(1000)}`, discount: `-${mad(100)}`, total: mad(900) },
    ]);
  });

  it('récapitulatif TVA juste pour un panier à 0 % + 20 %', () => {
    // 20 % : TTC 9,00 = HT 7,50 + TVA 1,50 ; 0 % : TTC 3,00 = HT 3,00.
    expect(receipt.vat).toEqual([
      { rate: '20 %', ht: mad(750), tva: mad(150) },
      { rate: '0 %', ht: mad(300), tva: mad(0) },
    ]);
    expect(receipt.totals).toEqual({ ht: mad(1050), tva: mad(150), ttc: mad(1200) });
  });

  it('récapitulatif TVA avec autres charges et remise globale réparties par taux (§7)', () => {
    const adjusted = sale({ otherCharges: 300, globalDiscount: 600, payments: [{ method: 'cash', amount: 900 }], amountReceived: 900 });
    const r = buildReceipt({ sale: adjusted, cashier: 'Caissier 1', customer: null }, store, 'UTC');
    expect(r.adjustments).toEqual([{ label: 'Autres charges', value: mad(300) }, { label: 'Remise globale', value: `-${mad(600)}` }]);
    // -3,00 DH répartis 9/12 sur le 20 % (-2,25) et 3/12 sur le 0 % (-0,75).
    expect(r.vat).toEqual([{ rate: '20 %', ht: mad(563), tva: mad(112) }, { rate: '0 %', ht: mad(225), tva: mad(0) }]);
    expect(r.totals).toEqual({ ht: mad(788), tva: mad(112), ttc: mad(900) });
  });

  it('paiements, espèces reçues et rendu', () => {
    expect(receipt.payments).toEqual([
      { label: 'Espèces', value: mad(1200) },
      { label: 'Espèces reçues', value: mad(2000) },
      { label: 'Rendu', value: mad(800) },
    ]);
  });

  it('paiement mixte avec crédit, pour un client : pas de ligne espèces reçues', () => {
    const mixed = sale({ customer: client, payments: [{ method: 'card', amount: 700 }, { method: 'credit', amount: 500 }], amountReceived: 0 });
    const r = buildReceipt({ sale: mixed, cashier: 'Caissier 1', customer: client.name }, store, 'UTC');
    expect(r.customer).toBe('Fatima Zahra');
    expect(r.payments).toEqual([{ label: 'Carte', value: mad(700) }, { label: 'Crédit', value: mad(500) }]);
  });

  it('les montants imprimés viennent de la vente enregistrée, jamais d’un recalcul', () => {
    const stored = {
      ...cash,
      lines: cash.lines.map((l, i) => (i === 0 ? { ...l, total_ttc: 333 } : l)),
      totals: { ht: 1, tva: 2, ttc: 3 },
    };
    const r = buildReceipt({ sale: stored, cashier: 'Caissier 1', customer: null }, store, 'UTC');
    expect(r.lines[0].total).toBe(mad(333));
    expect(r.totals).toEqual({ ht: mad(1), tva: mad(2), ttc: mad(3) });
    expect(r.vat.find((g) => g.rate === '0 %')?.ht).toBe(mad(333));
  });

  // Décalages fixes (Etc/GMT-1 = UTC+1) : le test ne dépend pas des changements d'heure légale du Maroc,
  // que chaque navigateur applique selon sa propre base de fuseaux.
  it('heure du fuseau demandé, quel que soit celui du poste', () => {
    expect(receiptDate('2026-10-22T23:30:00Z', 'Etc/GMT-1')).toBe('23/10/2026 00:30');
    expect(receiptDate('2026-10-22T23:30:00Z', 'UTC')).toBe('22/10/2026 23:30');
  });

  it('magasin absent de la configuration : nom de la session, sans adresse ni ICE', () => {
    expect(storeInfo('st_99', 'Magasin test')).toEqual({ name: 'Magasin test', address: [], ice: '' });
  });
});

describe('dernier ticket', () => {
  const cash = sale({ payments: [{ method: 'cash', amount: 1200 }], amountReceived: 2000 });

  it('survit à un rechargement, pour la caisse qui l’a imprimé', () => {
    const storage = memoryStorage();
    const data = { sale: cash, cashier: 'Caissier 1', customer: null };
    saveLastReceipt('reg_3', data, storage);
    expect(loadLastReceipt('reg_3', storage)).toEqual(data);
    expect(loadLastReceipt('reg_1', storage)).toBeNull();
  });

  it('illisible ou abîmé : rien à réimprimer', () => {
    expect(loadLastReceipt('reg_3', memoryStorage({ 'pos.lastReceipt.reg_3': '{abîmé' }))).toBeNull();
    const bad = { sale: { ...cash, totals: { ht: -1, tva: 0, ttc: 0 } }, cashier: 'Caissier 1', customer: null };
    expect(loadLastReceipt('reg_3', memoryStorage({ 'pos.lastReceipt.reg_3': JSON.stringify(bad) }))).toBeNull();
  });
});

describe('rapport de session 80 mm', () => {
  const opening = buildOpening({
    id: '3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f', storeId: 'st_2', registerId: 'reg_3', openedBy: 'u_2', openingCash: 50000,
    note: 'Billets de 20', now: new Date('2026-11-12T08:02:00Z'),
  });
  const open = openedSession(opening, 'Caissier 1');
  const sales = [
    sale({ payments: [{ method: 'cash', amount: 1200 }], amountReceived: 2000 }),
    sale({ payments: [{ method: 'card', amount: 1200 }], amountReceived: 0 }),
  ];
  const movement = (type: 'in' | 'out', amount: number, reason: string, created_at: string) =>
    ({ id: '9a1c4e7b-2d3f-4b8a-8c6d-5e4f3a2b1c0d', session_id: opening.id, type, amount, reason, created_by: 'u_2', created_at });
  // Dans le désordre : le rapport les remet dans l'ordre de l'heure.
  const movements = [movement('out', 500, 'Achat de sacs', '2026-11-12T11:15:00Z'), movement('in', 1000, 'Appoint', '2026-11-12T09:00:00Z')];
  const base = { sales, movements, registerName: 'Caisse 1', store, timeZone: 'UTC', pending: 0 };

  it('montants signés', () => {
    expect(signedMad(1000)).toBe(`+${mad(1000)}`);
    expect(signedMad(-1000)).toBe(`-${mad(1000)}`);
    expect(signedMad(0)).toBe(mad(0));
  });

  it('rapport X : ventes, moyens de paiement, TVA par taux, mouvements, fond et attendu ; ni compté ni écart', () => {
    const x = buildSessionReceipt({ ...base, session: open, printedAt: new Date('2026-11-12T15:40:00Z') });
    expect(x.title).toBe('RAPPORT X');
    expect(x.subtitle).toBe('Session en cours, non clôturée');
    expect(x.info).toEqual([
      { label: 'Caisse', value: 'Caisse 1' }, { label: 'Ouverture', value: '12/11/2026 08:02' },
      { label: 'Ouverte par', value: 'Caissier 1' }, { label: 'Imprimé le', value: '12/11/2026 15:40' },
    ]);
    expect(x.sales).toEqual([{ label: 'Nombre de ventes', value: '2' }, { label: 'Total TTC', value: mad(2400) }]);
    expect(x.methods).toEqual([
      { label: 'Espèces', value: mad(1200) }, { label: 'Carte', value: mad(1200) },
      { label: 'Mobile', value: mad(0) }, { label: 'Crédit', value: mad(0) },
    ]);
    expect(x.vat).toEqual([{ rate: '20 %', ht: mad(1500), tva: mad(300) }, { rate: '0 %', ht: mad(600), tva: mad(0) }]);
    expect(x.totals).toEqual([{ label: 'Total HT', value: mad(2100) }, { label: 'Total TVA', value: mad(300) }]);
    expect(x.movements).toEqual([
      { label: '09:00 Entrée : Appoint', value: `+${mad(1000)}` },
      { label: '11:15 Sortie : Achat de sacs', value: `-${mad(500)}` },
    ]);
    expect(x.cash).toEqual([
      { label: 'Fond de caisse', value: mad(50000) }, { label: 'Espèces des ventes', value: `+${mad(1200)}` },
      { label: 'Entrées', value: `+${mad(1000)}` }, { label: 'Sorties', value: `-${mad(500)}` },
    ]);
    expect(x.result).toEqual([{
      title: 'MONTANTS ATTENDUS',
      rows: [
        { label: 'Espèces', value: mad(51700), strong: true }, // 500 + 12 + 10 − 5
        { label: 'Carte', value: mad(1200), strong: false },
        { label: 'Mobile', value: mad(0), strong: false },
      ],
    }]);
    expect(x.cashCount).toEqual([]);
    expect(x.notes).toEqual(['Note d’ouverture : Billets de 20']);
    expect(x.pending).toBeNull();
  });

  it('retours de la session : bloc RETOURS et espèces rendues ; rien de plus sans retour', () => {
    const refund = {
      id: '7e4a2c1b-9d8f-4e6a-b5c3-2a1b0c9d8e7f', number: 'R-ST2-REG3-000001', store_id: 'st_2', register_id: 'reg_3',
      session_id: opening.id, original_sale_id: sales[0].id, cashier_id: 'u_2', customer_id: null, created_at: '2026-11-12T16:00:00Z',
      reason: 'defective' as const, reason_text: null, lines: [], totals: { ht: 667, tva: 133, ttc: 800 },
      payments: [{ method: 'cash' as const, amount: 300 }, { method: 'card' as const, amount: 500 }],
    };
    const x = buildSessionReceipt({ ...base, refunds: [refund], session: open, printedAt: new Date('2026-11-12T16:10:00Z') });
    expect(x.refunds).toEqual([
      { label: 'Nombre de retours', value: '1' }, { label: 'Total TTC remboursé', value: `-${mad(800)}` },
      { label: '  Espèces', value: `-${mad(300)}` }, { label: '  Carte', value: `-${mad(500)}` },
    ]);
    expect(x.cash[2]).toEqual({ label: 'Remboursements', value: `-${mad(300)}` });
    expect(x.result[0].rows.slice(0, 2)).toEqual([
      { label: 'Espèces', value: mad(51400), strong: true }, // 517 − 3
      { label: 'Carte', value: mad(700), strong: false }, // 12 − 5
    ]);
    const none = buildSessionReceipt({ ...base, session: open, printedAt: new Date('2026-11-12T16:10:00Z') });
    expect(none.refunds).toEqual([]);
    expect(none.cash).toHaveLength(4);
  });

  it('opérations pas encore envoyées : signalées sur le rapport', () => {
    const at = new Date('2026-11-12T15:40:00Z');
    expect(buildSessionReceipt({ ...base, session: open, printedAt: at, pending: 1 }).pending).toBe('1 opération pas encore envoyée au serveur');
    expect(buildSessionReceipt({ ...base, session: open, printedAt: at, pending: 3 }).pending).toBe('3 opérations pas encore envoyées au serveur');
  });

  it('rapport de clôture : qui et quand, attendu / compté / écart par moyen, comptage et note de clôture', () => {
    const closing = buildClosing({
      counted: { cash: 51000, card: 1200, mobile: 0 }, expected: { cash: 51700, card: 1200, mobile: 0 },
      cashCount: [{ value: 20000, quantity: 2 }, { value: 10000, quantity: 1 }, { value: 50, quantity: 20 }],
      note: 'Erreur de rendu', role: 'cashier', threshold: 2000, closedBy: 'u_1', now: new Date('2026-11-12T20:30:00Z'),
    });
    const z = buildSessionReceipt({ ...base, session: closedSession(open, closing, 'Falcon'), printedAt: new Date('2026-11-12T20:30:05Z'), pending: 4 });
    expect(z.title).toBe('RAPPORT DE CLÔTURE');
    expect(z.subtitle).toBeNull();
    expect(z.info.slice(3)).toEqual([{ label: 'Clôture', value: '12/11/2026 20:30' }, { label: 'Clôturée par', value: 'Falcon' }]);
    expect(z.result).toEqual([
      { title: 'ESPÈCES', rows: [
        { label: 'Attendu', value: mad(51700) }, { label: 'Compté', value: mad(51000) }, { label: 'Écart', value: `-${mad(700)}`, strong: true },
      ] },
      { title: 'CARTE', rows: [
        { label: 'Attendu', value: mad(1200) }, { label: 'Compté', value: mad(1200) }, { label: 'Écart', value: mad(0), strong: true },
      ] },
      { title: 'MOBILE', rows: [
        { label: 'Attendu', value: mad(0) }, { label: 'Compté', value: mad(0) }, { label: 'Écart', value: mad(0), strong: true },
      ] },
    ]);
    expect(z.cashCount).toEqual([
      { label: '2 × 200 DH', value: mad(40000) }, { label: '1 × 100 DH', value: mad(10000) }, { label: '20 × 0,50 DH', value: mad(1000) },
    ]);
    expect(z.notes).toEqual(['Note d’ouverture : Billets de 20', 'Note de clôture : Erreur de rendu']);
    expect(z.pending).toBe('4 opérations pas encore envoyées au serveur');
  });
});

describe('ticket d’entrée / sortie d’espèces', () => {
  const movement = {
    ...buildMovement({
      id: '9a1c4e7b-2d3f-4b8a-8c6d-5e4f3a2b1c0d', sessionId: '3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f', type: 'out', amount: 5000,
      reason: 'Achat de sacs', createdBy: 'u_2', available: 57000, now: new Date('2026-11-12T11:15:00Z'),
    }),
    cashier_name: 'Caissier 1',
  };

  it('sortie : titre, caisse, date, auteur, motif et montant négatif', () => {
    const r = buildMovementReceipt({ movement, registerName: 'Caisse 1', store, timeZone: 'UTC', copy: false });
    expect(r).toEqual({
      store, title: 'SORTIE D’ESPÈCES', copy: false,
      info: [{ label: 'Caisse', value: 'Caisse 1' }, { label: 'Date', value: '12/11/2026 11:15' }, { label: 'Par', value: 'Caissier 1' }],
      reason: 'Achat de sacs',
      amount: { label: 'MONTANT', value: `-${mad(5000)}` },
    });
  });

  it('entrée réimprimée : duplicata, montant positif', () => {
    const r = buildMovementReceipt({ movement: { ...movement, type: 'in' }, registerName: 'Caisse 1', store, timeZone: 'UTC', copy: true });
    expect(r).toMatchObject({ title: 'ENTRÉE D’ESPÈCES', copy: true, amount: { value: `+${mad(5000)}` } });
  });
});

describe('ticket de remboursement', () => {
  // 2 pains (0 %) + 1 thon remisé (20 %), 1 DH de remise globale : 11 DH, dont 1 DH à crédit.
  const original = sale({
    globalDiscount: 100, payments: [{ method: 'cash', amount: 1000 }, { method: 'credit', amount: 100 }], amountReceived: 1000, customer: client,
  });
  const refund = buildRefund({
    sale: original, refunds: [], quantities: new Map([[0, 1], [1, 1]]), reason: 'other', reasonText: 'Date dépassée',
    payments: [{ method: 'credit', amount: 100 }, { method: 'cash', amount: 863 }], cashAvailable: 100000, storeId: 'st_2',
    registerId: 'reg_3', sessionId: '3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f', cashierId: 'u_2', id: '7e4a2c1b-9d8f-4e6a-b5c3-2a1b0c9d8e7f',
    counter: 4, now: new Date('2026-11-12T16:05:00Z'),
  });

  it('numéro, ticket d’origine, motif, lignes en négatif, TVA par taux, total et moyens de remboursement', () => {
    const r = buildRefundReceipt({ refund, saleNumber: original.number, cashier: 'Caissier 1', customer: 'Fatima Zahra' }, store, 'UTC', false);
    expect(r.copy).toBe(false);
    expect(r.info).toEqual([
      { label: 'Retour', value: 'R-ST2-REG3-000004' }, { label: 'Ticket d’origine', value: 'ST2-REG3-000012' },
      { label: 'Date', value: '12/11/2026 16:05' }, { label: 'Caissier', value: 'Caissier 1' }, { label: 'Client', value: 'Fatima Zahra' },
    ]);
    expect(r.reason).toBe('Autre : Date dépassée');
    expect(r.lines.map((l) => [l.name, l.detail])).toEqual([['PAIN NORMAL', '1 × ' + mad(150)], ['THON ISABEL TOMATE', '1 × ' + mad(1000)]]);
    expect(r.lines.every((l) => l.total.startsWith('-'))).toBe(true);
    expect(r.totals.ttc).toBe(mad(963)); // pain : 2,75 DH payés pour 2, la moitié arrondie 1,38 ; thon : 8,25
    expect(r.vat.map((g) => g.rate)).toEqual(['20 %', '0 %']);
    expect(r.payments).toEqual([{ label: 'Déduit du crédit', value: mad(100) }, { label: 'Rendu en espèces', value: mad(863) }]);
    expect(buildRefundReceipt({ refund, saleNumber: original.number, cashier: 'X', customer: null }, store, 'UTC', true))
      .toMatchObject({ copy: true, info: expect.arrayContaining([{ label: 'Client', value: 'Client de passage' }]) });
  });
});
