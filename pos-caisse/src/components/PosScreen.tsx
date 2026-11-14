import { useEffect, useReducer, useRef, useState } from 'react';
import { AUTO_PRINT, storeInfo, TIME_ZONE } from '../config/store';
import { useApprovers } from '../db/approvers';
import { cachedProducts } from '../db/catalog';
import { cashSessionData, closeCashSession, recordCashMovement, sessionReceipt } from '../db/cashSessions';
import { db } from '../db/db';
import { legacyUnreadable } from '../db/migrate';
import { recordRefund, recordSale, SessionNotOpenError } from '../db/outbox';
import { useLiveQuery } from '../db/useLiveQuery';
import { buildRefund, mergeRefunds, RefundError } from '../lib/buildRefund';
import { buildSale, type SaleInput } from '../lib/buildSale';
import {
  buildClosing, buildMovement, closeBlocker, expectedByMethod, methodCounts, overThreshold, type Counted, type LocalCashMovement,
  type LocalCashSession,
} from '../lib/cashSession';
import { buildMovementReceipt, buildReceipt, buildRefundReceipt, type ReceiptData, type RefundReceiptData } from '../lib/receipt';
import { formatMad, saleTotals } from '../lib/totals.js';
import { METHOD_LABELS } from '../state/payment';
import { uuidv4 } from '../lib/uuid';
import { cartReducer, emptyCart, type CartAction } from '../state/cart';
import { holdCart, refreshFromCatalog } from '../state/held';
import { loadLastReceipt, saveLastReceipt } from '../state/lastReceipt';
import {
  closingNeedsApproval, discountNeedsApproval, discountsOverLimit, limitLabel, needsApproval, type GuardedAction,
} from '../state/permissions';
import type { LastSale } from '../state/sales';
import { closingThreshold, discountLimits, placeOf } from '../state/session';
import { useHeldSales } from '../state/useHeldSales';
import { usePrint } from '../state/usePrint';
import type { SyncState } from '../sync/useSync';
import type { Approver, CashCountLine, CashMovementType, Payment, Sale, Session } from '../types';
import { ApprovalModal } from './ApprovalModal';
import { Cart } from './Cart';
import { CashMovementModal } from './CashMovementModal';
import { CloseSessionModal } from './CloseSessionModal';
import { HeldListModal } from './HeldListModal';
import { RefundModal, type RefundChoice } from './RefundModal';
import { ProductGrid } from './ProductGrid';
import { SessionModal } from './SessionModal';
import { PrintSheet } from './Ticket';
import { SyncBanners, TopBar } from './TopBar';
import { Icon } from './ui';

type SessionView = 'menu' | 'movement' | 'close';

/** Qui a autorisé (§11) : un responsable, ou personne quand l'utilisateur connecté n'en a pas besoin. */
interface Approval { approvedBy: string | null; approverName: string | null }

/** Fenêtre d'autorisation ouverte : l'opération, ce qu'elle concerne, et la suite (null = annulée). */
interface ApprovalRequest { action: GuardedAction; detail: string | null; resolve: (approver: Approver | null) => void }

const storageMessage = (e: unknown, otherwise: string) => (e instanceof SessionNotOpenError ? e.message : otherwise);

export function PosScreen({ session, cashSession, sync, unreadableSessions, onClosed, onLogout }: {
  session: Session;
  cashSession: LocalCashSession;
  sync: SyncState;
  unreadableSessions: number;
  onClosed: (sessionId: string) => void;
  onLogout: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [sessionView, setSessionView] = useState<SessionView | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [refundDone, setRefundDone] = useState<RefundReceiptData | null>(null); // dernier retour : message et réimpression
  const held = useHeldSales(session.registerId);
  const [receipt, setReceipt] = useState(() => loadLastReceipt(session.registerId));
  const { doc, print } = usePrint();
  const [legacy] = useState(() => legacyUnreadable(session.registerId));
  const checkingOut = useRef(false); // un double appui sur F4 ne crée pas deux ventes
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const approvers = useApprovers(session.storeId);
  const limits = discountLimits(session);
  const role = session.user.role;
  // Remises d'un caissier au-delà du plafond (§11) : signalées dans le panier, autorisées par un responsable au paiement.
  const overLimit = needsApproval(role) ? discountsOverLimit(cart, limits) : null;
  const discountApproval = discountNeedsApproval(role, cart, limits);

  /**
   * Autorisation d'un responsable (§11) pour une opération d'un caissier. Un manager ou un admin connecté n'en a pas
   * besoin, ni une opération qui reste dans les droits du caissier (required = false) : la fenêtre ne s'ouvre pas et
   * rien n'est enregistré dans approved_by. Renvoie null si elle est annulée.
   */
  function authorize(action: GuardedAction, detail: string | null, required = true): Promise<Approval | null> {
    if (!required || !needsApproval(role)) return Promise.resolve({ approvedBy: null, approverName: null });
    return new Promise((resolve) => {
      setApproval({
        action, detail,
        resolve: (approver) => {
          setApproval(null);
          resolve(approver ? { approvedBy: approver.user_id, approverName: approver.name } : null);
        },
      });
    });
  }

  // Le cache s'affiche tout de suite ; la synchro le met à jour en arrière-plan, et la grille suit.
  const products = useLiveQuery(() => cachedProducts(session.storeId), [session.storeId], []);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []).value;
  const brands = useLiveQuery(() => db.brands.toArray(), [], []).value;
  // Ventes et mouvements de la session, relus à chaque changement : l'attendu est toujours à jour.
  const sessionData = useLiveQuery(() => cashSessionData(cashSession.id), [cashSession.id], { sales: [], movements: [], refunds: [] });
  const { sales, movements, refunds } = sessionData.value;
  const expected = expectedByMethod(cashSession.opening_cash, sales, movements, refunds);
  const sessionReady = sessionData.loaded && sessionData.error === null; // l’attendu n’est juste qu’une fois tout relu

  const { storeName, registerName } = placeOf(session);
  const store = storeInfo(session.storeId, storeName);

  const printSale = (data: ReceiptData, copy: boolean) => print({ kind: 'sale', receipt: buildReceipt(data, store, TIME_ZONE), copy });
  const printRefund = (data: RefundReceiptData, copy: boolean) =>
    print({ kind: 'refund', receipt: buildRefundReceipt(data, store, TIME_ZONE, copy) });
  const printMovement = (movement: LocalCashMovement, copy: boolean) =>
    print({ kind: 'movement', receipt: buildMovementReceipt({ movement, registerName, store, timeZone: TIME_ZONE, copy }) });

  /** « Plafond 10 % et 50,00 DH · OEUF, remise globale » : ce que le responsable autorise. */
  function discountDetail(): string {
    const excess = overLimit ?? { lines: [], global: false };
    const names = [
      ...cart.lines.filter((l) => excess.lines.includes(l.product_id)).map((l) => l.name),
      ...(excess.global ? ['remise globale'] : []),
    ];
    const limit = limitLabel(limits, formatMad);
    return `${limit ? `Plafond ${limit} · ` : ''}${names.join(', ')}`;
  }

  // Encaissement : la vente est d'abord écrite dans l'outbox (avec son numéro de ticket), puis envoyée.
  // Si la base locale refuse l'écriture, rien n'est encaissé et le panier reste là : aucune vente ne se perd.
  async function checkout(payments: Payment[], amountReceived: number) {
    if (checkingOut.current) return;
    const base: Omit<SaleInput, 'counter'> = {
      cart, storeId: session.storeId, registerId: session.registerId, sessionId: cashSession.id, cashierId: session.user.id,
      payments, amountReceived, id: uuidv4(), lineIds: cart.lines.map(() => uuidv4()), now: new Date(),
    };
    try {
      buildSale({ ...base, counter: 1 }); // vérifie panier et paiements avant d'écrire quoi que ce soit
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vente impossible.');
      return;
    }
    checkingOut.current = true;
    // Remise au-delà du plafond du caissier (§11) : un responsable l'autorise, pour toute la vente, au paiement.
    const approval = await authorize('discount', discountDetail(), discountApproval);
    if (!approval) {
      checkingOut.current = false;
      setError('Vente non enregistrée : la remise au-delà du plafond n’a pas été autorisée. Le panier est conservé.');
      return;
    }
    const input = { ...base, approvedBy: approval.approvedBy };
    const names = { cashier: session.user.name, customer: cart.customer?.name ?? null };
    let sale: Sale;
    try {
      sale = await recordSale((counter) => buildSale({ ...input, counter }), session.registerId, names);
    } catch (e) {
      setError(storageMessage(e, 'Stockage local indisponible : la vente n’est pas enregistrée. Le panier est conservé, réessayez.'));
      return;
    } finally {
      checkingOut.current = false;
    }
    sync.sync();
    const ticket = { sale, ...names };
    saveLastReceipt(session.registerId, ticket);
    setReceipt(ticket);
    if (AUTO_PRINT) printSale(ticket, false);
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

  // Suppression d'une vente en attente : autorisée par un responsable pour un caissier (§11). Rien n'est envoyé (§6).
  async function deleteHeld(id: string) {
    const sale = held.list.find((h) => h.id === id);
    if (!sale) return;
    const total = saleTotals(sale.cart.lines, sale.cart.otherCharges, sale.cart.globalDiscount).ttc;
    const approval = await authorize('delete_held', `${formatMad(total)}${sale.note ? ` · ${sale.note}` : ''}`);
    if (!approval) return;
    await held.remove(id).catch(() => setError('Suppression impossible : stockage local indisponible.'));
  }

  // Le résumé de la vente précédente disparaît dès qu'un article du client suivant est ajouté.
  function cartDispatch(action: CartAction) {
    if (action.type === 'add') setLastSale(null);
    dispatch(action);
  }

  // --- Retours (§10) -------------------------------------------------------------------------------------

  // Le retour est écrit sur la caisse et dans l'outbox (stock remonté) avant d'être envoyé. Les retours de la vente déjà
  // faits sur ce poste sont relus dans la même transaction : deux validations ne rendent pas deux fois le même article.
  async function saveRefund({ found, quantities, reason, reasonText, payments }: RefundChoice): Promise<string | null> {
    const { sale } = found;
    // Un caissier fait autoriser chaque retour par un responsable (§11), une fois le remboursement choisi.
    const total = payments.reduce((s, p) => s + p.amount, 0);
    const approval = await authorize('refund', `Ticket ${sale.number} · ${formatMad(total)} à rembourser`);
    if (!approval) return 'Retour non autorisé : rien n’est enregistré.';
    const names = { saleNumber: sale.number, cashier: session.user.name, customer: found.customer, approver: approval.approverName };
    let refund;
    try {
      refund = await recordRefund(sale.id, (counter, local) => buildRefund({
        sale, refunds: mergeRefunds(sale.id, found.refunds, local), quantities, reason, reasonText, payments,
        cashAvailable: expected.cash, storeId: session.storeId, registerId: session.registerId, sessionId: cashSession.id,
        cashierId: session.user.id, approvedBy: approval.approvedBy, id: uuidv4(), counter, now: new Date(),
      }), session.registerId, names);
    } catch (e) {
      // Règle du retour (article déjà retourné entre-temps, espèces insuffisantes…) ou session clôturée ailleurs.
      if (e instanceof RefundError || e instanceof SessionNotOpenError) return e.message;
      return 'Stockage local indisponible : le retour n’est pas enregistré.';
    }
    sync.sync();
    const data = { refund, ...names };
    setRefundDone(data);
    setRefunding(false);
    if (AUTO_PRINT) printRefund(data, false);
    document.getElementById('scan')?.focus();
    return null;
  }

  // --- Session de caisse -------------------------------------------------------------------------------

  function closeSessionView() {
    setSessionView(null);
    document.getElementById('scan')?.focus();
  }

  async function saveMovement(type: CashMovementType, amount: number, reason: string) {
    // Sortie d'espèces d'un caissier : autorisée par un responsable (§11). Annulée : la fenêtre du mouvement reste ouverte.
    const approval = await authorize('cash_out', `${formatMad(amount)} · ${reason.trim()}`, type === 'out');
    if (!approval) return;
    try {
      const movement = buildMovement({
        id: uuidv4(), sessionId: cashSession.id, type, amount, reason, createdBy: session.user.id, approvedBy: approval.approvedBy,
        available: expected.cash, now: new Date(),
      });
      const saved = await recordCashMovement(movement, session.user.name, approval.approverName);
      if (AUTO_PRINT) printMovement(saved, false); // la preuve papier du mouvement, à signer
    } catch (e) {
      setError(storageMessage(e, 'Stockage local indisponible : le mouvement d’espèces n’est pas enregistré.'));
    }
    closeSessionView();
    sync.sync();
  }

  async function printReportX() {
    setSessionView(null);
    try {
      print({ kind: 'session', report: await sessionReceipt(cashSession, registerName, store) });
    } catch {
      setError('Rapport X impossible : stockage local indisponible.');
    }
  }

  // Après la clôture, la caisse revient d'elle-même à l'écran d'ouverture, qui imprime le rapport.
  async function closeSession(counted: Counted, cashCount: CashCountLine[] | null, note: string) {
    // Écart au-delà du seuil, clôture d'un caissier : un responsable l'autorise (§11). Annulée : la fenêtre reste ouverte.
    const threshold = closingThreshold(session);
    const counts = methodCounts(expected, counted) ?? [];
    const detail = overThreshold(counts, threshold).map((c) => `${METHOD_LABELS[c.method]} : écart ${formatMad(c.difference)}`).join(' · ');
    const approval = await authorize('closing', `${detail} (seuil ${formatMad(threshold)})`, closingNeedsApproval(role, counts, threshold));
    if (!approval) return;
    try {
      const closing = buildClosing({
        counted, expected, cashCount, note, role, threshold, closedBy: session.user.id, approvedBy: approval.approvedBy, now: new Date(),
      });
      onClosed(cashSession.id);
      await closeCashSession(cashSession.id, closing, session.user.name, approval.approverName);
      sync.sync();
    } catch (e) {
      setSessionView(null);
      setError(storageMessage(e, 'Stockage local indisponible : la caisse n’est pas clôturée.'));
    }
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

  const unreadable = sync.outboxUnreadable + held.unreadable + legacy + unreadableSessions;

  return (
    <div className="pos">
      <TopBar session={session} sync={sync} onLogout={onLogout}>
        <button className="held-button" disabled={!sessionReady} onClick={() => { setRefundDone(null); setRefunding(true); }}
          aria-label="Retour d’articles et remboursement" title="Retour d’articles : retrouver le ticket, rembourser">
          <Icon name="swap" size={18} /><span className="label">Retour</span>
        </button>
        <button className="held-button" disabled={!sessionReady} onClick={() => setSessionView('menu')}
          aria-label="Session de caisse : entrées et sorties d’espèces, rapport X, clôture" title="Entrée / sortie d’espèces, rapport X, clôture">
          <Icon name="cash" size={18} /><span className="label">Session</span>
        </button>
        <button className="held-button" onClick={() => setShowHeld(true)} aria-label={`Liste d’attente : ${held.list.length}`}>
          <Icon name="pause" size={18} /><span className="label">Liste d’attente</span><span className="count">{held.list.length}</span>
        </button>
        <button className="held-button" disabled={!receipt} onClick={() => receipt && printSale(receipt, true)}
          aria-label="Réimprimer le dernier ticket" title={receipt ? `Réimprimer le ticket ${receipt.sale.number}` : 'Aucun ticket à réimprimer'}>
          <Icon name="printer" size={18} /><span className="label">Réimprimer</span>
        </button>
      </TopBar>
      {error && (
        <p className="banner" role="alert">
          <Icon name="alert" size={18} />{error}
          <button type="button" className="link" onClick={() => setError(null)}>Fermer</button>
        </p>
      )}
      {products.loaded && products.value.length === 0 && sync.connection === 'offline' && (
        <p className="banner"><Icon name="alert" size={18} />Catalogue vide sur ce poste : connectez la caisse au serveur une première fois.</p>
      )}
      {resumeNotice && (
        <p className="banner notice" role="status">
          <Icon name="alert" size={18} />{resumeNotice}
          <button type="button" className="link" onClick={() => setResumeNotice(null)}>Compris</button>
        </p>
      )}
      {refundDone && (
        <p className="banner notice" role="status">
          <Icon name="check" size={18} />
          Retour {refundDone.refund.number} enregistré : {formatMad(refundDone.refund.totals.ttc)} rendus
          ({refundDone.refund.payments.map((p) => `${METHOD_LABELS[p.method].toLowerCase()} ${formatMad(p.amount)}`).join(', ')}).
          <button type="button" className="link" onClick={() => printRefund(refundDone, true)}>Réimprimer le ticket</button>
          <button type="button" className="link" onClick={() => setRefundDone(null)}>Fermer</button>
        </p>
      )}
      {(sync.storageError || !held.saved) && (
        <p className="banner">
          <Icon name="alert" size={18} />Base locale indisponible : la caisse ne peut ni vendre hors ligne ni garder de vente en attente.
        </p>
      )}
      <SyncBanners sync={sync} unreadable={unreadable} />
      <main>
        <Cart cart={cart} dispatch={cartDispatch} products={products.value} lastSale={lastSale && lastSaleView(lastSale)}
          overLimit={overLimit} onCheckout={checkout} onHold={hold} />
        <ProductGrid products={products.value} categories={categories} brands={brands}
          onAdd={(product) => {
            cartDispatch({ type: 'add', product });
            document.getElementById('scan')?.focus(); // la douchette reste prête après un clic sur une tuile
          }} />
      </main>
      {showHeld && (
        <HeldListModal list={held.list} cartEmpty={cart.lines.length === 0} onResume={resume}
          onDelete={(id) => void deleteHeld(id)}
          onClose={() => { setShowHeld(false); document.getElementById('scan')?.focus(); }} />
      )}
      {sessionReady && sessionView === 'menu' && (
        <SessionModal session={cashSession} salesCount={sales.length} salesTotal={sales.reduce((n, s) => n + s.totals.ttc, 0)}
          refundsCount={refunds.length} refundsTotal={refunds.reduce((n, r) => n + r.totals.ttc, 0)}
          expected={expected} movements={movements} onMovement={() => setSessionView('movement')}
          onReprintMovement={(m) => printMovement(m, true)} onReport={() => void printReportX()}
          onCloseSession={() => setSessionView('close')} onClose={closeSessionView} />
      )}
      {sessionReady && sessionView === 'movement' && <CashMovementModal expected={expected.cash} onSave={saveMovement} onClose={closeSessionView} />}
      {sessionReady && sessionView === 'close' && (
        <CloseSessionModal expected={expected} role={role} threshold={closingThreshold(session)}
          blocker={closeBlocker(held.list.length, cart.lines.length)}
          onShowHeld={held.list.length > 0 ? () => { setSessionView(null); setShowHeld(true); } : null}
          onConfirm={closeSession} onClose={closeSessionView} />
      )}
      {sessionReady && refunding && (
        <RefundModal storeId={session.storeId} cashAvailable={expected.cash} onSave={saveRefund}
          onClose={() => { setRefunding(false); document.getElementById('scan')?.focus(); }} />
      )}
      {approval && (
        <ApprovalModal action={approval.action} detail={approval.detail} approvers={approvers.list}
          onApproved={(a) => approval.resolve(a)} onCancel={() => approval.resolve(null)} />
      )}
      <PrintSheet doc={doc} />
    </div>
  );
}
