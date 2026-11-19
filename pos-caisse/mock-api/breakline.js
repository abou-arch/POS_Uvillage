// Passerelle vers BreakLine, la plateforme de précommande de l'équipe (npm run passerelle).
// La caisse ne change pas : elle parle toujours à cette API locale, selon docs/API_CONTRACT.md. Ici :
//  - le catalogue (articles, catégories, stock) vient de BreakLine et remplace celui de démonstration ;
//  - chaque vente retire son stock dans BreakLine, chaque retour ou annulation le remet ;
//  - ventes, sessions de caisse, retours, clients et comptes caissiers restent gérés par la fausse API.
// Seule la passerelle appelle BreakLine (de serveur à serveur) : ni CORS ni page d'avertissement ngrok pour la caisse.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const TVA_RATES = [0, 7, 10, 14, 20];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const STOCK_ALERT = 5; // BreakLine signale un stock bas à 5 et moins

export class BreaklineError extends Error {
  /** status 0 : pas une réponse de l'API BreakLine (réseau, tunnel ngrok coupé, page HTML) → on réessaiera. */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** « https://x.ngrok-free.dev », avec ou sans /api ni barre finale → « https://x.ngrok-free.dev/api ». */
export function apiBase(url) {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.origin}${path.endsWith('/api') ? path : `${path}/api`}`;
}

/** Prix décimal de BreakLine (« 12.50 », « 12.5 », « 12 ») en centimes, sans passer par un flottant. null si illisible. */
export function priceToCents(value) {
  const text = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export const toCategory = (c) => ({ id: c.id, name: c.name, name_ar: null });
const isCategory = (c) => c && typeof c.id === 'string' && typeof c.name === 'string' && c.name.trim() !== '';

/**
 * Article BreakLine → article du contrat (§3). BreakLine n'a ni code-barres, ni TVA, ni unité : article à la pièce,
 * TVA du magasin, code article = 8 premiers caractères de l'id. null si une valeur est aberrante (prix, stock, nom).
 */
export function toProduct(p, tvaRate) {
  if (!p || typeof p.id !== 'string' || !UUID.test(p.id)) return null;
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  const price_ttc = priceToCents(p.price);
  if (!name || price_ttc === null || !Number.isInteger(p.stock_quantity) || p.stock_quantity < 0) return null;
  return {
    id: p.id, code: p.id.slice(0, 8).toUpperCase(), barcode: null, name, name_ar: null,
    category_id: typeof p.category === 'string' ? p.category : null, brand_id: null,
    price_ttc, tva_rate: tvaRate, unit: 'unit', image_url: null, stock_alert: STOCK_ALERT, expiry_date: null, active: true,
    stock: p.stock_quantity,
  };
}

/** Stock pas encore envoyé à BreakLine, par article (négatif : ventes, positif : retours). */
export function pendingByProduct(queue) {
  const pending = new Map();
  for (const e of queue) pending.set(e.product_id, (pending.get(e.product_id) ?? 0) + e.remaining);
  return pending;
}

const sameStock = (a = {}, b) => Object.keys(b).every((k) => a[k] === b[k]);

/**
 * Met le catalogue de la fausse API à jour avec celui de BreakLine, sur place. Le stock affiché est celui de BreakLine
 * plus ce qui n'y est pas encore envoyé, dans chaque magasin (BreakLine n'a qu'un stock). updated_at prend l'heure de la
 * passerelle seulement quand l'article change : la caisse ne retélécharge que les changements (updated_since). Un article
 * absent de BreakLine (supprimé, ou de démonstration) devient inactif, et la caisse le retire de son cache.
 */
export function mergeCatalog(products, incoming, { storeIds, pending, now }) {
  const counts = { added: 0, changed: 0, removed: 0 };
  const byId = new Map(products.map((p) => [p.id, p]));
  const seen = new Set();
  for (const { stock, ...fields } of incoming) {
    seen.add(fields.id);
    const shown = stock + (pending.get(fields.id) ?? 0);
    const stock_by_store = Object.fromEntries(storeIds.map((s) => [s, shown]));
    const existing = byId.get(fields.id);
    if (!existing) {
      products.push({ ...fields, stock_by_store, updated_at: now });
      counts.added += 1;
    } else if (!Object.keys(fields).every((k) => existing[k] === fields[k]) || !sameStock(existing.stock_by_store, stock_by_store)) {
      Object.assign(existing, fields, { stock_by_store, updated_at: now });
      counts.changed += 1;
    }
  }
  for (const p of products) {
    if (seen.has(p.id) || !p.active) continue;
    Object.assign(p, { active: false, updated_at: now });
    counts.removed += 1;
  }
  return counts;
}

/** Erreur définitive (article supprimé, stock déjà à 0…) : l'ajustement est abandonné. Le reste est retenté plus tard. */
const isFinal = (e) => e instanceof BreaklineError && e.status >= 400 && e.status < 500 && ![401, 403, 408, 429].includes(e.status);
const describe = (e) => (e instanceof Error && e.message ? e.message : String(e));

function detailOf(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.detail === 'string') return data.detail;
  const [field, value] = Object.entries(data)[0] ?? [];
  return field ? `${field} : ${Array.isArray(value) ? value.join(' ') : value}` : null;
}

/**
 * Passerelle. `catalog` : les tableaux de la fausse API (modifiés sur place). `storage` : { load, save } de la file des
 * ajustements de stock, gardée sur disque pour qu'un redémarrage ne perde rien.
 */
export function createBridge({ url, email, password, tvaRate = 0, catalog, storage, fetchImpl = fetch, log = console }) {
  const base = apiBase(url);
  const { categories, brands, products, stores } = catalog;
  const saved = storage.load();
  const queue = Array.isArray(saved?.queue) ? saved.queue : [];
  const knownStock = new Map(); // dernier stock BreakLine connu, pour ne jamais demander un stock négatif
  let tokens = { access: null, refresh: null };
  let problem = null;
  let synced = false;
  let timer = null;
  let skipped = 0;

  // Le catalogue de démonstration ne doit pas être vendu : retiré dès le démarrage, en attendant celui de BreakLine.
  const now = new Date().toISOString();
  for (const p of products) Object.assign(p, { active: false, updated_at: now });
  categories.splice(0, categories.length);
  brands.splice(0, brands.length);

  const persist = () => storage.save({ queue });

  function report(next) {
    if (next !== problem) {
      if (next) log.warn(`BreakLine : ${next}. Nouvel essai à la prochaine synchronisation.`);
      else if (problem) log.info('BreakLine : de nouveau joignable.');
    }
    problem = next;
  }

  async function answer(res) {
    // Une erreur du tunnel ngrok (« endpoint offline »…) ou une page HTML n'est pas une réponse de l'API : on réessaiera.
    const ngrok = res.headers.get('ngrok-error-code');
    if (ngrok) throw new BreaklineError(0, `tunnel ngrok indisponible (${ngrok}) : BreakLine est arrêté ou son adresse a changé`);
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
    const data = isJson ? await res.json().catch(() => null) : null;
    if (res.ok && (isJson || res.status === 204)) return data;
    throw new BreaklineError(isJson ? res.status : 0, detailOf(data) ?? `réponse HTTP ${res.status} inattendue`);
  }

  async function call(path, { method = 'GET', body, access = null } = {}) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'ngrok-skip-browser-warning': '1',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return answer(res);
  }

  async function login() {
    try {
      const data = await call('/auth/login/', { method: 'POST', body: { email, password } });
      tokens = { access: data?.access ?? null, refresh: data?.refresh ?? null };
    } catch (e) {
      if (e instanceof BreaklineError && e.status >= 400 && e.status < 500) {
        throw new BreaklineError(401, `compte de la passerelle refusé (${e.message})`);
      }
      throw e;
    }
    if (!tokens.access) throw new BreaklineError(0, 'connexion sans token');
  }

  async function renew() {
    if (tokens.refresh) {
      try {
        const data = await call('/refresh/', { method: 'POST', body: { refresh: tokens.refresh } });
        if (data?.access) {
          tokens = { access: data.access, refresh: data.refresh ?? tokens.refresh };
          return;
        }
      } catch (e) {
        if (!(e instanceof BreaklineError) || e.status === 0) throw e; // pas de réseau : inutile de se reconnecter
      }
    }
    await login();
  }

  /** Appel authentifié. Token expiré : renouvelé (ou reconnexion), puis un seul nouvel essai. */
  async function send(path, options = {}) {
    if (!tokens.access) await login();
    try {
      return await call(path, { ...options, access: tokens.access });
    } catch (e) {
      if (!(e instanceof BreaklineError) || e.status !== 401) throw e;
    }
    await renew();
    return call(path, { ...options, access: tokens.access });
  }

  /** Toutes les pages d'une liste DRF. Le lien `next` n'est pas suivi : il pointe vers l'adresse interne de Django. */
  async function list(path) {
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await send(`${path}?page=${page}&page_size=${PAGE_SIZE}`);
      if (Array.isArray(data)) return data;
      if (!Array.isArray(data?.results)) throw new BreaklineError(0, `liste illisible (${path})`);
      all.push(...data.results);
      if (!data.next || data.results.length === 0 || all.length >= (data.count ?? Infinity)) return all;
    }
    throw new BreaklineError(0, `liste trop longue (${path})`);
  }

  async function pull() {
    const [rawCategories, rawProducts] = [await list('/categories/'), await list('/products/')];
    const incoming = [];
    const invalid = [];
    for (const raw of rawProducts) {
      const p = toProduct(raw, tvaRate);
      if (p) {
        incoming.push(p);
        knownStock.set(p.id, p.stock);
      } else invalid.push(raw?.name ?? raw?.id ?? '?');
    }
    if (invalid.length !== skipped) {
      if (invalid.length) log.warn(`BreakLine : ${invalid.length} article(s) ignoré(s), prix ou stock aberrant : ${invalid.join(', ')}`);
      skipped = invalid.length;
    }
    categories.splice(0, categories.length, ...rawCategories.filter(isCategory).map(toCategory));
    const counts = mergeCatalog(products, incoming, {
      storeIds: stores.map((s) => s.id), pending: pendingByProduct(queue), now: new Date().toISOString(),
    });
    if (!synced) log.info(`Catalogue BreakLine : ${incoming.length} articles, ${categories.length} catégories.`);
    else if (counts.added + counts.changed + counts.removed > 0) {
      log.info(`Catalogue BreakLine : ${counts.added} nouveau(x), ${counts.changed} modifié(s), ${counts.removed} retiré(s).`);
    }
    synced = true;
    return counts;
  }

  function drop(entry, why) {
    log.warn(`BreakLine : ajustement de stock ${entry.remaining > 0 ? '+' : ''}${entry.remaining} sur ${entry.product_id} abandonné (${why}).`);
    queue.shift();
    persist();
  }

  /**
   * Envoie la file dans l'ordre, une unité à la fois (BreakLine ajuste par +1 / −1). Panne : arrêt, le reste attend.
   * Avant de retirer une unité, le stock BreakLine doit être positif : sinon (déjà à 0) le reste de la ligne est abandonné.
   */
  async function push() {
    while (queue.length > 0) {
      const entry = queue[0];
      const step = Math.sign(entry.remaining);
      try {
        if (step < 0 && !(knownStock.get(entry.product_id) > 0)) {
          const fresh = await send(`/products/${entry.product_id}/`);
          knownStock.set(entry.product_id, fresh?.stock_quantity);
          if (!(fresh?.stock_quantity > 0)) {
            drop(entry, 'stock BreakLine déjà à 0');
            continue;
          }
        }
        const saved = await send(`/products/${entry.product_id}/adjust_stock/`, { method: 'POST', body: { delta: step } });
        entry.remaining -= step;
        if (Number.isInteger(saved?.stock_quantity)) knownStock.set(entry.product_id, saved.stock_quantity);
        else knownStock.delete(entry.product_id);
      } catch (e) {
        knownStock.delete(entry.product_id);
        if (!isFinal(e)) {
          report(`stock non envoyé, ${queue.length} ajustement(s) en attente (${describe(e)})`);
          return false;
        }
        drop(entry, describe(e));
        continue;
      }
      if (entry.remaining === 0) queue.shift();
      persist();
    }
    return true;
  }

  // Une seule opération BreakLine à la fois : envoi du stock et lecture du catalogue ne se croisent jamais.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  /** Envoie le stock en attente puis relit le catalogue. Ne lève jamais d'erreur : elle est signalée dans le journal. */
  const sync = () => serial(async () => {
    try {
      if (await push()) {
        await pull();
        report(null);
      }
    } catch (e) {
      report(describe(e));
    }
  });

  let pushScheduled = false;
  function schedulePush() {
    if (pushScheduled) return;
    pushScheduled = true;
    serial(async () => {
      pushScheduled = false;
      try {
        if (await push()) report(null);
      } catch (e) {
        report(describe(e));
      }
    });
  }

  /**
   * Ajustements de stock d'une opération reçue (vente, retour, annulation) : [id article, quantité signée] par ligne.
   * `key` identifie l'opération : une même opération n'est jamais comptée deux fois. Les articles qui ne viennent pas de
   * BreakLine (ids de démonstration) sont ignorés.
   */
  function adjust(key, pairs) {
    let added = 0;
    pairs.forEach(([productId, quantity], i) => {
      if (typeof productId !== 'string' || !UUID.test(productId) || quantity === 0) return;
      if (!Number.isInteger(quantity)) {
        log.warn(`BreakLine : quantité ${quantity} non entière pour ${productId} (${key}), stock non ajusté.`);
        return;
      }
      const lineKey = `${key}:${i}`;
      if (queue.some((e) => e.key === lineKey)) return;
      queue.push({ key: lineKey, product_id: productId, remaining: quantity });
      added += 1;
    });
    if (added === 0) return;
    persist();
    // Le stock du magasin a déjà bougé dans la fausse API ; les autres magasins suivent à la prochaine lecture du catalogue.
    schedulePush();
  }

  function start(intervalMs) {
    sync();
    timer = setInterval(sync, intervalMs);
    timer.unref?.();
  }

  const stop = () => clearInterval(timer);

  return { adjust, push, pull, sync, start, stop, queue, idle: () => chain };
}

/** File des ajustements gardée dans un fichier JSON (ignoré par git). */
export function fileStorage(file) {
  return {
    load() {
      if (!existsSync(file)) return null;
      try {
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch (e) {
        console.warn(`File des ajustements BreakLine illisible (${e.message}) : ajustements en attente perdus, à vérifier.`);
        return null;
      }
    },
    save(data) {
      try {
        writeFileSync(file, JSON.stringify(data, null, 1));
      } catch (e) {
        console.warn(`Impossible d'écrire la file des ajustements BreakLine (${e.message}) : elle reste en mémoire.`);
      }
    },
  };
}

/** Démarre la passerelle d'après les variables d'environnement (mock-api/breakline.env). */
export function startBreakline(catalog, env = process.env) {
  const { BREAKLINE_URL: url, BREAKLINE_EMAIL: email, BREAKLINE_PASSWORD: password } = env;
  const tvaRate = Number(env.BREAKLINE_TVA_RATE ?? 0);
  const seconds = Number(env.BREAKLINE_SYNC_SECONDS ?? 60);
  const problems = [];
  try {
    apiBase(url);
  } catch {
    problems.push(`BREAKLINE_URL invalide (« ${url} »)`);
  }
  if (!email || !password) problems.push('BREAKLINE_EMAIL et BREAKLINE_PASSWORD sont obligatoires');
  if (!TVA_RATES.includes(tvaRate)) problems.push(`BREAKLINE_TVA_RATE doit valoir ${TVA_RATES.join(', ')}`);
  if (!Number.isInteger(seconds) || seconds < 10) problems.push('BREAKLINE_SYNC_SECONDS doit être un entier ≥ 10');
  if (problems.length) {
    console.error(`Passerelle BreakLine non démarrée : ${problems.join(' ; ')}. Voir mock-api/breakline.env.example.`);
    process.exit(1);
  }
  const file = env.BREAKLINE_STATE_FILE ?? new URL('./breakline-state.json', import.meta.url);
  const bridge = createBridge({ url, email, password, tvaRate, catalog, storage: fileStorage(file) });
  console.log(`Passerelle BreakLine vers ${apiBase(url)} (TVA ${tvaRate} %, synchro toutes les ${seconds} s).`);
  bridge.start(seconds * 1000);
  return bridge;
}
