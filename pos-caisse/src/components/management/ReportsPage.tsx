import { useMemo, useState } from 'react';
import { storeInfo } from '../../config/store';
import { receiptDate, signedMad } from '../../lib/receipt';
import {
  byMethod, byProduct, csvMad, customPeriod, dayKey, inPeriod, periodRange, PERIOD_LABELS, sessionRows, summarize, vatSummary,
  type Period, type PeriodKey,
} from '../../lib/stats';
import { formatMad } from '../../lib/totals.js';
import { formatQuantity } from '../../lib/units';
import { METHOD_LABELS } from '../../state/payment';
import { placeOf } from '../../state/session';
import type { ManagementData } from '../../db/management';
import { Icon } from '../ui';
import { Chips, Empty } from './common';
import { downloadCsv, shortDay, TZ, useNow, type PageProps } from './shared';

type When = PeriodKey | 'custom';
const WHEN: When[] = ['today', 'yesterday', 'week', 'month', 'custom'];

function compute(data: ManagementData, period: Period) {
  const sales = data.receipts.map((r) => r.sale).filter((s) => inPeriod(s.created_at, period, TZ));
  const refunds = data.refunds.filter((r) => inPeriod(r.created_at, period, TZ));
  const sessions = data.sessions.filter((s) => inPeriod(s.opened_at, period, TZ));
  return {
    summary: summarize(sales, refunds),
    vat: vatSummary(sales, refunds),
    methods: byMethod(sales, refunds),
    products: byProduct(sales, refunds),
    sessions: sessionRows(sessions, data.receipts.map((r) => r.sale), data.refunds, data.movements),
  };
}
type Report = ReturnType<typeof compute>;

// Rapport « détail des ventes » d'une période : résumé, TVA par taux (pour le comptable), encaissements par moyen,
// articles vendus, sessions. Imprimable en A4 et exportable en CSV.
export function ReportsPage({ session, data, print }: PageProps) {
  const now = useNow();
  const today = dayKey(now, TZ);
  const [when, setWhen] = useState<When>('today');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const period = when === 'custom' ? customPeriod(from, to) : periodRange(when, now, TZ);
  const report = useMemo(() => (period ? compute(data, period) : null), [data, period?.from, period?.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const { storeName, registerName } = placeOf(session);
  const title = period ? (period.from === period.to ? shortDay(period.from) : `du ${shortDay(period.from)} au ${shortDay(period.to)}`) : '';

  function printReport() {
    if (!report || !period) return;
    const store = storeInfo(session.storeId, storeName);
    print({
      kind: 'page',
      node: (
        <article className="a4-report">
          <header>
            <div><strong>{store.name}</strong>{store.address.map((l) => <div key={l}>{l}</div>)}{store.ice && <div>ICE : {store.ice}</div>}</div>
            <div className="a4-title"><h1>Détail des ventes</h1><div>{registerName} · {title}</div>
              <div>Imprimé le {receiptDate(now.toISOString(), TZ)} par {session.user.name}</div></div>
          </header>
          <ReportBody report={report} />
        </article>
      ),
    });
  }

  function exportCsv() {
    if (!report || !period) return;
    const s = report.summary;
    downloadCsv(`rapport-${session.registerId}-${period.from}-${period.to}.csv`, [
      ['Détail des ventes', `${storeName} · ${registerName}`, title],
      [],
      ['Résumé', 'Valeur'],
      ['Tickets', s.tickets], ['Ventes annulées', s.cancelled], ['Ventes TTC', csvMad(s.gross)], ['Retours TTC', csvMad(s.refunded)],
      ['CA net TTC', csvMad(s.net)], ['CA net HT', csvMad(s.netHt)], ['TVA nette', csvMad(s.netTva)], ['Remises', csvMad(s.discounts)],
      [],
      ['Taux TVA', 'Base HT', 'TVA', 'TTC'],
      ...report.vat.map((v) => [`${v.rate} %`, csvMad(v.ht), csvMad(v.tva), csvMad(v.ttc)]),
      [],
      ['Moyen de paiement', 'Encaissé net'],
      ...report.methods.map((m) => [METHOD_LABELS[m.method], csvMad(m.amount)]),
      [],
      ['Article', 'Quantité nette', 'Unité', 'CA net TTC'],
      ...report.products.map((p) => [p.name, String(p.quantity).replace('.', ','), p.unit === 'kg' ? 'kg' : 'pièce', csvMad(p.ttc)]),
    ]);
  }

  return (
    <>
      <div className="m-toolbar">
        <Chips label="Période" value={when} onChange={setWhen}
          options={WHEN.map((w) => ({ value: w, label: w === 'custom' ? 'Dates…' : PERIOD_LABELS[w] }))} />
        {when === 'custom' && (
          <span className="dates">
            <label>Du <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>au <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label>
          </span>
        )}
        <span className="spacer" />
        <button type="button" className="btn secondary small" onClick={exportCsv} disabled={!report}><Icon name="download" size={16} />Exporter (CSV)</button>
        <button type="button" className="btn primary small" onClick={printReport} disabled={!report}><Icon name="printer" size={16} />Imprimer (A4)</button>
      </div>
      {!period || !report ? <p className="alert" role="alert"><Icon name="alert" size={18} />Période invalide : choisissez deux dates dans l’ordre (366 jours au plus).</p> : (
        <>
          <p className="m-period"><Icon name="calendar" size={16} />Période : <strong>{title}</strong> · {registerName}</p>
          <ReportBody report={report} />
        </>
      )}
    </>
  );
}

function ReportBody({ report }: { report: Report }) {
  const s = report.summary;
  if (s.tickets === 0 && s.refunds === 0 && s.cancelled === 0) return <Empty>Aucune vente ni retour sur cette période.</Empty>;
  return (
    <div className="report">
      <section>
        <h3>Résumé</h3>
        <table className="m-table compact">
          <tbody>
            <tr><td>Tickets encaissés</td><td className="num">{s.tickets}</td></tr>
            {s.cancelled > 0 && <tr><td>Ventes annulées (non comptées)</td><td className="num">{s.cancelled}</td></tr>}
            <tr><td>Ventes TTC</td><td className="num">{formatMad(s.gross)}</td></tr>
            <tr><td>Retours ({s.refunds})</td><td className="num">{s.refunded > 0 ? '−' : ''}{formatMad(s.refunded)}</td></tr>
            <tr className="strong"><td>Chiffre d’affaires net TTC</td><td className="num">{formatMad(s.net)}</td></tr>
            <tr><td>dont HT</td><td className="num">{formatMad(s.netHt)}</td></tr>
            <tr><td>dont TVA</td><td className="num">{formatMad(s.netTva)}</td></tr>
            <tr><td>Panier moyen</td><td className="num">{formatMad(s.average)}</td></tr>
            <tr><td>Remises accordées</td><td className="num">{formatMad(s.discounts)}</td></tr>
            <tr><td>Articles vendus</td><td className="num">{s.units} pièce{s.units > 1 ? 's' : ''}{s.kg > 0 ? ` · ${formatQuantity(s.kg, 'kg')}` : ''}</td></tr>
          </tbody>
        </table>
      </section>
      <section>
        <h3>TVA par taux</h3>
        <table className="m-table compact">
          <thead><tr><th>Taux</th><th className="num">Base HT</th><th className="num">TVA</th><th className="num">TTC</th></tr></thead>
          <tbody>{report.vat.map((v) => (
            <tr key={v.rate}><td>{v.rate} %</td><td className="num">{formatMad(v.ht)}</td><td className="num">{formatMad(v.tva)}</td><td className="num">{formatMad(v.ttc)}</td></tr>
          ))}</tbody>
          <tfoot><tr className="strong"><td>Total</td><td className="num">{formatMad(s.netHt)}</td><td className="num">{formatMad(s.netTva)}</td><td className="num">{formatMad(s.net)}</td></tr></tfoot>
        </table>
        <h3>Encaissements par moyen de paiement</h3>
        <table className="m-table compact">
          <tbody>{report.methods.map((m) => (
            <tr key={m.method}><td>{METHOD_LABELS[m.method]}{m.method === 'credit' ? ' (à encaisser)' : ''}</td><td className="num">{formatMad(m.amount)}</td></tr>
          ))}</tbody>
        </table>
      </section>
      <section className="wide">
        <h3>Articles vendus ({report.products.length})</h3>
        <table className="m-table compact">
          <thead><tr><th>Article</th><th className="num">Quantité nette</th><th className="num">CA net TTC</th><th className="num">Part</th></tr></thead>
          <tbody>{report.products.map((p) => (
            <tr key={p.product_id}><td>{p.name}</td><td className="num">{formatQuantity(p.quantity, p.unit)}</td><td className="num">{formatMad(p.ttc)}</td>
              <td className="num">{s.net > 0 ? `${((p.ttc * 100) / s.net).toFixed(1).replace('.', ',')} %` : ''}</td></tr>
          ))}</tbody>
        </table>
      </section>
      {report.sessions.length > 0 && (
        <section className="wide">
          <h3>Sessions ouvertes sur la période</h3>
          <table className="m-table compact">
            <thead><tr><th>Ouverture</th><th>Clôture</th><th className="num">Tickets</th><th className="num">CA net</th><th className="num">Écart</th></tr></thead>
            <tbody>{report.sessions.map((r) => (
              <tr key={r.session.id}><td>{receiptDate(r.session.opened_at, TZ)} · {r.session.opened_by_name}</td>
                <td>{r.session.closed_at ? receiptDate(r.session.closed_at, TZ) : 'Ouverte'}</td><td className="num">{r.tickets}</td>
                <td className="num">{formatMad(r.net)}</td><td className="num">{r.difference === null ? '—' : signedMad(r.difference)}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
