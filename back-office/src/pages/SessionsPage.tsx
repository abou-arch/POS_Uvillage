// Sessions de caisse : ouvertures, comptages et écarts de clôture ; clôture depuis le back-office d'un poste en panne.
import { useState } from 'react'
import { api, ApiError, qs } from '../api/client'
import { METHOD_LABELS, type SaleList, type Session, type SessionDetail } from '../api/types'
import { PeriodPicker } from '../components/PeriodPicker'
import { Badge, Button, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Panel } from '../components/ui'
import { formatDateTime, formatMad } from '../lib/format'
import { go, useApp, useLoad } from '../lib/hooks'
import { periodRange } from '../lib/period'
import { SaleTr } from './SalesPage'

export function SessionsPage() {
  const { storeId, period, timeZone } = useApp()
  const [status, setStatus] = useState<'' | 'open' | 'closed'>('')
  const range = periodRange(period, timeZone)
  const { data, error, loading, reload } = useLoad(
    () => api.get<Session[]>(`/admin/cash-sessions${qs({ store_id: storeId, ...range, status, limit: 500 })}`),
    JSON.stringify([storeId, range, status]),
  )
  return (
    <>
      <PageHeader title="Sessions de caisse" subtitle="Fond de caisse, comptage et écart de chaque session (ouvertes sur la période)." />
      <PeriodPicker />
      <div className="chips">
        {([['', 'Toutes'], ['open', 'Ouvertes'], ['closed', 'Clôturées']] as const).map(([s, label]) => (
          <button key={s} type="button" className={`chip${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>{label}</button>
        ))}
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      <Panel>
        {!data ? loading && <Loading /> : data.length === 0 ? <Empty>Aucune session sur la période.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Caisse</th><th>Ouverte</th><th>Par</th><th>Clôturée</th><th className="num">Fond</th><th className="num">Espèces attendues</th><th className="num">Écart</th><th>État</th></tr></thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => go(`/sessions/${s.id}`)}>
                    <td><a href={`#/sessions/${s.id}`} onClick={(e) => e.stopPropagation()}>{s.register_name}</a><span className="sub">{s.store_name}</span></td>
                    <td className="nowrap">{formatDateTime(s.opened_at, timeZone)}</td>
                    <td>{s.opened_by_name}</td>
                    <td className="nowrap">{s.closed_at ? formatDateTime(s.closed_at, timeZone) : '—'}</td>
                    <td className="num">{formatMad(s.opening_cash)}</td>
                    <td className="num">{s.api_expected ? formatMad(s.api_expected.cash) : '—'}</td>
                    <td className="num"><Difference value={s.difference} /></td>
                    <td><SessionBadge s={s} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

function Difference({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>
  if (value === 0) return <Badge tone="green">0</Badge>
  return <Badge tone={value < 0 ? 'red' : 'amber'}>{value > 0 ? '+' : ''}{formatMad(value)}</Badge>
}

function SessionBadge({ s }: { s: Session }) {
  if (s.status === 'open') return <Badge tone="blue">Ouverte</Badge>
  if (s.forced) return <Badge tone="amber">Clôturée au back-office</Badge>
  if (s.expected_mismatch) return <Badge tone="amber">Attendus différents</Badge>
  return <Badge tone="green">Clôturée</Badge>
}

export function SessionPage({ id }: { id: string }) {
  const { timeZone, notify } = useApp()
  const { data, error, loading, reload } = useLoad(() => api.get<SessionDetail>(`/admin/cash-sessions/${encodeURIComponent(id)}`), id)
  const [closing, setClosing] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)

  async function forceClose() {
    setBusy(true)
    setCloseError(null)
    try {
      await api.post(`/admin/cash-sessions/${encodeURIComponent(id)}/force-close`, { note })
      setClosing(false)
      notify('Session clôturée.')
      reload()
    } catch (e) {
      setCloseError(e instanceof ApiError ? e.message : 'Clôture impossible.')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <><PageHeader title="Session" back="#/sessions" /><ErrorBox error={error} onRetry={reload} /></>
  if (!data) return loading ? <Loading /> : null
  const expected = data.api_expected
  return (
    <>
      <PageHeader title={`${data.register_name} · ${data.store_name}`} back="#/sessions"
        subtitle={<>Ouverte le {formatDateTime(data.opened_at, timeZone)} par {data.opened_by_name}{data.closed_at && <> · clôturée le {formatDateTime(data.closed_at, timeZone)} par {data.closed_by_name}</>}</>}
        actions={data.status === 'open' && <Button icon="lock" variant="danger" onClick={() => setClosing(true)}>Clôturer depuis le back-office</Button>} />
      {data.forced && <p className="notice"><Icon name="alert" />Clôturée depuis le back-office, sans comptage : {data.closing_note}</p>}
      {data.expected_mismatch && <p className="notice"><Icon name="alert" />Les attendus de la caisse diffèrent de ceux du serveur (ventes arrivées après la clôture ?).</p>}
      {data.approval_warning && <p className="notice"><Icon name="alert" />L’écart a été validé par quelqu’un qui n’est pas responsable de ce magasin.</p>}
      <div className="stats">
        <Panel><dl className="kv"><dt>Ventes</dt><dd>{data.sales.count} · {formatMad(data.sales.ttc)}</dd><dt>Annulées</dt><dd>{data.sales.cancelled}</dd>
          <dt>Retours</dt><dd>{data.refunds.count} · {formatMad(data.refunds.ttc)}</dd><dt>Fond de caisse</dt><dd>{formatMad(data.opening_cash)}</dd></dl></Panel>
      </div>
      <div className="grid">
        <Panel title="Comptage">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Moyen</th><th className="num">Attendu (serveur)</th>{data.counts && <><th className="num">Attendu (caisse)</th><th className="num">Compté</th><th className="num">Écart</th></>}</tr></thead>
              <tbody>
                {(['cash', 'card', 'mobile', 'qr'] as const).map((m) => {
                  const c = data.counts?.find((x) => x.method === m)
                  return (
                    <tr key={m}>
                      <td>{METHOD_LABELS[m]}</td>
                      <td className="num">{expected ? formatMad(expected[m]) : '—'}</td>
                      {data.counts && <><td className="num">{c ? formatMad(c.expected) : '—'}</td><td className="num">{c ? formatMad(c.counted) : '—'}</td>
                        <td className="num"><Difference value={c?.difference ?? null} /></td></>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {data.closing_note && !data.forced && <p className="panel-body muted">Note : {data.closing_note}</p>}
        </Panel>
        <Panel title="Entrées et sorties d’espèces">
          {data.movements.length === 0 ? <Empty>Aucun mouvement.</Empty> : (
            <ul className="list">
              {data.movements.map((m) => (
                <li key={m.id}>
                  <Badge tone={m.type === 'in' ? 'green' : 'amber'}>{m.type === 'in' ? 'Entrée' : 'Sortie'}</Badge>
                  <span className="grow">{m.reason}<span className="sub muted small"> · {m.created_by_name} · {formatDateTime(m.created_at, timeZone)}</span></span>
                  <strong className="num">{m.type === 'in' ? '+' : '−'} {formatMad(m.amount)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <SessionSales id={data.id} />
      {closing && (
        <Modal title="Clôturer cette session ?" onClose={() => setClosing(false)} footer={<>
          <Button onClick={() => setClosing(false)}>Annuler</Button>
          <Button variant="danger" icon="lock" busy={busy} disabled={!note.trim()} onClick={forceClose}>Clôturer</Button>
        </>}>
          <p>À utiliser quand le poste ne peut plus clôturer lui-même (panne, données effacées). Rien n’est compté : comptez le tiroir à part et notez-le ici.</p>
          <Field label="Motif (obligatoire)">
            <textarea rows={3} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Poste en panne, tiroir compté : 540 DH" />
          </Field>
          {closeError && <p className="alert"><Icon name="alert" />{closeError}</p>}
        </Modal>
      )}
    </>
  )
}

function SessionSales({ id }: { id: string }) {
  const { timeZone } = useApp()
  const { data, error, loading, reload } = useLoad(() => api.get<SaleList>(`/admin/sales${qs({ session_id: id, limit: 500 })}`), id)
  return (
    <Panel title={data ? `Ventes de la session (${data.total})` : 'Ventes de la session'}>
      {error ? <ErrorBox error={error} onRetry={reload} /> : !data ? loading && <Loading /> : data.rows.length === 0 ? <Empty>Aucune vente.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ticket</th><th>Date</th><th>Caissier</th><th>Client</th><th className="num">Total</th><th className="num">Payé</th><th className="num">Dû</th><th>Statut</th></tr></thead>
            <tbody>{data.rows.map((s) => <SaleTr key={s.id} s={s} timeZone={timeZone} showStore={false} />)}</tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
