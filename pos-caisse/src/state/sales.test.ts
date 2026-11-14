import { describe, expect, it } from 'vitest';
import { buildSale } from '../lib/buildSale';
import { saleTotals } from '../lib/totals.js';
import { uuidv4 } from '../lib/uuid';
import type { CartLine, Customer } from '../types';
import { emptyCart, type CartState } from './cart';
import { lastCounter, loadPending, savePending } from './sales';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}
const stored = (value: unknown) => memoryStorage({ 'pos.pendingSales': JSON.stringify(value) });

const thon: CartLine = { product_id: 'p_9', name: 'THON ISABEL TOMATE', quantity: 1, unit_price_ttc: 1000, discount: 0, tva_rate: 20, stock: 20 };
const sale = buildSale({
  cart: { ...emptyCart, lines: [thon] }, storeId: 'st_2', registerId: 'reg_3', sessionId: '3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f', cashierId: 'u_2',
  payments: [{ method: 'cash', amount: 1000 }], amountReceived: 2000,
  id: '0f8b7c2e-5c1d-4c6e-9a4b-2f1e3d4c5b6a', lineIds: ['5d2e8f1a-7b3c-4e9d-8a6f-1c2b3d4e5f60'], counter: 1, now: new Date('2026-10-05T14:32:10Z'),
});

describe('ventes gardées sur la caisse', () => {
  it('relit la file enregistrée, motif de refus compris', () => {
    const storage = memoryStorage();
    const queue = { sales: [{ sale, error: null }, { sale: { ...sale, id: uuidv4() }, error: 'Totaux incohérents' }], unreadable: [] };
    savePending(queue, storage);
    expect(loadPending(storage)).toEqual(queue);
  });
  it('relit toute vente construite par la caisse : poids, client, SMS, charges, remise, paiement mixte', () => {
    const olives: CartLine = { product_id: 'p_5', name: 'OLIVES NOIRES', quantity: 0.375, unit_price_ttc: 2150, discount: 100, tva_rate: 7, stock: 1.5 };
    const pain: CartLine = { product_id: 'p_1', name: 'PAIN NORMAL', quantity: 2, unit_price_ttc: 150, discount: 0, tva_rate: 0, stock: 60 };
    const ahmed: Customer = { id: 'c_1', name: 'Ahmed', phone: '+212600000001', matricule: null };
    const cart: CartState = { lines: [olives, pain, thon], customer: ahmed, otherCharges: 200, globalDiscount: 50, sendSms: true };
    const { ttc } = saleTotals(cart.lines, cart.otherCharges, cart.globalDiscount);
    const mixed = buildSale({
      cart, storeId: 'st_1', registerId: 'reg_1', sessionId: '3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f', cashierId: 'u_1', amountReceived: 500, id: uuidv4(), lineIds: cart.lines.map(() => uuidv4()), counter: 42,
      payments: [{ method: 'cash', amount: 300 }, { method: 'card', amount: 500 }, { method: 'credit', amount: ttc - 800 }],
      now: new Date('2026-10-11T09:15:00.456Z'),
    });
    const storage = memoryStorage();
    savePending({ sales: [{ sale: mixed, error: null }], unreadable: [] }, storage);
    expect(loadPending(storage)).toEqual({ sales: [{ sale: mixed, error: null }], unreadable: [] });
  });
  it('relit une vente autorisée par un responsable, et une vente d’avant le contrat 0.6 sans approved_by', () => {
    const { approved_by: _a, ...before06 } = sale;
    const approved = { ...sale, id: uuidv4(), approved_by: 'u_3' };
    const queue = { sales: [{ sale: approved, error: null }, { sale: before06, error: null }], unreadable: [] };
    expect(loadPending(stored(queue.sales))).toEqual(queue);
  });
  it('met de côté une entrée illisible, sans jamais l’envoyer ni la perdre', () => {
    // { sale: { id } } : avant, elle était relue comme une vente et partait telle quelle au serveur.
    const broken = [{ sale: { id: sale.id } }, { sale }, { sale, error: 42 }, 1, null];
    const storage = stored([{ sale, error: null }, ...broken]);
    const queue = loadPending(storage);
    expect(queue).toEqual({ sales: [{ sale, error: null }], unreadable: broken });
    savePending({ ...queue, sales: [] }, storage); // la vente lisible est partie : le reste demeure
    expect(loadPending(storage)).toEqual({ sales: [], unreadable: broken });
  });
  it('refuse une vente qui ne respecte pas le contrat', () => {
    const line = sale.lines[0];
    const changes: Record<string, unknown>[] = [
      { id: 'vente-1' }, // pas un UUID v4
      { session_id: undefined }, // vente d'avant les sessions de caisse (contrat 0.3)
      { session_id: 'session-1' },
      { created_at: 'hier' },
      { customer_id: 42 },
      { lines: [] }, // panier vide
      { lines: [{ ...line, quantity: 0 }] },
      { lines: [{ ...line, unit_price_ttc: 999.5 }] }, // centimes non entiers
      { lines: [{ ...line, tva_rate: '20' }] },
      { lines: [{ ...line, total_ttc: null }] },
      { totals: { ...sale.totals, ttc: 1000.5 } },
      { totals: undefined }, // champ absent
      { change_given: -1000 },
      { amount_received: '2000' },
      { payments: [] },
      { payments: [{ method: 'cheque', amount: 1000 }] },
      { send_sms: 'oui' },
      { status: 'pending' },
      { approved_by: '' }, // ni null ni un id (§11)
      { approved_by: 3 },
    ];
    for (const change of changes) {
      const { sales, unreadable } = loadPending(stored([{ sale: { ...sale, ...change }, error: null }]));
      expect(sales, JSON.stringify(change)).toEqual([]);
      expect(unreadable).toHaveLength(1);
    }
  });
  it('garde aussi un contenu qui n’est pas une liste (autre version de la caisse)', () => {
    const other = { version: 2, sales: [{ sale, error: null }] };
    expect(loadPending(stored(other))).toEqual({ sales: [], unreadable: [other] });
  });
  it('garde tel quel un texte qui n’est plus du JSON (modifié à la main), même après la vente suivante', () => {
    const text = '[{"sale":{"id":"0f8b7c2e-5c1d-4c6e-9a4b-2f1e3d4c5b6a","number":"ST2-REG3-000001"'; // la fin a été effacée
    const storage = memoryStorage({ 'pos.pendingSales': text });
    const queue = loadPending(storage);
    expect(queue).toEqual({ sales: [], unreadable: [text] });
    savePending({ ...queue, sales: [{ sale, error: null }] }, storage);
    expect(loadPending(storage)).toEqual({ sales: [{ sale, error: null }], unreadable: [text] });
  });
  it('ne trouve rien dans un stockage vide ou indisponible', () => {
    const empty = { sales: [], unreadable: [] };
    const fail = () => { throw new Error('stockage bloqué'); };
    expect(loadPending(memoryStorage())).toEqual(empty);
    expect(loadPending(null)).toEqual(empty);
    expect(loadPending({ getItem: fail, setItem: fail, removeItem: fail })).toEqual(empty);
  });
});

describe('compteur de tickets', () => {
  it('part de 0 et reste propre à chaque caisse', () => {
    const storage = memoryStorage();
    expect(lastCounter('reg_3', storage)).toBe(0);
    storage.setItem('pos.ticketCounter.reg_3', '41');
    expect(lastCounter('reg_3', storage)).toBe(41);
    expect(lastCounter('reg_1', storage)).toBe(0);
  });
  it('ignore une valeur aberrante', () => {
    expect(lastCounter('reg_3', memoryStorage({ 'pos.ticketCounter.reg_3': '"douze"' }))).toBe(0);
    expect(lastCounter('reg_3', memoryStorage({ 'pos.ticketCounter.reg_3': '-4' }))).toBe(0);
    expect(lastCounter('reg_3', memoryStorage({ 'pos.ticketCounter.reg_3': '{oups' }))).toBe(0);
  });
});
