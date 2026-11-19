// Ventes de tous les postes (reçues par le serveur) : liste filtrable avec payé / dû, et détail d'un ticket.
import { useState } from 'react'
import { api, ApiError, qs } from '../api/client'
import { METHOD_LABELS, REASON_LABELS, type SaleDetail, type SaleList, type SaleRow } from '../api/types'
import { PAGE_SIZE, Pager } from '../components/Pager'
import { PeriodPicker } from '../components/PeriodPicker'
import { Badge, Button, Empty, ErrorBox, Icon, Loading, Modal, PageHeader, Panel, SearchInput } from '../components/ui'
import { csvMad, downloadCsv, toCsv } from '../lib/csv'
import { formatDateTime, formatMad, formatQuantity } from '../lib/format'
import { go, useApp, useDebounced, useLoad } from '../lib/hooks'
import { periodRange } from '../lib/period'

type Filter = '' | 'due' | 'cancelled' | 'warning'
const FILTERS: [Filter, string][] = [['', 'Toutes'], ['due', 'À crédit'], ['cancelled', 'Annulées'], ['warning', 'À vérifier']]

export function SalesPage() {
  const { storeId, period, timeZone } = useApp()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('')
  const [offset, setOffset] = useState(0)
  const q = useDebounced(search)
  const range = periodRange(period, timeZone)
  const params = { store_id: storeId, ...range, search: q, due: filter === 'due', warning: filter === 'warning', status: filter === 'cancelled' ? 'cancelled' : '' }
  const { data, error, loading, reload } = useLoad(
    () => api.get<SaleList>(`/admin/sales${qs({ ...params, limit: PAGE_SIZE, offset })}`),
    JSON.stringify([params, offset]),
  )
  const [exporting, setExporting] = useState(false)

  async function exportCsv() {
    setExporting(true)
    try {
      const all = await api.get<SaleList>(`/admin/sales${qs({ ...params, limit: 500 })}`)
      downloadCsv(`ventes-${period.start}-${period.end}.csv`, toCsv(
        ['Numéro', 'Date', 'Magasin', 'Caisse', 'Caissier', 'Client', 'Statut', 'Total TTC', 'Payé', 'Dû', 'Remboursé', 'Paiements'],
        all.rows.map((s) => [s.number, formatDateTime(s.created_at, timeZone), s.store_name, s.register_name, s.cashier_name, s.customer_name,
          s.status === 'cancelled' ? 'Annulée' : 'Encaissée', csvMad(s.total_ttc), csvMad(s.paid), csvMad(s.due), csvMad(s.refunded_ttc),
          s.methods.map((m) => METHOD_LABELS[m]).join(' + ')]),
      ))
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader title="Ventes" subtitle="Tickets reçus de toutes les caisses." actions={
        <Button icon="download" busy={exporting} disabled={!data?.total} onClick={exportCsv}>Exporter</Button>
      } />
      <PeriodPicker />
      <div className="toolbar">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setOffset(0) }} placeholder="Numéro de ticket ou client" />
        <div className="chips">
          {FILTERS.map(([f, label]) => (
            <button key={f} type="button" className={`chip${filter === f ? ' on' : ''}`} onClick={() => { setFilter(f); setOffset(0) }}>{label}</button>
          ))}
        </div>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      <Panel>
        {!data ? loading && <Loading /> : data.rows.length === 0 ? <Empty>Aucune vente pour ces critères.</Empty> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Ticket</th><th>Date</th><th>Magasin</th><th>Caissier</th><th>Client</th><th className="num">Total</th>
                  <th className="num">Payé</th><th className="num">Dû</th><th>Statut</th>
                </tr></thead>
                <tbody>
                  {data.rows.map((s) => <SaleTr key={s.id} s={s} timeZone={timeZone} />)}
                </tbody>
                <tfoot><tr>
                  <td colSpan={5}>{data.total.toLocaleString('fr-FR')} vente(s) · hors annulées</td>
                  <td className="num">{formatMad(data.sums.ttc)}</td><td className="num">{formatMad(data.sums.paid)}</td>
                  <td className="num">{formatMad(data.sums.due)}</td><td />
                </tr></tfoot>
              </table>
            </div>
            <Pager offset={offset} total={data.total} onChange={setOffset} />
          </>
        )}
      </Panel>
    </>
  )
}

export function SaleTr({ s, timeZone, showStore = true }: { s: SaleRow; timeZone: string; showStore?: boolean }) {
  const flagged = s.warnings.price || s.warnings.approval || s.warnings.session_closed
  return (
    <tr className={`clickable${s.status === 'cancelled' ? ' inactive' : ''}`} onClick={() => go(`/ventes/${s.id}`)}>
      <td className="nowrap"><a href={`#/ventes/${s.id}`} onClick={(e) => e.stopPropagation()}>{s.number}</a>{flagged && <> <Icon name="alert" size={14} /></>}</td>
      <td className="nowrap">{formatDateTime(s.created_at, timeZone)}</td>
      {showStore && <td>{s.store_name}<span className="sub">{s.register_name}</span></td>}
      <td>{s.cashier_name}</td>
      <td>{s.customer_name ?? <span className="muted">—</span>}</td>
      <td className="num">{formatMad(s.total_ttc)}{s.refunded_ttc > 0 && <span className="sub">− {formatMad(s.refunded_ttc)} remboursé</span>}</td>
      <td className="num">{formatMad(s.paid)}</td>
      <td className="num">{s.due ? <strong>{formatMad(s.due)}</strong> : '—'}</td>
      <td>{s.status === 'cancelled' ? <Badge tone="red">Annulée</Badge> : s.due ? <Badge tone="amber">Crédit</Badge> : <Badge tone="green">Payée</Badge>}</td>
    </tr>
  )
}

export function SalePage({ id }: { id: string }) {
  const { timeZone, notify } = useApp()
  const { data, error, loading, reload } = useLoad(() => api.get<SaleDetail>(`/admin/sales/${encodeURIComponent(id)}`), id)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  async function cancel() {
    setBusy(true)
    setCancelError(null)
    try {
      await api.post(`/sales/${encodeURIComponent(id)}/cancel`)
      setConfirm(false)
      notify('Vente annulée, stock remis.')
      reload()
    } catch (e) {
      setCancelError(e instanceof ApiError ? e.message : 'Annulation impossible.')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <><PageHeader title="Vente" back="#/ventes" /><ErrorBox error={error} onRetry={reload} /></>
  if (!data) return loading ? <Loading /> : null
  const s = data.sale
  const paid = s.payments.reduce((n, p) => n + p.amount, 0)
  const refunded = data.refunds.reduce((n, r) => n + r.totals.ttc, 0)
  const canCancel = s.status === 'completed' && data.refunds.length === 0

  return (
    <>
      <PageHeader title={`Ticket ${s.number}`} back="#/ventes"
        subtitle={<>{formatDateTime(s.created_at, timeZone)} · {data.store?.name} · {data.register?.name}</>}
        actions={<>
          <Button icon="print" onClick={() => window.print()}>Imprimer</Button>
          {canCancel && <Button icon="x" variant="danger" onClick={() => setConfirm(true)}>Annuler la vente</Button>}
        </>} />
      {s.status === 'cancelled' && <p className="alert"><Icon name="x" />Vente annulée le {formatDateTime(data.cancelled_at, timeZone)} par {data.cancelled_by_name}. Le stock a été remis.</p>}
      {data.warnings.price && <p className="notice"><Icon name="alert" />Au moins un prix diffère du catalogue actuel (prix changé pendant une coupure, ou saisi à la main).</p>}
      {data.warnings.approval && <p className="notice"><Icon name="alert" />L’autorisation ({data.approved_by_name}) ne vient pas d’un responsable de ce magasin.</p>}
      {data.warnings.session_closed && <p className="notice"><Icon name="alert" />Vente reçue après la clôture de sa session.</p>}
      <div className="grid">
        <Panel title="Ticket">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Article</th><th className="num">Qté</th><th className="num">Prix</th><th className="num">Remise</th><th className="num">TVA</th><th className="num">Total</th></tr></thead>
              <tbody>
                {s.lines.map((l, i) => (
                  <tr key={l.id ?? i}>
                    <td>{l.name}</td><td className="num">{formatQuantity(l.quantity, l.unit)}</td><td className="num">{formatMad(l.unit_price_ttc)}</td>
                    <td className="num">{l.discount ? `− ${formatMad(l.discount)}` : '—'}</td><td className="num">{l.tva_rate} %</td>
                    <td className="num">{formatMad(l.total_ttc)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {s.global_discount > 0 && <tr><td colSpan={5}>Remise globale</td><td className="num">− {formatMad(s.global_discount)}</td></tr>}
                {s.other_charges > 0 && <tr><td colSpan={5}>Autres charges</td><td className="num">{formatMad(s.other_charges)}</td></tr>}
                <tr><td colSpan={5}>Total TTC <span className="muted small">(HT {formatMad(s.totals.ht)} · TVA {formatMad(s.totals.tva)})</span></td><td className="num">{formatMad(s.totals.ttc)}</td></tr>
              </tfoot>
            </table>
          </div>
        </Panel>
        <Panel title="Encaissement">
          <dl className="kv">
            <dt>Caissier</dt><dd>{data.cashier_name}</dd>
            {data.approved_by_name && <><dt>Autorisé par</dt><dd>{data.approved_by_name}</dd></>}
            <dt>Client</dt><dd>{data.customer ? <a href={`#/clients/${data.customer.id}`}>{data.customer.name}</a> : '—'}</dd>
            {s.payments.map((p, i) => <PaymentRow key={i} label={METHOD_LABELS[p.method]} amount={p.amount} />)}
            {paid < s.totals.ttc && <><dt>Reste dû</dt><dd><strong>{formatMad(s.totals.ttc - paid)}</strong></dd></>}
            {s.amount_received > 0 && <><dt>Reçu en espèces</dt><dd>{formatMad(s.amount_received)} · rendu {formatMad(s.change_given)}</dd></>}
            <dt>Reçue par le serveur</dt><dd>{formatDateTime(data.received_at, timeZone)}</dd>
          </dl>
        </Panel>
      </div>
      {data.refunds.length > 0 && (
        <Panel title={`Retours (${formatMad(refunded)})`}>
          <ul className="list">
            {data.refunds.map((r) => (
              <li key={r.id}>
                <Icon name="undo" />
                <span className="grow"><strong>{r.number}</strong> · {formatDateTime(r.created_at, timeZone)} · {REASON_LABELS[r.reason] ?? r.reason}{r.reason_text ? ` (${r.reason_text})` : ''}
                  <span className="sub muted small">{r.lines.map((l) => `${formatQuantity(l.quantity, l.unit)} × ${l.name}`).join(', ')} · {r.payments.map((p) => METHOD_LABELS[p.method]).join(' + ')}</span></span>
                <strong className="num">− {formatMad(r.totals.ttc)}</strong>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {confirm && (
        <Modal title="Annuler cette vente ?" onClose={() => setConfirm(false)} footer={<>
          <Button onClick={() => setConfirm(false)}>Garder</Button>
          <Button variant="danger" icon="x" busy={busy} onClick={cancel}>Annuler la vente</Button>
        </>}>
          <p>Le ticket {s.number} ({formatMad(s.totals.ttc)}) sera marqué annulé et ses articles remis en stock. Cette action ne peut pas être défaite.</p>
          <p className="muted small">L’argent éventuellement encaissé n’est pas rendu automatiquement : faites-le à la caisse.</p>
          {cancelError && <p className="alert"><Icon name="alert" />{cancelError}</p>}
        </Modal>
      )}
    </>
  )
}

const PaymentRow = ({ label, amount }: { label: string; amount: number }) => <><dt>{label}</dt><dd>{formatMad(amount)}</dd></>
