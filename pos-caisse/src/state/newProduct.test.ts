import { describe, expect, it } from 'vitest';
import { buildProduct, type ProductForm } from './newProduct';

const form = (f: Partial<ProductForm>): ProductForm => ({ name: '', price: '', barcode: '', categoryId: '', unit: 'unit', ...f });

describe('nouvel article créé à la caisse (contrat 0.9)', () => {
  it('construit l’article : prix en centimes, code-barres nettoyé, TVA 0', () => {
    expect(buildProduct(form({ name: '  Biscuit   chocolat ', price: '3,50', barcode: '6111 2345 6789 0', categoryId: 'cat_1' }), 'st_1')).toEqual({
      ok: true,
      product: { store_id: 'st_1', name: 'Biscuit chocolat', price_ttc: 350, barcode: '6111234567890', category_id: 'cat_1', unit: 'unit', tva_rate: 0 },
    });
  });
  it('sans code-barres ni catégorie : null', () => {
    const r = buildProduct(form({ name: 'Olives', price: '25', unit: 'kg' }), 'st_1');
    expect(r.ok && r.product).toMatchObject({ barcode: null, category_id: null, unit: 'kg', price_ttc: 2500 });
  });
  it('refuse nom vide, prix nul ou aberrant, code-barres invalide', () => {
    const r = buildProduct(form({ name: ' ', price: '0', barcode: '12a' }), 'st_1');
    expect(r.ok ? null : Object.keys(r.errors).sort()).toEqual(['barcode', 'name', 'price']);
    for (const bad of ['abc', '-3', '12,345', '10000,01']) expect(buildProduct(form({ name: 'X', price: bad }), 'st_1').ok).toBe(false);
  });
});
