// Tableau de bord : chiffre de la période et comparaison, courbe des ventes, moyens de paiement, meilleurs articles,
// alertes (stock, sessions ouvertes, opérations à vérifier, clients qui doivent de l'argent).
import { api, qs } from '../api/client'
import { METHOD_LABELS, type Dashboard } from '../api/types'
import { Columns, HBars } from '../components/charts'
import { PeriodPicker } from '../components/PeriodPicker'
import { Badge, Empty, ErrorBox, Icon, Loading, PageHeader, Panel, Stat } from '../components/ui'
import { formatDateTime, formatDay, formatMad, formatQuantity, variation } from '../lib/format'
import { useApp, useLoad } from '../lib/hooks'
import { periodLabel, periodRange } from '../lib/period'

export function DashboardPage() {
  const { storeId, period, timeZone, me } = useApp()
  const range = periodRange(period, timeZone)
  const { data, error, loading, reload } = useLoad(
    () => api.get<Dashboard>(`/admin/dashboard${qs({ store_id: storeId, ...range })}`),
    `${storeId}|${range.from}|${range.to}`,
  )
  const storeName = storeId ? me.stores.find((s) => s.id === storeId)?.name : 'Tous les magasins'

  return (
    <>
      <PageHeader title="Tableau de bord" subtitle={`${storeName} · ${periodLabel(period)}`} />
      <PeriodPicker />
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {!data ? (loading && <Loading />) : <DashboardBody d={data} timeZone={timeZone} multiStore={!storeId && me.stores.length > 1} />}
    </>
  )
}

function DashboardBody({ d, timeZone, multiStore }: { d: Dashboard; timeZone: string; multiStore: boolean }) {
  const s = d.report.summary
  const p = d.previous.summary
  const warnings = d.warnings.price + d.warnings.approval + d.warnings.session_closed + d.warnings.expected_mismatch
  const days = d.report.by_day
  const hourly = days.length <= 1
  return (
    <>
      <div className="stats">
        <Stat label="Chiffre d’affaires net (TTC)" value={formatMad(s.net_ttc)} delta={variation(s.net_ttc, p.net_ttc)} />
        <Stat label="Tickets" value={s.sales_count.toLocaleString('fr-FR')} delta={variation(s.sales_count, p.sales_count)} />
        <Stat label="Panier moyen" value={formatMad(s.average_basket)} delta={variation(s.average_basket, p.average_basket)} />
        <Stat label="Retours" value={formatMad(s.refunds_ttc)} tone={s.refunds_ttc ? 'red' : undefined} hint={`${s.refunds_count} retour(s)`} />
        <Stat label="Vendu à crédit" value={formatMad(s.credit_given)} tone={s.credit_given ? 'amber' : undefined}
          hint={`Reste dû total : ${formatMad(d.customers_due.total)}`} />
        <Stat label="Marge brute" value={s.margin === null ? '—' : formatMad(s.margin)}
          hint={s.margin === null ? 'Prix d’achat manquant pour certains articles' : `TVA collectée : ${formatMad(s.net_tva)}`} />
      </div>

      <div className="grid">
        <Panel title={hourly ? 'Ventes par heure' : 'Ventes par jour'} className="span-2">
          {s.sales_count === 0 && s.refunds_count === 0 ? <Empty>Aucune vente sur la période.</Empty> : hourly
            ? <Columns legend={['Ventes TTC']} data={Array.from({ length: 24 }, (_, h) => {
              const x = d.report.by_hour.find((r) => r.hour === h)
              return { key: String(h), label: `${h}h`, value: x?.sales_ttc ?? 0, title: `${h}h : ${formatMad(x?.sales_ttc ?? 0)} · ${x?.sales_count ?? 0} ticket(s)` }
            })} />
            : <Columns legend={['Ventes TTC', 'Retours']} data={days.map((x) => ({
              key: x.day, label: formatDay(x.day).slice(0, 5), value: x.sales_ttc, secondary: x.refunds_ttc,
              title: `${formatDay(x.day)} : ${formatMad(x.sales_ttc)} · ${x.sales_count} ticket(s)${x.refunds_ttc ? ` · retours ${formatMad(x.refunds_ttc)}` : ''}`,
            }))} />}
        </Panel>
        <Panel title="Moyens de paiement (net)">
          <HBars data={d.report.by_method.map((m) => ({ key: m.method, label: METHOD_LABELS[m.method], value: m.net,
            sub: m.refunds ? `retours ${formatMad(m.refunds)}` : undefined }))} empty="Aucun paiement." />
        </Panel>
      </div>

      <div className="grid">
        <Panel title="Meilleurs articles" actions={<a href="#/rapports" className="link">Rapports</a>}>
          <HBars data={d.report.by_product.slice(0, 8).map((x) => ({ key: x.product_id, label: x.name, sub: formatQuantity(x.quantity), value: x.ttc }))}
            empty="Aucun article vendu." />
        </Panel>
        {multiStore ? (
          <Panel title="Par magasin">
            <HBars data={d.report.by_store.map((x) => ({ key: x.store_id, label: x.name, value: x.sales_ttc - x.refunds_ttc, sub: `${x.sales_count} ticket(s)` }))} />
          </Panel>
        ) : (
          <Panel title="Par caissier">
            <HBars data={d.report.by_cashier.map((x) => ({ key: x.user_id, label: x.name, value: x.sales_ttc, sub: `${x.sales_count} ticket(s)` }))} empty="Aucune vente." />
          </Panel>
        )}
      </div>

      <div className="grid three">
        <Panel title="Stock bas" actions={<Badge tone={d.stock_alerts.count ? 'amber' : 'green'}>{d.stock_alerts.count}</Badge>}>
          {d.stock_alerts.items.length === 0 ? <Empty icon="check">Aucun article sous son seuil.</Empty> : (
            <ul className="list">
              {d.stock_alerts.items.slice(0, 8).map((a) => (
                <li key={`${a.product_id}-${a.store_id}`}>
                  <span className="grow"><a href={`#/articles/${a.product_id}`}>{a.name}</a><span className="sub muted small"> · {a.store_name}</span></span>
                  <Badge tone={a.stock <= 0 ? 'red' : 'amber'}>{formatQuantity(a.stock, a.unit)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Sessions ouvertes" actions={<a href="#/sessions" className="link">Toutes</a>}>
          {d.open_sessions.length === 0 ? <Empty>Aucune caisse ouverte.</Empty> : (
            <ul className="list">
              {d.open_sessions.map((x) => (
                <li key={x.id}>
                  <Icon name="register" />
                  <span className="grow"><a href={`#/sessions/${x.id}`}>{x.register_name ?? x.register_id}</a>
                    <span className="sub muted small"> · {x.opened_by_name} · depuis {formatDateTime(x.opened_at, timeZone)}</span></span>
                  <span className="num">{formatMad(x.expected.cash)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="À vérifier" actions={<Badge tone={warnings ? 'amber' : 'green'}>{warnings}</Badge>}>
          <ul className="list">
            <Warning n={d.warnings.price} label="Ventes à un prix différent du catalogue" href="#/ventes" />
            <Warning n={d.warnings.approval} label="Autorisations par un non-responsable" href="#/ventes" />
            <Warning n={d.warnings.session_closed} label="Opérations reçues après la clôture" href="#/ventes" />
            <Warning n={d.warnings.expected_mismatch} label="Clôtures aux attendus différents" href="#/sessions" />
          </ul>
        </Panel>
      </div>

      {d.customers_due.top.length > 0 && (
        <Panel title={`Clients qui doivent de l’argent (${d.customers_due.count})`} actions={<a href="#/clients" className="link">Clients</a>}>
          <ul className="list">
            {d.customers_due.top.map((c) => (
              <li key={c.id}>
                <Icon name="user" />
                <span className="grow"><a href={`#/clients/${c.id}`}>{c.name}</a>{c.phone && <span className="sub muted small"> · {c.phone}</span>}</span>
                <strong className="num">{formatMad(c.balance)}</strong>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  )
}

function Warning({ n, label, href }: { n: number; label: string; href: string }) {
  return (
    <li>
      <Icon name={n ? 'alert' : 'check'} />
      <span className="grow">{n ? <a href={href}>{label}</a> : <span className="muted">{label}</span>}</span>
      <Badge tone={n ? 'amber' : 'neutral'}>{n}</Badge>
    </li>
  )
}
