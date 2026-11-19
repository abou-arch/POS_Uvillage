import { describe, expect, it } from 'vitest';
import { apiBase, createBridge, mergeCatalog, pendingByProduct, priceToCents, toProduct } from './breakline.js';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';
const CAT = '82ce3a65-ea93-4565-b665-239d1869e814';

const blProduct = (id, name, price, stock_quantity) => ({
  id, name, description: '', category: CAT, category_name: 'Alimentation', price, product_image: null, stock_quantity,
  created_at: '2026-11-15T12:00:00Z', updated_at: '2026-11-15T12:00:00.123456Z',
});

describe('apiBase', () => {
  it('ajoute /api et retire la barre finale', () => {
    expect(apiBase('https://x.ngrok-free.dev')).toBe('https://x.ngrok-free.dev/api');
    expect(apiBase('https://x.ngrok-free.dev/')).toBe('https://x.ngrok-free.dev/api');
    expect(apiBase('https://x.ngrok-free.dev/api/')).toBe('https://x.ngrok-free.dev/api');
  });
  it('refuse une adresse invalide', () => {
    expect(() => apiBase('pas une adresse')).toThrow();
  });
});

describe('priceToCents', () => {
  it('convertit sans flottant', () => {
    expect(priceToCents('12.50')).toBe(1250);
    expect(priceToCents('12.5')).toBe(1250);
    expect(priceToCents('12')).toBe(1200);
    expect(priceToCents('0.05')).toBe(5);
    expect(priceToCents('19.99')).toBe(1999);
    expect(priceToCents(3)).toBe(300);
  });
  it('refuse les valeurs aberrantes', () => {
    for (const v of ['-1.00', '12.345', 'abc', '', '123456789', '1e3', null, undefined, {}]) expect(priceToCents(v)).toBeNull();
  });
});

describe('toProduct', () => {
  it('donne un article du contrat, à la pièce, avec la TVA choisie', () => {
    expect(toProduct(blProduct(ID_A, ' Pain ', '1.50', 12), 0)).toEqual({
      id: ID_A, code: '11111111', barcode: null, name: 'Pain', name_ar: null, category_id: CAT, brand_id: null,
      price_ttc: 150, tva_rate: 0, unit: 'unit', image_url: null, stock_alert: 5, expiry_date: null, active: true, stock: 12,
    });
    expect(toProduct(blProduct(ID_A, 'Pain', '1.50', 12), 20).tva_rate).toBe(20);
  });
  it('écarte un article au prix, au stock ou au nom aberrant', () => {
    expect(toProduct(blProduct(ID_A, 'Pain', '-1', 12), 0)).toBeNull();
    expect(toProduct(blProduct(ID_A, 'Pain', '1.50', -3), 0)).toBeNull();
    expect(toProduct(blProduct(ID_A, 'Pain', '1.50', 1.5), 0)).toBeNull();
    expect(toProduct(blProduct(ID_A, '  ', '1.50', 3), 0)).toBeNull();
    expect(toProduct(blProduct('p_1', 'Pain', '1.50', 3), 0)).toBeNull();
  });
});

describe('mergeCatalog', () => {
  const opts = (now, pending = new Map()) => ({ storeIds: ['st_1', 'st_2'], pending, now });

  it('ajoute, ne touche pas à ce qui n’a pas changé, retire ce qui a disparu', () => {
    const products = [{ id: 'p_1', active: true, updated_at: 'avant' }];
    const a = toProduct(blProduct(ID_A, 'Pain', '1.50', 10), 0);
    expect(mergeCatalog(products, [a], opts('T1'))).toEqual({ added: 1, changed: 0, removed: 1 });
    expect(products[0]).toMatchObject({ id: 'p_1', active: false, updated_at: 'T1' });
    expect(products[1]).toMatchObject({ id: ID_A, stock_by_store: { st_1: 10, st_2: 10 }, updated_at: 'T1' });
    expect(products[1]).not.toHaveProperty('stock');

    expect(mergeCatalog(products, [a], opts('T2'))).toEqual({ added: 0, changed: 0, removed: 0 });
    expect(products[1].updated_at).toBe('T1');

    const cheaper = toProduct(blProduct(ID_A, 'Pain', '1.20', 10), 0);
    expect(mergeCatalog(products, [cheaper], opts('T3'))).toEqual({ added: 0, changed: 1, removed: 0 });
    expect(products[1]).toMatchObject({ price_ttc: 120, updated_at: 'T3' });

    expect(mergeCatalog(products, [], opts('T4'))).toEqual({ added: 0, changed: 0, removed: 1 });
    expect(products[1]).toMatchObject({ active: false, updated_at: 'T4' });
  });

  it('montre le stock BreakLine moins ce qui n’y est pas encore envoyé', () => {
    const products = [];
    mergeCatalog(products, [toProduct(blProduct(ID_A, 'Pain', '1.50', 10), 0)], opts('T1', new Map([[ID_A, -3]])));
    expect(products[0].stock_by_store).toEqual({ st_1: 7, st_2: 7 });
  });
});

describe('pendingByProduct', () => {
  it('additionne les ajustements en attente par article', () => {
    const queue = [{ product_id: ID_A, remaining: -2 }, { product_id: ID_B, remaining: 1 }, { product_id: ID_A, remaining: -1 }];
    expect(pendingByProduct(queue)).toEqual(new Map([[ID_A, -3], [ID_B, 1]]));
  });
});

// --- Passerelle contre un faux BreakLine ----------------------------------------------------------------------

const json = (status, body, headers = {}) => new Response(body === null ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
});

/** Faux BreakLine : JWT, pagination DRF, adjust_stock par ±1 et stock jamais négatif, comme le vrai. */
function fakeBreakline({ products, pageSize = 2 }) {
  const fake = {
    products: new Map(products.map((p) => [p.id, { ...p }])),
    access: 'access-1',
    down: false,
    ngrokOffline: false,
    adjustCalls: [],
    logins: 0,
    refreshes: 0,
  };
  const page = (list, url) => {
    const n = Number(url.searchParams.get('page') ?? 1);
    const results = list.slice((n - 1) * pageSize, n * pageSize);
    const next = n * pageSize < list.length ? `http://127.0.0.1:8000${url.pathname}?page=${n + 1}` : null;
    return json(200, { count: list.length, next, previous: null, results });
  };
  fake.fetch = async (href, init = {}) => {
    if (fake.down) throw new TypeError('fetch failed');
    if (fake.ngrokOffline) {
      return new Response('<html>offline</html>', { status: 404, headers: { 'content-type': 'text/html', 'ngrok-error-code': 'ERR_NGROK_3200' } });
    }
    expect(init.headers['ngrok-skip-browser-warning']).toBe('1');
    const url = new URL(href);
    const body = init.body ? JSON.parse(init.body) : null;
    const path = url.pathname;
    if (path === '/api/auth/login/') {
      fake.logins += 1;
      if (body.email !== 'vendeur@test' || body.password !== 'secret') return json(401, { detail: 'Identifiants invalides' });
      return json(200, { access: fake.access, refresh: 'refresh-1' });
    }
    if (path === '/api/refresh/') {
      fake.refreshes += 1;
      return body.refresh === 'refresh-1' ? json(200, { access: fake.access }) : json(401, { detail: 'Token invalide' });
    }
    if (init.headers.Authorization !== `Bearer ${fake.access}`) return json(401, { detail: 'Token expiré' });
    if (path === '/api/categories/') return page([{ id: CAT, name: 'Alimentation', description: '', created_at: '' }], url);
    if (path === '/api/products/') return page([...fake.products.values()], url);
    const m = /^\/api\/products\/([^/]+)\/(adjust_stock\/)?$/.exec(path);
    const product = m && fake.products.get(m[1]);
    if (!product) return json(404, { detail: 'Pas trouvé.' });
    if (!m[2]) return json(200, product);
    fake.adjustCalls.push([m[1], body.delta]);
    if (Math.abs(body.delta) !== 1) return json(400, { delta: ['+1 ou -1'] });
    if (product.stock_quantity + body.delta < 0) return json(400, { detail: 'Stock insuffisant' });
    product.stock_quantity += body.delta;
    return json(200, product);
  };
  return fake;
}

const silent = { info: () => {}, warn: () => {} };

function setup(blProducts, { pageSize } = {}) {
  const fake = fakeBreakline({ products: blProducts, pageSize });
  let saved = null;
  const storage = { load: () => saved, save: (data) => { saved = structuredClone(data); } };
  const catalog = {
    categories: [{ id: 'cat_1', name: 'Démo' }],
    brands: [{ id: 'br_1', name: 'Démo' }],
    products: [{ id: 'p_1', name: 'DÉMO', active: true, updated_at: '2026-10-04T10:00:00Z', stock_by_store: { st_1: 5 } }],
    stores: [{ id: 'st_1' }, { id: 'st_2' }],
  };
  const bridge = createBridge({
    url: 'https://x.ngrok-free.dev', email: 'vendeur@test', password: 'secret', tvaRate: 0,
    catalog, storage, fetchImpl: fake.fetch, log: silent,
  });
  return { fake, bridge, catalog, saved: () => saved };
}

const stockOf = (catalog, id) => catalog.products.find((p) => p.id === id).stock_by_store;

describe('passerelle BreakLine', () => {
  it('retire le catalogue de démonstration dès le démarrage', () => {
    const { catalog } = setup([]);
    expect(catalog.products[0].active).toBe(false);
    expect(catalog.categories).toEqual([]);
    expect(catalog.brands).toEqual([]);
  });

  it('lit tout le catalogue, page après page', async () => {
    const { bridge, catalog } = setup([
      blProduct(ID_A, 'Pain', '1.50', 10), blProduct(ID_B, 'Lait', '7.00', 4), blProduct(ID_C, 'Cassé', 'abc', 1),
    ], { pageSize: 2 });
    await bridge.sync();
    expect(catalog.categories).toEqual([{ id: CAT, name: 'Alimentation', name_ar: null }]);
    const active = catalog.products.filter((p) => p.active);
    expect(active.map((p) => [p.name, p.price_ttc])).toEqual([['Pain', 150], ['Lait', 700]]);
    expect(stockOf(catalog, ID_B)).toEqual({ st_1: 4, st_2: 4 });
  });

  it('retire le stock d’une vente dans BreakLine, unité par unité, une seule fois', async () => {
    const { fake, bridge, catalog, saved } = setup([blProduct(ID_A, 'Pain', '1.50', 10)]);
    await bridge.sync();
    bridge.adjust('sale:v1', [[ID_A, -2], ['p_1', -1]]);
    bridge.adjust('sale:v1', [[ID_A, -2]]); // même opération signalée deux fois : comptée une fois
    await bridge.idle();
    expect(fake.adjustCalls).toEqual([[ID_A, -1], [ID_A, -1]]);
    expect(fake.products.get(ID_A).stock_quantity).toBe(8);
    expect(saved().queue).toEqual([]);
    await bridge.sync();
    expect(stockOf(catalog, ID_A)).toEqual({ st_1: 8, st_2: 8 });
  });

  it('remet le stock d’un retour', async () => {
    const { fake, bridge } = setup([blProduct(ID_A, 'Pain', '1.50', 10)]);
    bridge.adjust('refund:r1', [[ID_A, 3]]);
    await bridge.idle();
    expect(fake.products.get(ID_A).stock_quantity).toBe(13);
  });

  it('ne demande jamais un stock négatif : le reste est abandonné à 0', async () => {
    const { fake, bridge } = setup([blProduct(ID_A, 'Pain', '1.50', 1), blProduct(ID_B, 'Lait', '7.00', 5)]);
    bridge.adjust('sale:v1', [[ID_A, -3], [ID_B, -1]]);
    await bridge.idle();
    expect(fake.products.get(ID_A).stock_quantity).toBe(0);
    expect(fake.adjustCalls.filter(([id]) => id === ID_A)).toEqual([[ID_A, -1]]);
    expect(fake.products.get(ID_B).stock_quantity).toBe(4); // la suite de la file part quand même
    expect(bridge.queue).toEqual([]);
  });

  it('garde tout pendant une coupure ou quand le tunnel ngrok est arrêté, et l’envoie ensuite', async () => {
    const { fake, bridge, catalog, saved } = setup([blProduct(ID_A, 'Pain', '1.50', 10)]);
    await bridge.sync();
    fake.down = true;
    bridge.adjust('sale:v1', [[ID_A, -2]]);
    await bridge.idle();
    expect(saved().queue).toEqual([{ key: 'sale:v1:0', product_id: ID_A, remaining: -2 }]);

    fake.down = false;
    fake.ngrokOffline = true; // 404 HTML de ngrok : pas une réponse de BreakLine, rien n'est abandonné
    await bridge.sync();
    expect(saved().queue).toHaveLength(1);

    fake.ngrokOffline = false;
    await bridge.sync();
    expect(fake.products.get(ID_A).stock_quantity).toBe(8);
    expect(saved().queue).toEqual([]);
    expect(stockOf(catalog, ID_A).st_1).toBe(8);
  });

  it('montre à la caisse le stock pas encore envoyé', async () => {
    const { fake, bridge, catalog } = setup([blProduct(ID_A, 'Pain', '1.50', 10)]);
    fake.down = true;
    bridge.adjust('sale:v1', [[ID_A, -4]]);
    await bridge.idle();
    fake.down = false;
    // Lecture du catalogue sans envoi (envoi bloqué juste avant) : 10 dans BreakLine, 4 en attente.
    await bridge.pull();
    expect(stockOf(catalog, ID_A).st_1).toBe(6);
  });

  it('renouvelle un token expiré sans se reconnecter', async () => {
    const { fake, bridge } = setup([blProduct(ID_A, 'Pain', '1.50', 10)]);
    await bridge.sync();
    expect(fake.logins).toBe(1);
    fake.access = 'access-2'; // l'ancien token est refusé, le refresh donne le nouveau
    bridge.adjust('sale:v1', [[ID_A, -1]]);
    await bridge.idle();
    expect(fake.refreshes).toBe(1);
    expect(fake.logins).toBe(1);
    expect(fake.products.get(ID_A).stock_quantity).toBe(9);
  });

  it('abandonne l’ajustement d’un article supprimé dans BreakLine', async () => {
    const { fake, bridge } = setup([blProduct(ID_A, 'Pain', '1.50', 10)]);
    bridge.adjust('refund:r1', [[ID_C, 1], [ID_A, 1]]);
    await bridge.idle();
    expect(bridge.queue).toEqual([]);
    expect(fake.products.get(ID_A).stock_quantity).toBe(11);
  });

  it('dit clairement quand le tunnel ngrok est arrêté', async () => {
    const fake = fakeBreakline({ products: [] });
    fake.ngrokOffline = true;
    const warnings = [];
    const bridge = createBridge({
      url: 'https://x.ngrok-free.dev', email: 'vendeur@test', password: 'secret', catalog: { categories: [], brands: [], products: [], stores: [] },
      storage: { load: () => null, save: () => {} }, fetchImpl: fake.fetch, log: { info: () => {}, warn: (m) => warnings.push(m) },
    });
    await bridge.sync();
    expect(warnings).toEqual([expect.stringContaining('tunnel ngrok indisponible (ERR_NGROK_3200)')]);
  });

  it('n’abandonne rien quand le compte de la passerelle est refusé', async () => {
    const fake = fakeBreakline({ products: [blProduct(ID_A, 'Pain', '1.50', 10)] });
    const bridge = createBridge({
      url: 'https://x.ngrok-free.dev', email: 'vendeur@test', password: 'faux', catalog: { categories: [], brands: [], products: [], stores: [] },
      storage: { load: () => null, save: () => {} }, fetchImpl: fake.fetch, log: silent,
    });
    bridge.adjust('sale:v1', [[ID_A, -1]]);
    await bridge.idle();
    expect(bridge.queue).toHaveLength(1);
    expect(fake.products.get(ID_A).stock_quantity).toBe(10);
  });
});
