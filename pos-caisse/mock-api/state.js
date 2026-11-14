// État de la fausse API gardé sur disque, dans mock-api/state.json (ignoré par git) : la relancer ne perd ni les
// ventes reçues, ni les retours, ni les sessions de caisse, ni les stocks. Pour repartir de zéro : arrêter la fausse API et
// supprimer state.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// STATE_FILE=… pour un essai sans toucher à l'état habituel.
const FILE = process.env.STATE_FILE ?? new URL('./state.json', import.meta.url);

export function loadState({ sales, cashSessions, cashMovements, refunds, customers, products }) {
  if (!existsSync(FILE)) return;
  try {
    const saved = JSON.parse(readFileSync(FILE, 'utf8'));
    for (const s of saved.sales ?? []) sales.set(s.id, s);
    for (const s of saved.cashSessions ?? []) cashSessions.set(s.id, s);
    for (const m of saved.cashMovements ?? []) cashMovements.set(m.id, m);
    for (const r of saved.refunds ?? []) refunds.set(r.id, r);
    for (const c of saved.customers ?? []) if (!customers.some((x) => x.id === c.id)) customers.push(c);
    for (const p of saved.products ?? []) {
      const product = products.find((x) => x.id === p.id);
      if (product) Object.assign(product, { stock_by_store: p.stock_by_store, updated_at: p.updated_at });
    }
    console.log(`État repris de mock-api/state.json : ${sales.size} ventes, ${cashSessions.size} sessions, ${cashMovements.size} mouvements, ${refunds.size} retours.`);
  } catch (e) {
    console.warn(`mock-api/state.json illisible, ignoré (${e.message}).`);
  }
}

export function saveState({ sales, cashSessions, cashMovements, refunds, customers, products }) {
  const data = {
    sales: [...sales.values()],
    cashSessions: [...cashSessions.values()],
    cashMovements: [...cashMovements.values()],
    refunds: [...refunds.values()],
    customers,
    products: products.map(({ id, stock_by_store, updated_at }) => ({ id, stock_by_store, updated_at })),
  };
  try {
    writeFileSync(FILE, JSON.stringify(data, null, 1));
  } catch (e) {
    console.warn(`Impossible d'écrire mock-api/state.json (${e.message}) : l'état reste en mémoire.`);
  }
}
