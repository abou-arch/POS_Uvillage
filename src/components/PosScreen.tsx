import { useEffect, useReducer, useState } from 'react';
import { api, ApiError } from '../api/client';
import { cartReducer, emptyCart } from '../state/cart';
import type { Brand, Category, Product, Session } from '../types';
import { Cart } from './Cart';
import { ProductGrid } from './ProductGrid';
import { Avatar, Icon } from './ui';

export function PosScreen({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);

  const store = session.stores.find((s) => s.id === session.storeId);
  const register = store?.registers.find((r) => r.id === session.registerId);

  useEffect(() => {
    // Sprint hors ligne : lire d'abord le cache IndexedDB, puis rafraîchir avec updated_since.
    Promise.all([api.products(session.storeId), api.categories(), api.brands()])
      .then(([p, c, b]) => { setProducts(p); setCategories(c); setBrands(b); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Serveur injoignable : les articles ne sont pas chargés.'));
  }, [session.storeId]);

  // Raccourci Ctrl+Shift+S : focus sur la recherche, comme dans le POS actuel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        document.getElementById('scan')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="pos">
      <header className="topbar">
        <span className="brand"><span className="logo"><Icon name="register" size={18} /></span>Caisse</span>
        <span className="where"><Icon name="store" size={16} />{store?.name}<span className="dot">·</span>{register?.name}</span>
        <span className="spacer" />
        <span className="who"><Avatar name={session.user.name} />{session.user.name}</span>
        <button className="btn ghost" onClick={onLogout}><Icon name="logout" size={18} />Déconnexion</button>
      </header>
      {error && <p className="banner"><Icon name="alert" size={18} />{error}</p>}
      <main>
        <Cart cart={cart} dispatch={dispatch} products={products} />
        <ProductGrid products={products} categories={categories} brands={brands}
          onAdd={(product) => {
            dispatch({ type: 'add', product });
            document.getElementById('scan')?.focus(); // la douchette reste prête après un clic sur une tuile
          }} />
      </main>
    </div>
  );
}
