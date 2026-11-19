// Graphiques simples en HTML/CSS (aucune bibliothèque) : colonnes par jour ou heure, barres horizontales.
import { formatMad } from '../lib/format'

export interface Column { key: string; label: string; value: number; secondary?: number; title?: string }

/** Colonnes verticales ; `secondary` (retours) est dessiné en rouge sous la colonne principale. */
export function Columns({ data, legend }: { data: Column[]; legend?: [string, string?] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.secondary ?? 0)))
  const every = Math.ceil(data.length / 12) // pas plus de 12 libellés lisibles
  return (
    <figure className="columns-chart">
      <div className="columns" role="img" aria-label={legend?.[0] ?? 'Graphique'}>
        {data.map((d, i) => (
          <div key={d.key} className="col" title={d.title ?? `${d.label} : ${formatMad(d.value)}`}>
            <div className="bars">
              <span className="bar main" style={{ height: `${(d.value / max) * 100}%` }} />
              {d.secondary ? <span className="bar secondary" style={{ height: `${(d.secondary / max) * 100}%` }} /> : null}
            </div>
            <span className="col-label">{i % every === 0 ? d.label : ''}</span>
          </div>
        ))}
      </div>
      {legend && (
        <figcaption className="legend">
          <span><i className="dot main" />{legend[0]}</span>
          {legend[1] && <span><i className="dot secondary" />{legend[1]}</span>}
        </figcaption>
      )}
    </figure>
  )
}

export interface HBar { key: string; label: string; value: number; display?: string; sub?: string }

export function HBars({ data, empty = 'Aucune donnée' }: { data: HBar[]; empty?: string }) {
  if (!data.length) return <p className="muted small">{empty}</p>
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)))
  return (
    <ul className="hbars">
      {data.map((d) => (
        <li key={d.key}>
          <div className="hbar-text">
            <span className="hbar-label">{d.label}{d.sub && <small className="muted"> · {d.sub}</small>}</span>
            <strong>{d.display ?? formatMad(d.value)}</strong>
          </div>
          <div className="hbar-track"><span style={{ width: `${(Math.max(0, d.value) / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}
