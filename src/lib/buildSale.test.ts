import { describe, expect, it } from 'vitest';
import { emptyCart, type CartState } from '../state/cart';
import type { CartLine, Customer, Payment, Product } from '../types';
import { buildSale, decrementStock, ticketNumber, type SaleInput } from './buildSale';

const pain: CartLine = { product_id: 'p_1', name: 'PAIN NORMAL', quantity: 2, unit_price_ttc: 150, discount: 0, tva_rate: 0, stock: 60 };
const thon: CartLine = { product_id: 'p_9', name: 'THON ISABEL TOMATE', quantity: 1, unit_price_ttc: 1000, discount: 0, tva_rate: 20, stock: 20 };
const ahmed: Customer = { id: 'c_1', name: 'Ahmed', phone: '+212600000001', matricule: '2023001542' };
const cash = (amount: number): Payment => ({ method: 'cash', amount });

function input(cart: Partial<CartState>, payments: Payment[], amountReceived: number): SaleInput {
  return {
    cart: { ...emptyCart, ...cart }, storeId: 'st_2', registerId: 'reg_3', cashierId: 'u_2', payments, amountReceived,
    id: '0f8b7c2e-5c1d-4c6e-9a4b-2f1e3d4c5b6a', counter: 7, now: new Date('2026-10-05T14:32:10.123Z'),
  };
}

describe('construction de la vente (§5 du contrat)', () => {
  it('vente en espèces avec TVA mixte 0 % et 20 %', () => {
    const sale = buildSale(input({ lines: [pain, thon] }, [cash(1300)], 2000));
    expect(sale).toMatchObject({
      id: '0f8b7c2e-5c1d-4c6e-9a4b-2f1e3d4c5b6a', number: 'ST2-REG3-000007', store_id: 'st_2', register_id: 'reg_3',
      cashier_id: 'u_2', customer_id: null, created_at: '2026-10-05T14:32:10Z', other_charges: 0, global_discount: 0,
      totals: { ht: 1133, tva: 167, ttc: 1300 }, payments: [cash(1300)], amount_received: 2000, change_given: 700,
      send_sms: false, status: 'completed',
    });
    expect(sale.lines).toEqual([
      { product_id: 'p_1', name: 'PAIN NORMAL', quantity: 2, unit_price_ttc: 150, discount: 0, tva_rate: 0, total_ht: 300, total_tva: 0, total_ttc: 300 },
      { product_id: 'p_9', name: 'THON ISABEL TOMATE', quantity: 1, unit_price_ttc: 1000, discount: 0, tva_rate: 20, total_ht: 833, total_tva: 167, total_ttc: 1000 },
    ]);
    expect(sale.lines[0]).not.toHaveProperty('stock');
  });
  it('remise de ligne', () => {
    const sale = buildSale(input({ lines: [{ ...thon, discount: 100 }] }, [cash(900)], 900));
    expect(sale.lines[0]).toMatchObject({ discount: 100, total_ht: 750, total_tva: 150, total_ttc: 900 });
    expect(sale.totals).toEqual({ ht: 750, tva: 150, ttc: 900 });
  });
  it('autres charges et remise globale réparties sur les taux', () => {
    const sale = buildSale(input({ lines: [pain, thon], otherCharges: 200, globalDiscount: 50 }, [cash(1450)], 1450));
    // +150 réparti au prorata (1000 / 300) : 115 sur le 20 %, 35 sur le 0 %.
    expect(sale).toMatchObject({ other_charges: 200, global_discount: 50, totals: { ht: 1264, tva: 186, ttc: 1450 } });
    expect(sale.totals.ht + sale.totals.tva).toBe(sale.totals.ttc);
  });
  it('paiement mixte : espèces + carte + crédit pour un client', () => {
    const payments: Payment[] = [cash(300), { method: 'card', amount: 500 }, { method: 'credit', amount: 500 }];
    const sale = buildSale(input({ lines: [pain, thon], customer: ahmed, sendSms: true }, payments, 300));
    expect(sale).toMatchObject({ customer_id: 'c_1', payments, amount_received: 300, change_given: 0, send_sms: true });
  });
  it('paiement par carte seule : aucune espèce reçue', () => {
    const sale = buildSale(input({ lines: [thon] }, [{ method: 'card', amount: 1000 }], 0));
    expect(sale).toMatchObject({ amount_received: 0, change_given: 0 });
  });
  it('refuse une vente qui ne respecte pas le contrat', () => {
    expect(() => buildSale(input({ lines: [] }, [cash(0)], 0))).toThrow('Le panier est vide.');
    expect(() => buildSale(input({ lines: [thon] }, [cash(1000)], 500))).toThrow(/Il manque/);
    expect(() => buildSale(input({ lines: [thon] }, [cash(800)], 800))).toThrow(/Reste à payer/);
    expect(() => buildSale(input({ lines: [thon] }, [{ method: 'credit', amount: 1000 }], 0))).toThrow(/demande un client/);
  });
});

describe('numéro de ticket', () => {
  it('suit le format magasin-caisse-compteur sur 6 chiffres', () => {
    expect(ticketNumber('st_1', 'reg_1', 123)).toBe('ST1-REG1-000123');
    expect(ticketNumber('st_2', 'reg_3', 1)).toBe('ST2-REG3-000001');
  });
});

describe('stock après la vente', () => {
  it('retire les quantités vendues, articles au poids compris', () => {
    const products = [{ id: 'p_1', stock: 60 }, { id: 'p_5', stock: 1.5 }, { id: 'p_9', stock: 20 }] as Product[];
    const after = decrementStock(products, [{ product_id: 'p_1', quantity: 2 }, { product_id: 'p_5', quantity: 0.3 }]);
    expect(after.map((p) => p.stock)).toEqual([58, 1.2, 20]);
    expect(after[2]).toBe(products[2]);
  });
});
