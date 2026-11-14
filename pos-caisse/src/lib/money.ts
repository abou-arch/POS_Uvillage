// Saisie de montants en dirhams (virgule ou point, espaces des milliers) → centimes entiers.

/** « 12 », « 12,5 », « 1 000,00 » → centimes ; null si ce n'est pas un montant positif à 2 décimales au plus. */
export function parseMad(text: string): number | null {
  const t = text.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** Comme parseMad, avec un signe moins possible : total du terminal de carte quand les retours dépassent les ventes (§9). */
export function parseSignedMad(text: string): number | null {
  const t = text.replace(/\s/g, '');
  if (!t.startsWith('-')) return parseMad(t);
  const cents = parseMad(t.slice(1));
  return cents === null ? null : -cents;
}

/** Centimes → texte d'un champ de saisie : 1250 → « 12,50 ». */
export const madInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
