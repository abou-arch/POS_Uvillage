// Tableau de bord, sur le modèle de celui de Falcon POS : totaux (achats dus, ventes dues, ventes, dépenses), chiffres
// du jour, effectifs, achats et ventes mois par mois, articles ajoutés récemment ; puis la période choisie (chiffre,
// courbe, moyens de paiement, dépenses, meilleurs articles) et les alertes (stock, sessions, à vérifier, clients).
import { useState, type ReactNode } from 'react'
import { api, qs } from '../api/client'
import { EXPENSE_LABELS, METHOD_LABELS, type Dashboard } from '../api/types'
import { AreaLine, Donut, GroupedBars, HBars, SignedBars } from '../components/charts'
import { PeriodPicker } from '../components/PeriodPicker'
import { Badge, Button, Empty, ErrorBox, Icon, Loading, PageHeader, Panel, Stat, type IconName } from '../components/ui'
import { compactMad, EXPENSE_COLORS, METHOD_COLORS, monthLabel } from '../lib/charts'
import { formatDateTime, formatDay, formatMad, formatQuantity, plural, variation } from '../lib/format'
import { useApp, useLoad } from '../lib/hooks'
import { periodLabel, periodRange } from '../lib/period'
const SERIES = { sales: { label: 'Ventes', color: 'var(--s1)' }, purchases: { label: 'Achats', color: 'var(--s2)' }, expenses: { label: 'Dépenses', color: 'var(--s3)' } }

export function DashboardPage() {
  const { storeId, period, timeZone, me } = useApp()
  const [year, setYear] = useState<number | null>(null)
  const range = periodRange(period, timeZone)
  const { data, error, loading, reload } = useLoad(
    () => api.get<Dashboard>(`/admin/dashboard${qs({ store_id: storeId, ...range, year: year ?? undefined })}`),
    `${storeId}|${range.from}|${range.to}|${year}`,
  )
  const storeName = storeId ? me.stores.find((s) => s.id === storeId)?.name : 'Tous les magasins'

  return (
    <>
      <PageHeader title="Tableau de bord" subtitle={`${storeName} · ${periodLabel(period)}`}
        actions={<Button icon="refresh" small onClick={reload} busy={loading && !!data}>Actualiser</Button>} />
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {!data ? (loading && <Loading />) : (
        <DashboardBody d={data} timeZone={timeZone} multiStore={!storeId && me.stores.length > 1}
          periodText={periodLabel(period)} onYear={(y) => setYear(y)} />
      )}
    </>
  )
}

/** Famille d'une tuile : sa couleur vient de styles.css (classes .fam-*). */
type Family = 'buy' | 'due' | 'sales' | 'expenses' | 'customers' | 'suppliers' | 'invoices' | 'tickets'

function IconTile({ icon, family, label, value, href }: { icon: IconName; family: Family; label: string; value: string; href?: string }) {
  const body = (
    <>
      <span className="tile-icon"><Icon name={icon} size={20} /></span>
      <span className="tile-body"><span className="tile-label">{label}</span><strong className="tile-value" title={value}>{value}</strong></span>
    </>
  )
  return href ? <a className={`tile fam-${family}`} href={href}>{body}</a> : <div className={`tile fam-${family}`}>{body}</div>
}

function CountTile({ icon, family, label, value, href, more }: { icon: IconName; family: Family; label: string; value: number; href: string; more: string }) {
  return (
    <a className={`count-tile fam-${family}`} href={href}>
      <span className="count-head"><span>{label}</span><Icon name={icon} size={18} /></span>
      <strong>{value.toLocaleString('fr-FR')}</strong>
      <span className="count-link">{more}<Icon name="arrowRight" size={14} /></span>
    </a>
  )
}

function DashboardBody({ d, timeZone, multiStore, periodText, onYear }: {
  d: Dashboard; timeZone: string; multiStore: boolean; periodText: string; onYear: (y: number) => void
}) {
  const o = d.overview
  const s = d.report.summary
  const p = d.previous.summary
  const warnings = d.warnings.price + d.warnings.approval + d.warnings.session_closed + d.warnings.expected_mismatch
  const months = o.monthly.months
  const monthLabels = months.map((m) => monthLabel(m.month))
  const monthTitles = months.map((m) => monthLabel(m.month, true))
  const result = months.map((m) => m.sales - m.purchases - m.expenses)
  const yearTotals = months.reduce((t, m) => ({ sales: t.sales + m.sales, purchases: t.purchases + m.purchases, expenses: t.expenses + m.expenses }),
    { sales: 0, purchases: 0, expenses: 0 })
  const yearEmpty = months.every((m) => !m.sales && !m.purchases && !m.expenses)
  const days = d.report.by_day
  const hourly = days.length <= 1
  const currentYear = Number(o.today.slice(0, 4))
  const yearNav = (
    <span className="year-nav">
      <Button small variant="ghost" icon="chevronLeft" title="Année précédente" disabled={o.monthly.year <= 2000} onClick={() => onYear(o.monthly.year - 1)} />
      {o.monthly.year}
      <Button small variant="ghost" icon="chevronRight" title="Année suivante" disabled={o.monthly.year >= currentYear} onClick={() => onYear(o.monthly.year + 1)} />
    </span>
  )

  return (
    <>
      <h2 className="section-title">Depuis le début</h2>
      <div className="tiles">
        <IconTile icon="bag" family="buy" label="Achats à payer" value={formatMad(o.totals.purchases_due)} href="#/achats" />
        <IconTile icon="wallet" family="due" label="Crédit clients à encaisser" value={formatMad(o.totals.sales_due)} href="#/clients" />
        <IconTile icon="cart" family="sales" label="Ventes nettes" value={formatMad(o.totals.sales)} href="#/ventes" />
        <IconTile icon="minus" family="expenses" label="Dépenses" value={formatMad(o.totals.expenses)} href="#/depenses" />
      </div>
      <h2 className="section-title">Aujourd’hui</h2>
      <div className="tiles">
        <IconTile icon="bag" family="buy" label="Achats facturés" value={formatMad(o.today_totals.purchases)} />
        <IconTile icon="wallet" family="due" label="Argent encaissé" value={formatMad(o.today_totals.received)} />
        <IconTile icon="cart" family="sales" label="Ventes nettes" value={formatMad(o.today_totals.sales)} />
        <IconTile icon="minus" family="expenses" label="Dépenses" value={formatMad(o.today_totals.expenses)} />
      </div>
      <div className="tiles">
        <CountTile icon="users" family="customers" label="Clients" value={o.counts.customers} href="#/clients" more="Voir les clients" />
        <CountTile icon="truck" family="suppliers" label="Fournisseurs" value={o.counts.suppliers} href="#/fournisseurs" more="Voir les fournisseurs" />
        <CountTile icon="invoice" family="invoices" label="Factures d’achat" value={o.counts.purchases} href="#/achats" more="Voir les factures" />
        <CountTile icon="receipt" family="tickets" label="Tickets de vente" value={o.counts.sales} href="#/ventes" more="Voir les ventes" />
      </div>

      <div className="grid split">
        <Panel title="Achats et ventes par mois" actions={yearNav}>
          {yearEmpty ? <Empty>Aucune vente, aucun achat ni dépense en {o.monthly.year}.</Empty> : (
            <GroupedBars label={`Ventes, achats et dépenses par mois en ${o.monthly.year}`} labels={monthLabels} titles={monthTitles}
              format={formatMad} axisFormat={compactMad} height={300}
              series={(['sales', 'purchases', 'expenses'] as const).map((k) => ({ key: k, ...SERIES[k], values: months.map((m) => m[k]) }))} />
          )}
        </Panel>
        <Panel title="Articles ajoutés récemment" actions={<a href="#/articles" className="link">Voir tout</a>}>
          {o.recent_products.length === 0 ? <Empty>Aucun article.</Empty> : (
            <div className="table-wrap">
              <table className="recent">
                <thead><tr><th className="num">N°</th><th>Article</th><th className="num">Prix de vente</th></tr></thead>
                <tbody>
                  {o.recent_products.map((x, i) => (
                    <tr key={x.id}>
                      <td className="num muted">{i + 1}</td>
                      <td title={`Ajouté le ${formatDateTime(x.added_at, timeZone)}`}><a href={`#/articles/${x.id}`}>{x.name}</a><span className="sub">{x.code}</span></td>
                      <td className="num">{formatMad(x.price_ttc)}{x.unit === 'kg' ? ' /kg' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid split">
        <Panel title={`Résultat par mois (ventes − achats − dépenses), ${o.monthly.year}`}>
          {yearEmpty ? <Empty>Aucun mouvement en {o.monthly.year}.</Empty> : (
            <SignedBars label={`Résultat mensuel ${o.monthly.year}`} labels={monthLabels} titles={monthTitles} values={result}
              format={formatMad} axisFormat={compactMad} positive="Excédent" negative="Déficit" />
          )}
        </Panel>
        <Panel title={`Bilan ${o.monthly.year}`}>
          <YearSummary totals={yearTotals} />
        </Panel>
      </div>

      <h2 className="section-title">Sur la période : {periodText}</h2>
      <PeriodPicker />
      <div className="stats">
        <Stat label="Chiffre d’affaires net (TTC)" value={formatMad(s.net_ttc)} delta={variation(s.net_ttc, p.net_ttc)} />
        <Stat label="Tickets" value={s.sales_count.toLocaleString('fr-FR')} delta={variation(s.sales_count, p.sales_count)} />
        <Stat label="Panier moyen" value={formatMad(s.average_basket)} delta={variation(s.average_basket, p.average_basket)} />
        <Stat label="Achats" value={formatMad(o.period.purchases)} hint="factures datées de la période" />
        <Stat label="Dépenses" value={formatMad(o.period.expenses)} tone={o.period.expenses ? 'red' : undefined} />
        <Stat label="Marge brute" value={s.margin === null ? '—' : formatMad(s.margin)}
          hint={s.margin === null ? 'Prix d’achat manquant pour certains articles' : `TVA collectée : ${formatMad(s.net_tva)}`} />
      </div>

      <div className="grid split">
        <Panel title={hourly ? 'Ventes par heure' : 'Ventes par jour'}>
          {s.sales_count === 0 && s.refunds_count === 0 ? <Empty>Aucune vente sur la période.</Empty> : hourly ? (
            <AreaLine label="Ventes TTC par heure" seriesLabel="Ventes TTC" format={formatMad} axisFormat={compactMad}
              labels={Array.from({ length: 24 }, (_, h) => `${h}h`)}
              titles={Array.from({ length: 24 }, (_, h) => {
                const x = d.report.by_hour.find((r) => r.hour === h)
                return `${h}h – ${h + 1}h · ${plural(x?.sales_count ?? 0, 'ticket')}`
              })}
              values={Array.from({ length: 24 }, (_, h) => d.report.by_hour.find((r) => r.hour === h)?.sales_ttc ?? 0)} />
          ) : (
            <AreaLine label="Ventes TTC par jour" seriesLabel="Ventes TTC" format={formatMad} axisFormat={compactMad}
              labels={days.map((x) => formatDay(x.day).slice(0, 5))}
              titles={days.map((x) => `${formatDay(x.day)} · ${plural(x.sales_count, 'ticket')}${x.refunds_ttc ? ` · retours ${formatMad(x.refunds_ttc)}` : ''}`)}
              values={days.map((x) => x.sales_ttc)} />
          )}
        </Panel>
        <Panel title="Moyens de paiement (net)">
          <Donut label="Répartition des moyens de paiement" format={formatMad} colors={METHOD_COLORS}
            slices={d.report.by_method.map((m) => ({ key: m.method, label: METHOD_LABELS[m.method], value: m.net }))} />
        </Panel>
      </div>

      <div className="grid">
        <Panel title="Dépenses par catégorie" actions={<a href="#/depenses" className="link">Dépenses</a>}>
          <Donut label="Dépenses de la période par catégorie" format={formatMad} colors={EXPENSE_COLORS}
            slices={o.period.expenses_by_category.map((c) => ({ key: c.category, label: EXPENSE_LABELS[c.category], value: c.amount }))} />
        </Panel>
        <Panel title="Meilleurs articles" actions={<a href="#/rapports" className="link">Rapports</a>}>
          <HBars data={d.report.by_product.slice(0, 8).map((x) => ({ key: x.product_id, label: x.name, sub: formatQuantity(x.quantity), value: x.ttc }))}
            empty="Aucun article vendu." />
        </Panel>
        {multiStore ? (
          <Panel title="Par magasin">
            <HBars data={d.report.by_store.map((x) => ({ key: x.store_id, label: x.name, value: x.sales_ttc - x.refunds_ttc, sub: plural(x.sales_count, 'ticket') }))} />
          </Panel>
        ) : (
          <Panel title="Par caissier">
            <HBars data={d.report.by_cashier.map((x) => ({ key: x.user_id, label: x.name, value: x.sales_ttc, sub: plural(x.sales_count, 'ticket') }))} empty="Aucune vente." />
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

function YearSummary({ totals }: { totals: { sales: number; purchases: number; expenses: number } }) {
  const result = totals.sales - totals.purchases - totals.expenses
  const row = (label: ReactNode, value: number, color?: string) => (
    <li>
      {color ? <i className="swatch" style={{ background: color }} /> : <Icon name="chart" size={14} />}
      <span className="grow">{label}</span><strong className="num">{formatMad(value)}</strong>
    </li>
  )
  return (
    <>
      <ul className="list">
        {row('Ventes nettes', totals.sales, SERIES.sales.color)}
        {row('Achats', totals.purchases, SERIES.purchases.color)}
        {row('Dépenses', totals.expenses, SERIES.expenses.color)}
        {row(<strong>Résultat</strong>, result)}
      </ul>
      <p className="muted small panel-body">Résultat indicatif : ventes TTC moins achats facturés et dépenses saisies. Les achats sont déduits en entier, même si la marchandise n’est pas encore vendue.</p>
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
