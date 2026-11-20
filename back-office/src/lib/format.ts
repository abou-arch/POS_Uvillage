// Affichage et saisie des montants (centimes), quantités et dates. Jamais de flottant pour l'argent :
// une saisie « 12,50 » devient 1250 centimes par lecture du texte, pas par calcul.

const mad = new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 3, 'article' → « 3 articles » ; 0 et 1 restent au singulier, comme en français. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('fr-FR')} ${Math.abs(n) < 2 ? one : many}`
}

/** 1250 → « 12,50 DH ». */
export function formatMad(cents: number): string {
  return `${mad.format(cents / 100)} DH`
}

/** 1250 → « 12,50 » (champ de saisie). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

/**
 * « 12,5 », « 12.50 », « 1 200 » → centimes ; null si la saisie n'est pas un montant (2 décimales au plus, positif,
 * moins d'un milliard de DH).
 */
export function parseMad(text: string): number | null {
  const t = text.replace(/[\s  ]/g, '').replace(/dh$/i, '').replace(',', '.')
  const m = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(t)
  if (!m) return null
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/** Quantité : entière à la pièce, 3 décimales au plus au kg. null si invalide. */
export function parseQuantity(text: string, unit: 'unit' | 'kg', { allowNegative = false, allowZero = false } = {}): number | null {
  const t = text.replace(/\s/g, '').replace(',', '.')
  const re = unit === 'unit' ? /^-?\d{1,7}$/ : /^-?\d{1,7}(\.\d{1,3})?$/
  if (!re.test(t)) return null
  const q = Number(t)
  if (q < 0 && !allowNegative) return null
  if (q === 0 && !allowZero) return null
  return q
}

const qty3 = new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 3 })

/** 2 → « 2 », 0.75 kg → « 0,75 kg ». */
export function formatQuantity(q: number, unit: 'unit' | 'kg' = 'unit'): string {
  return unit === 'kg' ? `${qty3.format(q)} kg` : qty3.format(q)
}

/** Date et heure locales (fuseau du magasin). */
export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('fr-FR', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}

export function formatDay(day: string): string {
  const [y, m, d] = day.split('-')
  return `${d}/${m}/${y}`
}

/** Variation en % entre deux périodes ; null si la période précédente est vide. */
export function variation(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10
}

export const percent = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('fr-FR')} %`
