// Apparence d'une catégorie d'articles : une teinte et un pictogramme, pour que les familles se repèrent d'un coup d'œil
// (vignettes de la grille, puces de catégorie, lignes du panier). Purement visuel : aucune règle métier ici.

export type CategoryPictogram =
  | 'bread' | 'dairy' | 'sauce' | 'can' | 'drink' | 'chips' | 'sweets' | 'plug' | 'weight' | 'produce' | 'tag';

// Mots-clés cherchés dans le nom de la catégorie (sans accents ni majuscules). Le premier qui correspond l'emporte.
const KEYWORDS: [RegExp, CategoryPictogram][] = [
  [/boulang|pain|patiss|viennois/, 'bread'],
  [/cremer|lait|fromage|yaourt|yogourt/, 'dairy'],
  [/sauce|condiment|\bepices?\b/, 'sauce'], // « épices » seul : pas l'« épicerie »
  [/conserve/, 'can'],
  [/boisson|\beaux?\b|\bjus\b|soda|cafe/, 'drink'], // « eau » seul : pas celui de « gâteau »
  [/chips|snack|aperitif/, 'chips'],
  [/sucre|biscuit|chocolat|confiser|bonbon|gateau/, 'sweets'],
  [/electr|pile|telephon|accessoire/, 'plug'],
  [/poids|vrac/, 'weight'],
  [/fruit|legume|primeur/, 'produce'],
];

const plain = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Pictogramme d'une catégorie d'après son nom ; « tag » (étiquette) quand aucun mot-clé ne correspond. */
export function categoryPictogram(name: string | null | undefined): CategoryPictogram {
  const n = plain(name ?? '');
  return KEYWORDS.find(([re]) => re.test(n))?.[1] ?? 'tag';
}

/** Teinte (0 à 359) stable pour une catégorie ; null : article sans catégorie (gris). */
export function categoryHue(categoryId: string | null): number | null {
  if (!categoryId) return null;
  const n = [...categoryId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0);
  return Math.round((n * 137.508) % 360);
}
