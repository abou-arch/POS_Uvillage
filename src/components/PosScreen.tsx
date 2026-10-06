import { useEffect, useReducer, useState } from 'react';
import { api } from '../api/client';
import { cartReducer, emptyCart } from '../state/cart';
import type { Brand, Category, Product, Session } from '../types';
import { Cart } from './Cart';
import { ProductGrid } from './ProductGrid';

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
      .catch((e) => setError(e.message));
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
      <header>
        <strong>Caisse</strong>
        <span>{store?.name} · {register?.name}</span>
        <span className="spacer" />
        <span>{session.user.name}</span>
        <button className="link" onClick={onLogout}>Déconnexion</button>
      </header>
      {error && <p className="error banner">{error}</p>}
      <main>
        <Cart cart={cart} dispatch={dispatch} products={products} />
        <ProductGrid products={products} categories={categories} brands={brands}
          onAdd={(product) => dispatch({ type: 'add', product })} />
      </main>
    </div>
  );
}
