import { useMemo, useState } from 'react';
import { storeInfo } from '../../config/store';
import { buildReceipt, receiptDate, type ReceiptData } from '../../lib/receipt';
import { csvMad, filterSales, inPeriod, periodRange, PERIOD_LABELS, SALE_FILTER_LABELS, type PeriodKey, type SaleFilter } from '../../lib/stats';
import { formatMad } from '../../lib/totals.js';
import { lineUnit, quantityDetail } from '../../lib/units';
import { METHOD_LABELS } from '../../state/payment';
import { placeOf } from '../../state/session';
import { searchTickets, SEND_LABELS, ticketRows, type TicketRow } from '../../state/tickets';
import type { Refund } from '../../types';
import { Modal } from '../Modal';
import { Icon } from '../ui';
import { Chips, Empty, ExportButton } from './common';
import { downloadCsv, TZ, useNow, type PageProps } from './shared';

type When = PeriodKey | 'all';
const WHEN: When[] = ['today', 'yesterday', 'week', 'month', 'all'];
const FILTERS: SaleFilter[] = ['all', 'cash', 'card', 'mobile', 'credit', 'refunded', 'cancelled'];
const PAGE = 100;

const methodsOf = (r: ReceiptData) => [...new Set(r.sale.payments.map((p) => METHOD_LABELS[p.method]))].join(' + ');

// Ventes de la caisse (les « commandes » d'un back-office) : période, moyen de paiement, recherche par numéro ou client,
// état d'envoi ; détail d'une vente avec ses retours, réimpression en duplicata, export CSV.
export function SalesPage({ session, data, print }: PageProps) {
  const [when, setWhen] = useState<When>('today');
  const [filter, setFilter] = useState<SaleFilter>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<TicketRow | null>(null);
  const now = useNow();
  const today = periodRange('today', now, TZ).to;
  const store = storeInfo(session.storeId, placeOf(session).storeName);

  const rows = useMemo(() => {
    const period = when === 'all' ? null : periodRange(when, now, TZ);
    const inWhen = period ? data.receipts.filter((r) => inPeriod(r.sale.created_at, period, TZ)) : data.receipts;
    const refunded = new Set(data.refunds.map((r) => r.original_sale_id));
    return searchTickets(ticketRows(filterSales(inWhen, filter, refunded), data.outbox, data.refunds), query);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la période ne change qu'avec le jour
  }, [data, when, filter, query, today]);

  const total = rows.filter((r) => r.data.sale.status !== 'cancelled').reduce((s, r) => s + r.data.sale.totals.ttc, 0);
  const reprint = (r: ReceiptData) => print({ kind: 'doc', doc: { kind: 'sale', receipt: buildReceipt(r, store, TZ), copy: true } });

  function exportCsv() {
    downloadCsv(`ventes-${session.registerId}-${when}.csv`, [
      ['Ticket', 'Date', 'Client', 'Caissier', 'Paiement', 'Total HT', 'TVA', 'Total TTC', 'Rendu (retours)', 'Statut', 'Envoi'],
      ...rows.map(({ data: r, status, refunded }) => [
        r.sale.number, receiptDate(r.sale.created_at, TZ), r.customer ?? 'Client de passage', r.cashier, methodsOf(r),
        csvMad(r.sale.totals.ht), csvMad(r.sale.totals.tva), csvMad(r.sale.totals.ttc), csvMad(refunded),
        r.sale.status === 'cancelled' ? 'Annulée' : 'Encaissée', SEND_LABELS[status.kind],
      ]),
    ]);
  }

  return (
    <>
      <div className="m-toolbar">
        <Chips label="Période" value={when} onChange={(v) => { setWhen(v); setLimit(PAGE); }}
          options={WHEN.map((w) => ({ value: w, label: w === 'all' ? 'Tout' : PERIOD_LABELS[w] }))} />
        <label className="field m-search">
          <Icon name="search" />
          <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} autoComplete="off"
            placeholder="N° du ticket ou client" aria-label="Rechercher une vente par numéro ou par client" />
        </label>
      </div>
      <div className="m-toolbar">
        <Chips label="Filtre" value={filter} onChange={(v) => { setFilter(v); setLimit(PAGE); }}
          options={FILTERS.map((f) => ({ value: f, label: SALE_FILTER_LABELS[f] }))} />
        <span className="spacer" />
        <span className="m-sum">{rows.length} vente{rows.length > 1 ? 's' : ''} · <strong>{formatMad(total)}</strong></span>
        <ExportButton onClick={exportCsv} disabled={rows.length === 0} />
      </div>

      {rows.length === 0 ? <Empty>Aucune vente ne correspond.</Empty> : (
        <div className="m-table-wrap">
          <table className="m-table clickable">
            <thead>
              <tr><th>Ticket</th><th>Date</th><th>Client</th><th className="hide-sm">Caissier</th><th className="hide-sm">Paiement</th>
                <th className="num">Total TTC</th><th>État</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((row) => {
                const { data: r, status, refunded } = row;
                return (
                  <tr key={r.sale.id} tabIndex={0} onClick={() => setOpen(row)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(row); } }}
                    className={r.sale.status === 'cancelled' ? 'cancelled' : ''} aria-label={`Vente ${r.sale.number}, détail`}>
                    <td><strong>{r.sale.number}</strong></td>
                    <td>{receiptDate(r.sale.created_at, TZ)}</td>
                    <td>{r.customer ?? <span className="muted">Client de passage</span>}</td>
                    <td className="hide-sm">{r.cashier}</td>
                    <td className="hide-sm">{methodsOf(r)}</td>
                    <td className="num"><strong>{formatMad(r.sale.totals.ttc)}</strong>
                      {refunded > 0 && <small className="amber-text">retour −{formatMad(refunded)}</small>}</td>
                    <td>
                      <span className={`badge ${status.kind}`}>{SEND_LABELS[status.kind]}</span>
                      {r.sale.status === 'cancelled' && <span className="badge red">Annulée</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > limit && (
            <button type="button" className="btn secondary more" onClick={() => setLimit((l) => l + PAGE)}>
              Afficher {Math.min(PAGE, rows.length - limit)} ventes de plus
            </button>
          )}
        </div>
      )}

      {open && (
        <SaleDetail row={open} refunds={data.refunds.filter((r) => r.original_sale_id === open.data.sale.id)}
          onReprint={() => reprint(open.data)} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function SaleDetail({ row, refunds, onReprint, onClose }: {
  row: TicketRow; refunds: Refund[]; onReprint: () => void; onClose: () => void;
}) {
  const { sale, cashier, customer } = row.data;
  return (
    <Modal title={`Vente ${sale.number}`} className="detail" onClose={onClose}>
      <div className="modal-body">
        <dl className="facts">
          <div><dt>Date</dt><dd>{receiptDate(sale.created_at, TZ)}</dd></div>
          <div><dt>Caissier</dt><dd>{cashier}</dd></div>
          <div><dt>Client</dt><dd>{customer ?? 'Client de passage'}</dd></div>
          <div><dt>Envoi</dt><dd><span className={`badge ${row.status.kind}`}>{SEND_LABELS[row.status.kind]}</span>
            {row.status.kind === 'rejected' && <small className="red-text">{row.status.error}</small>}</dd></div>
        </dl>
        {sale.status === 'cancelled' && <p className="alert"><Icon name="alert" size={18} />Vente annulée : elle ne compte pas dans le chiffre d’affaires.</p>}
        <table className="m-table compact">
          <thead><tr><th>Article</th><th>Quantité × prix</th><th className="num">Remise</th><th className="num">Total</th></tr></thead>
          <tbody>
            {sale.lines.map((l, i) => (
              <tr key={l.id ?? i}>
                <td>{l.name}</td>
                <td>{quantityDetail(l.quantity, l.unit_price_ttc, lineUnit(l))}</td>
                <td className="num">{l.discount > 0 ? `−${formatMad(l.discount)}` : ''}</td>
                <td className="num">{formatMad(l.total_ttc)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {sale.other_charges > 0 && <tr><td colSpan={3}>Autres charges</td><td className="num">{formatMad(sale.other_charges)}</td></tr>}
            {sale.global_discount > 0 && <tr><td colSpan={3}>Remise globale</td><td className="num">−{formatMad(sale.global_discount)}</td></tr>}
            <tr><td colSpan={3}>Total HT · TVA</td><td className="num">{formatMad(sale.totals.ht)} · {formatMad(sale.totals.tva)}</td></tr>
            <tr className="strong"><td colSpan={3}>Total TTC</td><td className="num">{formatMad(sale.totals.ttc)}</td></tr>
          </tfoot>
        </table>
        <dl className="facts">
          {sale.payments.map((p, i) => <div key={i}><dt>{METHOD_LABELS[p.method]}</dt><dd>{formatMad(p.amount)}</dd></div>)}
          {sale.amount_received > 0 && <div><dt>Espèces reçues · rendu</dt><dd>{formatMad(sale.amount_received)} · {formatMad(sale.change_given)}</dd></div>}
        </dl>
        {refunds.length > 0 && (
          <>
            <h3 className="m-subtitle">Retours</h3>
            <ul className="m-list">
              {refunds.map((r) => (
                <li key={r.id}><strong>{r.number}</strong><span className="muted">{receiptDate(r.created_at, TZ)}</span>
                  <span>{r.lines.map((l) => `${l.name} × ${l.quantity}`).join(', ')}</span><strong>−{formatMad(r.totals.ttc)}</strong></li>
              ))}
            </ul>
          </>
        )}
        <p className="muted small">Un retour se fait depuis l’écran de caisse (bouton « Retour »), dans la session ouverte.</p>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Fermer</button>
          <button type="button" className="btn primary" onClick={onReprint}><Icon name="printer" size={18} />Réimprimer (duplicata)</button>
        </div>
      </div>
    </Modal>
  );
}
