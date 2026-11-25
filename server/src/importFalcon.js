// Reprise des données de Falcon POS (exports .xlsx du client) : articles, catégories, marques, stock, fournisseurs et
// ce qui leur est dû. Les valeurs absurdes de Falcon ne sont pas reprises telles quelles (voir les règles plus bas) ;
// tout ce qui est écarté ou corrigé figure dans le rapport rendu par importFalcon.
// Relancer l'import ne crée pas de doublons : un article déjà présent (même code) ou un fournisseur déjà repris est ignoré,
// sauf avec update (--update) : un article déjà présent prend alors le nom, le prix, la catégorie et le stock de Falcon.
import { randomUUID } from 'node:crypto';
import { moveStock } from './core.js';
import { get, nowIso, run, stampNow, toMilli, tx } from './db.js';

/**
 * Stock au-delà duquel le chiffre de Falcon n'est pas crédible pour une supérette (999 922 114 pains, 10 000 boîtes
 * de chaque article…) : il n'est pas repris, l'article part à 0 et figure dans le rapport, à compter à l'inventaire.
 */
export const MAX_IMPORTED_STOCK = 9_999;

const ARABIC = /[؀-ۿ]/;

/** « Pain normal (خبز عادي) » → { name: 'Pain normal', name_ar: 'خبز عادي' } ; sans arabe entre parenthèses, inchangé. */
export function splitArabic(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ');
  const m = t.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (m && m[1] && ARABIC.test(m[2])) return { name: m[1].trim(), name_ar: m[2].trim() };
  return { name: t, name_ar: null };
}

/** « 1.50 », « 1,234.50 » (format des exports) → centimes ; null si ce n'est pas un nombre. */
export function centsOf(text) {
  const t = String(text ?? '').trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

const HEADERS = { code: "Code de l'article", name: "Nom de l'article", brand: 'Marque', category: 'Catégorie', cost: 'Prix unitaire', price: 'Prix de vente', stock: 'Stock actuel' };

/** Colonnes de l'export des articles, retrouvées par leur titre (l'ordre peut changer d'un export à l'autre). */
function productColumns(header) {
  const find = (label) => {
    const i = header.findIndex((h) => String(h).trim().startsWith(label));
    if (i < 0) throw new Error(`Colonne « ${label} » introuvable dans l'export des articles`);
    return i;
  };
  return Object.fromEntries(Object.entries(HEADERS).map(([k, label]) => [k, find(label)]));
}

/**
 * Lignes de l'export « tableExport » (articles) → articles prêts à enregistrer, et ce qui a été corrigé.
 * Règles : la ligne « Total » est ignorée ; un code déjà vu plus haut devient « IT0681-2 » ; prix de vente nul → article
 * inactif (à compléter au back-office) ; stock au-delà de MAX_IMPORTED_STOCK → 0 ; TVA 0 % (désactivée dans Falcon).
 */
export function parseProducts(rows) {
  const headerIndex = rows.findIndex((r) => r.some((c) => String(c).trim() === HEADERS.code));
  if (headerIndex < 0) throw new Error('Export des articles : ligne de titres introuvable');
  const col = productColumns(rows[headerIndex]);
  const seen = new Map();
  const report = { renamedCodes: [], zeroPrice: [], absurdStock: [], invalid: [] };
  const products = [];
  for (const r of rows.slice(headerIndex + 1)) {
    const rawCode = String(r[col.code] ?? '').trim();
    if (!rawCode) continue; // ligne « Total : » de l'export
    const { name, name_ar } = splitArabic(r[col.name]);
    const price = centsOf(r[col.price]);
    if (!name || price === null || price < 0) { report.invalid.push(rawCode); continue; }
    const n = (seen.get(rawCode) ?? 0) + 1;
    seen.set(rawCode, n);
    const code = n === 1 ? rawCode : `${rawCode}-${n}`;
    if (n > 1) report.renamedCodes.push({ from: rawCode, to: code, name });
    const cost = centsOf(r[col.cost]);
    const stockCents = centsOf(r[col.stock]);
    let stock = stockCents === null ? 0 : stockCents / 100;
    if (!Number.isInteger(stock) || stock < 0 || stock > MAX_IMPORTED_STOCK) {
      if (stock !== 0) report.absurdStock.push({ code, name, falcon: stock });
      stock = 0;
    }
    if (price === 0) report.zeroPrice.push({ code, name });
    const category = splitArabic(r[col.category]);
    products.push({
      code, name, name_ar, price_ttc: price, cost_price: cost && cost > 0 ? cost : null, stock, active: price > 0,
      brand: String(r[col.brand] ?? '').trim() || null, category: category.name ? category : null,
    });
  }
  return { products, report };
}

/** Lignes de l'export « Liste des fournisseurs » → fournisseurs (code Falcon, nom, contact, reste dû en centimes). */
export function parseSuppliers(rows) {
  const headerIndex = rows.findIndex((r) => String(r[0] ?? '').trim() === 'ID du fournisseur');
  if (headerIndex < 0) throw new Error('Liste des fournisseurs : ligne de titres introuvable');
  const h = rows[headerIndex].map((x) => String(x).trim());
  const at = (label) => h.indexOf(label);
  const [iCode, iName, iPhone, iMail, iDue, iActive] = [at('ID du fournisseur'), at('Nom du fournisseur'), at('Mobile'), at('E-mail'), at('Achat dû'), at('Statut')];
  return rows.slice(headerIndex + 1)
    .filter((r) => String(r[iCode] ?? '').trim() && String(r[iName] ?? '').trim())
    .map((r) => ({
      code: String(r[iCode]).trim(),
      name: String(r[iName]).trim().replace(/\s+/g, ' '),
      phone: String(r[iPhone] ?? '').trim() || null,
      email: String(r[iMail] ?? '').trim() || null,
      due: Math.max(0, centsOf(r[iDue]) ?? 0),
      active: String(r[iActive] ?? 'Active').trim() !== 'Inactive',
    }));
}

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

/**
 * Enregistre articles et fournisseurs dans la base, en une transaction. storeId : la supérette ; userId : l'auteur
 * des mouvements (un administrateur). Renvoie le rapport : créés, ignorés (déjà présents), corrigés.
 */
export function importFalcon(db, { products = [], suppliers = [], storeId, userId, update = false, parsedReport = null }) {
  if (!get(db, 'SELECT id FROM stores WHERE id = ?', storeId)) throw new Error(`Magasin ${storeId} inconnu`);
  const result = { products: 0, productsUpdated: 0, productsSkipped: 0, categories: 0, brands: 0, stockLines: 0, suppliers: 0, suppliersSkipped: 0, openingDues: 0, report: parsedReport };
  const now = nowIso();
  tx(db, () => {
    const categoryId = (c) => {
      if (!c) return null;
      const known = get(db, 'SELECT id FROM categories WHERE lower(name) = lower(?)', c.name);
      if (known) return known.id;
      let id = `cat_${slug(c.name) || randomUUID().slice(0, 8)}`;
      if (get(db, 'SELECT id FROM categories WHERE id = ?', id)) id = `${id}_${randomUUID().slice(0, 4)}`; // « LRS EPICES » / « LES EPICES »
      run(db, 'INSERT INTO categories (id, name, name_ar) VALUES (?, ?, ?)', id, c.name, c.name_ar);
      result.categories += 1;
      return id;
    };
    const brandId = (name) => {
      if (!name) return null;
      const known = get(db, 'SELECT id FROM brands WHERE lower(name) = lower(?)', name);
      if (known) return known.id;
      const id = `br_${randomUUID().slice(0, 8)}`;
      run(db, 'INSERT INTO brands (id, name) VALUES (?, ?)', id, name);
      result.brands += 1;
      return id;
    };
    for (const p of products) {
      const existing = get(db, 'SELECT id FROM products WHERE code = ?', p.code);
      if (existing && !update) { result.productsSkipped += 1; continue; }
      if (existing) {
        // --update : Falcon fait foi pour un code déjà en base (données de démonstration, prix corrigés dans Falcon).
        run(db, `UPDATE products SET name = ?, name_ar = ?, category_id = ?, brand_id = ?, price_ttc = ?, cost_price = ?, tva_rate = 0, unit = 'unit', active = ?, updated_at = ?
          WHERE id = ?`, p.name, p.name_ar, categoryId(p.category), brandId(p.brand), p.price_ttc, p.cost_price, p.active ? 1 : 0, stampNow(), existing.id);
        const current = get(db, 'SELECT quantity FROM stock WHERE product_id = ? AND store_id = ?', existing.id, storeId)?.quantity ?? 0;
        const delta = toMilli(p.stock) - current;
        if (delta !== 0) {
          moveStock(db, { productId: existing.id, storeId, delta, kind: 'inventory', refId: null, note: 'Stock repris de Falcon POS', userId, at: now });
        }
        result.productsUpdated += 1;
        continue;
      }
      const id = `p_${randomUUID().slice(0, 8)}`;
      run(db, `INSERT INTO products (id, code, barcode, name, name_ar, category_id, brand_id, price_ttc, cost_price, tva_rate, unit, image_url,
        stock_alert, expiry_date, active, updated_at, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, 'unit', NULL, 0, NULL, ?, ?, ?)`,
      id, p.code, p.name, p.name_ar, categoryId(p.category), brandId(p.brand), p.price_ttc, p.cost_price, p.active ? 1 : 0, stampNow(), now);
      result.products += 1;
      if (p.stock > 0) {
        run(db, 'INSERT INTO stock (product_id, store_id, quantity) VALUES (?, ?, ?)', id, storeId, toMilli(p.stock));
        run(db, `INSERT INTO stock_moves (id, product_id, store_id, delta, kind, note, user_id, created_at) VALUES (?, ?, ?, ?, 'inventory', ?, ?, ?)`,
          randomUUID(), id, storeId, toMilli(p.stock), 'Stock repris de Falcon POS', userId, now);
        result.stockLines += 1;
      }
    }
    for (const s of suppliers) {
      const id = `sup_${s.code.toLowerCase()}`;
      if (get(db, 'SELECT id FROM suppliers WHERE id = ? OR lower(name) = lower(?)', id, s.name)) { result.suppliersSkipped += 1; continue; }
      run(db, `INSERT INTO suppliers (id, name, phone, email, note, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id, s.name, s.phone, s.email, `Repris de Falcon POS (${s.code})`, s.active ? 1 : 0, now, now);
      result.suppliers += 1;
      // Ce que la supérette doit encore au fournisseur d'après Falcon : une facture d'ouverture, sans ligne ni entrée en
      // stock, que le back-office montre comme reste dû et qui se règle comme une autre facture.
      if (s.due > 0) {
        const seq = get(db, "SELECT COALESCE(MAX(CAST(substr(number, 5) AS INTEGER)), 0) + 1 AS n FROM purchases WHERE number LIKE 'ACH-%'").n;
        run(db, `INSERT INTO purchases (id, number, supplier_id, store_id, invoice_ref, invoice_date, total, note, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, randomUUID(), `ACH-${String(seq).padStart(6, '0')}`, id, storeId, `Falcon ${s.code}`,
        now.slice(0, 10), s.due, 'Solde dû repris de Falcon POS', userId, now);
        result.openingDues += 1;
      }
    }
  });
  return result;
}
