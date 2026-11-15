import { describe, expect, it } from 'vitest';
import type { BarcodeRule, Product } from '../types';
import { lookupScan } from './scan';

// Règle d'exemple (§3) : préfixe 21, poids en kg sur 2 + 3 chiffres.
const RULES: BarcodeRule[] = [{ prefix: '21', type: 'weight', integer_digits: 2, decimal_digits: 3 }];
const product = (id: string, code: string, barcode: string | null, name: string, unit: 'unit' | 'kg'): Product => ({
  id, code, barcode, name, name_ar: null, category_id: null, brand_id: null, price_ttc: 2500, tva_rate: 0, unit,
  image_url: null, stock: 40, stock_alert: 5, expiry_date: null, active: true, updated_at: '2026-11-14T00:00:00Z',
});
const olives = product('p_olives', 'IT0100', '2100123000005', 'OLIVES NOIRES', 'kg');
const pain = product('p_pain', 'IT0001', '6111000000013', 'PAIN NORMAL', 'unit');
const CATALOG = [olives, pain];

describe('champ de scan', () => {
  it('code-barres ou code article exact', () => {
    expect(lookupScan('6111000000013', CATALOG, RULES)).toEqual({ kind: 'product', product: pain });
    expect(lookupScan(' it0001 ', CATALOG, RULES)).toEqual({ kind: 'product', product: pain });
  });

  it('code de base d’un article au poids : l’article, le poids reste à saisir', () => {
    expect(lookupScan('2100123000005', CATALOG, RULES)).toEqual({ kind: 'product', product: olives });
  });

  it('étiquette de la balance : l’article et son poids', () => {
    expect(lookupScan('2100123007509', CATALOG, RULES)).toEqual({ kind: 'weighed', product: olives, quantity: 0.75 });
  });

  it('étiquette illisible : refusée avec la raison, pas cherchée par nom', () => {
    expect(lookupScan('2100123007508', CATALOG, RULES)).toEqual({
      kind: 'error', message: 'Code-barres de balance illisible (chiffre de contrôle faux) : scannez-le à nouveau.',
    });
  });

  it('nom, puis rien', () => {
    expect(lookupScan('olives', CATALOG, RULES)).toEqual({ kind: 'product', product: olives });
    expect(lookupScan('  cafe ', CATALOG, RULES)).toEqual({ kind: 'error', message: 'Aucun article pour « cafe »' });
    expect(lookupScan('   ', CATALOG, RULES)).toBeNull();
  });
});
