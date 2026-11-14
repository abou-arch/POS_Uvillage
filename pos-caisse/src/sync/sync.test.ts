import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchesCustomer } from '../db/customers';
import { buildRefund, defaultRefundPayments, refundLines, refundTotals, returnableLines } from '../lib/buildRefund';
import { buildSale } from '../lib/buildSale';
import { buildClosing, buildMovement, buildOpening } from '../lib/cashSession';
import { emptyCart } from '../state/cart';
import type { CashMovement, CashSessionClosing, CashSessionOpening, Product, Refund, Sale } from '../types';
import {
  apiSenders, catalogChanges, closeKey, createSyncLoop, describeItem, flushOutbox, isOutboxItem, itemSession,
  MAX_DELAY_MS, nextCursor, nextDelay, pendingQuantities, SYNC_INTERVAL_MS, type OutboxItem, type OutboxStore, type Timers,
} from './sync';

const SESSION = '3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f';

// --- Une caisse et un serveur simulés ---------------------------------------------------------------

let counter = 0;
function sale(quantity = 1, productId = 'p_1'): Sale {
  counter += 1;
  return buildSale({
    cart: { ...emptyCart, lines: [{ product_id: productId, name: 'PAIN', quantity, unit_price_ttc: 150, discount: 0, tva_rate: 0, stock: 99 }] },
    storeId: 'st_2', registerId: 'reg_3', sessionId: '3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f', cashierId: 'u_2',
    payments: [{ method: 'cash', amount: Math.round(quantity * 150) }], amountReceived: Math.round(quantity * 150),
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`, counter, now: new Date('2026-10-22T10:00:00Z'),
    lineIds: [`10000000-0000-4000-8000-${String(counter).padStart(12, '0')}`],
  });
}

const item = (s: Sale, error: string | null = null): OutboxItem => ({ kind: 'sale', id: s.id, sale: s, error });

function memoryOutbox(entries: (Sale | OutboxItem)[]): OutboxStore & { items: OutboxItem[] } {
  const store = {
    items: entries.map((e): OutboxItem => ('kind' in e ? e : item(e))),
    list: async () => store.items.map((i) => ({ ...i })),
    remove: async (ids: string[]) => { store.items = store.items.filter((i) => !ids.includes(i.id)); },
    markError: async (errors: { id: string; error: string }[]) => {
      for (const e of errors) store.items = store.items.map((i) => (i.id === e.id ? { ...i, error: e.error } : i));
    },
  };
  return store;
}

// Opérations de session (§9), comme la caisse les met en file.
let ids = 0;
const nextId = () => `00000000-0000-4000-9000-${String((ids += 1)).padStart(12, '0')}`;
const now = new Date('2026-11-12T08:00:00Z');
function openingOp(sessionId = SESSION): OutboxItem & { opening: CashSessionOpening } {
  const opening = buildOpening({ id: sessionId, storeId: 'st_2', registerId: 'reg_3', openedBy: 'u_2', openingCash: 50000, note: '', now });
  return { kind: 'session_open', id: sessionId, opening, error: null };
}
function movementOp(amount = 5000): OutboxItem & { movement: CashMovement } {
  const movement = buildMovement({ id: nextId(), sessionId: SESSION, type: 'out', amount, reason: 'Achat de sacs', createdBy: 'u_2', available: 1e6, now });
  return { kind: 'cash_movement', id: movement.id, movement, error: null };
}
/** Retour de `quantity` articles de la première ligne d'une vente, remboursé comme proposé. */
function refundOp(original: Sale, quantity = 1): OutboxItem & { refund: Refund } {
  const quantities = new Map([[0, quantity]]);
  const total = refundTotals(refundLines(returnableLines(original, []), quantities)).ttc;
  const refund = buildRefund({
    sale: original, refunds: [], quantities, reason: 'defective', reasonText: '', payments: defaultRefundPayments(original, [], total),
    cashAvailable: 1e6, storeId: 'st_2', registerId: 'reg_3', sessionId: SESSION, cashierId: 'u_2', id: nextId(), counter: 1, now,
  });
  return { kind: 'refund', id: refund.id, refund, error: null };
}
function closeOp(sessionId = SESSION): OutboxItem & { closing: CashSessionClosing } {
  const closing = buildClosing({
    counted: { cash: 56000, card: 8000, mobile: 0 }, expected: { cash: 57000, card: 8000, mobile: 0 }, cashCount: null,
    note: 'Erreur de rendu', role: 'cashier', threshold: 2000, closedBy: 'u_2', now,
  });
  return { kind: 'session_close', id: closeKey(sessionId), session_id: sessionId, closing, error: null };
}

/**
 * fetch simulé pour les routes de la file (§5 et §9) : le serveur garde chaque opération une seule fois
 * (idempotence par id), note l'ordre d'arrivée, refuse ce qui est listé dans `refuse` (409 pour une ouverture,
 * comme une autre session déjà ouverte), et peut couper le réseau à la n-ième requête (avant ou après traitement).
 */
function fakeServer() {
  const server = {
    received: new Map<string, Sale>(),
    log: [] as string[], // ordre d'arrivée : « open », « sale:<id> », « refund:<id> », « move », « close »
    sessions: new Set<string>(),
    requests: 0,
    refuse: new Set<string>(),
    cutAt: null as number | null, // numéro de requête où le réseau coupe
    cutAfterProcessing: false, // true : le serveur enregistre, mais la réponse se perd
    status: 200,
  };
  const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    server.requests += 1;
    const cut = server.cutAt === server.requests;
    if (cut && !server.cutAfterProcessing) throw new TypeError('Failed to fetch');
    if (server.status !== 200) return json({ error: { code: 'X', message: `Erreur ${server.status}` } }, server.status);
    const body = JSON.parse(String(init.body));
    let response: Response;
    if (url.endsWith('/sales/batch')) {
      const results = (body.sales as Sale[]).map((s) => {
        if (server.refuse.has(s.id)) return { id: s.id, status: 'error', error: { code: 'TOTALS_MISMATCH', message: 'Totaux incohérents' } };
        if (server.received.has(s.id)) return { id: s.id, status: 'duplicate' };
        server.received.set(s.id, s);
        server.log.push(`sale:${s.id}`);
        return { id: s.id, status: 'created' };
      });
      response = json({ results }, 200);
    } else if (url.endsWith('/cash-sessions')) {
      if (server.refuse.has(body.id)) {
        response = json({ error: { code: 'SESSION_ALREADY_OPEN', message: 'Une autre session est ouverte sur cette caisse' } }, 409);
      } else {
        const created = !server.sessions.has(body.id);
        if (created) server.log.push('open');
        server.sessions.add(body.id);
        response = json({ id: body.id, status: created ? 'created' : 'duplicate' }, created ? 201 : 200);
      }
    } else if (url.endsWith('/refunds')) {
      if (server.refuse.has(body.id)) {
        response = json({ error: { code: 'RETURN_EXCEEDS', message: 'Plus que ce qui reste à retourner' } }, 422);
      } else {
        server.log.push(`refund:${body.id}`);
        response = json({ id: body.id, status: 'created', session_closed: false }, 201);
      }
    } else if (url.endsWith('/cash-movements')) {
      server.log.push('move');
      response = json({ id: body.id, status: 'created', session_closed: false }, 201);
    } else if (/\/cash-sessions\/[^/]+\/close$/.test(url)) {
      server.log.push('close');
      response = json({ status: 'closed', expected_mismatch: false }, 200);
    } else {
      throw new Error(`Route inattendue : ${url}`);
    }
    if (cut) throw new TypeError('Failed to fetch'); // traité côté serveur, réponse perdue
    return response;
  });
  return server;
}

afterEach(() => vi.unstubAllGlobals());

// --- Vidage de l'outbox ------------------------------------------------------------------------------

describe('envoi des ventes gardées sur la caisse', () => {
  it('envoi réussi : chaque vente arrive une fois et quitte la file', async () => {
    const server = fakeServer();
    const sales = [sale(), sale(), sale()];
    const outbox = memoryOutbox(sales);
    const result = await flushOutbox(outbox, apiSenders);
    expect(result).toEqual({ status: 'done', sent: sales.map((s) => s.id), rejected: [] });
    expect(outbox.items).toEqual([]);
    expect([...server.received.keys()]).toEqual(sales.map((s) => s.id));
    expect(server.requests).toBe(1);
  });

  it('doublon : une vente déjà reçue quitte la file sans être comptée deux fois', async () => {
    const server = fakeServer();
    const already = sale();
    server.received.set(already.id, already);
    const outbox = memoryOutbox([already, sale()]);
    const result = await flushOutbox(outbox, apiSenders);
    expect(result.sent).toHaveLength(2);
    expect(outbox.items).toEqual([]);
    expect(server.received.size).toBe(2);
  });

  it('erreur partielle : la vente refusée reste, marquée, les autres partent', async () => {
    const server = fakeServer();
    const [a, b, c] = [sale(), sale(), sale()];
    server.refuse.add(b.id);
    const outbox = memoryOutbox([a, b, c]);
    const result = await flushOutbox(outbox, apiSenders);
    expect(result).toEqual({ status: 'done', sent: [a.id, c.id], rejected: [{ id: b.id, error: 'Totaux incohérents' }] });
    expect(outbox.items).toEqual([item(b, 'Totaux incohérents')]);

    // Sans demande explicite, elle n'est pas renvoyée (le serveur la refuserait encore)…
    const before = server.requests;
    await flushOutbox(outbox, apiSenders);
    expect(server.requests).toBe(before);
    // … un clic sur l'indicateur la renvoie, une fois corrigée côté serveur.
    server.refuse.clear();
    expect((await flushOutbox(outbox, apiSenders, { includeErrors: true })).sent).toEqual([b.id]);
    expect(outbox.items).toEqual([]);
  });

  it('coupure au milieu d’un lot : les lots acceptés partent, le reste attend, rien n’est perdu ni doublé', async () => {
    const server = fakeServer();
    const sales = [sale(), sale(), sale(), sale(), sale()];
    const outbox = memoryOutbox(sales);
    server.cutAt = 2; // 2e lot : plus de réseau
    const first = await flushOutbox(outbox, apiSenders, { batchSize: 2 });
    expect(first).toEqual({ status: 'offline', sent: sales.slice(0, 2).map((s) => s.id), rejected: [] });
    expect(outbox.items.map((i) => i.id)).toEqual(sales.slice(2).map((s) => s.id));
    expect(outbox.items.every((i) => i.error === null)).toBe(true);

    server.cutAt = null; // le réseau revient
    const second = await flushOutbox(outbox, apiSenders, { batchSize: 2 });
    expect(second.status).toBe('done');
    expect(outbox.items).toEqual([]);
    expect([...server.received.keys()]).toEqual(sales.map((s) => s.id));
  });

  it('coupure après traitement (réponse perdue) : au renvoi, le serveur répond « duplicate », compté une fois', async () => {
    const server = fakeServer();
    const sales = [sale(), sale(), sale()];
    const outbox = memoryOutbox(sales);
    server.cutAt = 1;
    server.cutAfterProcessing = true;
    expect((await flushOutbox(outbox, apiSenders)).status).toBe('offline');
    expect(outbox.items).toHaveLength(3); // la caisse ne sait pas que le serveur les a reçues : elle les garde
    expect(server.received.size).toBe(3);

    server.cutAt = null;
    expect((await flushOutbox(outbox, apiSenders)).sent).toHaveLength(3);
    expect(outbox.items).toEqual([]);
    expect(server.received.size).toBe(3);
  });

  it('token expiré (401) : on s’arrête sans rien retirer ni marquer', async () => {
    const server = fakeServer();
    server.status = 401;
    const outbox = memoryOutbox([sale(), sale()]);
    expect(await flushOutbox(outbox, apiSenders)).toEqual({ status: 'unauthorized', sent: [], rejected: [] });
    expect(outbox.items.every((i) => i.error === null)).toBe(true);
    expect(outbox.items).toHaveLength(2);
  });

  it('panne du serveur (503) ou trop de requêtes (429) : tout reste, on réessaiera', async () => {
    for (const status of [503, 429]) {
      const server = fakeServer();
      server.status = status;
      const outbox = memoryOutbox([sale()]);
      expect((await flushOutbox(outbox, apiSenders)).status).toBe('offline');
      expect(outbox.items[0].error).toBeNull();
    }
  });

  it('lot refusé en entier (400) : ses ventes sont marquées, les lots suivants partent', async () => {
    let calls = 0;
    const outbox = memoryOutbox([sale(), sale(), sale()]);
    const send = async (batch: Sale[]) => {
      calls += 1;
      if (calls === 1) {
        const { ApiError } = await import('../api/client');
        throw new ApiError(400, 'BAD_REQUEST', 'Requête invalide');
      }
      return { results: batch.map((s) => ({ id: s.id, status: 'created' })) };
    };
    const result = await flushOutbox(outbox, { ...apiSenders, sales: send }, { batchSize: 2 });
    expect(result.status).toBe('done');
    expect(result.sent).toHaveLength(1);
    expect(outbox.items.map((i) => i.error)).toEqual(['Requête invalide', 'Requête invalide']);
  });

  it('vente absente de la réponse ou réponse illisible : gardée telle quelle', async () => {
    const [a, b] = [sale(), sale()];
    const outbox = memoryOutbox([a, b]);
    await flushOutbox(outbox, { ...apiSenders, sales: async () => ({ results: [{ id: a.id, status: 'created' }] }) });
    expect(outbox.items).toEqual([item(b)]);
    const garbage = await flushOutbox(outbox, { ...apiSenders, sales: async () => ({}) as never });
    expect(garbage.status).toBe('offline');
    expect(outbox.items).toEqual([item(b)]);
  });
});

// --- Boucle : toutes les 30 s, attente progressive ---------------------------------------------------

describe('boucle de synchronisation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const timers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as number) };

  it('attente : 30 s, puis double après chaque échec, sans dépasser 5 min', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(nextDelay)).toEqual([30_000, 60_000, 120_000, 240_000, MAX_DELAY_MS, MAX_DELAY_MS, MAX_DELAY_MS]);
  });

  it('un passage au démarrage, puis toutes les 30 s ; après des échecs, de plus en plus espacés', async () => {
    let online = false;
    const run = vi.fn(async () => (online ? 'ok' as const : 'offline' as const));
    const loop = createSyncLoop(run, timers);
    await loop.start();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 2); // 1er échec : 60 s d'attente
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 4 - 1); // 2e échec : 120 s
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(3);
    online = true;
    await loop.online(); // le réseau revient : tout de suite, et l'attente repart de 30 s
    expect(run).toHaveBeenCalledTimes(4);
    expect(loop.failures).toBe(0);
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(5);
    loop.stop();
  });

  it('jamais deux passages à la fois : une demande pendant un passage en relance un juste après', async () => {
    let release: () => void = () => {};
    let running = 0;
    let maxRunning = 0;
    const forced: boolean[] = [];
    const run = vi.fn(async (force: boolean) => {
      forced.push(force);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise<void>((r) => { release = r; });
      running -= 1;
      return 'ok' as const;
    });
    const loop = createSyncLoop(run, timers);
    const first = loop.start();
    void loop.trigger(); // nouvelle vente pendant l'envoi
    void loop.trigger(true); // clic sur l'indicateur
    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    release();
    await first;
    expect(maxRunning).toBe(1);
    expect(forced).toEqual([false, true]); // les deux demandes en un seul passage, forcé
    loop.stop();
  });

  it('token refusé : la boucle s’arrête jusqu’à la reconnexion', async () => {
    const run = vi.fn(async () => 'unauthorized' as const);
    const loop = createSyncLoop(run, timers);
    await loop.start();
    await vi.advanceTimersByTimeAsync(MAX_DELAY_MS * 3);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('arrêtée (écran quitté) : plus aucun passage', async () => {
    const run = vi.fn(async () => 'ok' as const);
    const loop = createSyncLoop(run, timers);
    await loop.start();
    loop.stop();
    await vi.advanceTimersByTimeAsync(MAX_DELAY_MS * 3);
    await loop.trigger();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

// --- Catalogue et stock local ------------------------------------------------------------------------

const product = (id: string, stock: number, extra: Partial<Product> = {}): Product => ({
  id, code: id, barcode: null, name: id, name_ar: null, category_id: null, brand_id: null, price_ttc: 100, tva_rate: 0,
  image_url: null, stock, stock_alert: 5, expiry_date: null, active: true, updated_at: '2026-10-22T10:00:00Z', ...extra,
});

describe('catalogue hors ligne', () => {
  it('stock en attente d’envoi : quantités vendues sur ce magasin, par article', () => {
    const other = { ...sale(5, 'p_1'), store_id: 'st_1' };
    const pending = pendingQuantities([item(sale(2, 'p_1')), item(sale(0.25, 'p_1')), openingOp(), movementOp(),
      item(sale(1, 'p_2')), item(other), closeOp()], 'st_2');
    expect([...pending]).toEqual([['p_1', 2.25], ['p_2', 1]]);
  });

  it('retour pas encore reçu : ses quantités sont déduites (le serveur ne les a pas encore remises en stock)', () => {
    const pending = pendingQuantities([item(sale(2, 'p_1')), refundOp(sale(3, 'p_1'), 1.5), refundOp(sale(1, 'p_2'))], 'st_2');
    expect([...pending]).toEqual([['p_1', 0.5], ['p_2', -1]]);
    const { put } = catalogChanges([product('p_2', 10)], pending);
    expect(put[0].stock).toBe(11);
  });

  it('changements reçus : actifs mis à jour (moins les ventes pas encore reçues), désactivés retirés', () => {
    const changes = [product('p_1', 60), product('p_2', 10), product('p_3', 4, { active: false })];
    const { put, remove } = catalogChanges(changes, new Map([['p_1', 2.25]]));
    expect(put.map((p) => [p.id, p.stock])).toEqual([['p_1', 57.75], ['p_2', 10]]);
    expect(remove).toEqual(['p_3']);
  });

  it('repère de synchro : le updated_at le plus récent reçu, ou le précédent', () => {
    const changes = [product('p_1', 1, { updated_at: '2026-10-22T10:00:00Z' }), product('p_2', 1, { updated_at: '2026-10-22T11:30:00.250Z' })];
    expect(nextCursor(changes, '2026-10-21T00:00:00Z')).toBe('2026-10-22T11:30:00.250Z');
    expect(nextCursor([], '2026-10-21T00:00:00Z')).toBe('2026-10-21T00:00:00Z');
    expect(nextCursor([], null)).toBeNull();
    expect(nextCursor([product('p_1', 1, { updated_at: '2026-01-01T00:00:00Z' })], '2026-10-21T00:00:00Z')).toBe('2026-10-21T00:00:00Z');
  });

  it('recherche de client hors ligne : nom, téléphone ou matricule, comme l’API', () => {
    const c = { id: 'c_1', name: 'Fatima Zahra', phone: '+212612345678', matricule: '0024001' };
    expect(['fati', 'ZAHRA', '06 12 34', '612345678', '0024', '24001', '0712'].map((q) => matchesCustomer(c, q)))
      .toEqual([true, true, true, true, true, true, false]);
    expect(matchesCustomer({ ...c, phone: null, matricule: null }, '06')).toBe(false);
  });
});

// --- Sessions de caisse : une seule file, dans l'ordre (§9) --------------------------------------------

describe('envoi des opérations de session', () => {
  it('session faite hors ligne : ouverture, ventes, sortie, clôture arrivent dans l’ordre, une seule fois', async () => {
    const server = fakeServer();
    const [s1, s2, s3] = [sale(), sale(), sale()];
    const outbox = memoryOutbox([openingOp(), s1, s2, movementOp(), s3, closeOp()]);
    const result = await flushOutbox(outbox, apiSenders);
    expect(result.status).toBe('done');
    expect(server.log).toEqual(['open', `sale:${s1.id}`, `sale:${s2.id}`, 'move', `sale:${s3.id}`, 'close']);
    expect(server.requests).toBe(5); // les ventes qui se suivent partent ensemble
    expect(outbox.items).toEqual([]);
  });

  it('retours : envoyés un à un, à leur place dans la file, entre les lots de ventes', async () => {
    const server = fakeServer();
    const [s1, s2] = [sale(), sale()];
    const refund = refundOp(s1);
    const outbox = memoryOutbox([openingOp(), s1, refund, s2, closeOp()]);
    const result = await flushOutbox(outbox, apiSenders);
    expect(result.status).toBe('done');
    expect(server.log).toEqual(['open', `sale:${s1.id}`, `refund:${refund.id}`, `sale:${s2.id}`, 'close']);
    expect(outbox.items).toEqual([]);
  });

  it('retour refusé (422, déjà retourné sur une autre caisse) : gardé avec le motif, la suite part', async () => {
    const server = fakeServer();
    const refund = refundOp(sale());
    server.refuse.add(refund.id);
    const outbox = memoryOutbox([refund, closeOp()]);
    const result = await flushOutbox(outbox, apiSenders);
    expect(result.rejected).toEqual([{ id: refund.id, error: 'Plus que ce qui reste à retourner' }]);
    expect(server.log).toEqual(['close']);
    expect(outbox.items).toEqual([{ ...refund, error: 'Plus que ce qui reste à retourner' }]);
  });

  it('coupure au milieu : on s’arrête, la suite attend dans le même ordre, rien n’est perdu ni doublé', async () => {
    const server = fakeServer();
    const [s1, s2] = [sale(), sale()];
    const move = movementOp();
    const outbox = memoryOutbox([openingOp(), s1, move, s2, closeOp()]);
    server.cutAt = 3; // la sortie d'espèces ne passe pas
    expect((await flushOutbox(outbox, apiSenders)).status).toBe('offline');
    expect(outbox.items.map((i) => i.id)).toEqual([move.id, s2.id, closeKey(SESSION)]);

    server.cutAt = null;
    expect((await flushOutbox(outbox, apiSenders)).status).toBe('done');
    expect(server.log).toEqual(['open', `sale:${s1.id}`, 'move', `sale:${s2.id}`, 'close']);
    expect(outbox.items).toEqual([]);
  });

  it('ouverture reçue mais réponse perdue : au renvoi, « duplicate », une seule session côté serveur', async () => {
    const server = fakeServer();
    const outbox = memoryOutbox([openingOp(), sale()]);
    server.cutAt = 1;
    server.cutAfterProcessing = true;
    expect((await flushOutbox(outbox, apiSenders)).status).toBe('offline');
    expect(outbox.items).toHaveLength(2);
    server.cutAt = null;
    expect((await flushOutbox(outbox, apiSenders)).sent).toHaveLength(2);
    expect(server.log.filter((l) => l === 'open')).toHaveLength(1);
    expect(outbox.items).toEqual([]);
  });

  it('ouverture refusée (409, autre session ouverte) : gardée avec le motif, la suite part, renvoi sur demande', async () => {
    const server = fakeServer();
    server.refuse.add(SESSION);
    const s1 = sale();
    const outbox = memoryOutbox([openingOp(), s1, closeOp()]);
    const result = await flushOutbox(outbox, apiSenders);
    expect(result.rejected).toEqual([{ id: SESSION, error: 'Une autre session est ouverte sur cette caisse' }]);
    expect(outbox.items).toEqual([{ ...openingOp(), error: 'Une autre session est ouverte sur cette caisse' }]);

    await flushOutbox(outbox, apiSenders); // pas renvoyée d'office : le serveur la refuserait encore
    expect(outbox.items).toHaveLength(1);
    server.refuse.clear(); // l'autre session a été clôturée au back-office
    expect((await flushOutbox(outbox, apiSenders, { includeErrors: true })).sent).toEqual([SESSION]);
    expect(outbox.items).toEqual([]);
  });

  it('token expiré (401) sur une ouverture : on s’arrête sans rien retirer ni marquer', async () => {
    const server = fakeServer();
    server.status = 401;
    const outbox = memoryOutbox([openingOp(), sale()]);
    expect(await flushOutbox(outbox, apiSenders)).toEqual({ status: 'unauthorized', sent: [], rejected: [] });
    expect(outbox.items.every((i) => i.error === null)).toBe(true);
    expect(outbox.items).toHaveLength(2);
  });

  it('relecture de la file : chaque sorte d’opération, ligne abîmée refusée (ni envoyée ni effacée)', () => {
    const s = sale();
    const [open, move, close, refund] = [openingOp(), movementOp(), closeOp(), refundOp(s)];
    for (const valid of [item(s), item(s, 'Totaux incohérents'), open, move, close, refund]) expect(isOutboxItem(valid)).toBe(true);
    const broken = [
      { sale: s, error: null }, // sans « kind » (ancienne version)
      { ...item(s), id: 'autre' }, // clé différente de l'id de la vente
      { ...item(s), sale: { ...s, session_id: undefined } }, // vente d'avant les sessions
      { ...open, opening: { ...open.opening, opening_cash: -1 } },
      { ...move, movement: { ...move.movement, reason: '' } },
      { ...close, id: SESSION }, // la clôture a sa propre clé
      { ...close, closing: { ...close.closing, counts: close.closing.counts.map((c) => ({ ...c, difference: 0 })) } }, // écart incohérent
      { ...close, closing: { ...close.closing, counts: undefined, counted_cash: 56000 } }, // clôture v0.4 d'essai
      { ...item(s), kind: 'refund' },
      { ...refund, id: s.id }, // clé différente de l'id du retour
      { ...refund, refund: { ...refund.refund, reason: 'vol' } },
      { ...refund, refund: { ...refund.refund, lines: [] } },
      { ...item(s), error: 42 },
      null,
    ];
    for (const b of broken) expect(isOutboxItem(b), JSON.stringify(b)).toBe(false);
  });

  it('session de chaque opération, et libellé montré au caissier en cas de refus', () => {
    const s = sale();
    const refund = refundOp(s);
    expect([item(s), openingOp(), movementOp(), closeOp(), refund].map(itemSession)).toEqual([SESSION, SESSION, SESSION, SESSION, SESSION]);
    expect(describeItem(item(s))).toBe(`Vente ${s.number}`);
    expect(describeItem(refund)).toBe('Retour R-ST2-REG3-000001');
    expect(describeItem(openingOp())).toBe('Ouverture de caisse');
    expect(describeItem(movementOp(5000))).toMatch(/^Sortie d’espèces de 50,00/);
    expect(describeItem(closeOp())).toBe('Clôture de caisse');
  });
});
