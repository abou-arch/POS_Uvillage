import { useMemo, useState, type CSSProperties } from 'react';
import { categoryHue, categoryPictogram } from '../lib/categoryLook';
import { formatQuantity, unitPrice } from '../lib/units';
import type { Brand, Category, Product } from '../types';
import { flyToCart } from './fx';
import { Icon } from './ui';

interface Props {
  products: Product[];
  categories: Category[];
  brands: Brand[];
  onAdd: (p: Product) => void;
}

// Une teinte par catégorie (variable CSS --hue) : les familles d'articles se repèrent d'un coup d'œil.
const hueStyle = (categoryId: string | null) => {
  const hue = categoryHue(categoryId);
  return hue === null ? undefined : ({ '--hue': hue } as CSSProperties);
};

export function ProductGrid({ products, categories, brands, onAdd }: Props) {
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [query, setQuery] = useState('');
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

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
        <button type="button" className={`chip ${categoryId === '' ? 'active' : ''}`}
          aria-pressed={categoryId === ''} onClick={() => setCategoryId('')}><Icon name="grid" size={15} />Tout</button>
        {categories.map((c) => (
          <button key={c.id} type="button" className={`chip ${categoryId === c.id ? 'active' : ''}`} style={hueStyle(c.id)}
            aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
            <Icon name={categoryPictogram(c.name)} size={15} />{c.name}
          </button>
        ))}
      </div>
      {/* La clé change avec le filtre : les vignettes réapparaissent en cascade à chaque catégorie. */}
      <div className="grid" key={`${categoryId}|${brandId}`}>
        {visible.map((p) => {
          const level = p.stock <= 0 ? 'out' : p.stock <= p.stock_alert ? 'low' : '';
          const stock = formatQuantity(p.stock, p.unit); // au poids : en kg
          const category = p.category_id ? categoryById.get(p.category_id) : undefined;
          return (
            <button key={p.id} type="button" className={`tile ${level}`} title={p.code}
              onClick={(e) => {
                // Au poids, le poids reste à saisir : l'article n'entre dans le panier qu'après.
                if (p.unit !== 'kg') flyToCart(e.currentTarget.querySelector('.thumb'));
                onAdd(p);
              }}>
              <span className={`thumb ${p.category_id ? '' : 'plain'}`} style={hueStyle(p.category_id)}>
                {p.image_url ? <img src={p.image_url} alt="" /> : <Icon name={categoryPictogram(category?.name)} size={30} />}
                {p.unit === 'kg' && <span className="thumb-tag">kg</span>}
              </span>
              <span className="add-hint" aria-hidden="true"><Icon name="plus" size={16} /></span>
              <span className="name">{p.name}</span>
              {p.name_ar && <span className="name-ar" dir="rtl" lang="ar">{p.name_ar}</span>}
              <span className="tile-foot">
                <strong className="price">{unitPrice(p.price_ttc, p.unit)}</strong>
                <span className={`stock ${level}`}>
                  {level === 'out' ? 'Rupture' : level === 'low' ? `Stock bas : ${stock}` : `Stock ${stock}`}
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
