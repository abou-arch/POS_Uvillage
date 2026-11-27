// Connexion du serveur POS à BreakLine (site de précommande), prévue pour que la caisse ne dépende JAMAIS de BreakLine.
//
//   BreakLine → POS : articles, prix, catégories et stock sont lus toutes les N secondes (GET /api/pos/items/).
//   POS → BreakLine : chaque mouvement de stock du magasin relié (vente, annulation, retour, réception, ajustement)
//                     est écrit dans une file (table breakline_outbox) DANS LA MÊME TRANSACTION que la vente, puis envoyé
//                     par lots (POST /api/pos/stock-movements/). Chaque mouvement porte une clé unique : BreakLine ne le
//                     compte qu'une fois, même si la réponse s'est perdue et que l'envoi est refait.
//
// BreakLine arrêté, tunnel ngrok coupé, pas d'internet : la caisse vend normalement, la file se remplit, tout part au retour.
// Un seul magasin du POS est relié (BREAKLINE_STORE_ID) : BreakLine n'a qu'un stock.
import { all, get, nowIso, run, stampNow, tx } from "./db.js";
import { moveStock, setStockHook } from "./core.js";

export const TVA_RATES = [0, 7, 10, 14, 20];
const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 500;
const BATCH = 100;
const STOCK_ALERT = 5;

export class BreaklineError extends Error {
  /** status 0 : pas une vraie réponse de l'API (réseau, tunnel ngrok coupé, page HTML) → on réessaiera. */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** « https://x.ngrok-free.dev », avec ou sans /api ni barre finale → « https://x.ngrok-free.dev/api ». */
export function apiBase(url) {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.origin}${path.endsWith("/api") ? path : `${path}/api`}`;
}

/** Prix décimal de BreakLine (« 12.50 », « 12.5 », « 12 ») en centimes, sans flottant. null si illisible. */
export function priceToCents(value) {
  const text =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number"
        ? String(value)
        : "";
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Article BreakLine (/pos/items/) → champs de la table products. null si une valeur est aberrante (prix, stock, nom, id). */
export function toProduct(item, tvaRate) {
  if (!item || typeof item.id !== "string" || !/^[0-9a-f-]{36}$/i.test(item.id))
    return null;
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const price_ttc = priceToCents(item.price);
  if (
    !name ||
    price_ttc === null ||
    price_ttc === 0 ||
    !Number.isInteger(item.stock_quantity) ||
    item.stock_quantity < 0
  )
    return null;
  const sku =
    typeof item.sku === "string" && item.sku.trim()
      ? item.sku.trim().toUpperCase().slice(0, 40)
      : null;
  return {
    id: item.id,
    code: sku ?? item.id.slice(0, 8).toUpperCase(),
    name,
    category_id: typeof item.category === "string" ? item.category : null,
    price_ttc,
    tva_rate: tvaRate,
    stock: item.stock_quantity,
  };
}

const isFinal = (e) =>
  e instanceof BreaklineError &&
  e.status >= 400 &&
  e.status < 500 &&
  ![401, 403, 408, 429].includes(e.status);
const describe = (e) =>
  e instanceof Error && e.message ? e.message : String(e);

function detailOf(data) {
  if (!data || typeof data !== "object") return null;
  if (typeof data.detail === "string") return data.detail;
  const [field, value] = Object.entries(data)[0] ?? [];
  return field
    ? `${field} : ${Array.isArray(value) ? value.join(" ") : value}`
    : null;
}

export function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS breakline_outbox (
      key TEXT PRIMARY KEY,                 -- id du mouvement de stock, envoyé tel quel : BreakLine ne le compte qu'une fois
      item_id TEXT NOT NULL,
      delta INTEGER NOT NULL,               -- en pièces (négatif : vente)
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dropped'))
    );
    CREATE INDEX IF NOT EXISTS breakline_outbox_status ON breakline_outbox(status, created_at);
  `);
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(products)")
      .all()
      .map((c) => c.name),
  );
  if (!columns.has("source"))
    db.exec("ALTER TABLE products ADD COLUMN source TEXT"); // 'breakline' : article géré par BreakLine
}

export function createBreakline({
  db,
  url,
  email,
  password,
  storeId,
  tvaRate = 0,
  fetchImpl = fetch,
  log = console,
}) {
  const base = apiBase(url);
  ensureSchema(db);
  if (!get(db, "SELECT id FROM stores WHERE id = ?", storeId))
    throw new Error(`BREAKLINE_STORE_ID : magasin « ${storeId} » inconnu`);

  let access = null;
  let problem = null;
  let synced = false;
  let timer = null;

  function report(next) {
    if (next !== problem) {
      if (next)
        log.warn(
          `BreakLine : ${next}. Nouvel essai à la prochaine synchronisation.`,
        );
      else if (problem) log.info("BreakLine : de nouveau joignable.");
    }
    problem = next;
  }

  // --- Réseau ---------------------------------------------------------------------------------------------------

  async function answer(res) {
    // Erreur du tunnel ngrok ou page HTML : ce n'est pas une réponse de l'API, on réessaiera.
    const ngrok = res.headers.get("ngrok-error-code");
    if (ngrok)
      throw new BreaklineError(
        0,
        `tunnel ngrok indisponible (${ngrok}) : BreakLine est arrêté ou son adresse a changé`,
      );
    const isJson = (res.headers.get("content-type") ?? "").includes(
      "application/json",
    );
    const data = isJson ? await res.json().catch(() => null) : null;
    if (res.ok && isJson) return data;
    throw new BreaklineError(
      isJson ? res.status : 0,
      detailOf(data) ?? `réponse HTTP ${res.status} inattendue`,
    );
  }

  async function call(path, { method = "GET", body, token = null } = {}) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "ngrok-skip-browser-warning": "1",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return answer(res);
  }

  // BreakLine ne renvoie pas le refresh token dans le corps (il va dans un cookie) : le jeton d'accès (15 min) est
  // simplement redemandé par une nouvelle connexion quand il expire.
  async function login() {
    try {
      const data = await call("/auth/login/", {
        method: "POST",
        body: { email, password },
      });
      access = data?.access ?? null;
    } catch (e) {
      if (e instanceof BreaklineError && e.status >= 400 && e.status < 500)
        throw new BreaklineError(
          401,
          `compte de la connexion refusé (${e.message})`,
        );
      throw e;
    }
    if (!access) throw new BreaklineError(0, "connexion sans jeton");
  }

  async function send(path, options = {}) {
    if (!access) await login();
    try {
      return await call(path, { ...options, token: access });
    } catch (e) {
      if (!(e instanceof BreaklineError) || e.status !== 401) throw e;
    }
    await login();
    return call(path, { ...options, token: access });
  }

  /** Toutes les pages d'une liste DRF, jusqu'à ce qu'il n'y ait plus de `next` (son adresse est interne : non suivie). */
  async function list(path) {
    const all_ = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await send(`${path}?page=${page}&page_size=${PAGE_SIZE}`);
      if (!Array.isArray(data?.results))
        throw new BreaklineError(0, `liste illisible (${path})`);
      all_.push(...data.results);
      if (!data.next || data.results.length === 0) return all_;
    }
    throw new BreaklineError(0, `liste trop longue (${path})`);
  }

  // --- POS → BreakLine : la file ------------------------------------------------------------------------------------

  /** Appelé par moveStock, dans la transaction du mouvement : écrit dans la file, ou rien si l'article n'est pas concerné. */
  function onStockMove(_db, m) {
    if (m.storeId !== storeId) return;
    const p = get(db, "SELECT source FROM products WHERE id = ?", m.productId);
    if (p?.source !== "breakline") return;
    if (m.delta % 1000 !== 0) {
      log.warn(
        `BreakLine : mouvement de ${m.delta / 1000} sur ${m.productId} non entier, stock non envoyé.`,
      );
      return;
    }
    run(
      db,
      "INSERT OR IGNORE INTO breakline_outbox (key, item_id, delta, kind, created_at) VALUES (?, ?, ?, ?, ?)",
      m.moveId,
      m.productId,
      m.delta / 1000,
      m.kind,
      nowIso(),
    );
    schedulePush();
  }

  const pendingByItem = () =>
    new Map(
      all(
        db,
        `SELECT item_id, SUM(delta) AS d FROM breakline_outbox WHERE status = 'pending' GROUP BY item_id`,
      ).map((r) => [r.item_id, r.d]),
    );

  function settle(rows, results) {
    const byKey = new Map((results ?? []).map((r) => [r?.key, r]));
    for (const row of rows) {
      const r = byKey.get(row.key);
      if (r?.status === "applied" || r?.status === "duplicate") {
        run(db, "DELETE FROM breakline_outbox WHERE key = ?", row.key);
      } else if (r) {
        log.warn(
          `BreakLine : mouvement ${row.delta > 0 ? "+" : ""}${row.delta} sur ${row.item_id} abandonné (${r.status}${r.detail ? ` : ${r.detail}` : ""}).`,
        );
        run(
          db,
          `UPDATE breakline_outbox SET status = 'dropped', last_error = ? WHERE key = ?`,
          r.status,
          row.key,
        );
      }
      // pas de réponse pour cette clé : elle reste dans la file
    }
  }

  /** Envoie des lignes. Lot refusé en bloc (4xx définitif) : on les envoie une par une, pour qu'une seule mauvaise ligne ne bloque pas les autres. */
  async function sendRows(rows) {
    try {
      const data = await send("/pos/stock-movements/", {
        method: "POST",
        body: {
          movements: rows.map((r) => ({
            key: r.key,
            item_id: r.item_id,
            delta: r.delta,
          })),
        },
      });
      settle(rows, data?.results);
      return true;
    } catch (e) {
      if (isFinal(e) && rows.length > 1) {
        for (const row of rows) if (!(await sendRows([row]))) return false;
        return true;
      }
      if (isFinal(e)) {
        log.warn(
          `BreakLine : mouvement ${row0(rows)} abandonné (${describe(e)}).`,
        );
        run(
          db,
          `UPDATE breakline_outbox SET status = 'dropped', last_error = ? WHERE key = ?`,
          describe(e),
          rows[0].key,
        );
        return true;
      }
      for (const row of rows)
        run(
          db,
          "UPDATE breakline_outbox SET attempts = attempts + 1, last_error = ? WHERE key = ?",
          describe(e),
          row.key,
        );
      throw e;
    }
  }
  const row0 = (rows) =>
    `${rows[0].delta > 0 ? "+" : ""}${rows[0].delta} sur ${rows[0].item_id}`;

  /** Envoie toute la file, dans l'ordre. Lève l'erreur réseau : le reste attend la prochaine synchro. */
  async function push() {
    for (;;) {
      const rows = all(
        db,
        `SELECT key, item_id, delta FROM breakline_outbox WHERE status = 'pending' ORDER BY created_at, rowid LIMIT ?`,
        BATCH,
      );
      if (rows.length === 0) return;
      await sendRows(rows);
    }
  }

  // --- BreakLine → POS : le catalogue ---------------------------------------------------------------------------------

  async function pull() {
    const [categories, items] = [
      await list("/categories/"),
      await list("/pos/items/"),
    ];
    const incoming = [];
    const invalid = [];
    for (const raw of items) {
      const p = toProduct(raw, tvaRate);
      if (p) incoming.push(p);
      else invalid.push(raw?.name ?? raw?.id ?? "?");
    }
    if (invalid.length)
      log.warn(
        `BreakLine : ${invalid.length} article(s) ignoré(s), prix, stock ou nom aberrant : ${invalid.slice(0, 10).join(", ")}`,
      );
    const counts = tx(db, () => merge(categories, incoming));
    if (!synced)
      log.info(
        `Catalogue BreakLine : ${incoming.length} articles, ${categories.length} catégories.`,
      );
    else if (
      counts.added + counts.changed + counts.removed + counts.stock >
      0
    ) {
      log.info(
        `Catalogue BreakLine : ${counts.added} nouveau(x), ${counts.changed} modifié(s), ${counts.removed} retiré(s), stock changé sur ${counts.stock}.`,
      );
    }
    synced = true;
    return counts;
  }

  /** Une seule transaction, sans attente : une vente ne peut pas s'intercaler. Le stock affiché = stock BreakLine + ce qui n'est pas encore envoyé. */
  function merge(categories, incoming) {
    const counts = { added: 0, changed: 0, removed: 0, stock: 0 };
    const known = new Set();
    for (const c of categories) {
      if (
        typeof c?.id !== "string" ||
        typeof c.name !== "string" ||
        !c.name.trim()
      )
        continue;
      known.add(c.id);
      run(
        db,
        `INSERT INTO categories (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name WHERE name <> excluded.name`,
        c.id,
        c.name.trim(),
      );
    }
    const pending = pendingByItem();
    const seen = new Set();
    for (const p of incoming) {
      seen.add(p.id);
      const category =
        p.category_id && known.has(p.category_id) ? p.category_id : null;
      const existing = get(db, "SELECT * FROM products WHERE id = ?", p.id);
      if (!existing) {
        const clash = get(db, "SELECT id FROM products WHERE code = ?", p.code);
        const code = clash ? p.id.replaceAll("-", "").toUpperCase() : p.code;
        run(
          db,
          `INSERT INTO products (id, code, barcode, name, name_ar, category_id, brand_id, price_ttc, cost_price, tva_rate, unit, image_url,
          stock_alert, expiry_date, active, updated_at, created_at, source) VALUES (?, ?, NULL, ?, NULL, ?, NULL, ?, NULL, ?, 'unit', NULL, ?, NULL, 1, ?, ?, 'breakline')`,
          p.id,
          code,
          p.name,
          category,
          p.price_ttc,
          p.tva_rate,
          STOCK_ALERT,
          stampNow(),
          nowIso(),
        );
        counts.added += 1;
      } else if (
        existing.source === "breakline" &&
        (existing.name !== p.name ||
          existing.price_ttc !== p.price_ttc ||
          existing.category_id !== category ||
          existing.tva_rate !== p.tva_rate ||
          existing.active !== 1)
      ) {
        run(
          db,
          "UPDATE products SET name = ?, price_ttc = ?, category_id = ?, tva_rate = ?, active = 1, updated_at = ? WHERE id = ?",
          p.name,
          p.price_ttc,
          category,
          p.tva_rate,
          stampNow(),
          p.id,
        );
        counts.changed += 1;
      } else if (existing.source !== "breakline") {
        continue; // un article du POS qui porte le même id : jamais touché
      }
      const current =
        get(
          db,
          "SELECT quantity FROM stock WHERE product_id = ? AND store_id = ?",
          p.id,
          storeId,
        )?.quantity ?? 0;
      const target = (p.stock + (pending.get(p.id) ?? 0)) * 1000;
      if (target !== current) {
        moveStock(db, {
          productId: p.id,
          storeId,
          delta: target - current,
          kind: "adjustment",
          note: "Synchro BreakLine",
          external: true,
        });
        counts.stock += 1;
      }
    }
    // Un article de BreakLine qui n'y est plus (supprimé, variante désactivée) n'est plus vendable. Liste vide = on ne touche à rien.
    const mine = all(
      db,
      `SELECT id FROM products WHERE source = 'breakline' AND active = 1`,
    );
    if (incoming.length === 0 && mine.length > 0) {
      log.warn("BreakLine a renvoyé un catalogue vide : aucun article retiré.");
    } else {
      for (const { id } of mine) {
        if (seen.has(id)) continue;
        run(
          db,
          "UPDATE products SET active = 0, updated_at = ? WHERE id = ?",
          stampNow(),
          id,
        );
        counts.removed += 1;
      }
    }
    return counts;
  }

  // --- Orchestration ----------------------------------------------------------------------------------------------

  // Une seule opération BreakLine à la fois : l'envoi et la lecture du catalogue ne se croisent jamais.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run_ = chain.then(fn);
    chain = run_.catch(() => {});
    return run_;
  };

  /** Envoie la file puis relit le catalogue. Ne lève jamais d'erreur : elle va dans le journal. */
  const sync = () =>
    serial(async () => {
      try {
        await push();
        await pull();
        report(null);
      } catch (e) {
        const waiting = get(
          db,
          `SELECT COUNT(*) AS n FROM breakline_outbox WHERE status = 'pending'`,
        ).n;
        report(
          `${describe(e)}${waiting ? ` (${waiting} mouvement(s) de stock en attente)` : ""}`,
        );
      }
    });

  let pushScheduled = false;
  function schedulePush() {
    if (pushScheduled) return;
    pushScheduled = true;
    setTimeout(
      () =>
        serial(async () => {
          pushScheduled = false;
          try {
            await push();
            report(null);
          } catch (e) {
            report(describe(e));
          }
        }),
      500,
    ).unref?.();
  }

  setStockHook(onStockMove);

  function start(intervalMs) {
    sync();
    timer = setInterval(sync, intervalMs);
    timer.unref?.();
  }
  const stop = () => {
    clearInterval(timer);
    setStockHook(null);
  };
  const status = () => ({
    pending: get(
      db,
      `SELECT COUNT(*) AS n FROM breakline_outbox WHERE status = 'pending'`,
    ).n,
    dropped: get(
      db,
      `SELECT COUNT(*) AS n FROM breakline_outbox WHERE status = 'dropped'`,
    ).n,
    problem,
  });

  return { sync, push, pull, start, stop, status, idle: () => chain };
}

/** Démarre la connexion d'après les variables d'environnement. Sans BREAKLINE_URL : rien (le POS fonctionne seul). */
export function startBreakline(db, env = process.env) {
  const {
    BREAKLINE_URL: url,
    BREAKLINE_EMAIL: email,
    BREAKLINE_PASSWORD: password,
    BREAKLINE_STORE_ID: storeId,
  } = env;
  if (!url) return null;
  const tvaRate = Number(env.BREAKLINE_TVA_RATE ?? 0);
  const seconds = Number(env.BREAKLINE_SYNC_SECONDS ?? 60);
  const problems = [];
  try {
    apiBase(url);
  } catch {
    problems.push(`BREAKLINE_URL invalide (« ${url} »)`);
  }
  if (!email || !password)
    problems.push(
      "BREAKLINE_EMAIL et BREAKLINE_PASSWORD sont obligatoires (compte vendeur)",
    );
  if (!storeId)
    problems.push(
      "BREAKLINE_STORE_ID est obligatoire (le magasin du POS dont le stock suit celui de BreakLine)",
    );
  if (!TVA_RATES.includes(tvaRate))
    problems.push(`BREAKLINE_TVA_RATE doit valoir ${TVA_RATES.join(", ")}`);
  if (!Number.isInteger(seconds) || seconds < 10)
    problems.push("BREAKLINE_SYNC_SECONDS doit être un entier ≥ 10");
  if (problems.length) {
    console.error(
      `Connexion BreakLine non démarrée : ${problems.join(" ; ")}.`,
    );
    process.exit(1);
  }
  const bridge = createBreakline({
    db,
    url,
    email,
    password,
    storeId,
    tvaRate,
  });
  console.log(
    `Connexion BreakLine : ${apiBase(url)} (magasin ${storeId}, TVA ${tvaRate} %, synchro toutes les ${seconds} s).`,
  );
  bridge.start(seconds * 1000);
  return bridge;
}
