import { useRef, useState, type FormEvent } from 'react';
import { madInput, parseMad } from '../lib/money';
import { formatMad } from '../lib/totals.js';
import { METHOD_LABELS, paymentsError } from '../state/payment';
import type { Payment, PaymentMethod } from '../types';
import { Modal } from './Modal';
import { Icon } from './ui';

interface Row { key: number; method: PaymentMethod; text: string }
const METHODS: PaymentMethod[] = ['cash', 'card', 'mobile', 'credit'];

// Paiement mixte (« Multiple » de Falcon POS) : plusieurs moyens de paiement pour une même vente.
export function MultiPaymentModal({ total, hasCustomer, onPay, onClose }: {
  total: number;
  hasCustomer: boolean; // le crédit n'est possible que pour un client
  onPay: (payments: Payment[]) => void;
  onClose: () => void;
}) {
  const nextKey = useRef(2);
  const [rows, setRows] = useState<Row[]>([{ key: 1, method: 'cash', text: madInput(total) }]);
  const payments: Payment[] = rows.map((r) => ({ method: r.method, amount: parseMad(r.text) ?? NaN }));
  const error = paymentsError(total, payments, hasCustomer);
  const paid = payments.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0);

  const update = (key: number, change: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));

  // Une nouvelle ligne propose un autre moyen de paiement et ce qui reste à payer.
  function addRow() {
    const used = new Set(rows.map((r) => r.method));
    const method = METHODS.find((m) => !used.has(m) && (m !== 'credit' || hasCustomer)) ?? 'card';
    setRows([...rows, { key: nextKey.current++, method, text: total > paid ? madInput(total - paid) : '' }]);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!error) onPay(payments);
  }

  return (
    <Modal title="Paiement mixte" onClose={onClose} className="wide">
      <form className="pay" onSubmit={submit}>
        <div className="pay-due"><span>Total à payer</span><strong>{formatMad(total)}</strong></div>
        <div className="pay-rows">
          {rows.map((r, i) => (
            <div className="pay-row" key={r.key}>
              <select value={r.method} aria-label="Moyen de paiement"
                onChange={(e) => update(r.key, { method: e.target.value as PaymentMethod })}>
                {METHODS.map((m) => (
                  <option key={m} value={m} disabled={m === 'credit' && !hasCustomer}>
                    {METHOD_LABELS[m]}{m === 'credit' && !hasCustomer ? ' (choisir un client)' : ''}
                  </option>
                ))}
              </select>
              <span className="money">
                <input inputMode="decimal" autoComplete="off" aria-label={`Montant ${METHOD_LABELS[r.method]}`}
                  data-autofocus={i === 0 ? true : undefined} value={r.text} onFocus={(e) => e.target.select()}
                  onChange={(e) => update(r.key, { text: e.target.value })} />
                DH
              </span>
              <button type="button" className="remove" aria-label="Retirer ce paiement" disabled={rows.length === 1}
                onClick={() => setRows(rows.filter((x) => x.key !== r.key))}><Icon name="trash" size={18} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="link add-payment" onClick={addRow}><Icon name="plus" size={16} />Ajouter un moyen de paiement</button>
        <p className={`pay-status ${error ? 'pending' : 'ok'}`} role="status">{error ?? 'Le compte est bon.'}</p>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Annuler</button>
          <button className="btn validate" disabled={!!error}><Icon name="check" size={18} />Valider la vente</button>
        </div>
      </form>
    </Modal>
  );
}
