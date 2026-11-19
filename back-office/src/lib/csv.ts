// Export CSV pour Excel (séparateur « ; », BOM UTF-8). Une cellule qui commence par = + - @ est neutralisée :
// ouverte dans un tableur, elle ne doit pas s'exécuter comme une formule.

export type Cell = string | number | null | undefined

function cell(v: Cell): string {
  if (v === null || v === undefined) return ''
  let s = String(v)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')
}

/** Centimes → « 12,50 » (nombre lisible par Excel en français). */
export const csvMad = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

export function downloadCsv(name: string, content: string) {
  const blob = new Blob(['﻿', content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
