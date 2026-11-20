// Rapports de la période : résumé, TVA par taux (pour le comptable), ventes par jour, article, catégorie, caissier,
// moyen de paiement. Export CSV de chaque tableau et impression.
import type { ReactNode } from 'react'
import { api, qs } from '../api/client'
import { METHOD_LABELS, type Report } from '../api/types'
import { PeriodPicker } from '../components/PeriodPicker'
import { Button, Empty, ErrorBox, Loading, PageHeader, Panel, Stat } from '../components/ui'
import { csvMad, downloadCsv, toCsv, type Cell } from '../lib/csv'
import { formatDay, formatMad, formatQuantity, plural } from '../lib/format'
import { useApp, useLoad } from '../lib/hooks'
import { periodLabel, periodRange } from '../lib/period'

export function ReportsPage() {
  const { storeId, period, timeZone, me } = useApp()
  const range = periodRange(period, timeZone)
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ report: Report }>(`/admin/reports${qs({ store_id: storeId, ...range })}`),
    `${storeId}|${range.from}|${range.to}`,
  )
  const storeName = storeId ? me.stores.find((s) => s.id === storeId)?.name : 'Tous les magasins'
  const file = (name: string) => `${name}-${period.start}-${period.end}.csv`
  return (
    <>
      <PageHeader title="Rapports" subtitle={`${storeName} · ${periodLabel(period)} · ventes annulées exclues, retours déduits`}
        actions={<Button icon="print" onClick={() => window.print()}>Imprimer</Button>} />
      <div className="no-print"><PeriodPicker /></div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {!data ? loading && <Loading /> : <Body r={data.report} file={file} />}
    </>
  )
}

function Body({ r, file }: { r: Report; file: (name: string) => string }) {
  const s = r.summary
  if (s.sales_count === 0 && s.refunds_count === 0) return <Empty>Aucune vente sur la période.</Empty>
  return (
    <>
      <div className="stats">
        <Stat label="Ventes TTC" value={formatMad(s.sales_ttc)} hint={`${plural(s.sales_count, 'ticket')} · panier moyen ${formatMad(s.average_basket)}`} />
        <Stat label="Retours" value={formatMad(s.refunds_ttc)} tone={s.refunds_ttc ? 'red' : undefined} hint={plural(s.refunds_count, 'retour')} />
        <Stat label="Net TTC" value={formatMad(s.net_ttc)} hint={`HT ${formatMad(s.net_ht)} · TVA ${formatMad(s.net_tva)}`} />
        <Stat label="Remises accordées" value={formatMad(s.discounts)} />
        <Stat label="Vendu à crédit" value={formatMad(s.credit_given)} tone={s.credit_given ? 'amber' : undefined} />
        <Stat label="Marge brute" value={s.margin === null ? '—' : formatMad(s.margin)} hint={s.margin === null ? 'Prix d’achat manquant' : 'TTC − prix d’achat'} />
        {s.cancelled_count > 0 && <Stat label="Ventes annulées" value={s.cancelled_count} tone="red" hint={formatMad(s.cancelled_ttc)} />}
      </div>

      <Table title="TVA par taux" file={file('tva')} head={['Taux', 'HT', 'TVA', 'TTC']} num={[1, 2, 3]}
        rows={r.vat.map((v) => [`${v.rate} %`, v.ht, v.tva, v.ttc])} money={[1, 2, 3]}
        foot={['Total', r.vat.reduce((n, v) => n + v.ht, 0), r.vat.reduce((n, v) => n + v.tva, 0), r.vat.reduce((n, v) => n + v.ttc, 0)]} />

      <div className="grid">
        <Table title="Par moyen de paiement" file={file('paiements')} head={['Moyen', 'Ventes', 'Remboursé', 'Net']} num={[1, 2, 3]} money={[1, 2, 3]}
          rows={r.by_method.map((m) => [METHOD_LABELS[m.method], m.sales, m.refunds, m.net])} />
        <Table title="Par caissier" file={file('caissiers')} head={['Caissier', 'Tickets', 'Ventes TTC']} num={[1, 2]} money={[2]}
          rows={r.by_cashier.map((c) => [c.name, c.sales_count, c.sales_ttc])} />
      </div>

      <Table title="Par jour" file={file('jours')} head={['Jour', 'Tickets', 'Ventes TTC', 'Retours', 'Net']} num={[1, 2, 3, 4]} money={[2, 3, 4]}
        rows={r.by_day.map((d) => [formatDay(d.day), d.sales_count, d.sales_ttc, d.refunds_ttc, d.sales_ttc - d.refunds_ttc])} />

      <div className="grid">
        <Table title="Par catégorie" file={file('categories')} head={['Catégorie', 'Net TTC']} num={[1]} money={[1]}
          rows={r.by_category.map((c) => [c.name, c.ttc])} />
        {r.by_store.length > 1 && <Table title="Par magasin" file={file('magasins')} head={['Magasin', 'Tickets', 'Ventes', 'Retours']} num={[1, 2, 3]} money={[2, 3]}
          rows={r.by_store.map((x) => [x.name, x.sales_count, x.sales_ttc, x.refunds_ttc])} />}
      </div>

      <Table title="Par article (net des retours)" file={file('articles')} head={['Code', 'Article', 'Quantité', 'Net TTC', 'Coût', 'Marge']} num={[2, 3, 4, 5]} money={[3, 4, 5]}
        rows={r.by_product.map((p) => [p.code, p.name, p.quantity, p.ttc, p.cost, p.margin])} quantity={[2]} />
    </>
  )
}

/** Tableau avec export CSV ; `money` = colonnes en centimes, `quantity` = quantités. */
function Table({ title, file, head, rows, foot, num = [], money = [], quantity = [] }: {
  title: string; file: string; head: string[]; rows: (string | number)[][]; foot?: (string | number)[]; num?: number[]; money?: number[]; quantity?: number[]
}) {
  const show = (v: string | number, i: number): ReactNode => (typeof v === 'number' && money.includes(i) ? formatMad(v)
    : typeof v === 'number' && quantity.includes(i) ? formatQuantity(v) : v)
  const csv = (v: string | number, i: number): Cell => (typeof v === 'number' && money.includes(i) ? csvMad(v)
    : typeof v === 'number' ? String(v).replace('.', ',') : v)
  return (
    <Panel title={title} actions={rows.length > 0 && (
      <span className="no-print"><Button small icon="download" onClick={() => downloadCsv(file, toCsv(head, [...rows, ...(foot ? [foot] : [])].map((r) => r.map(csv))))}>CSV</Button></span>
    )}>
      {rows.length === 0 ? <Empty>Aucune donnée.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr>{head.map((h, i) => <th key={h} className={num.includes(i) ? 'num' : undefined}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, j) => <tr key={j}>{r.map((v, i) => <td key={i} className={num.includes(i) ? 'num' : undefined}>{show(v, i)}</td>)}</tr>)}</tbody>
            {foot && <tfoot><tr>{foot.map((v, i) => <td key={i} className={num.includes(i) ? 'num' : undefined}>{show(v, i)}</td>)}</tr></tfoot>}
          </table>
        </div>
      )}
    </Panel>
  )
}
