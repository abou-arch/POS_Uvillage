// Calculs des graphiques dessinés à la main (SVG) : échelle « ronde », arcs d'anneau, regroupement des petites parts,
// libellés des mois, montants abrégés. Fonctions pures, testées dans lib.test.ts.

/** Couleur fixe de chaque catégorie de dépense : elle suit la catégorie d'un graphique à l'autre, quel que soit son rang. */
export const EXPENSE_COLORS: Record<string, string> = {
  rent: 'var(--s1)', salaries: 'var(--s2)', electricity: 'var(--s3)', water: 'var(--s4)', transport: 'var(--s5)', supplies: 'var(--s6)',
  maintenance: 'var(--s7)', taxes: 'var(--s8)', other: 'var(--faint)',
}
/** Couleur fixe de chaque moyen de paiement. */
export const METHOD_COLORS: Record<string, string> = { cash: 'var(--s1)', card: 'var(--s2)', mobile: 'var(--s3)', qr: 'var(--s5)', credit: 'var(--s4)' }

/** Échelle verticale : maximum arrondi vers le haut (1, 2, 2,5 ou 5 × 10ⁿ) et graduations régulières depuis 0. */
export function niceScale(max: number, steps = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] }
  const raw = max / steps
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power
  const top = Math.ceil(max / step - 1e-9) * step
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 1000) / 1000)
  return { max: top, ticks }
}

/** Échelle qui contient aussi des valeurs négatives (résultat mensuel) : graduations symétriques autour de 0. */
export function signedScale(min: number, max: number, steps = 4): { min: number; max: number; ticks: number[] } {
  const span = Math.max(Math.abs(min), Math.abs(max))
  if (min >= 0) { const s = niceScale(max, steps); return { min: 0, ...s } }
  const s = niceScale(span, Math.max(2, Math.round(steps / 2)))
  const step = s.ticks[1] - s.ticks[0]
  const low = max <= 0 ? -s.max : -Math.ceil(-min / step - 1e-9) * step
  const high = max <= 0 ? 0 : Math.ceil(max / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = low; v <= high + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000)
  return { min: low, max: high, ticks }
}

const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** « 2026-03 » → « Mars » ; long : « mars 2026 ». */
export function monthLabel(month: string, long = false): string {
  const [y, m] = month.split('-').map(Number)
  return long ? `${MONTHS_LONG[m - 1]} ${y}` : MONTHS[m - 1]
}

/** Montant abrégé pour les axes : 125 000 DH → « 125 k », 2 400 000 DH → « 2,4 M » (centimes en entrée). */
export function compactMad(cents: number): string {
  const dh = cents / 100
  const abs = Math.abs(dh)
  const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: n < 10 ? 1 : 0 })
  if (abs >= 1_000_000) return `${fmt(dh / 1_000_000)} M`
  if (abs >= 1_000) return `${fmt(dh / 1_000)} k`
  return fmt(dh)
}

export interface Slice { key: string; label: string; value: number }

/**
 * Parts d'un anneau : les valeurs nulles ou négatives sont écartées, au-delà de `max` parts les plus petites sont
 * regroupées en « Autres » (une couleur par part, jamais réutilisée).
 */
export function foldSlices(slices: Slice[], max = 6): Slice[] {
  const kept = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value)
  if (kept.length <= max) return kept
  const rest = kept.slice(max - 1)
  return [...kept.slice(0, max - 1), { key: '__others', label: 'Autres', value: rest.reduce((n, s) => n + s.value, 0) }]
}

/** Angles (radians, 0 en haut, sens horaire) de chaque part ; un petit espace sépare les parts quand il y en a plusieurs. */
export function arcs(values: number[], gap = 0.02): { start: number; end: number; share: number }[] {
  const total = values.reduce((n, v) => n + v, 0)
  if (total <= 0) return []
  const g = values.length > 1 ? gap : 0
  let at = 0
  return values.map((v) => {
    const share = v / total
    const span = share * Math.PI * 2
    const arc = { start: at + g / 2, end: at + Math.max(span - g / 2, g / 2 + 0.0001), share }
    at += span
    return arc
  })
}

/** Chemin SVG d'un secteur d'anneau entre deux angles (cercle complet découpé en deux demi-arcs). */
export function ringPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  if (end - start >= Math.PI * 2 - 1e-6) {
    return [ringPath(cx, cy, outer, inner, 0, Math.PI), ringPath(cx, cy, outer, inner, Math.PI, Math.PI * 2 - 1e-6)].join(' ')
  }
  const pt = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`
  const large = end - start > Math.PI ? 1 : 0
  return `M ${pt(outer, start)} A ${outer} ${outer} 0 ${large} 1 ${pt(outer, end)} L ${pt(inner, end)} A ${inner} ${inner} 0 ${large} 0 ${pt(inner, start)} Z`
}
