// Calcul HT / TVA / TTC partagé par la caisse et la fausse API (règle du §7 de docs/API_CONTRACT.md).
// Tous les montants sont en centimes de dirham.

/** Calcule les totaux d'une ligne à partir du prix TTC. */
export function lineTotals(quantity, unitPriceTtc, discount, tvaRate) {
  const ttc = Math.round(quantity * unitPriceTtc) - discount;
  const ht = Math.round((ttc * 100) / (100 + tvaRate));
  return { ht, tva: ttc - ht, ttc };
}

/** Totaux de la vente : somme des lignes + autres charges − remise globale (sur le TTC). */
export function saleTotals(lines, otherCharges = 0, globalDiscount = 0) {
  const sum = lines.reduce(
    (acc, l) => {
      const t = lineTotals(l.quantity, l.unit_price_ttc, l.discount ?? 0, l.tva_rate);
      return { ht: acc.ht + t.ht, tva: acc.tva + t.tva, ttc: acc.ttc + t.ttc };
    },
    { ht: 0, tva: 0, ttc: 0 },
  );
  return { ...sum, ttc: sum.ttc + otherCharges - globalDiscount };
}

/** Formate des centimes en dirhams : 1250 -> "12,50 DH". */
export function formatMad(cents) {
  return `${(cents / 100).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}
