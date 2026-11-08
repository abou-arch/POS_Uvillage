import { describe, expect, it } from 'vitest';
import type { Customer, Product } from '../types';
import { cartReducer, emptyCart, type CartAction, type CartState } from './cart';
import { cleanNote, holdCart, loadHeld, MAX_NOTE_LENGTH, refreshFromCatalog, saveHeld } from './held';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

const product = (id: string, price_ttc: number, extra: Partial<Product> = {}): Product => ({
  id, code: id, barcode: null, name: id.toUpperCase(), name_ar: null, category_id: null, brand_id: null,
  price_ttc, tva_rate: 20, image_url: null, stock: 50, stock_alert: 5, expiry_date: null, active: true, updated_at: '',
  ...extra,
});
const run = (...actions: CartAction[]): CartState => actions.reduce(cartReducer, emptyCart);
const client: Customer = { id: 'c_1', name: 'Fatima', phone: '+212612345678', matricule: null };

const cart = run(
  { type: 'add', product: product('p1', 1000) },
  { type: 'add', product: product('p2', 250) },
  { type: 'setQuantity', productId: 'p2', quantity: 3 },
  { type: 'setDiscount', productId: 'p1', discount: 100 },
  { type: 'setCustomer', customer: client },
  { type: 'setOtherCharges', amount: 200 },
  { type: 'setGlobalDiscount', amount: 50 },
  { type: 'toggleSms' },
);
const now = new Date('2026-10-22T10:15:00Z');

describe('mise en attente', () => {
  it('garde lignes, client, charges, remises, note et heure', () => {
    const held = holdCart(cart, '  client parti   chercher sa carte ', 'h1', now);
    expect(held).toEqual({ id: 'h1', held_at: '2026-10-22T10:15:00.000Z', note: 'client parti chercher sa carte', cart });
  });
  it('refuse un panier vide', () => {
    expect(() => holdCart(emptyCart, '', 'h1', now)).toThrow();
  });
  it('borne la longueur de la note', () => {
    expect(cleanNote('x'.repeat(200))).toHaveLength(MAX_NOTE_LENGTH);
  });
});

describe('stockage par caisse', () => {
  it('deux paniers survivent à un rechargement, et restent propres à leur caisse', () => {
    const storage = memoryStorage();
    const list = [holdCart(cart, 'a', 'h1', now), holdCart(cart, '', 'h2', now)];
    saveHeld('reg_3', { sales: list, unreadable: [] }, storage);
    expect(loadHeld('reg_3', storage)).toEqual({ sales: list, unreadable: [] });
    expect(loadHeld('reg_4', storage)).toEqual({ sales: [], unreadable: [] });
  });
  it('garde à part, sans les jeter, les entrées illisibles ou aberrantes', () => {
    const good = holdCart(cart, '', 'h1', now);
    const absurd = { ...good, id: 'h2', cart: { ...cart, lines: [{ ...cart.lines[0], quantity: 1e9 }] } };
    const storage = memoryStorage({ 'pos.heldSales.reg_3': JSON.stringify([good, absurd, 'abîmé']) });
    const loaded = loadHeld('reg_3', storage);
    expect(loaded.sales).toEqual([good]);
    expect(loaded.unreadable).toEqual([absurd, 'abîmé']);
    saveHeld('reg_3', loaded, storage);
    expect(loadHeld('reg_3', storage)).toEqual(loaded);
  });
  it('texte qui n’est pas du JSON : gardé tel quel', () => {
    const storage = memoryStorage({ 'pos.heldSales.reg_3': '{pas du json' });
    expect(loadHeld('reg_3', storage)).toEqual({ sales: [], unreadable: ['{pas du json'] });
  });
});

describe('reprise', () => {
  it('reprend prix, TVA et stock du catalogue et signale les prix changés', () => {
    const catalog = [product('p1', 1200, { stock: 4, tva_rate: 10 }), product('p2', 250, { stock: 7 })];
    const { cart: refreshed, changes, missing, checked } = refreshFromCatalog(cart, catalog);
    expect(checked).toBe(true);
    expect(missing).toEqual([]);
    expect(changes).toEqual([{ product_id: 'p1', name: 'P1', before: 1000, after: 1200 }]);
    expect(refreshed.lines.map((l) => [l.unit_price_ttc, l.tva_rate, l.stock, l.quantity, l.discount]))
      .toEqual([[1200, 10, 4, 1, 100], [250, 20, 7, 3, 0]]);
    expect(refreshed.customer).toEqual(client);
    expect([refreshed.otherCharges, refreshed.globalDiscount, refreshed.sendSms]).toEqual([200, 50, true]);
  });
  it('article retiré ou désactivé : laissé tel quel et signalé', () => {
    const { cart: refreshed, missing } = refreshFromCatalog(cart, [product('p1', 1000), product('p2', 250, { active: false })]);
    expect(missing).toEqual(['P2']);
    expect(refreshed.lines[1]).toEqual(cart.lines[1]);
  });
  it('catalogue pas chargé : rien n’est vérifié', () => {
    expect(refreshFromCatalog(cart, [])).toEqual({ cart, changes: [], missing: [], checked: false });
  });
  it('une baisse de prix recale les remises à la restauration', () => {
    const { cart: refreshed } = refreshFromCatalog(cart, [product('p1', 50), product('p2', 250)]);
    const restored = cartReducer(emptyCart, { type: 'restore', state: refreshed });
    expect(restored.lines[0].discount).toBe(50);
  });
});
