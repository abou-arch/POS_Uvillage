import { describe, expect, it } from 'vitest';
import type { Customer } from '../types';
import { canSendSms, cartReducer, emptyCart } from './cart';

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
