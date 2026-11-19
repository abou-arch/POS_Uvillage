import { useMemo, useState } from 'react';
import { receiptDate } from '../../lib/receipt';
import { csvMad, customerRows, type CustomerRow } from '../../lib/stats';
import { formatMad } from '../../lib/totals.js';
import { METHOD_LABELS } from '../../state/payment';
import { Modal } from '../Modal';
import { Icon } from '../ui';
import { Chips, Empty, ExportButton, Stat } from './common';
import { downloadCsv, TZ, type PageProps } from './shared';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
type Filter = 'all' | 'credit';

// Clients qui ont acheté sur ce poste : nombre d'achats, chiffre d'affaires, reste dû à crédit, dernier achat ; détail
// de leurs tickets. Le client de passage n'y figure pas. La fiche client se modifie dans le back-office (§4).
export function CustomersPage({ session, data }: PageProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<CustomerRow | null>(null);
  const rows = useMemo(() => customerRows(data.receipts, data.refunds), [data.receipts, data.refunds]);
  const withCredit = rows.filter((r) => r.credit > 0);
  const q = fold(query);
  const list = (filter === 'credit' ? withCredit : rows).filter((r) => !q || fold(r.name).includes(q));

  function exportCsv() {
    downloadCsv(`clients-${session.registerId}.csv`, [
      ['Client', 'Achats', 'CA net TTC', 'Reste dû (crédit)', 'Dernier achat'],
      ...list.map((r) => [r.name, r.purchases, csvMad(r.net), csvMad(r.credit), receiptDate(r.last, TZ)]),
    ]);
  }

  return (
    <>
      <div className="stats">
        <Stat icon="users" label="Clients servis" value={rows.length} />
        <Stat icon="trend" label="CA des clients identifiés" value={formatMad(rows.reduce((s, r) => s + r.net, 0))} tone="green" />
        <Stat icon="card" label="Reste dû à crédit" value={formatMad(withCredit.reduce((s, r) => s + r.credit, 0))}
          tone={withCredit.length ? 'amber' : 'green'} hint={`${withCredit.length} client${withCredit.length > 1 ? 's' : ''}`} />
      </div>
      <div className="m-toolbar">
        <label className="field m-search">
          <Icon name="search" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off"
            placeholder="Nom du client" aria-label="Rechercher un client" />
        </label>
        <Chips label="Filtre" value={filter} onChange={setFilter}
          options={[{ value: 'all', label: 'Tous' }, { value: 'credit', label: 'Avec crédit', count: withCredit.length }]} />
        <span className="spacer" />
        <ExportButton onClick={exportCsv} disabled={list.length === 0} />
      </div>

      {rows.length === 0 ? <Empty>Aucun client identifié n’a acheté sur ce poste.</Empty>
        : list.length === 0 ? <Empty>Aucun client ne correspond.</Empty> : (
          <div className="m-table-wrap">
            <table className="m-table clickable">
              <thead>
                <tr><th>Client</th><th className="num">Achats</th><th className="num">CA net</th><th className="num">Reste dû</th>
                  <th className="hide-sm">Dernier achat</th></tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.customer_id} tabIndex={0} onClick={() => setOpen(r)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(r); } }}
                    aria-label={`${r.name}, détail des achats`}>
                    <td><strong>{r.name}</strong></td>
                    <td className="num">{r.purchases}</td>
                    <td className="num">{formatMad(r.net)}</td>
                    <td className="num">{r.credit > 0 ? <span className="badge amber">{formatMad(r.credit)}</span> : <span className="muted">—</span>}</td>
                    <td className="hide-sm">{receiptDate(r.last, TZ)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {open && (
        <Modal title={open.name} className="detail" onClose={() => setOpen(null)}>
          <div className="modal-body">
            <dl className="facts">
              <div><dt>Achats</dt><dd>{open.purchases}</dd></div>
              <div><dt>CA net</dt><dd>{formatMad(open.net)}</dd></div>
              <div><dt>Reste dû à crédit</dt><dd>{formatMad(open.credit)}</dd></div>
            </dl>
            <ul className="m-list">
              {data.receipts.filter((r) => r.sale.customer_id === open.customer_id).map((r) => (
                <li key={r.sale.id}>
                  <strong>{r.sale.number}</strong><span className="muted">{receiptDate(r.sale.created_at, TZ)}</span>
                  <span>{r.sale.payments.map((p) => METHOD_LABELS[p.method]).join(' + ')}{r.sale.status === 'cancelled' ? ' · annulée' : ''}</span>
                  <strong>{formatMad(r.sale.totals.ttc)}</strong>
                </li>
              ))}
            </ul>
            <div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setOpen(null)}>Fermer</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}
