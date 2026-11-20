// Retours reçus de toutes les caisses, avec le ticket d'origine et le motif.
import { useState } from 'react'
import { api, qs } from '../api/client'
import { METHOD_LABELS, REASON_LABELS, type RefundRow } from '../api/types'
import { PAGE_SIZE, Pager } from '../components/Pager'
import { PeriodPicker } from '../components/PeriodPicker'
import { Badge, Empty, ErrorBox, Icon, Loading, PageHeader, Panel } from '../components/ui'
import { formatDateTime, formatMad, plural } from '../lib/format'
import { useApp, useLoad } from '../lib/hooks'
import { periodRange } from '../lib/period'

export function RefundsPage() {
  const { storeId, period, timeZone } = useApp()
  const [offset, setOffset] = useState(0)
  const range = periodRange(period, timeZone)
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ total: number; sums: { ttc: number }; rows: RefundRow[] }>(`/admin/refunds${qs({ store_id: storeId, ...range, limit: PAGE_SIZE, offset })}`),
    JSON.stringify([storeId, range, offset]),
  )
  return (
    <>
      <PageHeader title="Retours" subtitle="Articles rapportés et remboursés en caisse." />
      <PeriodPicker />
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      <Panel>
        {!data ? loading && <Loading /> : data.rows.length === 0 ? <Empty>Aucun retour sur la période.</Empty> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Retour</th><th>Date</th><th>Ticket d’origine</th><th>Magasin</th><th>Caissier</th><th>Client</th><th>Motif</th><th>Rendu en</th><th className="num">Montant</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="nowrap">{r.number}{r.approval_warning && <> <Icon name="alert" size={14} /></>}</td>
                      <td className="nowrap">{formatDateTime(r.created_at, timeZone)}</td>
                      <td><a href={`#/ventes/${r.sale_id}`}>{r.sale_number}</a></td>
                      <td>{r.store_name}</td><td>{r.cashier_name}</td><td>{r.customer_name ?? <span className="muted">—</span>}</td>
                      <td><Badge>{REASON_LABELS[r.reason] ?? r.reason}</Badge>{r.reason_text && <span className="sub">{r.reason_text}</span>}</td>
                      <td>{r.payments.map((p) => METHOD_LABELS[p.method]).join(' + ')}</td>
                      <td className="num">{formatMad(r.total_ttc)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={8}>{plural(data.total, 'retour')}</td><td className="num">{formatMad(data.sums.ttc)}</td></tr></tfoot>
              </table>
            </div>
            <Pager offset={offset} total={data.total} onChange={setOffset} />
          </>
        )}
      </Panel>
    </>
  )
}
