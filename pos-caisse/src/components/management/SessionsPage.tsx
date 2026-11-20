import { useMemo, useState } from 'react';
import { storeInfo } from '../../config/store';
import { sessionReceipt } from '../../db/cashSessions';
import { denominationLabel, MOVEMENT_LABELS, type LocalCashMovement } from '../../lib/cashSession';
import { receiptDate, receiptTime, signedMad } from '../../lib/receipt';
import { csvMad, sessionRows, type SessionRow } from '../../lib/stats';
import { formatMad } from '../../lib/totals.js';
import { METHOD_LABELS } from '../../state/payment';
import { closingThreshold, placeOf } from '../../state/session';
import { Modal } from '../Modal';
import { Icon } from '../ui';
import { Empty, ExportButton, Stat } from './common';
import { downloadCsv, TZ, type PageProps } from './shared';

// Sessions de la caisse : ouverture, clôture, tickets, chiffre d'affaires, espèces attendues et écart de clôture ;
// détail par moyen de paiement, mouvements d'espèces, notes ; réimpression du rapport X ou de clôture.
export function SessionsPage({ session, data, print }: PageProps) {
  const [open, setOpen] = useState<SessionRow | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { storeName, registerName } = placeOf(session);
  const threshold = closingThreshold(session);
  const rows = useMemo(
    () => sessionRows(data.sessions, data.receipts.map((r) => r.sale), data.refunds, data.movements, data.payments),
    [data],
  );
  const closed = rows.filter((r) => r.difference !== null);
  const totalGap = closed.reduce((s, r) => s + (r.difference ?? 0), 0);
  const overThreshold = closed.filter((r) => (r.session.counts ?? []).some((c) => Math.abs(c.difference) > threshold)).length;

  async function printReport(row: SessionRow) {
    setFailure(null);
    try {
      const report = await sessionReceipt(row.session, registerName, storeInfo(session.storeId, storeName));
      print({ kind: 'doc', doc: { kind: 'session', report } });
    } catch {
      setFailure('Base locale illisible : rapport indisponible.');
    }
  }

  function exportCsv() {
    downloadCsv(`sessions-${session.registerId}.csv`, [
      ['Ouverture', 'Ouverte par', 'Clôture', 'Clôturée par', 'Tickets', 'CA net TTC', 'Fond de caisse', 'Entrées', 'Sorties', 'Espèces attendues', 'Écart total'],
      ...rows.map((r) => [
        receiptDate(r.session.opened_at, TZ), r.session.opened_by_name, r.session.closed_at ? receiptDate(r.session.closed_at, TZ) : 'Ouverte',
        r.session.closed_by_name ?? '', r.tickets, csvMad(r.net), csvMad(r.session.opening_cash), csvMad(r.cashIn), csvMad(r.cashOut),
        csvMad(r.expectedCash), r.difference === null ? '' : csvMad(r.difference),
      ]),
    ]);
  }

  return (
    <>
      <div className="stats">
        <Stat icon="cash" label="Sessions sur le poste" value={rows.length}
          hint={rows.some((r) => r.session.status === 'open') ? '1 ouverte' : 'aucune ouverte'} />
        <Stat icon="trend" label="CA net des sessions" value={formatMad(rows.reduce((s, r) => s + r.net, 0))} tone="green" />
        <Stat icon="alert" label="Écart cumulé des clôtures" value={signedMad(totalGap)} tone={totalGap === 0 ? 'green' : 'amber'}
          hint={`${overThreshold} clôture${overThreshold > 1 ? 's' : ''} au-delà du seuil (${formatMad(threshold)})`} />
      </div>
      <div className="m-toolbar"><span className="spacer" /><ExportButton onClick={exportCsv} disabled={rows.length === 0} /></div>
      {failure && <p className="alert" role="alert"><Icon name="alert" size={18} />{failure}</p>}

      {rows.length === 0 ? <Empty>Aucune session enregistrée sur ce poste.</Empty> : (
        <div className="m-table-wrap">
          <table className="m-table clickable">
            <thead>
              <tr><th>Ouverture</th><th className="hide-sm">Par</th><th>Clôture</th><th className="num">Tickets</th>
                <th className="num">CA net</th><th className="num hide-sm">Espèces attendues</th><th className="num">Écart</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.session.id} tabIndex={0} onClick={() => setOpen(r)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(r); } }}
                  aria-label={`Session ouverte le ${receiptDate(r.session.opened_at, TZ)}, détail`}>
                  <td>{receiptDate(r.session.opened_at, TZ)}</td>
                  <td className="hide-sm">{r.session.opened_by_name}</td>
                  <td>{r.session.closed_at ? receiptDate(r.session.closed_at, TZ) : <span className="badge pending-open">Ouverte</span>}</td>
                  <td className="num">{r.tickets}</td>
                  <td className="num"><strong>{formatMad(r.net)}</strong></td>
                  <td className="num hide-sm">{formatMad(r.expectedCash)}</td>
                  <td className="num">{r.difference === null ? '—' : <GapBadge value={r.difference} threshold={threshold} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <SessionDetail row={open} threshold={threshold} movements={data.movements.filter((m) => m.session_id === open.session.id)}
          onPrint={() => void printReport(open)} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function GapBadge({ value, threshold }: { value: number; threshold: number }) {
  const tone = value === 0 ? 'sent' : Math.abs(value) > threshold ? 'red' : 'amber';
  return <span className={`badge ${tone}`}>{value === 0 ? 'Aucun' : signedMad(value)}</span>;
}

function SessionDetail({ row, threshold, movements, onPrint, onClose }: {
  row: SessionRow; threshold: number; movements: LocalCashMovement[]; onPrint: () => void; onClose: () => void;
}) {
  const s = row.session;
  return (
    <Modal title={s.status === 'open' ? 'Session en cours' : 'Session clôturée'} className="detail" onClose={onClose}>
      <div className="modal-body">
        <dl className="facts">
          <div><dt>Ouverture</dt><dd>{receiptDate(s.opened_at, TZ)} · {s.opened_by_name}</dd></div>
          <div><dt>Clôture</dt><dd>{s.closed_at ? `${receiptDate(s.closed_at, TZ)} · ${s.closed_by_name ?? ''}` : 'Pas encore'}</dd></div>
          {s.approved_by_name && <div><dt>Autorisée par</dt><dd>{s.approved_by_name}</dd></div>}
          <div><dt>Fond de caisse</dt><dd>{formatMad(s.opening_cash)}</dd></div>
          <div><dt>Tickets · CA net</dt><dd>{row.tickets} · {formatMad(row.net)}</dd></div>
          <div><dt>Entrées · sorties</dt><dd>+{formatMad(row.cashIn)} · −{formatMad(row.cashOut)}</dd></div>
        </dl>
        {s.counts ? (
          <table className="m-table compact">
            <thead><tr><th>Moyen</th><th className="num">Attendu</th><th className="num">Compté</th><th className="num">Écart</th></tr></thead>
            <tbody>
              {s.counts.map((c) => (
                <tr key={c.method}><td>{METHOD_LABELS[c.method]}</td><td className="num">{formatMad(c.expected)}</td>
                  <td className="num">{formatMad(c.counted)}</td><td className="num"><GapBadge value={c.difference} threshold={threshold} /></td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">Espèces attendues à cet instant : <strong>{formatMad(row.expectedCash)}</strong></p>}
        {s.cash_count && s.cash_count.some((l) => l.quantity > 0) && (
          <p className="muted small">Comptage : {s.cash_count.filter((l) => l.quantity > 0).map((l) => `${l.quantity} × ${denominationLabel(l.value)}`).join(', ')}</p>
        )}
        {movements.length > 0 && (
          <>
            <h3 className="m-subtitle">Mouvements d’espèces</h3>
            <ul className="m-list">
              {[...movements].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((m) => (
                <li key={m.id}><span className="muted">{receiptTime(m.created_at, TZ)}</span><strong>{MOVEMENT_LABELS[m.type]}</strong>
                  <span>{m.reason} · {m.cashier_name}{m.approver_name ? ` (autorisé par ${m.approver_name})` : ''}</span>
                  <strong>{signedMad(m.type === 'in' ? m.amount : -m.amount)}</strong></li>
              ))}
            </ul>
          </>
        )}
        {(s.opening_note || s.closing_note) && (
          <p className="muted small">{s.opening_note && <>Note d’ouverture : {s.opening_note}. </>}{s.closing_note && <>Note de clôture : {s.closing_note}.</>}</p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Fermer</button>
          <button type="button" className="btn primary" onClick={onPrint}>
            <Icon name="printer" size={18} />{s.status === 'open' ? 'Imprimer le rapport X' : 'Réimprimer le rapport de clôture'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
