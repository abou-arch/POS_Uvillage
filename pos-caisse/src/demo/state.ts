// Remplace mock-api/state.js pour la démo (build --mode demo) : l'état de la fausse API (ventes reçues, sessions de
// caisse, retours, clients, stocks) est gardé dans le navigateur du testeur, et non dans state.json.
// Pour repartir de zéro : « Réinitialiser la démo » sur l'écran de connexion.

export const DEMO_STATE_KEY = 'caisse-demo-api';

interface WithId { id: string }
interface StockItem { id: string; stock_by_store: Record<string, number>; updated_at: string }
interface MockState {
  sales: Map<string, WithId>;
  cashSessions: Map<string, WithId>;
  cashMovements: Map<string, WithId>;
  refunds: Map<string, WithId>;
  customerPayments: Map<string, WithId>;
  customers: WithId[];
  products: StockItem[];
}

export function loadState({ sales, cashSessions, cashMovements, refunds, customerPayments, customers, products }: MockState) {
  try {
    const raw = localStorage.getItem(DEMO_STATE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const s of saved.sales ?? []) sales.set(s.id, s);
    for (const s of saved.cashSessions ?? []) cashSessions.set(s.id, s);
    for (const m of saved.cashMovements ?? []) cashMovements.set(m.id, m);
    for (const r of saved.refunds ?? []) refunds.set(r.id, r);
    for (const p of saved.customerPayments ?? []) customerPayments.set(p.id, p);
    for (const c of saved.customers ?? []) if (!customers.some((x) => x.id === c.id)) customers.push(c);
    for (const p of saved.products ?? []) {
      const product = products.find((x) => x.id === p.id);
      if (product) Object.assign(product, { stock_by_store: p.stock_by_store, updated_at: p.updated_at });
    }
  } catch (e) {
    console.warn(`Démo : état de la fausse API illisible, ignoré (${e instanceof Error ? e.message : e}).`);
  }
}

export function saveState({ sales, cashSessions, cashMovements, refunds, customerPayments, customers, products }: MockState) {
  try {
    localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({
      sales: [...sales.values()],
      cashSessions: [...cashSessions.values()],
      cashMovements: [...cashMovements.values()],
      refunds: [...refunds.values()],
      customerPayments: [...customerPayments.values()],
      customers,
      products: products.map(({ id, stock_by_store, updated_at }) => ({ id, stock_by_store, updated_at })),
    }));
  } catch (e) {
    console.warn(`Démo : impossible d'enregistrer l'état de la fausse API (${e instanceof Error ? e.message : e}).`);
  }
}
