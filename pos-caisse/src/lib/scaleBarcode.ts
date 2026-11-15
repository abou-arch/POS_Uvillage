// Codes-barres imprimés par la balance (§3, contrat 0.7) : EAN-13 = préfixe, code article, valeur (poids ou prix),
// chiffre de contrôle. Les règles viennent de l'API (GET /api/stores/{id}/barcode-rules), rien n'est codé en dur.
// Fonctions pures : tout est testé.
import { isRecord } from './storage';
import type { BarcodeRule, Product } from '../types';

const EAN13 = /^\d{13}$/;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Chiffre de contrôle EAN-13 des 12 premiers chiffres : poids 1 et 3 en alternance, complément à la dizaine. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** 13 chiffres et chiffre de contrôle juste. */
export const isEan13 = (code: string) => EAN13.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);

/** Nombre de chiffres du code article d'une règle : ce qui reste entre le préfixe et la valeur. */
export const articleDigits = (r: BarcodeRule) => 12 - r.prefix.length - r.integer_digits - r.decimal_digits;

/** Règle reçue de l'API, contrôlée : une règle incohérente est écartée plutôt que de mal lire un code. */
export const isBarcodeRule = (v: unknown): v is BarcodeRule =>
  isRecord(v) && typeof v.prefix === 'string' && /^\d{1,6}$/.test(v.prefix)
  && (v.type === 'weight' || v.type === 'price')
  && Number.isInteger(v.integer_digits) && Number.isInteger(v.decimal_digits)
  && (v.integer_digits as number) >= 0 && (v.decimal_digits as number) >= 0
  && (v.integer_digits as number) + (v.decimal_digits as number) >= 1
  && (v.decimal_digits as number) <= (v.type === 'weight' ? 3 : 2)
  && articleDigits(v as unknown as BarcodeRule) >= 1;

/** Règles utilisables : valides, et aucun préfixe n'est le début d'un autre (sinon un code pourrait se lire de deux façons). */
export function usableRules(list: unknown): BarcodeRule[] {
  if (!Array.isArray(list)) return [];
  const rules = list.filter(isBarcodeRule);
  return rules.filter((r) => !rules.some((o) => o !== r && (o.prefix.startsWith(r.prefix) || r.prefix.startsWith(o.prefix))));
}

/** Code de base de l'article : la valeur remplacée par des zéros, chiffre de contrôle recalculé. C'est son barcode au catalogue. */
export function baseCode(code: string, rule: BarcodeRule): string {
  const head = code.slice(0, rule.prefix.length + articleDigits(rule));
  const first12 = head + '0'.repeat(rule.integer_digits + rule.decimal_digits);
  return first12 + ean13CheckDigit(first12);
}

/** Ce que dit un code de balance : son code de base, et le poids (kg) ou le prix (centimes) qu'il porte. */
export interface ScaleCode { rule: BarcodeRule; baseCode: string; weight: number | null; price: number | null }

/**
 * Lit un code scanné avec les règles du magasin. null : ce n'est pas un code de balance (autre préfixe, pas 13 chiffres).
 * { error } : c'est un code de balance mais il est illisible (chiffre de contrôle faux).
 */
export function decodeScaleBarcode(code: string, rules: BarcodeRule[]): ScaleCode | { error: string } | null {
  if (!EAN13.test(code)) return null;
  const rule = rules.find((r) => code.startsWith(r.prefix));
  if (!rule) return null;
  if (!isEan13(code)) return { error: 'Code-barres de balance illisible (chiffre de contrôle faux) : scannez-le à nouveau.' };
  const start = rule.prefix.length + articleDigits(rule);
  const digits = code.slice(start, start + rule.integer_digits + rule.decimal_digits);
  const value = Number(digits);
  return {
    rule,
    baseCode: baseCode(code, rule),
    weight: rule.type === 'weight' ? round3(value / 10 ** rule.decimal_digits) : null,
    price: rule.type === 'price' ? value * 10 ** (2 - rule.decimal_digits) : null, // en centimes
  };
}

/**
 * Article et quantité d'un code de balance. Poids : la quantité est ce poids. Prix : prix ÷ prix au kg, arrondi
 * à 3 décimales (§3 ; le total peut différer de quelques centimes de l'étiquette, §8 point 11).
 */
export function scaleLine(scan: ScaleCode, products: Product[]): { product: Product; quantity: number } | { error: string } {
  const product = products.find((p) => p.barcode === scan.baseCode);
  if (!product) return { error: `Article de balance inconnu (code de base ${scan.baseCode}).` };
  if (product.unit !== 'kg') return { error: `${product.name} se vend à la pièce : ce code de balance ne lui correspond pas.` };
  if (scan.weight !== null) {
    return scan.weight > 0 ? { product, quantity: scan.weight } : { error: `${product.name} : poids nul sur l’étiquette.` };
  }
  if (product.price_ttc <= 0) return { error: `${product.name} : pas de prix au kg, la quantité ne peut pas être calculée.` };
  const quantity = round3((scan.price ?? 0) / product.price_ttc);
  return quantity > 0 ? { product, quantity } : { error: `${product.name} : prix trop faible sur l’étiquette.` };
}

/** Un code scanné, lu jusqu'au bout : null si ce n'est pas un code de balance. */
export function readScaleBarcode(code: string, rules: BarcodeRule[], products: Product[]) {
  const scan = decodeScaleBarcode(code, rules);
  if (scan === null || 'error' in scan) return scan;
  return scaleLine(scan, products);
}
