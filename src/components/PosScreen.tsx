import { useEffect, useReducer, useRef, useState } from 'react';
import { AUTO_PRINT, storeInfo, TIME_ZONE } from '../config/store';
import { cachedProducts } from '../db/catalog';
import { db } from '../db/db';
import { legacyUnreadable } from '../db/migrate';
import { recordSale } from '../db/outbox';
import { useLiveQuery } from '../db/useLiveQuery';
import { buildSale, type SaleInput } from '../lib/buildSale';
import { buildReceipt } from '../lib/receipt';
import { formatMad } from '../lib/totals.js';
import { uuidv4 } from '../lib/uuid';
import { cartReducer, emptyCart, type CartAction } from '../state/cart';
import { holdCart, refreshFromCatalog } from '../state/held';
import { loadLastReceipt, saveLastReceipt } from '../state/lastReceipt';
import type { LastSale } from '../state/sales';
import { useHeldSales } from '../state/useHeldSales';
import { useSync } from '../sync/useSync';
import type { Payment, Sale, Session } from '../types';
import { Cart } from './Cart';
import { HeldListModal } from './HeldListModal';
import { ProductGrid } from './ProductGrid';
import { SyncStatus } from './SyncStatus';
import { Ticket } from './Ticket';
import { Avatar, Icon } from './ui';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('{n}', String(n)));

export function PosScreen({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const held = useHeldSales(session.registerId);
  const sync = useSync(session.storeId);
  const [receipt, setReceipt] = useState(() => loadLastReceipt(session.registerId));
  const [duplicate, setDuplicate] = useState(false);
  const [printRequest, setPrintRequest] = useState(0);
  const [legacy] = useState(() => legacyUnreadable(session.registerId));
  const checkingOut = useRef(false); // un double appui sur F4 ne crée pas deux ventes

  // Le cache s'affiche tout de suite ; la synchro le met à jour en arrière-plan, et la grille suit.
  const products = useLiveQuery(() => cachedProducts(session.storeId), [session.storeId], []);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []).value;
  const brands = useLiveQuery(() => db.brands.toArray(), [], []).value;

  const store = session.stores.find((s) => s.id === session.storeId);
  const register = store?.registers.find((r) => r.id === session.registerId);
  const rejected = sync.outbox.filter((e) => e.error !== null);

  // L'impression part après le rendu, pour que le ticket imprimé soit bien celui de la vente demandée.
  useEffect(() => {
    if (printRequest > 0) window.print();
  }, [printRequest]);

  function reprint() {
    setDuplicate(true);
    setPrintRequest((n) => n + 1);
  }

  // Encaissement : la vente est d'abord écrite dans l'outbox (avec son numéro de ticket), puis envoyée.
  // Si la base locale refuse l'écriture, rien n'est encaissé et le panier reste là : aucune vente ne se perd.
  async function checkout(payments: Payment[], amountReceived: number) {
    if (checkingOut.current) return;
    const input: Omit<SaleInput, 'counter'> = {
      cart, storeId: session.storeId, registerId: session.registerId, cashierId: session.user.id,
      payments, amountReceived, id: uuidv4(), now: new Date(),
    };
    try {
      buildSale({ ...input, counter: 1 }); // vérifie panier et paiements avant d'écrire quoi que ce soit
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vente impossible.');
      return;
    }
    checkingOut.current = true;
    let sale: Sale;
    try {
      sale = await recordSale((counter) => buildSale({ ...input, counter }), session.registerId);
    } catch {
      setError('Stockage local indisponible : la vente n’est pas enregistrée. Le panier est conservé, réessayez.');
      return;
    } finally {
      checkingOut.current = false;
    }
    sync.sync();
    const ticket = { sale, cashier: session.user.name, customer: cart.customer?.name ?? null };
    saveLastReceipt(session.registerId, ticket);
    setReceipt(ticket);
    setDuplicate(false);
    if (AUTO_PRINT) setPrintRequest((n) => n + 1);
    dispatch({ type: 'clear' });
    setError(null);
    setResumeNotice(null);
    setLastSale(sale);
  }

  // Ce que l'écran dit de la dernière vente vient de la synchro : reçue, refusée, ou encore sur la caisse.
  function lastSaleView(sale: Sale): LastSale {
    const outcome = sync.outcomes.get(sale.id);
    if (outcome?.status === 'sent') return { sale, status: 'sent' };
    const error = outcome?.status === 'rejected' ? outcome.error : sync.outbox.find((e) => e.id === sale.id)?.error;
    if (error) return { sale, status: 'rejected', message: error };
    return { sale, status: sync.connection === 'offline' ? 'offline' : 'sending' };
  }

  // Mise en attente : le panier n'est vidé qu'une fois écrit sur la caisse.
  function hold(note: string) {
    held.add(holdCart(cart, note, uuidv4(), new Date()))
      .then(() => {
        dispatch({ type: 'clear' });
        setResumeNotice(null);
      })
      .catch(() => setError('Mise en attente impossible : stockage local indisponible. Le panier est conservé.'));
  }

  // Reprise : prix et stock repris du catalogue actuel ; le caissier voit ce qui a changé.
  async function resume(id: string, holdCurrent: boolean) {
    const sale = held.list.find((h) => h.id === id);
    if (!sale) return;
    try {
      if (holdCurrent && cart.lines.length > 0) await held.add(holdCart(cart, '', uuidv4(), new Date()));
      await held.remove(id);
    } catch {
      setError('Reprise impossible : stockage local indisponible.');
      return;
    }
    const { cart: refreshed, changes, missing, checked } = refreshFromCatalog(sale.cart, products.value);
    setLastSale(null);
    dispatch({ type: 'restore', state: refreshed });
    setShowHeld(false);
    const notes = [
      ...(!checked ? ['Catalogue non chargé : prix et stock non vérifiés.'] : []),
      ...(changes.length > 0
        ? [`Prix changé depuis la mise en attente : ${changes.map((c) => `${c.name} ${formatMad(c.before)} → ${formatMad(c.after)}`).join(', ')}.`]
        : []),
      ...(missing.length > 0 ? [`Absent du catalogue, à vérifier : ${missing.join(', ')}.`] : []),
    ];
    setResumeNotice(notes.length > 0 ? notes.join(' ') : null);
    document.getElementById('scan')?.focus();
  }

  // Le résumé de la vente précédente disparaît dès qu'un article du client suivant est ajouté.
  function cartDispatch(action: CartAction) {
    if (action.type === 'add') setLastSale(null);
    dispatch(action);
  }

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

  const unreadable = sync.outboxUnreadable + held.unreadable + legacy;

  return (
    <div className="pos">
      <header className="topbar">
        <span className="brand"><span className="logo"><Icon name="register" size={18} /></span>Caisse</span>
        <span className="where"><Icon name="store" size={16} />{store?.name}<span className="dot">·</span>{register?.name}</span>
        <SyncStatus connection={sync.connection} pending={sync.outbox.length} rejected={rejected.length} onSync={() => sync.sync(true)} />
        <span className="spacer" />
        <button className="held-button" onClick={() => setShowHeld(true)} aria-label={`Liste d’attente : ${held.list.length}`}>
          <Icon name="pause" size={18} /><span className="label">Liste d’attente</span><span className="count">{held.list.length}</span>
        </button>
        <button className="held-button" disabled={!receipt} onClick={reprint}
          aria-label="Réimprimer le dernier ticket" title={receipt ? `Réimprimer le ticket ${receipt.sale.number}` : 'Aucun ticket à réimprimer'}>
          <Icon name="printer" size={18} /><span className="label">Réimprimer le dernier ticket</span>
        </button>
        <span className="who"><Avatar name={session.user.name} />{session.user.name}</span>
        <button className="btn ghost" onClick={onLogout}><Icon name="logout" size={18} />Déconnexion</button>
      </header>
      {error && <p className="banner"><Icon name="alert" size={18} />{error}</p>}
      {products.loaded && products.value.length === 0 && sync.connection === 'offline' && (
        <p className="banner"><Icon name="alert" size={18} />Catalogue vide sur ce poste : connectez la caisse au serveur une première fois.</p>
      )}
      {resumeNotice && (
        <p className="banner notice" role="status">
          <Icon name="alert" size={18} />{resumeNotice}
          <button type="button" className="link" onClick={() => setResumeNotice(null)}>Compris</button>
        </p>
      )}
      {(sync.storageError || !held.saved) && (
        <p className="banner">
          <Icon name="alert" size={18} />Base locale indisponible : la caisse ne peut ni vendre hors ligne ni garder de vente en attente.
        </p>
      )}
      {rejected.length > 0 && (
        <p className="banner notice">
          <Icon name="alert" size={18} />
          {plural(rejected.length, 'Une vente a été refusée par le serveur', '{n} ventes ont été refusées par le serveur')}
          {' '}: gardée{rejected.length > 1 ? 's' : ''} sur la caisse, à faire vérifier. Cliquez sur l’indicateur pour réessayer.
        </p>
      )}
      {unreadable > 0 && (
        <p className="banner">
          <Icon name="alert" size={18} />
          {plural(unreadable, 'Une vente gardée sur la caisse est illisible', '{n} ventes gardées sur la caisse sont illisibles')}
          {' '}: rien n’est envoyé ni effacé, à faire vérifier.
        </p>
      )}
      <main>
        <Cart cart={cart} dispatch={cartDispatch} products={products.value} lastSale={lastSale && lastSaleView(lastSale)}
          onCheckout={checkout} onHold={hold} />
        <ProductGrid products={products.value} categories={categories} brands={brands}
          onAdd={(product) => {
            cartDispatch({ type: 'add', product });
            document.getElementById('scan')?.focus(); // la douchette reste prête après un clic sur une tuile
          }} />
      </main>
      {showHeld && (
        <HeldListModal list={held.list} cartEmpty={cart.lines.length === 0} onResume={resume}
          onDelete={(id) => void held.remove(id).catch(() => setError('Suppression impossible : stockage local indisponible.'))}
          onClose={() => { setShowHeld(false); document.getElementById('scan')?.focus(); }} />
      )}
      {receipt && (
        <Ticket receipt={buildReceipt(receipt, storeInfo(session.storeId, store?.name ?? ''), TIME_ZONE)} copy={duplicate} />
      )}
    </div>
  );
}
