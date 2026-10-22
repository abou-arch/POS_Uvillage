import { describe, expect, it } from 'vitest';
import { STORE_INFO, storeInfo } from '../config/store';
import { emptyCart } from '../state/cart';
import { loadLastReceipt, saveLastReceipt } from '../state/lastReceipt';
import type { CartLine, Customer, Payment } from '../types';
import { buildSale } from './buildSale';
import { buildReceipt, receiptDate } from './receipt';
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
    storeId: 'st_2', registerId: 'reg_3', cashierId: 'u_2', payments, amountReceived,
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
