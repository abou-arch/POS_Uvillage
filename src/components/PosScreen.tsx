import { useEffect, useReducer, useState } from 'react';
import { api, ApiError } from '../api/client';
import { buildSale, decrementStock } from '../lib/buildSale';
import { uuidv4 } from '../lib/uuid';
import { cartReducer, emptyCart, type CartAction } from '../state/cart';
import { lastCounter, saveCounter, sendSale, type LastSale } from '../state/sales';
import { usePendingSales } from '../state/usePendingSales';
import type { Brand, Category, Payment, Product, Sale, Session } from '../types';
import { Cart } from './Cart';
import { ProductGrid } from './ProductGrid';
import { Avatar, Icon } from './ui';

export function PosScreen({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  const [lastSale, setLastSale] = useState<LastSale | null>(null);
  const [resending, setResending] = useState(false);
  const pending = usePendingSales();

  const store = session.stores.find((s) => s.id === session.storeId);
  const register = store?.registers.find((r) => r.id === session.registerId);

  // Encaissement : la vente est d'abord gardée sur la caisse, puis envoyée. Elle ne peut donc plus se perdre.
  async function checkout(payments: Payment[], amountReceived: number) {
    const counter = lastCounter(session.registerId) + 1;
    let sale: Sale;
    try {
      sale = buildSale({
        cart, storeId: session.storeId, registerId: session.registerId, cashierId: session.user.id,
        payments, amountReceived, id: uuidv4(), counter, now: new Date(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vente impossible.');
      return;
    }
    saveCounter(session.registerId, counter);
    pending.add(sale);
    dispatch({ type: 'clear' });
    setError(null);
    setProducts((list) => decrementStock(list, sale.lines));
    setLastSale({ sale, status: 'sending' });
    const result = await sendSale(sale, api.createSale);
    if (result.status === 'sent') pending.remove(sale.id);
    if (result.status === 'rejected') pending.reject(sale.id, result.message);
    setLastSale((last) => (last?.sale.id === sale.id ? { sale, ...result } : last));
  }

  // « Renvoyer » : les ventes gardées partent une par une ; l'API ignore celles qu'elle a déjà reçues.
  async function resendPending() {
    setResending(true);
    for (const p of pending.list) {
      const result = await sendSale(p.sale, api.createSale);
      if (result.status === 'sent') pending.remove(p.sale.id);
      else if (result.status === 'rejected') pending.reject(p.sale.id, result.message);
      else break; // toujours pas de réseau : inutile d'insister
    }
    setResending(false);
  }

  // Le résumé de la vente précédente disparaît dès qu'un article du client suivant est ajouté.
  function cartDispatch(action: CartAction) {
    if (action.type === 'add') setLastSale(null);
    dispatch(action);
  }

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
        {pending.list.length > 0 && (
          <button className="pending-badge" onClick={resendPending} disabled={resending}
            title="Ventes gardées sur la caisse, pas encore reçues par le serveur">
            <Icon name="alert" size={16} />
            {pending.list.length} vente{pending.list.length > 1 ? 's' : ''} à envoyer · {resending ? 'envoi…' : 'Renvoyer'}
          </button>
        )}
        <span className="spacer" />
        <span className="who"><Avatar name={session.user.name} />{session.user.name}</span>
        <button className="btn ghost" onClick={onLogout}><Icon name="logout" size={18} />Déconnexion</button>
      </header>
      {error && <p className="banner"><Icon name="alert" size={18} />{error}</p>}
      {!pending.saved && (
        <p className="banner">
          <Icon name="alert" size={18} />Stockage local indisponible : ne fermez pas la caisse avant l’envoi des ventes.
        </p>
      )}
      {pending.unreadable > 0 && (
        <p className="banner">
          <Icon name="alert" size={18} />
          {pending.unreadable === 1
            ? 'Une vente gardée sur la caisse est illisible : elle reste sur ce poste, sans être envoyée, à faire vérifier.'
            : `${pending.unreadable} ventes gardées sur la caisse sont illisibles : elles restent sur ce poste, sans être envoyées, à faire vérifier.`}
        </p>
      )}
      <main>
        <Cart cart={cart} dispatch={cartDispatch} products={products} lastSale={lastSale} onCheckout={checkout} />
        <ProductGrid products={products} categories={categories} brands={brands}
          onAdd={(product) => {
            cartDispatch({ type: 'add', product });
            document.getElementById('scan')?.focus(); // la douchette reste prête après un clic sur une tuile
          }} />
      </main>
    </div>
  );
}
