// Billets et pièces en circulation au Maroc, du plus grand au plus petit, en centimes.
// Pour en ajouter ou en retirer, il suffit de modifier cette liste : l'API accepte toute valeur positive (§9).
export interface Denomination { value: number; kind: 'billet' | 'pièce' }

export const DENOMINATIONS: readonly Denomination[] = [
  { value: 20000, kind: 'billet' },
  { value: 10000, kind: 'billet' },
  { value: 5000, kind: 'billet' },
  { value: 2000, kind: 'billet' },
  { value: 1000, kind: 'pièce' },
  { value: 500, kind: 'pièce' },
  { value: 200, kind: 'pièce' },
  { value: 100, kind: 'pièce' },
  { value: 50, kind: 'pièce' },
  { value: 20, kind: 'pièce' },
  { value: 10, kind: 'pièce' },
];
