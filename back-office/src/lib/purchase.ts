// Facture d'achat : total d'une ligne et de la facture, en centimes, calculés comme le serveur (routes/purchases.js).

/** Quantité (pièces, ou kg à 3 décimales) × prix d'achat unitaire en centimes, arrondi au centime. */
export const lineTotal = (quantity: number, unitCost: number) => Math.round(quantity * unitCost)

/** Total d'une facture ; null tant qu'une ligne est incomplète ou invalide. */
export function purchaseTotal(lines: { quantity: number | null; unitCost: number | null }[]): number | null {
  if (lines.length === 0 || lines.some((l) => l.quantity === null || l.unitCost === null)) return null
  return lines.reduce((n, l) => n + lineTotal(l.quantity as number, l.unitCost as number), 0)
}

/** Reste dû après un premier règlement ; null si le règlement dépasse le total. */
export function dueAfter(total: number, paid: number): number | null {
  return paid > total ? null : total - paid
}
