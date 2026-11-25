import { describe, expect, it } from 'vitest';
import type { Customer, Product } from '../types';
import { articleCount, canSendSms, cartReducer, chargesError, emptyCart, MAX_OTHER_CHARGES, quantityError, readQuantity, type CartAction, type CartState } from './cart';

const product = (id: string, price_ttc: number): Product => ({
  id, code: id, barcode: null, name: id.toUpperCase(), name_ar: null, category_id: null, brand_id: null,
  price_ttc, tva_rate: 20, unit: 'unit', image_url: null, stock: 50, stock_alert: 5, expiry_date: null, active: true, updated_at: '',
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

describe('quantités à la pièce et au poids (§1, contrat 0.7)', () => {
  const olives = { ...product('p5', 2500), unit: 'kg' as const }; // 25,00 DH le kg

  it('critère 6e : un article à la pièce refuse 1,5 ; le panier ne change pas', () => {
    const cart = run({ type: 'add', product: product('p1', 1000) }, { type: 'setQuantity', productId: 'p1', quantity: 1.5 });
    expect(cart.lines[0].quantity).toBe(1);
    expect(quantityError('unit', 1.5)).toBe('Article vendu à la pièce : quantité entière (pas de 1,5).');
    expect(readQuantity('1,5', 'unit')).toEqual({ quantity: null, error: 'Article vendu à la pièce : quantité entière (pas de 1,5).' });
    expect(readQuantity('3', 'unit')).toEqual({ quantity: 3, error: null });
    expect(run({ type: 'add', product: product('p1', 1000), quantity: 0.5 }).lines).toEqual([]);
  });

  it('article au poids : saisi en kg, 3 décimales au plus', () => {
    const cart = run({ type: 'add', product: olives, quantity: 0.75 });
    expect(cart.lines[0]).toMatchObject({ unit: 'kg', quantity: 0.75, unit_price_ttc: 2500 });
    expect(readQuantity('0,750', 'kg')).toEqual({ quantity: 0.75, error: null });
    expect(readQuantity('0.7505', 'kg').error).toBe('Poids : 3 décimales au plus (au gramme près).');
    expect(readQuantity('abc', 'kg').error).toBe('Poids invalide : en kg, par exemple 0,750.');
    expect(readQuantity('0', 'kg').error).toBe('Poids invalide.');
    expect(cartReducer(cart, { type: 'setQuantity', productId: 'p5', quantity: 1.2345 }).lines[0].quantity).toBe(0.75);
    expect(cartReducer(cart, { type: 'setQuantity', productId: 'p5', quantity: 1.25 }).lines[0].quantity).toBe(1.25);
  });

  it('deux pesées du même article s’additionnent au gramme près', () => {
    const cart = run({ type: 'add', product: olives, quantity: 0.375 }, { type: 'add', product: olives, quantity: 0.5 });
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(0.875);
  });

  it('quantités aberrantes refusées', () => {
    expect(quantityError('unit', 0)).toBe('Quantité invalide.');
    expect(quantityError('unit', -2)).toBe('Quantité invalide.');
    expect(quantityError('unit', Number.NaN)).toBe('Quantité invalide.');
    expect(quantityError('unit', 10_000)).toMatch(/au plus/);
    expect(quantityError('kg', 0.001)).toBeNull();
  });

  it('nombre d’articles : les pièces, plus un par article pesé', () => {
    const cart = run({ type: 'add', product: product('p1', 1000) }, { type: 'add', product: product('p1', 1000) },
      { type: 'add', product: olives, quantity: 0.375 });
    expect(articleCount(cart.lines)).toBe(3);
  });
});

describe('client spécial (contrat 0.9)', () => {
  const fidele: Customer = { id: 'c_9', name: 'Fidèle', phone: null, matricule: null, discount_percent: 10 };
  it('applique son pourcentage aux articles, recalculé à chaque changement, hors frais', () => {
    const cart = run(
      { type: 'add', product: product('p1', 1000) },
      { type: 'setCustomer', customer: fidele },
      { type: 'add', product: product('p2', 555) },
      { type: 'setOtherCharges', amount: 500 },
    );
    expect(cart.globalDiscount).toBe(156); // 10 % de 15,55 DH, arrondi au centime ; les 5 DH de frais n'y sont pas
  });
  it('compte les remises de ligne avant le pourcentage et ignore une remise globale tapée', () => {
    const cart = run(
      { type: 'setCustomer', customer: fidele },
      { type: 'add', product: product('p1', 2000) },
      { type: 'setDiscount', productId: 'p1', discount: 500 },
      { type: 'setGlobalDiscount', amount: 1000 },
    );
    expect(cart.globalDiscount).toBe(150);
  });
  it('retirer le client spécial retire sa remise', () => {
    const cart = run({ type: 'add', product: product('p1', 1000) }, { type: 'setCustomer', customer: fidele }, { type: 'setCustomer', customer: null });
    expect(cart.globalDiscount).toBe(0);
  });
  it('un client ordinaire garde la remise globale tapée', () => {
    const cart = run({ type: 'add', product: product('p1', 1000) }, { type: 'setGlobalDiscount', amount: 100 }, { type: 'setCustomer', customer: ahmed });
    expect(cart.globalDiscount).toBe(100);
  });
});

describe('frais supplémentaires', () => {
  it('s’ajoutent au total ; aberrants refusés et plafonnés', () => {
    expect(chargesError(500)).toBeNull();
    expect(chargesError(0)).toBeNull(); // 0 retire les frais
    expect(chargesError(null)).toMatch(/invalide/);
    expect(chargesError(MAX_OTHER_CHARGES + 1)).toMatch(/au plus/);
    expect(run({ type: 'setOtherCharges', amount: 5_000_000 }).otherCharges).toBe(MAX_OTHER_CHARGES);
  });
});
