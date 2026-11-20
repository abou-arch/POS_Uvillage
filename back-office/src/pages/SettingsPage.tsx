// Réglages (administrateur) : taux de TVA proposés pour les articles, fuseau horaire des rapports.
import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import type { Settings } from '../api/types'
import { Badge, Button, Field, Icon, PageHeader, Panel } from '../components/ui'
import { useApp } from '../lib/hooks'

export function SettingsPage() {
  const { me, reloadMe, notify } = useApp()
  const [rates, setRates] = useState(me.settings.tva_rates)
  const [newRate, setNewRate] = useState('')
  const [timeZone, setTimeZone] = useState(me.settings.timezone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rate = /^\d{1,3}$/.test(newRate) && Number(newRate) <= 100 ? Number(newRate) : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.put<Settings>('/admin/settings', { tva_rates: rates, timezone: timeZone.trim() })
      await reloadMe()
      notify('Réglages enregistrés.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Réglages" />
      <form onSubmit={submit} className="grid">
        <Panel title="Taux de TVA">
          <div className="panel-body" style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <p className="notice"><Icon name="info" />Liste provisoire (20, 14, 10, 7, 0 %) : faites-la valider par votre comptable.</p>
            <div className="checks">
              {rates.map((r) => (
                <Badge key={r} tone="blue">{r} %
                  <button type="button" className="link" aria-label={`Retirer ${r} %`} onClick={() => setRates((x) => x.filter((y) => y !== r))}><Icon name="x" size={12} /></button>
                </Badge>
              ))}
            </div>
            <div className="toolbar">
              <input inputMode="numeric" value={newRate} placeholder="Taux en %" aria-label="Nouveau taux" style={{ width: 120 }} onChange={(e) => setNewRate(e.target.value)} />
              <Button small icon="plus" disabled={rate === null || rates.includes(rate)} onClick={() => { if (rate !== null) setRates((x) => [...x, rate].sort((a, b) => b - a)); setNewRate('') }}>Ajouter</Button>
            </div>
            <p className="muted small">Un taux encore porté par un article ne peut pas être retiré : changez d’abord ces articles.</p>
          </div>
        </Panel>
        <Panel title="Fuseau horaire">
          <div className="panel-body form">
            <Field label="Fuseau des rapports et des listes" hint="Une vente à 23h30 UTC compte le lendemain à Casablanca." wide>
              <input value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="Africa/Casablanca" />
            </Field>
          </div>
        </Panel>
        <div className="form-actions">
          {error && <p className="alert"><Icon name="alert" />{error}</p>}
          <Button type="submit" variant="primary" icon="check" busy={busy} disabled={rates.length === 0 || !timeZone.trim()}>Enregistrer</Button>
        </div>
      </form>
    </>
  )
}
