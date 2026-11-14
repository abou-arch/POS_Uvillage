// Synchronisation hors ligne, sans dépendance au stockage : la file d'envoi (outbox), l'API et les minuteries
// sont passées en paramètres. Tout ce qui décide quoi envoyer, quoi garder et quand réessayer est ici, et testé.
import { api, ApiError } from '../api/client';
import { isRefund } from '../lib/buildRefund';
import { isClosing, isMovement, isOpening, MOVEMENT_LABELS } from '../lib/cashSession';
import { formatMad } from '../lib/totals.js';
import { isSale, isUuid } from '../state/sales';
import type { CashMovement, CashSessionClosing, CashSessionOpening, Product, Refund, Sale } from '../types';

/**
 * Ce que la caisse garde pour l'envoyer à l'API (§9, §10) : les ventes, les retours, et l'ouverture, les mouvements
 * d'espèces et la clôture des sessions. Tout part dans l'ordre où cela a été fait : l'API reçoit l'ouverture avant les ventes.
 */
export type OutboxOperation =
  | { kind: 'sale'; sale: Sale }
  | { kind: 'refund'; refund: Refund }
  | { kind: 'session_open'; opening: CashSessionOpening }
  | { kind: 'cash_movement'; movement: CashMovement }
  | { kind: 'session_close'; session_id: string; closing: CashSessionClosing };

/** Une opération de la file. `error` = refus du serveur, à faire vérifier (elle n'est plus renvoyée d'office). */
export type OutboxItem = OutboxOperation & { id: string; error: string | null };
type SaleItem = Extract<OutboxItem, { kind: 'sale' }>;

/** Clé de la clôture dans la file (l'ouverture a déjà l'id de la session). */
export const closeKey = (sessionId: string) => `close:${sessionId}`;

/** La file d'envoi, dans l'ordre où les opérations ont été faites. */
export interface OutboxStore {
  list(): Promise<OutboxItem[]>;
  remove(ids: string[]): Promise<void>;
  markError(errors: { id: string; error: string }[]): Promise<void>;
}

/** Réponse de POST /api/sales/batch (§5 du contrat) : un résultat par vente. */
export interface BatchResponse { results: { id: string; status: string; error?: { message?: string } }[] }

/** Les routes de l'API qui reçoivent la file (§5 et §9). */
export interface OutboxApi {
  sales: (sales: Sale[]) => Promise<BatchResponse>;
  refund: (refund: Refund) => Promise<unknown>;
  openSession: (opening: CashSessionOpening) => Promise<unknown>;
  addMovement: (movement: CashMovement) => Promise<unknown>;
  closeSession: (sessionId: string, closing: CashSessionClosing) => Promise<unknown>;
}

export const apiSenders: OutboxApi = {
  sales: api.syncSales,
  refund: api.createRefund,
  openSession: api.openCashSession,
  addMovement: api.addCashMovement,
  closeSession: api.closeCashSession,
};

export type FlushStatus = 'done' | 'offline' | 'unauthorized';
export interface FlushResult { status: FlushStatus; sent: string[]; rejected: { id: string; error: string }[] }

export const BATCH_SIZE = 20;

/** Pas de réponse, panne du serveur, ou « réessayez plus tard » : on garde tout et on réessaiera. */
const isTemporary = (err: unknown) =>
  !(err instanceof ApiError) || err.status >= 500 || err.status === 408 || err.status === 429;

const refusal = (err: unknown) => (err instanceof Error && err.message ? err.message : 'Refusée par le serveur');

/** Une opération qui n'est pas une vente part seule. Toute réponse 2xx (créée, déjà reçue, clôturée) la retire de la file. */
function sendOne(send: OutboxApi, item: Exclude<OutboxItem, SaleItem>): Promise<unknown> {
  switch (item.kind) {
    case 'refund': return send.refund(item.refund);
    case 'session_open': return send.openSession(item.opening);
    case 'cash_movement': return send.addMovement(item.movement);
    case 'session_close': return send.closeSession(item.session_id, item.closing);
  }
}

/**
 * Vide la file dans l'ordre. Les ventes qui se suivent partent par lots (POST /api/sales/batch) : « created » et
 * « duplicate » sont retirées de la file, « error » gardées et marquées. Les autres opérations partent une à une.
 * Coupure ou panne : on s'arrête, ce qui a été accepté est retiré, le reste attend dans l'ordre. Token refusé (401) :
 * on s'arrête sans rien toucher, l'envoi reprendra après la reconnexion. Une opération marquée en erreur n'est
 * renvoyée que si on le demande (`includeErrors`, clic sur l'indicateur) : le serveur la refuserait encore.
 */
export async function flushOutbox(
  outbox: OutboxStore,
  send: OutboxApi,
  { includeErrors = false, batchSize = BATCH_SIZE } = {},
): Promise<FlushResult> {
  const items = (await outbox.list()).filter((e) => includeErrors || e.error === null);
  const result: FlushResult = { status: 'done', sent: [], rejected: [] };
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.kind !== 'sale') {
      i += 1;
      try {
        await sendOne(send, item);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return { ...result, status: 'unauthorized' };
        if (isTemporary(err)) return { ...result, status: 'offline' };
        const rejected = { id: item.id, error: refusal(err) };
        await outbox.markError([rejected]);
        result.rejected.push(rejected);
        continue;
      }
      await outbox.remove([item.id]);
      result.sent.push(item.id);
      continue;
    }

    const batch: SaleItem[] = []; // les ventes qui se suivent, `batchSize` au plus
    while (i < items.length && batch.length < batchSize) {
      const next = items[i];
      if (next.kind !== 'sale') break;
      batch.push(next);
      i += 1;
    }
    let response: BatchResponse;
    try {
      response = await send.sales(batch.map((b) => b.sale));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return { ...result, status: 'unauthorized' };
      if (isTemporary(err)) return { ...result, status: 'offline' };
      // Lot refusé en entier (400…) : chaque vente est marquée, la suite part quand même.
      const rejected = batch.map((b) => ({ id: b.id, error: refusal(err) }));
      await outbox.markError(rejected);
      result.rejected.push(...rejected);
      continue;
    }
    if (!Array.isArray(response?.results)) return { ...result, status: 'offline' }; // réponse illisible : on réessaiera
    const byId = new Map(response.results.map((r) => [r.id, r]));
    const sent: string[] = [];
    const rejected: { id: string; error: string }[] = [];
    for (const { id } of batch) {
      const r = byId.get(id);
      if (r?.status === 'created' || r?.status === 'duplicate') sent.push(id);
      else if (r?.status === 'error') rejected.push({ id, error: r.error?.message ?? 'Refusée par le serveur' });
      // Absente de la réponse : gardée telle quelle, elle repartira au prochain passage.
    }
    await outbox.remove(sent);
    await outbox.markError(rejected);
    result.sent.push(...sent);
    result.rejected.push(...rejected);
  }
  return result;
}

/** Relecture d'une opération de la file : une ligne abîmée ou écrite par une autre version n'est ni envoyée ni effacée. */
export function isOutboxItem(v: unknown): v is OutboxItem {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  if (typeof e.id !== 'string' || !(e.error === null || typeof e.error === 'string')) return false;
  switch (e.kind) {
    case 'sale': return isSale(e.sale) && e.sale.id === e.id;
    case 'refund': return isRefund(e.refund) && e.refund.id === e.id;
    case 'session_open': return isOpening(e.opening) && e.opening.id === e.id;
    case 'cash_movement': return isMovement(e.movement) && e.movement.id === e.id;
    case 'session_close': return isUuid(e.session_id) && isClosing(e.closing) && e.id === closeKey(e.session_id);
    default: return false;
  }
}

/** Session de caisse à laquelle appartient une opération. */
export function itemSession(item: OutboxOperation): string {
  switch (item.kind) {
    case 'sale': return item.sale.session_id;
    case 'refund': return item.refund.session_id;
    case 'session_open': return item.opening.id;
    case 'cash_movement': return item.movement.session_id;
    case 'session_close': return item.session_id;
  }
}

/** Ce que le caissier lit quand une opération est refusée. */
export function describeItem(item: OutboxOperation): string {
  switch (item.kind) {
    case 'sale': return `Vente ${item.sale.number}`;
    case 'refund': return `Retour ${item.refund.number}`;
    case 'session_open': return 'Ouverture de caisse';
    case 'cash_movement': return `${MOVEMENT_LABELS[item.movement.type]} d’espèces de ${formatMad(item.movement.amount)}`;
    case 'session_close': return 'Clôture de caisse';
  }
}

export const SYNC_INTERVAL_MS = 30_000;
export const MAX_DELAY_MS = 5 * 60_000;

/** Toutes les 30 s ; après des échecs de suite, l'attente double (1 min, 2 min…) sans dépasser 5 min. */
export const nextDelay = (failures: number) => Math.min(SYNC_INTERVAL_MS * 2 ** failures, MAX_DELAY_MS);

export type RunStatus = 'ok' | 'offline' | 'unauthorized';

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

/**
 * Boucle de synchronisation : un passage tout de suite, puis toutes les 30 s (attente progressive après un échec).
 * Jamais deux passages à la fois : une demande pendant un passage (nouvelle vente, clic) en relance un juste après.
 * Token refusé : la boucle s'arrête, elle sera relancée après la reconnexion.
 */
export function createSyncLoop(
  run: (force: boolean) => Promise<RunStatus>,
  timers: Timers = { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id as number) },
) {
  let failures = 0;
  let timer: unknown;
  let busy = false;
  let queued: boolean | null = null; // passage demandé pendant le passage en cours (true = forcé)
  let stopped = false;

  async function tick(force: boolean): Promise<void> {
    if (stopped) return;
    if (busy) {
      queued = (queued ?? false) || force;
      return;
    }
    busy = true;
    timers.clearTimeout(timer);
    let status: RunStatus;
    try {
      status = await run(force);
    } catch {
      status = 'offline';
    }
    busy = false;
    if (stopped || status === 'unauthorized') return;
    failures = status === 'ok' ? 0 : failures + 1;
    if (queued !== null) {
      const next = queued;
      queued = null;
      return tick(next);
    }
    timer = timers.setTimeout(() => void tick(false), nextDelay(failures));
  }

  return {
    start: () => tick(false),
    /** Nouvelle vente ou clic sur l'indicateur (force = renvoyer aussi les ventes en erreur). */
    trigger: (force = false) => tick(force),
    /** Le réseau revient : on réessaie tout de suite, sans l'attente progressive. */
    online: () => {
      failures = 0;
      return tick(false);
    },
    stop: () => {
      stopped = true;
      timers.clearTimeout(timer);
    },
    get failures() { return failures; },
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000; // stock au poids : 3 décimales

/**
 * Quantités vendues sur ce magasin et pas encore reçues par le serveur, par article, moins les quantités retournées
 * pas encore reçues (négatif : le serveur n'a pas encore remis ces articles en stock).
 */
export function pendingQuantities(outbox: OutboxOperation[], storeId: string): Map<string, number> {
  const quantities = new Map<string, number>();
  const add = (productId: string, q: number) => quantities.set(productId, round3((quantities.get(productId) ?? 0) + q));
  for (const item of outbox) {
    if (item.kind === 'sale' && item.sale.store_id === storeId) for (const l of item.sale.lines) add(l.product_id, l.quantity);
    if (item.kind === 'refund' && item.refund.store_id === storeId) for (const l of item.refund.lines) add(l.product_id, -l.quantity);
  }
  return quantities;
}

/**
 * Changements du catalogue reçus de l'API (updated_since) : les articles actifs sont mis à jour, ceux
 * désactivés retirés du cache. Le stock du serveur ne compte pas encore les ventes de la file : on les déduit,
 * sinon la grille remonterait le stock d'un article vendu hors ligne.
 */
export function catalogChanges(changes: Product[], pending: Map<string, number>): { put: Product[]; remove: string[] } {
  return {
    put: changes.filter((p) => p.active).map((p) => ({ ...p, stock: round3(p.stock - (pending.get(p.id) ?? 0)) })),
    remove: changes.filter((p) => !p.active).map((p) => p.id),
  };
}

/** Repère de la prochaine synchro : le plus récent updated_at reçu, tel que l'API l'a écrit. */
export function nextCursor(changes: Product[], previous: string | null): string | null {
  let cursor = previous;
  for (const p of changes) {
    const t = Date.parse(p.updated_at);
    if (!Number.isNaN(t) && (cursor === null || t > Date.parse(cursor))) cursor = p.updated_at;
  }
  return cursor;
}
