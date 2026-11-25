// Feuille d'inventaire : filtres et chiffres affichés pendant le comptage (le serveur reste la référence).
import type { InventoryRow } from '../api/types'

export type SheetFilter = 'todo' | 'counted' | 'gaps' | 'all'

// « Œuf » se cherche « oeuf » : les ligatures ne se décomposent pas avec NFD.
const norm = (s: string) => s.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Lignes visibles : recherche sur code, nom, nom arabe ; filtre « à compter », « comptés », « écarts ». */
export function filterSheet(rows: InventoryRow[], search: string, filter: SheetFilter, category = ''): InventoryRow[] {
  const q = norm(search.trim())
  return rows.filter((r) => {
    if (category && r.category_name !== category) return false
    if (filter === 'todo' && r.counted !== null) return false
    if (filter === 'counted' && r.counted === null) return false
    if (filter === 'gaps' && (r.delta === null || r.delta === 0)) return false
    return !q || norm(r.code).includes(q) || norm(r.name).includes(q) || (r.name_ar ?? '').includes(search.trim())
  })
}

/** Écart d'une ligne en valeur (centimes, au prix d'achat) ; null sans écart ou sans prix d'achat. */
export const gapValue = (r: InventoryRow) => (r.delta === null || r.delta === 0 || r.cost_price === null ? null : Math.round(r.delta * r.cost_price))

/** Avancement : comptés / total, écarts (manques et surplus), valeur nette des écarts. */
export function sheetSummary(rows: InventoryRow[]) {
  const counted = rows.filter((r) => r.counted !== null)
  const gaps = counted.filter((r) => r.delta !== null && r.delta !== 0)
  return {
    total: rows.length,
    counted: counted.length,
    missing: gaps.filter((r) => (r.delta ?? 0) < 0).length,
    surplus: gaps.filter((r) => (r.delta ?? 0) > 0).length,
    value: gaps.reduce((n, r) => n + (gapValue(r) ?? 0), 0),
  }
}
