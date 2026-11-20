import { useMemo, useState } from 'react';
import { receiptDate } from '../../lib/receipt';
import {
  byCategory, byDay, byHour, byMethod, byProduct, inPeriod, periodRange, previousPeriod, sessionRows, stockStatus, summarize,
  variation, type PeriodKey,
} from '../../lib/stats';
import { formatMad } from '../../lib/totals.js';
import { formatQuantity } from '../../lib/units';
import { METHOD_LABELS } from '../../state/payment';
import { Icon } from '../ui';
import { Columns, Empty, HBars, Panel, PeriodPicker, Stat, type Bar } from './common';
import { dayLabel, TZ, useNow, type PageProps } from './shared';

const pct = (part: number, total: number) => (total > 0 ? `${Math.round((part * 100) / total)} %` : '');

// Tableau de bord : chiffre d'affaires et tickets de la période, comparés à la période d'avant ; ventes par heure ou
// par jour, encaissements par moyen de paiement, meilleurs articles, catégories ; session en cours et alertes.
export function DashboardPage({ data, onNavigate }: PageProps) {
  const [key, setKey] = useState<PeriodKey>('today');
  const now = useNow();
  const period = periodRange(key, now, TZ);
  const before = previousPeriod(period);

  const view = useMemo(() => {
    const sales = data.receipts.map((r) => r.sale);
    const pick = <T extends { created_at: string }>(list: T[], p: typeof period) => list.filter((x) => inPeriod(x.created_at, p, TZ));
    const current = { sales: pick(sales, period), refunds: pick(data.refunds, period) };
    const products = byProduct(current.sales, current.refunds);
    return {
      current,
      summary: summarize(current.sales, current.refunds),
      previous: summarize(pick(sales, before), pick(data.refunds, before)),
      products,
      methods: byMethod(current.sales, current.refunds),
      categories: byCategory(
        products, new Map(data.products.map((p) => [p.id, p.category_id])), new Map(data.categories.map((c) => [c.id, c.name])),
      ),
    };
    // La période ne change qu'avec la clé et le jour : recalcul inutile à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key, period.to]);

  const { summary, previous } = view;

  // Une journée : par heure, de 7 h à 22 h au moins (élargi s'il y a des ventes plus tôt ou plus tard).
  // Plusieurs jours : par jour.
  let bars: Bar[];
  let every = 1;
  if (period.days.length === 1) {
    const hours = byHour(view.current.sales, TZ);
    const active = hours.filter((h) => h.tickets > 0).map((h) => h.hour);
    const from = Math.min(7, ...active);
    const to = Math.max(22, ...active);
    bars = hours.slice(from, to + 1).map((h) => ({
      key: String(h.hour), label: `${h.hour}h`, value: h.ttc,
      tip: `${h.hour} h – ${h.hour + 1} h : ${formatMad(h.ttc)} · ${h.tickets} ticket${h.tickets > 1 ? 's' : ''}`,
    }));
    every = 2;
  } else {
    bars = byDay(view.current.sales, view.current.refunds, period, TZ).map((d) => ({
      key: d.day, label: dayLabel(d.day, false), value: d.net,
      tip: `${dayLabel(d.day)} : ${formatMad(d.net)} · ${d.tickets} ticket${d.tickets > 1 ? 's' : ''}`,
    }));
    every = period.days.length > 10 ? 5 : 1;
  }

  const open = data.sessions.find((s) => s.status === 'open') ?? null;
  const openRow = open
    ? sessionRows([open], data.receipts.map((r) => r.sale), data.refunds, data.movements, data.payments)[0]
    : null;
  const out = data.products.filter((p) => stockStatus(p) === 'out').length;
  const low = data.products.filter((p) => stockStatus(p) === 'low').length;
  const rejected = data.outbox.filter((e) => e.error !== null).length;
  const totalPaid = view.methods.reduce((s, m) => s + Math.max(0, m.amount), 0);

  return (
    <>
      <div className="m-toolbar"><PeriodPicker value={key} onChange={setKey} /></div>

      <div className="stats">
        <Stat icon="trend" label="Chiffre d’affaires net TTC" value={formatMad(summary.net)} trend={variation(summary.net, previous.net)}
          tone="green" />
        <Stat icon="receipt" label="Tickets" value={summary.tickets} trend={variation(summary.tickets, previous.tickets)}
          hint={summary.cancelled > 0 ? `${summary.cancelled} annulé${summary.cancelled > 1 ? 's' : ''}` : undefined} />
        <Stat icon="cart" label="Panier moyen" value={formatMad(summary.average)} trend={variation(summary.average, previous.average)} />
        <Stat icon="swap" label="Retours" value={formatMad(summary.refunded)} tone={summary.refunds > 0 ? 'amber' : 'blue'}
          hint={`${summary.refunds} retour${summary.refunds > 1 ? 's' : ''} · remises ${formatMad(summary.discounts)}`} />
      </div>

      <div className="m-grid">
        <Panel title={period.days.length === 1 ? 'Ventes par heure (TTC)' : 'Chiffre d’affaires net par jour (TTC)'} className="span-2">
          {summary.tickets === 0 && summary.refunds === 0
            ? <Empty>Aucune vente sur la période.</Empty>
            : <Columns bars={bars} every={every} format={formatMad}
              caption={period.days.length === 1 ? 'Ventes par heure' : 'Chiffre d’affaires par jour'} />}
        </Panel>

        <Panel title="Session en cours">
          {open && openRow ? (
            <dl className="facts">
              <div><dt>Ouverte</dt><dd>{receiptDate(open.opened_at, TZ)}</dd></div>
              <div><dt>Par</dt><dd>{open.opened_by_name}</dd></div>
              <div><dt>Tickets</dt><dd>{openRow.tickets}</dd></div>
              <div><dt>CA net</dt><dd>{formatMad(openRow.net)}</dd></div>
              <div><dt>Fond de caisse</dt><dd>{formatMad(open.opening_cash)}</dd></div>
              <div><dt>Espèces attendues</dt><dd><strong>{formatMad(openRow.expectedCash)}</strong></dd></div>
            </dl>
          ) : <Empty>Aucune session ouverte sur cette caisse.</Empty>}
          <ul className="alerts">
            {out > 0 && <li className="red"><Icon name="alert" size={16} />{out} article{out > 1 ? 's' : ''} en rupture
              <button type="button" className="link" onClick={() => onNavigate('products')}>Voir</button></li>}
            {low > 0 && <li className="amber"><Icon name="alert" size={16} />{low} article{low > 1 ? 's' : ''} en stock bas
              <button type="button" className="link" onClick={() => onNavigate('products')}>Voir</button></li>}
            {data.outbox.length > 0 && <li className={rejected ? 'red' : 'amber'}><Icon name="clock" size={16} />
              {data.outbox.length} opération{data.outbox.length > 1 ? 's' : ''} à envoyer{rejected ? ` dont ${rejected} refusée${rejected > 1 ? 's' : ''}` : ''}</li>}
            {out === 0 && low === 0 && data.outbox.length === 0 && <li className="green"><Icon name="check" size={16} />Stock et envoi à jour</li>}
          </ul>
        </Panel>

        <Panel title="Encaissements par moyen de paiement">
          {totalPaid === 0 && view.methods.every((m) => m.amount === 0) ? <Empty>Rien d’encaissé sur la période.</Empty> : (
            <HBars label="Encaissements par moyen de paiement" format={formatMad}
              rows={view.methods.map((m) => ({ key: m.method, label: METHOD_LABELS[m.method], value: m.amount, detail: pct(Math.max(0, m.amount), totalPaid) }))} />
          )}
        </Panel>

        <Panel title="Meilleurs articles">
          {view.products.length === 0 ? <Empty>Aucun article vendu.</Empty> : (
            <HBars label="Meilleurs articles" format={formatMad}
              rows={view.products.slice(0, 6).map((p) => ({ key: p.product_id, label: p.name, value: p.ttc, detail: formatQuantity(p.quantity, p.unit) }))} />
          )}
        </Panel>

        <Panel title="Ventes par catégorie">
          {view.categories.length === 0 ? <Empty>Aucune vente.</Empty> : (
            <HBars label="Ventes par catégorie" format={formatMad}
              rows={view.categories.slice(0, 6).map((c) => ({ key: c.category_id ?? 'none', label: c.name, value: c.ttc, detail: pct(c.ttc, summary.net) }))} />
          )}
        </Panel>
      </div>
    </>
  );
}
