import { useRef, useState, type FormEvent } from 'react';
import { madInput, parseMad } from '../lib/money';
import { formatMad } from '../lib/totals.js';
import { METHOD_LABELS, paymentsError } from '../state/payment';
import type { Payment, PaymentMethod } from '../types';
import { Modal } from './Modal';
import { Icon } from './ui';

interface Row { key: number; method: PaymentMethod; text: string }
const METHODS: PaymentMethod[] = ['cash', 'card', 'mobile', 'credit'];

/** Mode remboursement (§10) : moyens proposés, contrôle des montants, et crédit possible ou non. */
export interface RefundMode {
  initial: Payment[];
  check: (payments: Payment[]) => string | null;
  creditAllowed: boolean; // seulement si la vente d'origine a du crédit pas encore remboursé
}

// Paiement mixte (« Multiple » de Falcon POS) : plusieurs moyens de paiement pour une même vente.
// En mode remboursement, la même fenêtre dit comment l'argent est rendu au client.
export function MultiPaymentModal({ total, hasCustomer, refund, onPay, onClose }: {
  total: number;
  hasCustomer: boolean; // le crédit n'est possible que pour un client
  refund?: RefundMode;
  onPay: (payments: Payment[]) => void;
  onClose: () => void;
}) {
  const creditAllowed = refund ? refund.creditAllowed : hasCustomer;
  const creditHint = refund ? ' (pas de crédit à réduire)' : ' (choisir un client)';
  const nextKey = useRef(100); // clés des lignes ajoutées ; les lignes de départ ont 1, 2…
  const [rows, setRows] = useState<Row[]>(() =>
    (refund?.initial.length ? refund.initial : [{ method: 'cash' as const, amount: total }])
      .map((p, i) => ({ key: i + 1, method: p.method, text: madInput(p.amount) })));
  const payments: Payment[] = rows.map((r) => ({ method: r.method, amount: parseMad(r.text) ?? NaN }));
  const error = refund ? refund.check(payments) : paymentsError(total, payments, hasCustomer);
  const paid = payments.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0);

  const update = (key: number, change: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));

  // Une nouvelle ligne propose un autre moyen de paiement et ce qui reste à payer.
  function addRow() {
    const used = new Set(rows.map((r) => r.method));
    const method = METHODS.find((m) => !used.has(m) && (m !== 'credit' || creditAllowed)) ?? 'card';
    setRows([...rows, { key: nextKey.current++, method, text: total > paid ? madInput(total - paid) : '' }]);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!error) onPay(payments);
  }

  return (
    <Modal title={refund ? 'Remboursement' : 'Paiement mixte'} onClose={onClose} className="wide">
      <form className="pay" onSubmit={submit}>
        <div className="pay-due"><span>{refund ? 'Total à rembourser' : 'Total à payer'}</span><strong>{formatMad(total)}</strong></div>
        <div className="pay-rows">
          {rows.map((r, i) => (
            <div className="pay-row" key={r.key}>
              <select value={r.method} aria-label={refund ? 'Moyen de remboursement' : 'Moyen de paiement'}
                onChange={(e) => update(r.key, { method: e.target.value as PaymentMethod })}>
                {METHODS.map((m) => (
                  <option key={m} value={m} disabled={m === 'credit' && !creditAllowed}>
                    {METHOD_LABELS[m]}{m === 'credit' && !creditAllowed ? creditHint : ''}
                  </option>
                ))}
              </select>
              <span className="money">
                <input inputMode="decimal" autoComplete="off" aria-label={`Montant ${METHOD_LABELS[r.method]}`}
                  data-autofocus={i === 0 ? true : undefined} value={r.text} onFocus={(e) => e.target.select()}
                  onChange={(e) => update(r.key, { text: e.target.value })} />
                DH
              </span>
              <button type="button" className="remove" aria-label="Retirer cette ligne" disabled={rows.length === 1}
                onClick={() => setRows(rows.filter((x) => x.key !== r.key))}><Icon name="trash" size={18} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="link add-payment" onClick={addRow}>
          <Icon name="plus" size={16} />{refund ? 'Ajouter un moyen de remboursement' : 'Ajouter un moyen de paiement'}
        </button>
        <p className={`pay-status ${error ? 'pending' : 'ok'}`} role="status">{error ?? 'Le compte est bon.'}</p>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>{refund ? 'Retour aux articles' : 'Annuler'}</button>
          <button className="btn validate" disabled={!!error}>
            <Icon name="check" size={18} />{refund ? 'Valider le remboursement' : 'Valider la vente'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
