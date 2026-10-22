// Synchronisation hors ligne, sans dépendance au stockage : la file des ventes (outbox), l'API et les minuteries
// sont passées en paramètres. Tout ce qui décide quoi envoyer, quoi garder et quand réessayer est ici, et testé.
import { ApiError } from '../api/client';
import type { Product, Sale } from '../types';

export interface OutboxItem { sale: Sale; error: string | null }

/** La file des ventes à envoyer, dans l'ordre où elles ont été faites. */
export interface OutboxStore {
  list(): Promise<OutboxItem[]>;
  remove(ids: string[]): Promise<void>;
  markError(errors: { id: string; error: string }[]): Promise<void>;
}

/** Réponse de POST /api/sales/batch (§5 du contrat) : un résultat par vente. */
export interface BatchResponse { results: { id: string; status: string; error?: { message?: string } }[] }

export type FlushStatus = 'done' | 'offline' | 'unauthorized';
export interface FlushResult { status: FlushStatus; sent: string[]; rejected: { id: string; error: string }[] }

export const BATCH_SIZE = 20;

/** Pas de réponse, panne du serveur, ou « réessayez plus tard » : on garde tout et on réessaiera. */
const isTemporary = (err: unknown) =>
  !(err instanceof ApiError) || err.status >= 500 || err.status === 408 || err.status === 429;

/**
 * Vide la file par lots. « created » et « duplicate » : retirées de la file. « error » : gardées, marquées en erreur.
 * Coupure ou panne : on s'arrête, les lots déjà acceptés sont retirés, le reste attend. Token refusé (401) :
 * on s'arrête sans rien toucher, l'envoi reprendra après la reconnexion. Une vente marquée en erreur n'est
 * renvoyée que si on le demande (`includeErrors`, clic sur l'indicateur) : le serveur la refuserait encore.
 */
export async function flushOutbox(
  outbox: OutboxStore,
  sendBatch: (sales: Sale[]) => Promise<BatchResponse>,
  { includeErrors = false, batchSize = BATCH_SIZE } = {},
): Promise<FlushResult> {
  const sales = (await outbox.list()).filter((e) => includeErrors || e.error === null).map((e) => e.sale);
  const result: FlushResult = { status: 'done', sent: [], rejected: [] };
  for (let i = 0; i < sales.length; i += batchSize) {
    const batch = sales.slice(i, i + batchSize);
    let response: BatchResponse;
    try {
      response = await sendBatch(batch);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return { ...result, status: 'unauthorized' };
      if (isTemporary(err)) return { ...result, status: 'offline' };
      // Lot refusé en entier (400…) : chaque vente est marquée, les lots suivants partent quand même.
      const rejected = batch.map((s) => ({ id: s.id, error: err instanceof Error ? err.message : 'Refusée par le serveur' }));
      await outbox.markError(rejected);
      result.rejected.push(...rejected);
      continue;
    }
    if (!Array.isArray(response?.results)) return { ...result, status: 'offline' }; // réponse illisible : on réessaiera
    const byId = new Map(response.results.map((r) => [r.id, r]));
    const sent: string[] = [];
    const rejected: { id: string; error: string }[] = [];
    for (const sale of batch) {
      const r = byId.get(sale.id);
      if (r?.status === 'created' || r?.status === 'duplicate') sent.push(sale.id);
      else if (r?.status === 'error') rejected.push({ id: sale.id, error: r.error?.message ?? 'Refusée par le serveur' });
      // Absente de la réponse : gardée telle quelle, elle repartira au prochain passage.
    }
    await outbox.remove(sent);
    await outbox.markError(rejected);
    result.sent.push(...sent);
    result.rejected.push(...rejected);
  }
  return result;
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

/** Quantités vendues sur ce magasin et pas encore reçues par le serveur, par article. */
export function pendingQuantities(outbox: OutboxItem[], storeId: string): Map<string, number> {
  const quantities = new Map<string, number>();
  for (const { sale } of outbox) {
    if (sale.store_id !== storeId) continue;
    for (const l of sale.lines) quantities.set(l.product_id, round3((quantities.get(l.product_id) ?? 0) + l.quantity));
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
