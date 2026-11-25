import { describe, expect, it } from 'vitest'
import type { InventoryRow } from '../api/types'
import { filterSheet, gapValue, sheetSummary } from './inventory'

const row = (code: string, name: string, counted: number | null, stock: number, cost: number | null = 100, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  product_id: code, code, name, name_ar: null, unit: 'unit', cost_price: cost, category_name: 'Boulangerie', active: true, stock,
  counted, expected: counted === null ? null : stock, delta: counted === null ? null : counted - stock, counted_at: null, counted_by_name: null, ...extra,
})

const ROWS = [
  row('IT0001', 'Pain normal', null, 10),
  row('IT0002', 'Baguette', 8, 10),
  row('IT0003', 'Œuf', 30, 30, null, { name_ar: 'بيض', category_name: 'Crèmerie' }),
  row('IT0004', 'Fromage', 5, 2, null),
]

describe('feuille d’inventaire', () => {
  it('filtre à compter, comptés, écarts ; recherche sans accents et en arabe', () => {
    expect(filterSheet(ROWS, '', 'todo').map((r) => r.code)).toEqual(['IT0001'])
    expect(filterSheet(ROWS, '', 'counted').map((r) => r.code)).toEqual(['IT0002', 'IT0003', 'IT0004'])
    expect(filterSheet(ROWS, '', 'gaps').map((r) => r.code)).toEqual(['IT0002', 'IT0004'])
    expect(filterSheet(ROWS, 'oeuf', 'all').map((r) => r.code)).toEqual(['IT0003'])
    expect(filterSheet(ROWS, 'بيض', 'all').map((r) => r.code)).toEqual(['IT0003'])
    expect(filterSheet(ROWS, '', 'all', 'Crèmerie').map((r) => r.code)).toEqual(['IT0003'])
  })
  it('résumé : manques, surplus et valeur au prix d’achat (sans prix d’achat : non chiffré)', () => {
    expect(gapValue(ROWS[1])).toBe(-200)
    expect(gapValue(ROWS[3])).toBeNull()
    expect(sheetSummary(ROWS)).toEqual({ total: 4, counted: 3, missing: 1, surplus: 1, value: -200 })
  })
})
