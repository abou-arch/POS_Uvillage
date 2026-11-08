import { useRef, useState, type FormEvent } from 'react';
import { madInput, parseMad } from '../lib/money';
import { formatMad } from '../lib/totals.js';
import { cashError, QUICK_CASH } from '../state/payment';
import { Modal } from './Modal';
import { Icon } from './ui';

// Paiement en espèces : montant reçu (billets ou saisie) et rendu de monnaie calculé.
export function CashModal({ total, onPay, onClose }: { total: number; onPay: (received: number) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const received = parseMad(text);
  const error = text.trim() === '' ? null : cashError(total, received);
  const ready = received !== null && error === null;

  // Les billets s'additionnent (200 + 50 pour 230 DH) ; le focus revient au champ pour valider avec Entrée.
  function fill(value: string) {
    setText(value);
    input.current?.focus();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (ready) onPay(received);
  }

  return (
    <Modal title="Paiement en espèces" onClose={onClose}>
      <form className="pay" onSubmit={submit}>
        <div className="pay-due"><span>Total à payer</span><strong>{formatMad(total)}</strong></div>
        <label className="pay-field">
          <span>Montant reçu</span>
          <span className="money big">
            <input ref={input} data-autofocus inputMode="decimal" autoComplete="off" placeholder="0,00"
              aria-invalid={!!error} value={text} onChange={(e) => setText(e.target.value)} />
            DH
          </span>
        </label>
        <div className="bills">
          {QUICK_CASH.map((bill) => (
            <button type="button" key={bill} onClick={() => fill(madInput((received ?? 0) + bill))}>+{bill / 100} DH</button>
          ))}
          <button type="button" className="wide" onClick={() => fill(madInput(total))}>Compte juste</button>
          <button type="button" onClick={() => fill('')}>Effacer</button>
        </div>
        <div className={`change ${ready ? 'ok' : ''}`}>
          <span>Rendu à donner</span>
          <strong>{ready ? formatMad(received - total) : '—'}</strong>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Annuler</button>
          <button className="btn validate" disabled={!ready}><Icon name="check" size={18} />Valider la vente</button>
        </div>
      </form>
    </Modal>
  );
}
