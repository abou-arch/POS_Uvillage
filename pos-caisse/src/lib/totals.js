// Calcul HT / TVA / TTC partagé par la caisse et la fausse API (règle du §7 de docs/API_CONTRACT.md).
// Tous les montants sont en centimes de dirham.

/** Décompose un montant TTC en HT + TVA pour un taux donné. */
function split(ttc, tvaRate) {
  const ht = Math.round((ttc * 100) / (100 + tvaRate));
  return { ht, tva: ttc - ht, ttc };
}

/** Calcule les totaux d'une ligne à partir du prix TTC. */
export function lineTotals(quantity, unitPriceTtc, discount, tvaRate) {
  return split(Math.round(quantity * unitPriceTtc) - discount, tvaRate);
}

/**
 * Répartit `amount` centimes au prorata de `weights` (montants positifs, de somme non nulle),
 * sans perdre ni créer de centime : méthode des plus forts restes.
 */
export function allocate(amount, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (amount === 0 || total <= 0) return weights.map(() => 0);
  const abs = Math.abs(amount);
  const exact = weights.map((w) => (abs * w) / total);
  const parts = exact.map((e) => Math.floor(e));
  let rest = abs - parts.reduce((s, p) => s + p, 0);
  const byRemainder = exact.map((_, i) => i).sort((a, b) => exact[b] - parts[b] - (exact[a] - parts[a]) || a - b);
  for (const i of byRemainder) {
    if (rest === 0) break;
    parts[i] += 1;
    rest -= 1;
  }
  return parts.map((p) => (p === 0 ? 0 : Math.sign(amount) * p));
}

/**
 * Récapitulatif TVA par taux (le plus élevé d'abord), tel qu'imprimé sur le ticket.
 * Les autres charges et la remise globale sont réparties entre les taux au prorata du TTC de leurs lignes
 * (tout sur le taux le plus élevé si ce TTC est nul), puis chaque taux est décomposé en HT + TVA.
 */
export function vatBreakdown(lines, otherCharges = 0, globalDiscount = 0) {
  const priced = lines.map((l) => ({
    tva_rate: l.tva_rate, total_ttc: lineTotals(l.quantity, l.unit_price_ttc, l.discount ?? 0, l.tva_rate).ttc,
  }));
  return vatBreakdownOfLines(priced, otherCharges, globalDiscount);
}

/**
 * Même récapitulatif, à partir du `total_ttc` déjà calculé de chaque ligne (celui d'une vente enregistrée) :
 * le ticket imprime ainsi les montants de la vente, sans repartir des prix et des quantités.
 */
export function vatBreakdownOfLines(lines, otherCharges = 0, globalDiscount = 0) {
  const adjustment = otherCharges - globalDiscount;
  if (lines.length === 0) return adjustment === 0 ? [] : [{ rate: 0, ...split(adjustment, 0) }];
  return rateShares(lines, adjustment).map(({ rate, base, share }) => ({ rate, ...split(base + share, rate) }));
}

/**
 * Étape 2 du §7 : TTC des lignes de chaque taux (le plus élevé d'abord) et part de `adjustment`
 * (autres charges − remise globale) de ce taux, au prorata de ces TTC, au centime près.
 */
function rateShares(lines, adjustment) {
  const ttcByRate = new Map();
  for (const l of lines) ttcByRate.set(l.tva_rate, (ttcByRate.get(l.tva_rate) ?? 0) + l.total_ttc);
  const rates = [...ttcByRate.keys()].sort((a, b) => b - a);
  const bases = rates.map((r) => ttcByRate.get(r));
  const base = bases.reduce((s, b) => s + b, 0);
  const shares = allocate(adjustment, base > 0 ? bases : bases.map((_, i) => (i === 0 ? 1 : 0)));
  return rates.map((rate, i) => ({ rate, base: bases[i], share: shares[i] }));
}

/**
 * TTC réellement payé de chaque ligne d'une vente (§7, « Montant remboursé lors d'un retour ») : son total_ttc plus
 * sa part de la remise globale et des autres charges. La part de chaque taux est répartie entre les lignes de ce taux
 * au prorata de leur total_ttc (plus forts restes ; à TTC nul, tout sur la première). La somme est égale au TTC de la vente.
 */
export function paidByLine(lines, otherCharges = 0, globalDiscount = 0) {
  const paid = lines.map((l) => l.total_ttc);
  for (const { rate, base, share } of rateShares(lines, otherCharges - globalDiscount)) {
    const indexes = lines.map((l, i) => (l.tva_rate === rate ? i : -1)).filter((i) => i >= 0);
    const weights = indexes.map((i) => lines[i].total_ttc);
    const parts = allocate(share, base > 0 ? weights : weights.map((_, k) => (k === 0 ? 1 : 0)));
    indexes.forEach((i, k) => { paid[i] += parts[k]; });
  }
  return paid;
}

const thousandths = (quantity) => Math.round(quantity * 1000); // quantités au poids : 3 décimales, calcul en entiers

/**
 * Remboursement de `quantity` articles sur une ligne payée `paid` pour `sold` articles, dont `returnedBefore` déjà
 * retournés (§7) :
 * round(payé × (r + q) / Q) − round(payé × r / Q). Les arrondis ne s'accumulent pas : toute la quantité retournée,
 * en un ou plusieurs retours, rend exactement le payé. HT et TVA avec le taux de la ligne.
 */
export function refundLine(paid, tvaRate, sold, returnedBefore, quantity) {
  const q = thousandths(sold);
  const before = thousandths(returnedBefore);
  const after = before + thousandths(quantity);
  return split(Math.round((paid * after) / q) - Math.round((paid * before) / q), tvaRate);
}

/** Totaux de la vente : somme du récapitulatif par taux. HT + TVA = TTC, toujours. */
export function saleTotals(lines, otherCharges = 0, globalDiscount = 0) {
  return vatBreakdown(lines, otherCharges, globalDiscount)
    .reduce((acc, g) => ({ ht: acc.ht + g.ht, tva: acc.tva + g.tva, ttc: acc.ttc + g.ttc }), { ht: 0, tva: 0, ttc: 0 });
}

/** Formate des centimes en dirhams : 1250 -> "12,50 DH". */
export function formatMad(cents) {
  return `${(cents / 100).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}
