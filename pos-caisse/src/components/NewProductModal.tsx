import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { db } from '../db/db';
import { buildProduct, MAX_PRODUCT_NAME, type ProductErrors, type ProductForm } from '../state/newProduct';
import type { Category, Product } from '../types';
import { Modal } from './Modal';
import { Icon } from './ui';

// Nouvel article créé à la caisse, caissier compris (contrat 0.9). En ligne seulement : l'API donne le code IT… et
// vérifie que le code-barres n'est pas déjà pris. L'article est gardé dans le catalogue de la caisse puis ajouté au panier.
export function NewProductModal({ storeId, categories, initialBarcode = '', onCreated, onClose }: {
  storeId: string;
  categories: Category[];
  initialBarcode?: string;
  onCreated: (product: Product) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ProductForm>({ name: '', price: '', barcode: initialBarcode, categoryId: '', unit: 'unit' });
  const [errors, setErrors] = useState<ProductErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof ProductForm, value: string) => {
    setForm({ ...form, [key]: value });
    setErrors({ ...errors, [key]: undefined });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = buildProduct(form, storeId);
    if (!result.ok) return setErrors(result.errors);
    setSaving(true);
    setFailure(null);
    try {
      const created = await api.createProduct(result.product);
      await db.products.put({ ...created, store_id: storeId }).catch(() => {}); // visible tout de suite dans la grille
      onCreated(created);
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'Serveur injoignable : l’article n’est pas créé. Réessayez une fois en ligne.');
      setSaving(false);
    }
  }

  return (
    <Modal title="Nouvel article" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label>
          <span>Nom de l’article</span>
          <input data-autofocus maxLength={MAX_PRODUCT_NAME} autoComplete="off" value={form.name} aria-invalid={!!errors.name}
            onChange={(e) => set('name', e.target.value)} />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </label>
        <label>
          <span>Vendu</span>
          <select value={form.unit} onChange={(e) => set('unit', e.target.value)}>
            <option value="unit">À la pièce</option>
            <option value="kg">Au poids (kg)</option>
          </select>
        </label>
        <label>
          <span>{form.unit === 'kg' ? 'Prix d’un kg' : 'Prix de vente'}</span>
          <span className="money">
            <input inputMode="decimal" placeholder="0,00" autoComplete="off" value={form.price} aria-invalid={!!errors.price}
              onChange={(e) => set('price', e.target.value)} />
            DH
          </span>
          {errors.price && <span className="field-error">{errors.price}</span>}
        </label>
        <label>
          <span>Code-barres <small>facultatif : scannez l’article</small></span>
          <input inputMode="numeric" autoComplete="off" value={form.barcode} aria-invalid={!!errors.barcode}
            onChange={(e) => set('barcode', e.target.value)} />
          {errors.barcode && <span className="field-error">{errors.barcode}</span>}
        </label>
        <label>
          <span>Catégorie <small>facultative</small></span>
          <select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">Sans catégorie</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {failure && <p className="alert" role="alert"><Icon name="alert" size={18} />{failure}</p>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Créer et ajouter au panier'}</button>
        </div>
      </form>
    </Modal>
  );
}
