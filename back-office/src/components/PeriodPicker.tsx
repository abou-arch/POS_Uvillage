// Choix de la période : préréglages, ou deux dates (366 jours au plus).
import { useState } from 'react'
import { useApp } from '../lib/hooks'
import { customPeriod, PRESET_LABELS, presetPeriod, type Preset } from '../lib/period'

const PRESETS: Exclude<Preset, 'custom'>[] = ['today', 'yesterday', '7d', '30d', 'month', 'last-month']

export function PeriodPicker() {
  const { period, setPeriod, timeZone } = useApp()
  const [start, setStart] = useState(period.start)
  const [end, setEnd] = useState(period.end)
  const custom = customPeriod(start, end)
  return (
    <div className="period">
      <div className="chips" role="group" aria-label="Période">
        {PRESETS.map((p) => (
          <button key={p} type="button" className={`chip${period.preset === p ? ' on' : ''}`} aria-pressed={period.preset === p}
            onClick={() => {
              const next = presetPeriod(p, new Date(), timeZone)
              setPeriod(next)
              setStart(next.start)
              setEnd(next.end)
            }}>
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>
      <form className="dates" onSubmit={(e) => { e.preventDefault(); if (custom) setPeriod(custom) }}>
        <input type="date" value={start} aria-label="Du" onChange={(e) => setStart(e.target.value)} />
        <span className="muted">au</span>
        <input type="date" value={end} aria-label="Au" onChange={(e) => setEnd(e.target.value)} />
        <button type="submit" className={`chip${period.preset === 'custom' ? ' on' : ''}`} disabled={!custom}
          title={custom ? undefined : 'Dates dans l’ordre, 366 jours au plus'}>
          Appliquer
        </button>
      </form>
    </div>
  )
}
