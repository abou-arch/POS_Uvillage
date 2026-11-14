// Sessions de caisse dans IndexedDB (§9) : chaque opération est écrite sur la caisse ET mise dans l'outbox, dans la
// même transaction. Tout marche hors ligne ; l'envoi à l'API suit, dans l'ordre (sync/sync.ts).
import { api } from '../api/client';
import { TIME_ZONE, type StoreInfo } from '../config/store';
import {
  closedSession, isLocalMovement, isLocalSession, openedSession, sessionsToPrune, type LocalCashMovement, type LocalCashSession,
} from '../lib/cashSession';
import { isRefund } from '../lib/buildRefund';
import { buildSessionReceipt, type SessionReceipt } from '../lib/receipt';
import { isSale } from '../state/sales';
import { closeKey, isOutboxItem, itemSession } from '../sync/sync';
import type { CashMovement, CashSession, CashSessionClosing, CashSessionOpening, Refund, Sale } from '../types';
import { db } from './db';
import { useLiveQuery } from './useLiveQuery';
import { enqueue, SessionNotOpenError } from './outbox';

/** Ouvre une session. Refusé si une session est déjà ouverte sur cette caisse (une seule à la fois, §9). */
export async function openCashSession(opening: CashSessionOpening, openerName: string): Promise<void> {
  await db.transaction('rw', [db.cash_sessions, db.outbox], async () => {
    const sessions = await db.cash_sessions.where('register_id').equals(opening.register_id).toArray();
    if (sessions.some((s) => s.status === 'open')) throw new Error('Une session est déjà ouverte sur cette caisse.');
    await db.cash_sessions.add(openedSession(opening, openerName));
    await enqueue({ kind: 'session_open', id: opening.id, opening });
  });
  void pruneOldSessions().catch(() => {}); // ménage au mieux : il ne doit jamais bloquer l'ouverture
}

/** Entrée ou sortie d'espèces, dans la session ouverte. Renvoie le mouvement tel qu'il est gardé (pour son ticket). */
export async function recordCashMovement(
  movement: CashMovement, cashierName: string, approverName: string | null = null,
): Promise<LocalCashMovement> {
  const local: LocalCashMovement = { ...movement, cashier_name: cashierName, approver_name: approverName };
  await db.transaction('rw', [db.cash_sessions, db.cash_movements, db.outbox], async () => {
    if ((await db.cash_sessions.get(movement.session_id))?.status !== 'open') throw new SessionNotOpenError();
    await db.cash_movements.add(local);
    await enqueue({ kind: 'cash_movement', id: movement.id, movement });
  });
  return local;
}

/** Clôture : la session est marquée clôturée sur la caisse et la clôture part en dernier dans l'outbox. */
export async function closeCashSession(
  sessionId: string, closing: CashSessionClosing, closerName: string, approverName: string | null = null,
): Promise<void> {
  await db.transaction('rw', [db.cash_sessions, db.outbox], async () => {
    const session = await db.cash_sessions.get(sessionId);
    if (!session || session.status !== 'open') throw new SessionNotOpenError();
    await db.cash_sessions.put(closedSession(session, closing, closerName, approverName));
    await enqueue({ kind: 'session_close', id: closeKey(sessionId), session_id: sessionId, closing });
  });
}

export interface CashSessionData { sales: Sale[]; movements: LocalCashMovement[]; refunds: Refund[] }

/** Ventes, retours et mouvements enregistrés dans une session (pour le rapport et l'attendu de la clôture). */
export async function cashSessionData(sessionId: string): Promise<CashSessionData> {
  const [journal, movements, refunds] = await Promise.all([
    db.journal.where('session_id').equals(sessionId).toArray(),
    db.cash_movements.where('session_id').equals(sessionId).toArray(),
    db.refunds.where('session_id').equals(sessionId).toArray(),
  ]);
  const byDate = (a: { created_at: string }, b: { created_at: string }) => a.created_at.localeCompare(b.created_at);
  return {
    sales: journal.map((row) => row.sale).filter(isSale).sort(byDate),
    movements: movements.filter(isLocalMovement),
    refunds: refunds.map((row) => row.refund).filter(isRefund).sort(byDate),
  };
}

/** Les sessions clôturées depuis plus de 31 jours et entièrement envoyées quittent le poste, avec leurs ventes et retours. */
export async function pruneOldSessions(now = new Date()): Promise<void> {
  const sessions = (await db.cash_sessions.toArray()).filter(isLocalSession);
  const pending = new Set((await db.outbox.toArray()).filter(isOutboxItem).map(itemSession));
  const ids = sessionsToPrune(sessions, now, pending);
  if (ids.length === 0) return;
  await db.transaction('rw', [db.cash_sessions, db.cash_movements, db.journal, db.refunds], async () => {
    await db.journal.where('session_id').anyOf(ids).delete();
    await db.refunds.where('session_id').anyOf(ids).delete();
    await db.cash_movements.where('session_id').anyOf(ids).delete();
    await db.cash_sessions.bulkDelete(ids);
  });
}

/** Sessions de cette caisse : celle qui est ouverte, la dernière clôturée ; se met à jour à chaque changement. */
export function useCashSessions(registerId: string) {
  const query = useLiveQuery(() => db.cash_sessions.where('register_id').equals(registerId).toArray(), [registerId], []);
  const sessions = query.value.filter(isLocalSession);
  const closed = sessions.filter((s) => s.status === 'closed').sort((a, b) => (b.closed_at ?? '').localeCompare(a.closed_at ?? ''));
  return {
    loaded: query.loaded,
    storageError: query.error !== null,
    open: sessions.find((s) => s.status === 'open') ?? null,
    lastClosed: closed[0] ?? null,
    /** Lignes illisibles (autre version de la caisse) : ni utilisées ni effacées. */
    unreadable: query.value.length - sessions.length,
  };
}

/**
 * Session ouverte côté serveur que ce poste ne connaît pas (ouverte sur un autre poste, ou données du poste
 * effacées) : la caisse n'en ouvre pas une deuxième (§9). Une session que le poste connaît (clôture pas encore
 * envoyée, par exemple) ne bloque rien. Lève une erreur si l'API ne répond pas.
 */
export async function unknownServerSession(registerId: string): Promise<CashSession | null> {
  const { session } = await api.currentCashSession(registerId);
  if (!session || typeof session.id !== 'string') return null;
  return (await db.cash_sessions.get(session.id)) ? null : session;
}

/** Rapport 80 mm d'une session, avec ce qui est enregistré sur la caisse à cet instant (et ce qui reste à envoyer). */
export async function sessionReceipt(session: LocalCashSession, registerName: string, store: StoreInfo): Promise<SessionReceipt> {
  const [{ sales, movements, refunds }, outbox] = await Promise.all([cashSessionData(session.id), db.outbox.toArray()]);
  const pending = outbox.filter(isOutboxItem).filter((item) => itemSession(item) === session.id).length;
  return buildSessionReceipt({ session, sales, movements, refunds, registerName, printedAt: new Date(), store, timeZone: TIME_ZONE, pending });
}
