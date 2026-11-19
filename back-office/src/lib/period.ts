// Périodes des listes et rapports : des jours du fuseau du magasin, traduits en instants UTC pour l'API
// (from inclus, to exclu, §12 du contrat).

export type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'last-month' | 'custom'

export const PRESET_LABELS: Record<Preset, string> = {
  today: 'Aujourd’hui',
  yesterday: 'Hier',
  '7d': '7 jours',
  '30d': '30 jours',
  month: 'Ce mois',
  'last-month': 'Mois dernier',
  custom: 'Dates…',
}

export interface Period {
  preset: Preset
  /** Premier jour (AAAA-MM-JJ), inclus. */
  start: string
  /** Dernier jour (AAAA-MM-JJ), inclus. */
  end: string
}

/** Jour local (AAAA-MM-JJ) d'un instant dans un fuseau. */
export function dayIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** Décalage du fuseau à cet instant, en millisecondes (heure locale − UTC). */
function offsetAt(ms: number, timeZone: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** Instant UTC où commence un jour local (minuit dans le fuseau). */
export function dayStart(day: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  let t = guess - offsetAt(guess, timeZone)
  t = guess - offsetAt(t, timeZone) // second passage : changement d'heure entre les deux
  return new Date(t)
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function presetPeriod(preset: Exclude<Preset, 'custom'>, now: Date, timeZone: string): Period {
  const today = dayIn(now, timeZone)
  const monthStart = `${today.slice(0, 8)}01`
  switch (preset) {
    case 'today': return { preset, start: today, end: today }
    case 'yesterday': return { preset, start: addDays(today, -1), end: addDays(today, -1) }
    case '7d': return { preset, start: addDays(today, -6), end: today }
    case '30d': return { preset, start: addDays(today, -29), end: today }
    case 'month': return { preset, start: monthStart, end: today }
    case 'last-month': {
      const end = addDays(monthStart, -1)
      return { preset, start: `${end.slice(0, 8)}01`, end }
    }
  }
}

/** Période personnalisée : dates dans l'ordre, 366 jours au plus ; sinon null. */
export function customPeriod(start: string, end: string): Period | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return null
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1
  return days <= 366 ? { preset: 'custom', start, end } : null
}

/** Instants from (inclus) / to (exclu) de l'API pour une période. */
export function periodRange(p: Period, timeZone: string): { from: string; to: string } {
  return { from: dayStart(p.start, timeZone).toISOString(), to: dayStart(addDays(p.end, 1), timeZone).toISOString() }
}

export function periodQuery(p: Period, timeZone: string): string {
  const { from, to } = periodRange(p, timeZone)
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
}

export function periodLabel(p: Period): string {
  if (p.preset !== 'custom') return PRESET_LABELS[p.preset]
  const f = (d: string) => d.split('-').reverse().join('/')
  return p.start === p.end ? f(p.start) : `${f(p.start)} – ${f(p.end)}`
}
