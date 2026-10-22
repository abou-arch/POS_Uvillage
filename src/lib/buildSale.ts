// Construction de la vente envoyée à l'API, exactement selon le §5 du contrat. Fonction pure : tout est testé.
import type { CartState } from '../state/cart';
import { cashError, paymentsError } from '../state/payment';
import type { Payment, Product, Sale, SaleLine } from '../types';
import { lineTotals, saleTotals } from './totals.js';

export interface SaleInput {
  cart: CartState;
  storeId: string;
  registerId: string;
  cashierId: string;
  payments: Payment[];
  amountReceived: number; // espèces remises par le client ; le rendu en découle
  id: string; // UUID v4 généré par la caisse
  counter: number; // compteur de tickets de cette caisse
  now: Date;
}

/** Numéro de ticket lisible : « ST1-REG1-000123 » pour le magasin st_1, la caisse reg_1, 123e ticket. */
export function ticketNumber(storeId: string, registerId: string, counter: number): string {
  const code = (id: string) => id.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return `${code(storeId)}-${code(registerId)}-${String(counter).padStart(6, '0')}`;
}

/** Construit la vente ; lève une erreur si le panier ou les paiements ne respectent pas le contrat. */
export function buildSale(input: SaleInput): Sale {
  const { cart, payments, amountReceived } = input;
  if (cart.lines.length === 0) throw new Error('Le panier est vide.');
  const totals = saleTotals(cart.lines, cart.otherCharges, cart.globalDiscount);
  const cashPaid = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
  const error = paymentsError(totals.ttc, payments, cart.customer !== null)
    ?? (cashPaid > 0 ? cashError(cashPaid, amountReceived) : null);
  if (error) throw new Error(error);

  const lines: SaleLine[] = cart.lines.map((l) => {
    const t = lineTotals(l.quantity, l.unit_price_ttc, l.discount, l.tva_rate);
    return {
      product_id: l.product_id, name: l.name, quantity: l.quantity, unit_price_ttc: l.unit_price_ttc,
      discount: l.discount, tva_rate: l.tva_rate, total_ht: t.ht, total_tva: t.tva, total_ttc: t.ttc,
    };
  });

  return {
    id: input.id,
    number: ticketNumber(input.storeId, input.registerId, input.counter),
    store_id: input.storeId,
    register_id: input.registerId,
    cashier_id: input.cashierId,
    customer_id: cart.customer?.id ?? null,
    created_at: input.now.toISOString().replace(/\.\d{3}Z$/, 'Z'), // « 2026-10-05T14:32:10Z » comme le contrat
    lines,
    other_charges: cart.otherCharges,
    global_discount: cart.globalDiscount,
    totals,
    payments,
    amount_received: cashPaid > 0 ? amountReceived : 0,
    change_given: cashPaid > 0 ? amountReceived - cashPaid : 0,
    send_sms: cart.sendSms,
    status: 'completed',
  };
}

/** Stock affiché après une vente : chaque article perd la quantité vendue (3 décimales pour le poids). */
export function decrementStock(products: Product[], lines: Pick<SaleLine, 'product_id' | 'quantity'>[]): Product[] {
  const sold = new Map<string, number>();
  for (const l of lines) sold.set(l.product_id, (sold.get(l.product_id) ?? 0) + l.quantity);
  return products.map((p) => {
    const quantity = sold.get(p.id);
    return quantity === undefined ? p : { ...p, stock: Math.round((p.stock - quantity) * 1000) / 1000 };
  });
}
