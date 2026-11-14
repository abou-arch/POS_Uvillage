import { useState, type FormEvent } from 'react';
import { TIME_ZONE } from '../config/store';
import { findSale, type FoundSale } from '../db/refunds';
import {
  creditRemaining, defaultRefundPayments, MAX_REASON_LENGTH, parseQuantity, quantitiesError, REASONS, reasonError, REFUND_REASONS,
  refundLines, refundPaymentsError, refundTotals, returnableLines, saleRefundError,
} from '../lib/buildRefund';
import { receiptDate } from '../lib/receipt';
import { formatMad } from '../lib/totals.js';
import { METHOD_LABELS } from '../state/payment';
import type { Payment, RefundReason } from '../types';
import { Modal } from './Modal';
import { MultiPaymentModal } from './MultiPaymentModal';
import { Icon } from './ui';

/** Ce que le caissier a choisi, à enregistrer (voir PosScreen). */
export interface RefundChoice {
  found: FoundSale;
  quantities: Map<number, number>;
  reason: RefundReason;
  reasonText: string;
  payments: Payment[];
}

const qty = (q: number) => q.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

// Retour (§10) : numéro du ticket (tapé ou scanné), puis les articles rapportés et le motif, puis le remboursement
// dans la fenêtre de paiement en mode remboursement. Les règles sont dans lib/buildRefund.ts.
export function RefundModal({ storeId, cashAvailable, onSave, onClose }: {
  storeId: string;
  cashAvailable: number; // espèces attendues dans le tiroir : on ne rend pas plus
  onSave: (choice: RefundChoice) => Promise<string | null>; // erreur : rien n'est enregistré, la fenêtre reste ouverte
  onClose: () => void;
}) {
  const [number, setNumber] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [found, setFound] = useState<FoundSale | null>(null);
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [reason, setReason] = useState<RefundReason | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [tried, setTried] = useState(false);
  const [paying, setPaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (searching || number.trim() === '') return;
    setSearching(true);
    setSearchError(null);
    try {
      const result = await findSale(number);
      if (result) {
        setFound(result);
        setTexts({});
      } else {
        setSearchError(`Aucune vente « ${number.trim()} » : vérifiez le numéro. Hors ligne, seules les ventes de cette caisse sont retrouvées.`);
      }
    } catch {
      setSearchError('Recherche impossible : reconnectez-vous puis réessayez.');
    } finally {
      setSearching(false);
    }
  }

  if (!found) {
    return (
      <Modal title="Retour" onClose={onClose}>
        <form onSubmit={search}>
          <label>
            Numéro du ticket <small>scannez le code-barres du ticket, ou tapez son numéro</small>
            <span className="field">
              <Icon name="barcode" />
              <input data-autofocus autoComplete="off" placeholder="ST1-REG1-000123" value={number}
                aria-invalid={!!searchError} onChange={(e) => { setNumber(e.target.value); setSearchError(null); }} />
            </span>
          </label>
          {searchError && <p className="field-error" role="alert">{searchError}</p>}
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>Annuler</button>
            <button className="btn primary" disabled={searching || number.trim() === ''}>
              <Icon name="search" size={18} />{searching ? 'Recherche…' : 'Rechercher'}
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  const { sale, refunds } = found;
  const blocked = saleRefundError(sale, storeId);
  const rows = returnableLines(sale, refunds);
  const quantityTooHigh = (index: number, q: number) => q > (rows.find((r) => r.index === index)?.remaining ?? 0);
  const read = new Map<number, number | null>(
    Object.entries(texts).filter(([, t]) => t.trim() !== '').map(([i, t]) => [Number(i), parseQuantity(t)]),
  );
  const valid = new Map([...read].filter((e): e is [number, number] => e[1] !== null && !quantityTooHigh(e[0], e[1])));
  const lines = refundLines(rows, valid);
  const total = refundTotals(lines).ttc;
  const error = blocked ?? quantitiesError(rows, read) ?? reasonError(reason, reasonText);
  const credit = creditRemaining(sale, refunds);
  const allReturned = rows.every((r) => r.remaining === 0);

  function next(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!error) setPaying(true);
  }

  async function pay(payments: Payment[]) {
    if (saving || error || reason === null) return;
    setSaving(true);
    const failure = await onSave({ found: found as FoundSale, quantities: valid, reason, reasonText, payments });
    setSaving(false);
    setSaveError(failure);
    if (failure) setPaying(false);
  }

  if (paying) {
    return (
      <MultiPaymentModal total={total} hasCustomer={sale.customer_id !== null} onPay={(p) => void pay(p)} onClose={() => setPaying(false)}
        refund={{
          initial: defaultRefundPayments(sale, refunds, total),
          check: (p) => refundPaymentsError(total, p, { credit, cash: cashAvailable }),
          creditAllowed: credit > 0,
        }} />
    );
  }

  return (
    <Modal title={`Retour — ticket ${sale.number}`} onClose={onClose} className="refund">
      <form onSubmit={next}>
        <dl className="session-info refund-sale">
          <div><dt>Date</dt><dd>{receiptDate(sale.created_at, TIME_ZONE)}</dd></div>
          <div><dt>Client</dt><dd>{found.customer ?? 'Client de passage'}</dd></div>
          <div><dt>Total payé</dt><dd>{formatMad(sale.totals.ttc)}</dd></div>
          <div><dt>Payé par</dt><dd>{sale.payments.map((p) => `${METHOD_LABELS[p.method]} ${formatMad(p.amount)}`).join(' · ')}</dd></div>
        </dl>
        {blocked && <p className="alert" role="alert"><Icon name="alert" size={18} />{blocked}</p>}
        {!blocked && allReturned && <p className="notice" role="alert"><Icon name="alert" size={18} />Tous les articles de cette vente ont déjà été retournés.</p>}
        {found.local && (
          <p className="notice"><Icon name="alert" size={18} />Serveur injoignable : seuls les retours faits sur cette caisse sont comptés.</p>
        )}
        {!blocked && (
          <table className="refund-table">
            <thead>
              <tr><th>Article</th><th>Vendu</th><th>Déjà retourné</th><th>Retournable</th><th>À retourner</th><th>Remboursé</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const text = texts[row.index] ?? '';
                const q = read.get(row.index);
                const invalid = text.trim() !== '' && (q === null || (q !== undefined && quantityTooHigh(row.index, q)));
                const amount = lines.find((l) => l.line_index === row.index)?.total_ttc;
                return (
                  <tr key={row.index} className={row.remaining === 0 ? 'done' : ''}>
                    <td>
                      <strong>{row.line.name}</strong>
                      <small>{qty(row.sold)} × {formatMad(row.line.unit_price_ttc)}{row.line.discount > 0 ? ` − ${formatMad(row.line.discount)}` : ''} · payé {formatMad(row.paid)}</small>
                    </td>
                    <td>{qty(row.sold)}</td>
                    <td>{qty(row.returned)}</td>
                    <td>{qty(row.remaining)}</td>
                    <td>
                      <span className="refund-qty">
                        <input inputMode="decimal" autoComplete="off" aria-label={`Quantité à retourner : ${row.line.name}`} placeholder="0"
                          disabled={row.remaining === 0} aria-invalid={invalid} value={text}
                          onChange={(e) => setTexts({ ...texts, [row.index]: e.target.value })} />
                        <button type="button" className="link" disabled={row.remaining === 0}
                          onClick={() => setTexts({ ...texts, [row.index]: String(row.remaining).replace('.', ',') })}>Tout</button>
                      </span>
                    </td>
                    <td>{amount !== undefined ? formatMad(amount) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!blocked && !allReturned && (
          <fieldset className="refund-reason">
            <legend>Motif du retour</legend>
            <div className="segmented four">
              {REASONS.map((r) => (
                <button type="button" key={r} className={reason === r ? 'active' : ''} aria-pressed={reason === r} onClick={() => setReason(r)}>
                  {REFUND_REASONS[r]}
                </button>
              ))}
            </div>
            <input autoComplete="off" maxLength={MAX_REASON_LENGTH} aria-label="Précision du motif"
              placeholder={reason === 'other' ? 'Précisez la raison (obligatoire)' : 'Précision (facultative)'}
              aria-invalid={tried && reason === 'other' && reasonText.trim() === ''} value={reasonText}
              onChange={(e) => setReasonText(e.target.value)} />
          </fieldset>
        )}
        <div className="pay-due"><span>Total à rembourser</span><strong>{formatMad(total)}</strong></div>
        {tried && error && <p className="field-error" role="alert">{error}</p>}
        {saveError && <p className="alert" role="alert"><Icon name="alert" size={18} />{saveError}</p>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={() => { setFound(null); setTried(false); setReason(null); setReasonText(''); }}>
            Autre ticket
          </button>
          <button className="btn validate" disabled={!!blocked || allReturned || saving}>
            <Icon name="cash" size={18} />Rembourser
          </button>
        </div>
      </form>
    </Modal>
  );
}
