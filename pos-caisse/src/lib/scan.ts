// Ce que la douchette (ou le caissier) a tapé dans le champ de scan : quel article, et avec quel poids.
import type { BarcodeRule, Product } from '../types';
import { readScaleBarcode } from './scaleBarcode';

export type ScanResult =
  | { kind: 'product'; product: Product } // article trouvé ; s'il se vend au poids, le poids reste à saisir
  | { kind: 'weighed'; product: Product; quantity: number } // étiquette de la balance : article et poids lus
  | { kind: 'error'; message: string };

/**
 * Ordre de recherche : code-barres ou code article exact, puis étiquette de la balance (§3, contrat 0.7), puis nom.
 * null : rien n'a été tapé.
 */
export function lookupScan(typed: string, products: Product[], rules: BarcodeRule[]): ScanResult | null {
  const text = typed.trim();
  const value = text.toLowerCase();
  if (!value) return null;
  const exact = products.find((p) => p.barcode === value || p.code.toLowerCase() === value);
  if (exact) return { kind: 'product', product: exact };
  const scale = readScaleBarcode(value, rules, products);
  if (scale) return 'error' in scale ? { kind: 'error', message: scale.error } : { kind: 'weighed', ...scale };
  const byName = products.find((p) => p.name.toLowerCase().includes(value));
  return byName ? { kind: 'product', product: byName } : { kind: 'error', message: `Aucun article pour « ${text} »` };
}
