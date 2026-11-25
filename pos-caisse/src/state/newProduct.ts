// Nouvel article créé à la caisse (contrat 0.9) : on refuse les saisies aberrantes avant de l'envoyer à l'API.
import { parseMad } from '../lib/money';
import type { Unit } from '../types';

export interface ProductForm { name: string; price: string; barcode: string; categoryId: string; unit: Unit }
export type ProductErrors = Partial<Record<keyof ProductForm, string>>;

/** Ce que la caisse envoie (POST /api/products) ; le code article (IT…) est donné par l'API. */
export interface NewProduct {
  store_id: string; name: string; price_ttc: number; barcode: string | null; category_id: string | null; unit: Unit; tva_rate: number;
}

export const MAX_PRODUCT_NAME = 120;
export const MAX_PRICE = 10_000_00; // 10 000 DH : au-delà, c'est une erreur de frappe dans une supérette

/** TVA désactivée dans la boutique (comme dans Falcon POS) : un article créé à la caisse est à 0 %. */
export const NEW_PRODUCT_TVA = 0;

export function buildProduct(form: ProductForm, storeId: string): { ok: true; product: NewProduct } | { ok: false; errors: ProductErrors } {
  const errors: ProductErrors = {};
  const name = form.name.trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Le nom est obligatoire.';
  else if (name.length > MAX_PRODUCT_NAME) errors.name = `${MAX_PRODUCT_NAME} caractères au maximum.`;

  const price = parseMad(form.price);
  if (price === null || price <= 0) errors.price = form.unit === 'kg' ? 'Prix d’un kg invalide (ex. 25,00).' : 'Prix invalide (ex. 12,50).';
  else if (price > MAX_PRICE) errors.price = 'Prix trop élevé : vérifiez la saisie.';

  const barcode = form.barcode.replace(/\s/g, '');
  if (barcode && !/^\d{4,20}$/.test(barcode)) errors.barcode = 'Code-barres : 4 à 20 chiffres.';

  if (Object.keys(errors).length > 0 || price === null) return { ok: false, errors };
  return {
    ok: true,
    product: { store_id: storeId, name, price_ttc: price, barcode: barcode || null, category_id: form.categoryId || null, unit: form.unit, tva_rate: NEW_PRODUCT_TVA },
  };
}
