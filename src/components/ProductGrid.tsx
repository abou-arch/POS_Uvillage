import { useMemo, useState } from 'react';
import { formatMad } from '../lib/totals.js';
import type { Brand, Category, Product } from '../types';

interface Props {
  products: Product[];
  categories: Category[];
  brands: Brand[];
  onAdd: (p: Product) => void;
}

export function ProductGrid({ products, categories, brands, onAdd }: Props) {
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) =>
      p.active &&
      (!categoryId || p.category_id === categoryId) &&
      (!brandId || p.brand_id === brandId) &&
      (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)));
  }, [products, categoryId, brandId, query]);

  return (
    <section className="grid-panel">
      <div className="filters">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Toutes les catégories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
          <option value="">Toutes les marques</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input placeholder="Nom de l'article" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="grid">
        {visible.map((p) => (
          <button
            key={p.id}
            className={`tile ${p.stock <= 0 ? 'out' : p.stock <= p.stock_alert ? 'low' : ''}`}
            onClick={() => onAdd(p)}
            title={p.code}
          >
            <span className="badge">Stock : {p.stock}</span>
            {p.image_url ? <img src={p.image_url} alt="" /> : <span className="placeholder">{p.name.charAt(0)}</span>}
            <span className="name">{p.name}{p.name_ar ? ` (${p.name_ar})` : ''}</span>
            <strong>{formatMad(p.price_ttc)}</strong>
          </button>
        ))}
        {visible.length === 0 && <p className="muted">Aucun article.</p>}
      </div>
    </section>
  );
}
