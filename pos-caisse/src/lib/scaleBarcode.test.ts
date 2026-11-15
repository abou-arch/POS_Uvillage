import { describe, expect, it } from 'vitest';
import type { BarcodeRule, Product } from '../types';
import {
  baseCode, decodeScaleBarcode, ean13CheckDigit, isBarcodeRule, isEan13, readScaleBarcode, usableRules,
} from './scaleBarcode';

// Règles d'exemple du contrat (§3) : le format de la balance du client reste à confirmer.
const WEIGHT: BarcodeRule = { prefix: '21', type: 'weight', integer_digits: 2, decimal_digits: 3 };
const PRICE: BarcodeRule = { prefix: '23', type: 'price', integer_digits: 3, decimal_digits: 2 };
const RULES = [WEIGHT, PRICE];

const product = (id: string, barcode: string | null, price_ttc: number, unit: 'unit' | 'kg'): Product => ({
  id, code: id, barcode, name: id.toUpperCase(), name_ar: null, category_id: null, brand_id: null, price_ttc, tva_rate: 0, unit,
  image_url: null, stock: 40, stock_alert: 5, expiry_date: null, active: true, updated_at: '2026-11-14T00:00:00Z',
});
// Codes de base calculés à la main : 21 00123 00000 → contrôle 5 ; 22 00456 00000 → contrôle 7 ; 21 00789 00000 → 5.
const olives = product('olives', '2100123000005', 2500, 'kg'); // 25,00 DH le kg
const fromage = product('fromage', '2300456000004', 9000, 'kg'); // 90,00 DH le kg
const pain = product('pain', '2100789000005', 150, 'unit');
const CATALOG = [olives, fromage, pain];

describe('chiffre de contrôle EAN-13', () => {
  it('codes de référence', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(ean13CheckDigit('590123412345')).toBe(7);
    expect(isEan13('4006381333931')).toBe(true);
    expect(isEan13('4006381333932')).toBe(false);
    expect(isEan13('400638133393')).toBe(false); // 12 chiffres
  });
});

describe('code-barres de la balance (§3, contrat 0.7)', () => {
  it('critère 6e : code au poids → le bon article avec le bon poids', () => {
    // 21 | 00123 | 00750 (0,750 kg) | 9
    expect(readScaleBarcode('2100123007509', RULES, CATALOG)).toEqual({ product: olives, quantity: 0.75 });
    expect(decodeScaleBarcode('2100123007509', RULES)).toMatchObject({ baseCode: '2100123000005', weight: 0.75, price: null });
  });

  it('critère 6e : chiffre de contrôle faux → refusé', () => {
    expect(readScaleBarcode('2100123007508', RULES, CATALOG)).toEqual({
      error: 'Code-barres de balance illisible (chiffre de contrôle faux) : scannez-le à nouveau.',
    });
  });

  it('code de base retrouvé : la valeur remplacée par des zéros, contrôle recalculé', () => {
    expect(baseCode('2100123007509', WEIGHT)).toBe('2100123000005');
    expect(baseCode('2300456012359', PRICE)).toBe('2300456000004');
  });

  it('code au prix : quantité = prix ÷ prix au kg, arrondie à 3 décimales', () => {
    // 22 | 00456 | 01235 (12,35 DH) | 2 ; fromage à 90 DH/kg : 0,13722… → 0,137 kg
    expect(decodeScaleBarcode('2300456012359', RULES)).toMatchObject({ weight: null, price: 1235 });
    expect(readScaleBarcode('2300456012359', RULES, CATALOG)).toEqual({ product: fromage, quantity: 0.137 });
    // Même étiquette sur les olives (25 DH/kg) : 0,494 kg
    const olivesAuPrix = { ...olives, barcode: '2300456000004' };
    expect(readScaleBarcode('2300456012359', RULES, [olivesAuPrix])).toEqual({ product: olivesAuPrix, quantity: 0.494 });
  });

  it('article inconnu, article à la pièce, poids nul : refusés avec la raison', () => {
    // 21 | 00999 | 00500 | contrôle juste, mais aucun article n'a le code de base 2100999000006
    const unknown = `210099900500${ean13CheckDigit('210099900500')}`;
    expect(readScaleBarcode(unknown, RULES, CATALOG)).toEqual({ error: `Article de balance inconnu (code de base ${baseCode(unknown, WEIGHT)}).` });
    const surPain = `210078900500${ean13CheckDigit('210078900500')}`;
    expect(readScaleBarcode(surPain, RULES, CATALOG)).toEqual({ error: 'PAIN se vend à la pièce : ce code de balance ne lui correspond pas.' });
    const vide = `210012300000${ean13CheckDigit('210012300000')}`;
    expect(readScaleBarcode(vide, RULES, CATALOG)).toEqual({ error: 'OLIVES : poids nul sur l’étiquette.' });
  });

  it('pas un code de balance : autre préfixe, pas 13 chiffres, aucune règle', () => {
    expect(readScaleBarcode('6110000000011', RULES, CATALOG)).toBeNull();
    expect(readScaleBarcode('IT0001', RULES, CATALOG)).toBeNull();
    expect(readScaleBarcode('2100123007509', [], CATALOG)).toBeNull();
  });

  it('règles reçues de l’API : une règle incohérente est écartée', () => {
    expect(isBarcodeRule(WEIGHT)).toBe(true);
    expect(isBarcodeRule(PRICE)).toBe(true);
    expect(isBarcodeRule({ ...WEIGHT, type: 'volume' })).toBe(false);
    expect(isBarcodeRule({ ...WEIGHT, prefix: '2a' })).toBe(false);
    expect(isBarcodeRule({ ...WEIGHT, decimal_digits: 4 })).toBe(false); // poids au-delà du gramme
    expect(isBarcodeRule({ ...PRICE, decimal_digits: 3 })).toBe(false); // prix au-delà du centime
    expect(isBarcodeRule({ ...WEIGHT, integer_digits: 8 })).toBe(false); // plus de place pour le code article
    expect(usableRules([WEIGHT, PRICE, { prefix: 'x' }])).toEqual([WEIGHT, PRICE]);
    // « 2 » est le début de « 21 » : un code pourrait se lire de deux façons, les deux règles sont écartées.
    expect(usableRules([WEIGHT, { ...PRICE, prefix: '2' }])).toEqual([]);
    expect(usableRules(null)).toEqual([]);
  });
});
