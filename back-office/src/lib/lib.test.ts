import { describe, expect, test } from 'vitest'
import { csvMad, toCsv } from './csv'
import { centsToInput, formatMad, parseMad, parseQuantity, variation } from './format'
import { addDays, customPeriod, dayIn, dayStart, periodQuery, presetPeriod } from './period'

describe('montants', () => {
  test('saisie lue comme du texte, jamais par calcul flottant', () => {
    expect(parseMad('12,5')).toBe(1250)
    expect(parseMad('0.1')).toBe(10)
    expect(parseMad('1 200,05 DH')).toBe(120005)
    expect(parseMad('19,99')).toBe(1999)
    expect(parseMad('12,505')).toBeNull()
    expect(parseMad('-3')).toBeNull()
    expect(parseMad('abc')).toBeNull()
    expect(parseMad('')).toBeNull()
  })

  test('affichage', () => {
    expect(centsToInput(1250)).toBe('12,50')
    expect(centsToInput(5)).toBe('0,05')
    expect(centsToInput(null)).toBe('')
    expect(formatMad(123456)).toBe('1.234,56 DH') // comme le ticket de la caisse (fr-MA)
  })

  test('quantités : entières à la pièce, 3 décimales au kg', () => {
    expect(parseQuantity('3', 'unit')).toBe(3)
    expect(parseQuantity('1,5', 'unit')).toBeNull()
    expect(parseQuantity('0,750', 'kg')).toBe(0.75)
    expect(parseQuantity('0,7505', 'kg')).toBeNull()
    expect(parseQuantity('-2', 'unit')).toBeNull()
    expect(parseQuantity('-2', 'unit', { allowNegative: true })).toBe(-2)
    expect(parseQuantity('0', 'unit')).toBeNull()
    expect(parseQuantity('0', 'unit', { allowZero: true })).toBe(0)
  })

  test('variation', () => {
    expect(variation(150, 100)).toBe(50)
    expect(variation(50, 100)).toBe(-50)
    expect(variation(10, 0)).toBeNull()
  })
})

describe('périodes dans le fuseau du magasin', () => {
  const tz = 'Africa/Casablanca'

  test('minuit à Casablanca (UTC+1) = 23h UTC la veille', () => {
    expect(dayStart('2026-11-12', tz).toISOString()).toBe('2026-11-11T23:00:00.000Z')
    expect(dayStart('2026-11-12', 'UTC').toISOString()).toBe('2026-11-12T00:00:00.000Z')
  })

  test('jour local d’un instant', () => {
    expect(dayIn(new Date('2026-11-12T23:30:00Z'), tz)).toBe('2026-11-13')
  })

  test('préréglages', () => {
    const now = new Date('2026-11-19T10:00:00Z')
    expect(presetPeriod('today', now, tz)).toMatchObject({ start: '2026-11-19', end: '2026-11-19' })
    expect(presetPeriod('7d', now, tz)).toMatchObject({ start: '2026-11-13', end: '2026-11-19' })
    expect(presetPeriod('month', now, tz)).toMatchObject({ start: '2026-11-01' })
    expect(presetPeriod('last-month', now, tz)).toMatchObject({ start: '2026-10-01', end: '2026-10-31' })
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  test('paramètres de l’API : to exclu, lendemain du dernier jour', () => {
    const q = periodQuery({ preset: 'custom', start: '2026-11-01', end: '2026-11-01' }, tz)
    expect(decodeURIComponent(q)).toBe('from=2026-10-31T23:00:00.000Z&to=2026-11-01T23:00:00.000Z')
  })

  test('période personnalisée : dans l’ordre, 366 jours au plus', () => {
    expect(customPeriod('2026-11-02', '2026-11-01')).toBeNull()
    expect(customPeriod('2025-01-01', '2026-01-02')).toBeNull()
    expect(customPeriod('2026-01-01', '2026-12-31')).not.toBeNull()
  })
})

describe('CSV', () => {
  test('séparateur ; guillemets, formules neutralisées', () => {
    expect(toCsv(['a', 'b'], [['x;y', '=SOMME(A1)'], [1, null]])).toBe('a;b\r\n"x;y";\'=SOMME(A1)\r\n1;')
    expect(csvMad(1250)).toBe('12,50')
    expect(csvMad(-5)).toBe('-0,05')
  })
})
