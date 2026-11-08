import { describe, expect, it } from 'vitest';
import type { Customer, Product } from '../types';
import { canSendSms, cartReducer, emptyCart, type CartAction, type CartState } from './cart';

const product = (id: string, price_ttc: number): Product => ({
  id, code: id, barcode: null, name: id.toUpperCase(), name_ar: null, category_id: null, brand_id: null,
  price_ttc, tva_rate: 20, image_url: null, stock: 50, stock_alert: 5, expiry_date: null, active: true, updated_at: '',
});
const run = (...actions: CartAction[]): CartState => actions.reduce(cartReducer, emptyCart);

describe('remises', () => {
  it('recale la remise de ligne quand la quantité baisse', () => {
    const cart = run(
      { type: 'add', product: product('p1', 1000) },
      { type: 'setQuantity', productId: 'p1', quantity: 3 },
      { type: 'setDiscount', productId: 'p1', discount: 2500 },
      { type: 'setQuantity', productId: 'p1', quantity: 1 },
    );
    expect(cart.lines[0].discount).toBe(1000);
  });
  it('plafonne la remise globale au total (charges comprises)', () => {
    expect(run({ type: 'add', product: product('p1', 1150) }, { type: 'setGlobalDiscount', amount: 5000 }).globalDiscount).toBe(1150);
    expect(run(
      { type: 'add', product: product('p1', 1150) },
      { type: 'setOtherCharges', amount: 200 },
      { type: 'setGlobalDiscount', amount: 5000 },
    ).globalDiscount).toBe(1350);
  });
  it('recale la remise globale quand on retire un article', () => {
    const cart = run(
      { type: 'add', product: product('p1', 1000) },
      { type: 'add', product: product('p2', 500) },
      { type: 'setGlobalDiscount', amount: 1200 },
      { type: 'remove', productId: 'p1' },
    );
    expect(cart.globalDiscount).toBe(500);
  });
});

const ahmed: Customer = { id: 'c_1', name: 'Ahmed', phone: '+212600000001', matricule: null };
const sansTelephone: Customer = { id: 'c_3', name: 'Karim', phone: null, matricule: null };

describe('client et SMS', () => {
  it('pas de SMS pour le client de passage', () => {
    expect(canSendSms(emptyCart)).toBe(false);
    expect(cartReducer(emptyCart, { type: 'toggleSms' }).sendSms).toBe(false);
  });
  it('autorise le SMS quand le client a un téléphone', () => {
    const withAhmed = cartReducer(emptyCart, { type: 'setCustomer', customer: ahmed });
    expect(canSendSms(withAhmed)).toBe(true);
    expect(cartReducer(withAhmed, { type: 'toggleSms' }).sendSms).toBe(true);
  });
  it('décoche le SMS si on passe à un client sans téléphone', () => {
    const sms = cartReducer(cartReducer(emptyCart, { type: 'setCustomer', customer: ahmed }), { type: 'toggleSms' });
    const switched = cartReducer(sms, { type: 'setCustomer', customer: sansTelephone });
    expect(switched.sendSms).toBe(false);
    expect(cartReducer(switched, { type: 'toggleSms' }).sendSms).toBe(false);
  });
  it('revenir au client de passage décoche le SMS', () => {
    const sms = cartReducer(cartReducer(emptyCart, { type: 'setCustomer', customer: ahmed }), { type: 'toggleSms' });
    const cleared = cartReducer(sms, { type: 'setCustomer', customer: null });
    expect(cleared).toMatchObject({ customer: null, sendSms: false });
  });
});
