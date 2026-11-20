import { describe, expect, test } from 'vitest'
import { arcs, compactMad, foldSlices, monthLabel, niceScale, ringPath, signedScale } from './charts'
import { dueAfter, lineTotal, purchaseTotal } from './purchase'

describe('échelles des graphiques', () => {
  test('maximum rond et graduations depuis 0', () => {
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] })
    expect(niceScale(87)).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] })
    expect(niceScale(1_234_500)).toEqual({ max: 1_500_000, ticks: [0, 500_000, 1_000_000, 1_500_000] })
    expect(niceScale(400)).toEqual({ max: 400, ticks: [0, 100, 200, 300, 400] })
  })

  test('échelle signée : 0 toujours graduée, négatifs couverts', () => {
    expect(signedScale(0, 87).min).toBe(0)
    const s = signedScale(-300, 900)
    expect(s.ticks).toContain(0)
    expect(s.min).toBeLessThanOrEqual(-300)
    expect(s.max).toBeGreaterThanOrEqual(900)
    const neg = signedScale(-450, -10)
    expect(neg.max).toBe(0)
    expect(neg.min).toBeLessThanOrEqual(-450)
  })

  test('mois et montants abrégés', () => {
    expect(monthLabel('2026-03')).toBe('Mars')
    expect(monthLabel('2026-08', true)).toBe('août 2026')
    expect(compactMad(12_500_000)).toBe('125 k')
    expect(compactMad(240_000_000)).toBe('2,4 M')
    expect(compactMad(-50_000)).toBe('-500')
  })
})

describe('anneaux', () => {
  test('parts nulles écartées, petites parts regroupées en « Autres »', () => {
    const slices = ['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ key: k, label: k, value: (5 - i) * 10 }))
    expect(foldSlices([...slices, { key: 'z', label: 'z', value: 0 }], 6)).toHaveLength(5)
    const folded = foldSlices(slices, 3)
    expect(folded.map((s) => s.key)).toEqual(['a', 'b', '__others'])
    expect(folded[2].value).toBe(30 + 20 + 10)
  })

  test('angles proportionnels, une part seule fait le tour complet', () => {
    const [a, b] = arcs([1, 3], 0)
    expect(a.share).toBe(0.25)
    expect(a.end).toBeCloseTo(Math.PI / 2)
    expect(b.end).toBeCloseTo(Math.PI * 2)
    expect(arcs([0, 0])).toEqual([])
    const [full] = arcs([5])
    expect(full.end - full.start).toBeCloseTo(Math.PI * 2)
    expect(ringPath(50, 50, 40, 25, full.start, full.end).match(/M /g)).toHaveLength(2)
    expect(ringPath(50, 50, 40, 25, 0, Math.PI / 2)).toBe('M 50.00 10.00 A 40 40 0 0 1 90.00 50.00 L 75.00 50.00 A 25 25 0 0 0 50.00 25.00 Z')
  })
})

describe('facture d’achat', () => {
  test('total au centime, comme le serveur ; incomplète tant qu’une ligne manque', () => {
    expect(lineTotal(2.5, 1800)).toBe(4500)
    expect(lineTotal(0.333, 1999)).toBe(666)
    expect(purchaseTotal([{ quantity: 40, unitCost: 90 }, { quantity: 2.5, unitCost: 1800 }])).toBe(8100)
    expect(purchaseTotal([{ quantity: 40, unitCost: null }])).toBeNull()
    expect(purchaseTotal([])).toBeNull()
    expect(dueAfter(8100, 3000)).toBe(5100)
    expect(dueAfter(8100, 8101)).toBeNull()
  })
})
