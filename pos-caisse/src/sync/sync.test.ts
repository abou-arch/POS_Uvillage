import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { matchesCustomer } from '../db/customers';
import { buildSale } from '../lib/buildSale';
import { emptyCart } from '../state/cart';
import type { Product, Sale } from '../types';
import {
  catalogChanges, createSyncLoop, flushOutbox, MAX_DELAY_MS, nextCursor, nextDelay, pendingQuantities,
  SYNC_INTERVAL_MS, type OutboxItem, type OutboxStore, type Timers,
} from './sync';

// --- Une caisse et un serveur simulés ---------------------------------------------------------------

let counter = 0;
function sale(quantity = 1, productId = 'p_1'): Sale {
  counter += 1;
  return buildSale({
    cart: { ...emptyCart, lines: [{ product_id: productId, name: 'PAIN', quantity, unit_price_ttc: 150, discount: 0, tva_rate: 0, stock: 99 }] },
    storeId: 'st_2', registerId: 'reg_3', cashierId: 'u_2',
    payments: [{ method: 'cash', amount: Math.round(quantity * 150) }], amountReceived: Math.round(quantity * 150),
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`, counter, now: new Date('2026-10-22T10:00:00Z'),
  });
}

function memoryOutbox(sales: Sale[]): OutboxStore & { items: OutboxItem[] } {
  const store = {
    items: sales.map((s): OutboxItem => ({ sale: s, error: null })),
    list: async () => store.items.map((i) => ({ ...i })),
    remove: async (ids: string[]) => { store.items = store.items.filter((i) => !ids.includes(i.sale.id)); },
    markError: async (errors: { id: string; error: string }[]) => {
      for (const e of errors) store.items = store.items.map((i) => (i.sale.id === e.id ? { ...i, error: e.error } : i));
    },
  };
  return store;
}

/**
 * fetch simulé pour POST /api/sales/batch : le serveur garde chaque vente une seule fois (idempotence par id),
 * refuse celles listées dans `refuse`, et peut couper le réseau à la n-ième requête (avant ou après traitement).
 */
function fakeServer() {
  const server = {
    received: new Map<string, Sale>(),
    requests: 0,
    refuse: new Set<string>(),
    cutAt: null as number | null, // numéro de requête où le réseau coupe
    cutAfterProcessing: false, // true : le serveur enregistre le lot, mais la réponse se perd
    status: 200,
  };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    server.requests += 1;
    expect(url).toMatch(/\/sales\/batch$/);
    const cut = server.cutAt === server.requests;
    if (cut && !server.cutAfterProcessing) throw new TypeError('Failed to fetch');
    if (server.status !== 200) {
      return new Response(JSON.stringify({ error: { code: 'X', message: `Erreur ${server.status}` } }), { status: server.status });
    }
    const { sales } = JSON.parse(String(init.body)) as { sales: Sale[] };
    const results = sales.map((s) => {
      if (server.refuse.has(s.id)) return { id: s.id, status: 'error', error: { code: 'TOTALS_MISMATCH', message: 'Totaux incohérents' } };
      if (server.received.has(s.id)) return { id: s.id, status: 'duplicate' };
      server.received.set(s.id, s);
      return { id: s.id, status: 'created' };
    });
    if (cut) throw new TypeError('Failed to fetch'); // traité côté serveur, réponse perdue
    return new Response(JSON.stringify({ results }), { status: 200 });
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
    const result = await flushOutbox(outbox, api.syncSales);
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
    const result = await flushOutbox(outbox, api.syncSales);
    expect(result.sent).toHaveLength(2);
    expect(outbox.items).toEqual([]);
    expect(server.received.size).toBe(2);
  });

  it('erreur partielle : la vente refusée reste, marquée, les autres partent', async () => {
    const server = fakeServer();
    const [a, b, c] = [sale(), sale(), sale()];
    server.refuse.add(b.id);
    const outbox = memoryOutbox([a, b, c]);
    const result = await flushOutbox(outbox, api.syncSales);
    expect(result).toEqual({ status: 'done', sent: [a.id, c.id], rejected: [{ id: b.id, error: 'Totaux incohérents' }] });
    expect(outbox.items).toEqual([{ sale: b, error: 'Totaux incohérents' }]);

    // Sans demande explicite, elle n'est pas renvoyée (le serveur la refuserait encore)…
    const before = server.requests;
    await flushOutbox(outbox, api.syncSales);
    expect(server.requests).toBe(before);
    // … un clic sur l'indicateur la renvoie, une fois corrigée côté serveur.
    server.refuse.clear();
    expect((await flushOutbox(outbox, api.syncSales, { includeErrors: true })).sent).toEqual([b.id]);
    expect(outbox.items).toEqual([]);
  });

  it('coupure au milieu d’un lot : les lots acceptés partent, le reste attend, rien n’est perdu ni doublé', async () => {
    const server = fakeServer();
    const sales = [sale(), sale(), sale(), sale(), sale()];
    const outbox = memoryOutbox(sales);
    server.cutAt = 2; // 2e lot : plus de réseau
    const first = await flushOutbox(outbox, api.syncSales, { batchSize: 2 });
    expect(first).toEqual({ status: 'offline', sent: sales.slice(0, 2).map((s) => s.id), rejected: [] });
    expect(outbox.items.map((i) => i.sale.id)).toEqual(sales.slice(2).map((s) => s.id));
    expect(outbox.items.every((i) => i.error === null)).toBe(true);

    server.cutAt = null; // le réseau revient
    const second = await flushOutbox(outbox, api.syncSales, { batchSize: 2 });
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
    expect((await flushOutbox(outbox, api.syncSales)).status).toBe('offline');
    expect(outbox.items).toHaveLength(3); // la caisse ne sait pas que le serveur les a reçues : elle les garde
    expect(server.received.size).toBe(3);

    server.cutAt = null;
    expect((await flushOutbox(outbox, api.syncSales)).sent).toHaveLength(3);
    expect(outbox.items).toEqual([]);
    expect(server.received.size).toBe(3);
  });

  it('token expiré (401) : on s’arrête sans rien retirer ni marquer', async () => {
    const server = fakeServer();
    server.status = 401;
    const outbox = memoryOutbox([sale(), sale()]);
    expect(await flushOutbox(outbox, api.syncSales)).toEqual({ status: 'unauthorized', sent: [], rejected: [] });
    expect(outbox.items.every((i) => i.error === null)).toBe(true);
    expect(outbox.items).toHaveLength(2);
  });

  it('panne du serveur (503) ou trop de requêtes (429) : tout reste, on réessaiera', async () => {
    for (const status of [503, 429]) {
      const server = fakeServer();
      server.status = status;
      const outbox = memoryOutbox([sale()]);
      expect((await flushOutbox(outbox, api.syncSales)).status).toBe('offline');
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
    const result = await flushOutbox(outbox, send, { batchSize: 2 });
    expect(result.status).toBe('done');
    expect(result.sent).toHaveLength(1);
    expect(outbox.items.map((i) => i.error)).toEqual(['Requête invalide', 'Requête invalide']);
  });

  it('vente absente de la réponse ou réponse illisible : gardée telle quelle', async () => {
    const [a, b] = [sale(), sale()];
    const outbox = memoryOutbox([a, b]);
    await flushOutbox(outbox, async () => ({ results: [{ id: a.id, status: 'created' }] }));
    expect(outbox.items).toEqual([{ sale: b, error: null }]);
    const garbage = await flushOutbox(outbox, async () => ({}) as never);
    expect(garbage.status).toBe('offline');
    expect(outbox.items).toEqual([{ sale: b, error: null }]);
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
    const pending = pendingQuantities([{ sale: sale(2, 'p_1'), error: null }, { sale: sale(0.25, 'p_1'), error: null },
      { sale: sale(1, 'p_2'), error: null }, { sale: other, error: null }], 'st_2');
    expect([...pending]).toEqual([['p_1', 2.25], ['p_2', 1]]);
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
