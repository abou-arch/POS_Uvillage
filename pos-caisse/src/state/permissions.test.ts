import { describe, expect, it } from 'vitest';
import { formatMad } from '../lib/totals.js';
import type { CartLine, MethodCount } from '../types';
import { emptyCart, type CartState } from './cart';
import {
  afterFailure, closingNeedsApproval, discountNeedsApproval, discountsOverLimit, limitLabel, loadPinLock, lockLabel, lockRemaining,
  MAX_PIN_FAILURES, needsApproval, NO_LOCK, overDiscountLimit, PIN_LOCK_MS, savePinLock, type DiscountLimits,
} from './permissions';

const line = (product_id: string, quantity: number, unit_price_ttc: number, discount = 0): CartLine =>
  ({ product_id, name: product_id.toUpperCase(), quantity, unit_price_ttc, discount, tva_rate: 20, stock: 100 });
const cart = (lines: CartLine[], extra: Partial<CartState> = {}): CartState => ({ ...emptyCart, lines, ...extra });
const LIMITS: DiscountLimits = { percent: 10, amount: 5000 }; // 10 % et 50 DH

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe('qui fait autoriser (§11)', () => {
  it('un caissier fait autoriser ; un manager ou un admin ne voit jamais la fenêtre', () => {
    expect(needsApproval('cashier')).toBe(true);
    expect(needsApproval('manager')).toBe(false);
    expect(needsApproval('admin')).toBe(false);
  });
});

describe('plafond de remise d’un caissier (§2, §11)', () => {
  it('critère 6d : une remise de 30 % sur une ligne demande le PIN au caissier, pas à l’admin', () => {
    const c = cart([line('p_1', 2, 1000, 600)]); // 20 DH, remise 6 DH = 30 %
    expect(discountNeedsApproval('cashier', c, LIMITS)).toBe(true);
    expect(discountNeedsApproval('admin', c, LIMITS)).toBe(false);
    expect(discountNeedsApproval('manager', c, LIMITS)).toBe(false);
    expect(discountsOverLimit(c, LIMITS)).toEqual({ lines: ['p_1'], global: false });
  });

  it('pourcentage : égal au plafond permis, un centime de plus non ; calcul en entiers', () => {
    expect(overDiscountLimit(100, 1000, LIMITS)).toBe(false); // 10 % pile
    expect(overDiscountLimit(101, 1000, LIMITS)).toBe(true);
    expect(overDiscountLimit(33, 333, LIMITS)).toBe(false); // 9,9 %
    expect(overDiscountLimit(34, 333, LIMITS)).toBe(true); // 10,2 %
    expect(overDiscountLimit(0, 1000, LIMITS)).toBe(false); // pas de remise, rien à autoriser
  });

  it('montant en DH : au-delà de 50 DH même sous 10 % ; null = pas de plafond de ce type', () => {
    expect(overDiscountLimit(5000, 100_000, LIMITS)).toBe(false); // 50 DH sur 1 000 DH
    expect(overDiscountLimit(5001, 100_000, LIMITS)).toBe(true);
    expect(overDiscountLimit(5001, 100_000, { percent: 10, amount: null })).toBe(false);
    expect(overDiscountLimit(900, 1000, { percent: null, amount: 5000 })).toBe(false); // 90 % mais 9 DH
    expect(overDiscountLimit(900, 1000, { percent: null, amount: null })).toBe(false); // aucun plafond
    expect(overDiscountLimit(1, 1000, { percent: 0, amount: null })).toBe(true); // 0 % : toute remise
  });

  it('remise globale : rapportée aux lignes après leurs remises, plus les autres charges', () => {
    // Lignes 100 DH − 5 DH de remise de ligne + 5 DH d'autres charges = 100 DH de base.
    const base = { lines: [line('p_1', 10, 1000, 500)], otherCharges: 500 };
    expect(discountsOverLimit(cart(base.lines, { ...base, globalDiscount: 1000 }), LIMITS)).toEqual({ lines: [], global: false });
    expect(discountsOverLimit(cart(base.lines, { ...base, globalDiscount: 1001 }), LIMITS)).toEqual({ lines: [], global: true });
    expect(discountNeedsApproval('cashier', cart(base.lines, { ...base, globalDiscount: 1001 }), LIMITS)).toBe(true);
  });

  it('chaque ligne est jugée sur son propre montant ; quantité au poids arrondie au centime', () => {
    const c = cart([line('p_1', 3, 1000, 300), line('p_2', 1, 500, 51), line('p_3', 0.25, 4000, 100)]);
    expect(discountsOverLimit(c, LIMITS)).toEqual({ lines: ['p_2'], global: false }); // 10,2 % ; 10 % pile ; 10 % pile
    expect(discountNeedsApproval('cashier', cart([line('p_1', 3, 1000, 300)]), LIMITS)).toBe(false);
  });

  it('libellé du plafond', () => {
    expect(limitLabel(LIMITS, formatMad)).toBe(`10 % et ${formatMad(5000)}`);
    expect(limitLabel({ percent: 15, amount: null }, formatMad)).toBe('15 %');
    expect(limitLabel({ percent: null, amount: null }, formatMad)).toBeNull();
  });
});

describe('clôture au-delà du seuil (§9, §11)', () => {
  const counts = (cash: number, card = 0): MethodCount[] => [
    { method: 'cash', expected: 57000, counted: 57000 + cash, difference: cash },
    { method: 'card', expected: 8000, counted: 8000 + card, difference: card },
    { method: 'mobile', expected: 0, counted: 0, difference: 0 },
  ];
  it('un écart de plus que le seuil, manque ou excédent, sur n’importe quel moyen', () => {
    expect(closingNeedsApproval('cashier', counts(-2000), 2000)).toBe(false); // pile le seuil
    expect(closingNeedsApproval('cashier', counts(-2001), 2000)).toBe(true);
    expect(closingNeedsApproval('cashier', counts(0, 2500), 2000)).toBe(true);
    expect(closingNeedsApproval('manager', counts(-9000), 2000)).toBe(false);
    expect(closingNeedsApproval('cashier', counts(-1), 0)).toBe(true); // seuil 0 : tout écart
  });
});

describe('blocage après 3 PIN faux (§11)', () => {
  const t0 = 1_800_000_000_000;

  it('3 PIN faux de suite : bloqué 1 minute, puis le compte repart de zéro', () => {
    let lock = afterFailure(NO_LOCK, t0);
    expect(lock).toEqual({ failures: 1, lockedUntil: 0 });
    lock = afterFailure(lock, t0 + 1000);
    expect(lockRemaining(lock, t0 + 1000)).toBe(0); // 2 essais ratés : pas encore bloqué
    lock = afterFailure(lock, t0 + 2000);
    expect(lock).toEqual({ failures: 0, lockedUntil: t0 + 2000 + PIN_LOCK_MS });
    expect(lockRemaining(lock, t0 + 2000)).toBe(PIN_LOCK_MS);
    expect(lockRemaining(lock, t0 + 2000 + 59_000)).toBe(1000);
    expect(lockRemaining(lock, t0 + 2000 + PIN_LOCK_MS)).toBe(0); // la minute est passée
    expect(afterFailure(lock, t0 + 70_000)).toEqual({ failures: 1, lockedUntil: 0 }); // 3 nouveaux essais
    expect(MAX_PIN_FAILURES).toBe(3);
  });

  it('horloge du poste reculée : un blocage à plus d’1 minute est ignoré (la caisse ne reste pas bloquée)', () => {
    expect(lockRemaining({ failures: 0, lockedUntil: t0 + 10 * PIN_LOCK_MS }, t0)).toBe(0);
  });

  it('gardé sur le poste : un F5 ne remet pas les essais à zéro ; abîmé → pas de blocage', () => {
    const storage = memoryStorage();
    expect(loadPinLock(storage)).toEqual(NO_LOCK);
    const lock = afterFailure(afterFailure(NO_LOCK, t0), t0);
    expect(savePinLock(lock, storage)).toBe(true);
    expect(loadPinLock(storage)).toEqual({ failures: 2, lockedUntil: 0 });
    expect(loadPinLock(memoryStorage({ 'pos.pinLock': '{"failures":"x"}' }))).toEqual(NO_LOCK);
    expect(loadPinLock(memoryStorage({ 'pos.pinLock': 'pas du json' }))).toEqual(NO_LOCK);
    expect(loadPinLock(null)).toEqual(NO_LOCK); // stockage indisponible
  });

  it('temps restant affiché', () => {
    expect(lockLabel(60_000)).toBe('1 min');
    expect(lockLabel(45_200)).toBe('46 s');
    expect(lockLabel(300)).toBe('1 s');
  });
});
