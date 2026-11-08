import { useMemo, useState } from 'react';
import { formatMad } from '../lib/totals.js';
import type { Brand, Category, Product } from '../types';
import { Icon } from './ui';

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
    <section className="panel grid-panel">
      <div className="toolbar">
        <div className="field">
          <Icon name="search" />
          <input type="search" placeholder="Rechercher…" aria-label="Rechercher un article par nom ou code"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label="Marque">
          <option value="">Toutes les marques</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className="chips" role="group" aria-label="Catégories">
        {[{ id: '', name: 'Tout' }, ...categories].map((c) => (
          <button key={c.id} type="button" className={`chip ${categoryId === c.id ? 'active' : ''}`}
            aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>{c.name}</button>
        ))}
      </div>
      <div className="grid">
        {visible.map((p) => {
          const level = p.stock <= 0 ? 'out' : p.stock <= p.stock_alert ? 'low' : '';
          return (
            <button key={p.id} type="button" className={`tile ${level}`} onClick={() => onAdd(p)} title={p.code}>
              <span className="thumb" style={thumbColors(p.category_id)}>
                {p.image_url ? <img src={p.image_url} alt="" /> : p.name.charAt(0)}
              </span>
              <span className="name">{p.name}</span>
              {p.name_ar && <span className="name-ar" dir="rtl" lang="ar">{p.name_ar}</span>}
              <span className="tile-foot">
                <strong className="price">{formatMad(p.price_ttc)}</strong>
                <span className={`stock ${level}`}>
                  {level === 'out' ? 'Rupture' : level === 'low' ? `Stock bas : ${p.stock}` : `Stock ${p.stock}`}
                </span>
              </span>
            </button>
          );
        })}
        {visible.length === 0 && <p className="muted grid-empty">Aucun article ne correspond.</p>}
      </div>
    </section>
  );
}

// Une teinte par catégorie : les familles d'articles se repèrent d'un coup d'œil.
function thumbColors(categoryId: string | null) {
  if (!categoryId) return { background: '#eef2f6', color: '#64748b' };
  const n = [...categoryId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0);
  const hue = Math.round((n * 137.508) % 360);
  return { background: `hsl(${hue} 70% 93%)`, color: `hsl(${hue} 45% 32%)` };
}
