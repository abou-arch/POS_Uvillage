// Graphiques sans bibliothèque : colonnes et barres horizontales en HTML/CSS ; barres groupées, courbe, résultat
// signé et anneau en SVG dessiné à la main (calculs dans lib/charts.ts, testés).
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { arcs, foldSlices, niceScale, ringPath, signedScale, type Slice } from '../lib/charts'
import { formatMad } from '../lib/format'

/** Rang d'une barre : décale son apparition de --stagger (styles.css). */
const order = (i: number) => ({ '--i': i }) as CSSProperties

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
              <span className="bar main" style={{ height: `${(d.value / max) * 100}%`, ...order(i) }} />
              {d.secondary ? <span className="bar secondary" style={{ height: `${(d.secondary / max) * 100}%`, ...order(i) }} /> : null}
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
      {data.map((d, i) => (
        <li key={d.key}>
          <div className="hbar-text">
            <span className="hbar-label">{d.label}{d.sub && <small className="muted"> · {d.sub}</small>}</span>
            <strong>{d.display ?? formatMad(d.value)}</strong>
          </div>
          <div className="hbar-track"><span style={{ width: `${(Math.max(0, d.value) / max) * 100}%`, ...order(i) }} /></div>
        </li>
      ))}
    </ul>
  )
}

// --- Graphiques SVG dessinés à la main : barres groupées, courbe, résultat signé, anneau --------------------------
// Couleurs : palette catégorielle dans un ordre fixe (--s1 ventes, --s2 achats, --s3 dépenses…), jamais selon le rang.
// Chaque graphique a une info-bulle au survol (et au toucher) ; les montants exacts restent dans les tableaux.

/** Largeur réelle du conteneur : le SVG est dessiné au pixel, les textes gardent leur taille sur mobile. */
function useWidth(initial = 600) {
  const [width, setWidth] = useState(initial)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

interface Tip { x: number; y: number; title: string; rows: { color?: string; label: string; value: string }[] }

/** Info-bulle : la dernière reste affichée le temps de sa sortie (--dur-exit), puis s'efface sans être démontée. */
function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  const [last, setLast] = useState<Tip | null>(null)
  if (tip && tip !== last) setLast(tip)
  const shown = tip ?? last
  if (!shown) return null
  const left = Math.min(Math.max(shown.x, 90), width - 90)
  return (
    <div className={tip ? 'chart-tip' : 'chart-tip out'} style={{ left, top: shown.y }} role="status" aria-hidden={!tip}>
      <strong>{shown.title}</strong>
      {shown.rows.map((r) => (
        <span key={r.label} className="chart-tip-row">{r.color && <i style={{ background: r.color }} />}{r.label}<b>{r.value}</b></span>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => <span key={i.label}><i style={{ background: i.color }} />{i.label}</span>)}
    </div>
  )
}

export interface Series { key: string; label: string; color: string; values: number[] }

const PAD = { top: 12, right: 8, bottom: 26, left: 52 }

function YAxis({ ticks, y, width, format }: { ticks: number[]; y: (v: number) => number; width: number; format: (v: number) => string }) {
  return (
    <g className="axis">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'baseline' : 'grid-line'} />
          <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{format(t)}</text>
        </g>
      ))}
    </g>
  )
}

/** Barre aux coins arrondis (4 px) côté valeur, posée sur la ligne de base ; vers le bas pour une valeur négative. */
function barPath(x: number, w: number, y0: number, y1: number, r = 4): string {
  const h = Math.abs(y1 - y0)
  if (h < 0.5) return ''
  const rr = Math.min(r, w / 2, h)
  const s = y1 <= y0 ? 1 : -1
  return `M${x},${y0} V${y1 + s * rr} Q${x},${y1} ${x + rr},${y1} H${x + w - rr} Q${x + w},${y1} ${x + w},${y1 + s * rr} V${y0} Z`
}

/** Barres groupées par catégorie (mois) : une barre par série, info-bulle sur toute la colonne. */
export function GroupedBars({ labels, titles, series, format, axisFormat, height = 260, label }: {
  labels: string[]; titles?: string[]; series: Series[]; format: (v: number) => string; axisFormat: (v: number) => string
  height?: number; label: string
}) {
  const { ref, width } = useWidth()
  const [active, setActive] = useState<number | null>(null)
  const scale = niceScale(Math.max(0, ...series.flatMap((s) => s.values)))
  const plotW = width - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  const band = plotW / Math.max(1, labels.length)
  const gap = 2
  const barW = Math.max(2, Math.min(18, (band * 0.72 - gap * (series.length - 1)) / series.length))
  const groupW = barW * series.length + gap * (series.length - 1)
  const y = (v: number) => PAD.top + plotH - (v / scale.max) * plotH
  const every = band < 34 ? 2 : 1
  const tip: Tip | null = active === null ? null : {
    x: PAD.left + band * (active + 0.5), y: PAD.top, title: titles?.[active] ?? labels[active],
    rows: series.map((s) => ({ color: s.color, label: s.label, value: format(s.values[active]) })),
  }
  return (
    <div className="chart" ref={ref}>
      {series.length > 1 && <Legend items={series} />}
      <svg width={width} height={height} role="img" aria-label={label} onMouseLeave={() => setActive(null)}>
        <YAxis ticks={scale.ticks} y={y} width={width} format={axisFormat} />
        {labels.map((l, i) => {
          const x0 = PAD.left + band * i + (band - groupW) / 2
          return (
            <g key={l + i}>
              {active === i && <rect className="hover-band" x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} />}
              {series.map((s, j) => <path key={s.key} className="bar" style={order(i)} d={barPath(x0 + j * (barW + gap), barW, y(0), y(s.values[i]))} fill={s.color} />)}
              {i % every === 0 && <text className="x-label" x={PAD.left + band * (i + 0.5)} y={height - 8} textAnchor="middle">{l}</text>}
              <rect className="hit" x={PAD.left + band * i} y={PAD.top} width={band} height={plotH + PAD.bottom}
                onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  )
}

/** Barres d'une valeur signée (résultat du mois) : au-dessus de zéro en bleu, en dessous en rouge ; libellé dans l'info-bulle. */
export function SignedBars({ labels, titles, values, format, axisFormat, height = 220, label, positive = 'Bénéfice', negative = 'Perte' }: {
  labels: string[]; titles?: string[]; values: number[]; format: (v: number) => string; axisFormat: (v: number) => string
  height?: number; label: string; positive?: string; negative?: string
}) {
  const { ref, width } = useWidth()
  const [active, setActive] = useState<number | null>(null)
  const scale = signedScale(Math.min(0, ...values), Math.max(0, ...values))
  const plotW = width - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  const band = plotW / Math.max(1, labels.length)
  const barW = Math.max(3, Math.min(24, band * 0.6))
  const y = (v: number) => PAD.top + ((scale.max - v) / (scale.max - scale.min)) * plotH
  const every = band < 34 ? 2 : 1
  const colorOf = (v: number) => (v < 0 ? 'var(--s8)' : 'var(--s1)')
  const tip: Tip | null = active === null ? null : {
    x: PAD.left + band * (active + 0.5), y: PAD.top, title: titles?.[active] ?? labels[active],
    rows: [{ color: colorOf(values[active]), label: values[active] < 0 ? negative : positive, value: format(values[active]) }],
  }
  return (
    <div className="chart" ref={ref}>
      <Legend items={[{ label: positive, color: 'var(--s1)' }, { label: negative, color: 'var(--s8)' }]} />
      <svg width={width} height={height} role="img" aria-label={label} onMouseLeave={() => setActive(null)}>
        <YAxis ticks={scale.ticks} y={y} width={width} format={axisFormat} />
        {labels.map((l, i) => (
          <g key={l + i}>
            {active === i && <rect className="hover-band" x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} />}
            <path className={values[i] < 0 ? 'bar neg' : 'bar'} style={order(i)} d={barPath(PAD.left + band * i + (band - barW) / 2, barW, y(0), y(values[i]))} fill={colorOf(values[i])} />
            {i % every === 0 && <text className="x-label" x={PAD.left + band * (i + 0.5)} y={height - 8} textAnchor="middle">{l}</text>}
            <rect className="hit" x={PAD.left + band * i} y={PAD.top} width={band} height={plotH + PAD.bottom}
              onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
          </g>
        ))}
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  )
}

/** Courbe d'une série dans le temps (ventes par jour) : trait de 2 px, aire légère, réticule et info-bulle au survol. */
export function AreaLine({ labels, titles, values, color = 'var(--s1)', format, axisFormat, height = 240, label, seriesLabel }: {
  labels: string[]; titles?: string[]; values: number[]; color?: string; format: (v: number) => string; axisFormat: (v: number) => string
  height?: number; label: string; seriesLabel: string
}) {
  const { ref, width } = useWidth()
  const [active, setActive] = useState<number | null>(null)
  const scale = niceScale(Math.max(0, ...values))
  const plotW = width - PAD.left - PAD.right - 8
  const plotH = height - PAD.top - PAD.bottom
  const n = values.length
  const x = (i: number) => PAD.left + 4 + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => PAD.top + plotH - (v / scale.max) * plotH
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = n > 1 ? `${line} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : ''
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))))
  function pick(clientX: number, rect: DOMRect) {
    const i = n <= 1 ? 0 : Math.round(((clientX - rect.left - PAD.left - 4) / plotW) * (n - 1))
    setActive(Math.min(n - 1, Math.max(0, i)))
  }
  const tip: Tip | null = active === null ? null : {
    x: x(active), y: PAD.top, title: titles?.[active] ?? labels[active], rows: [{ color, label: seriesLabel, value: format(values[active]) }],
  }
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={label} onMouseLeave={() => setActive(null)}
        onMouseMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onClick={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}>
        <YAxis ticks={scale.ticks} y={y} width={width} format={axisFormat} />
        <g className="plot-fade">
          <path d={area} fill={color} opacity={0.12} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </g>
        {labels.map((l, i) => {
          const last = i === n - 1
          if (!(last || (i % every === 0 && n - 1 - i >= every / 2))) return null
          return <text key={l + i} className="x-label" x={x(i)} y={height - 8} textAnchor={i === 0 && n > 1 ? 'start' : last && n > 1 ? 'end' : 'middle'}>{l}</text>
        })}
        {n === 1 && <circle cx={x(0)} cy={y(values[0])} r={4} fill={color} />}
        {active !== null && (
          <g>
            <line className="crosshair" x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} />
            <circle cx={x(active)} cy={y(values[active])} r={5} fill={color} stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  )
}

const SLICE_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)']

/**
 * Anneau de répartition (moyens de paiement, dépenses par catégorie) : 6 parts au plus, les plus petites regroupées en
 * « Autres » ; total au centre ; la légende donne montant et part de chacune (elle sert de vue tableau).
 * `colors` fixe la couleur d'une clé (elle suit l'entité, pas son rang).
 */
export function Donut({ slices, format, label, centerLabel = 'Total', colors }: {
  slices: Slice[]; format: (v: number) => string; label: string; centerLabel?: string; colors?: Record<string, string>
}) {
  const [active, setActive] = useState<string | null>(null)
  const parts = foldSlices(slices, 6)
  if (!parts.length) return <p className="muted small chart-empty">Aucune donnée sur la période.</p>
  const total = parts.reduce((n, s) => n + s.value, 0)
  const angles = arcs(parts.map((s) => s.value))
  const color = (s: Slice, i: number) => (s.key === '__others' ? 'var(--faint)' : colors?.[s.key] ?? SLICE_COLORS[i % SLICE_COLORS.length])
  const shown = parts.find((s) => s.key === active)
  return (
    <div className={active ? 'donut focus' : 'donut'}>
      <svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label={label} onMouseLeave={() => setActive(null)}>
        {parts.map((s, i) => (
          <path key={s.key} className={active === s.key ? 'on' : undefined} d={ringPath(80, 80, 76, 50, angles[i].start, angles[i].end)} fill={color(s, i)}
            onMouseEnter={() => setActive(s.key)} onClick={() => setActive(s.key)}>
            <title>{`${s.label} : ${format(s.value)} (${Math.round(angles[i].share * 100)} %)`}</title>
          </path>
        ))}
        <text x="80" y="74" textAnchor="middle" className="donut-label">{shown ? shown.label : centerLabel}</text>
        <text x="80" y="94" textAnchor="middle" className="donut-value">{format(shown ? shown.value : total)}</text>
      </svg>
      <ul className="donut-legend">
        {parts.map((s, i) => (
          <li key={s.key} className={active === s.key ? 'on' : undefined} onMouseEnter={() => setActive(s.key)} onMouseLeave={() => setActive(null)}>
            <i style={{ background: color(s, i) }} />
            <span className="grow">{s.label}</span>
            <strong>{format(s.value)}</strong>
            <span className="muted small share">{Math.round(angles[i].share * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
