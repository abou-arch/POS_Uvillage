import { useState, type FormEvent } from 'react';
import { madInput, parseMad } from '../lib/money';
import { formatMad } from '../lib/totals.js';
import { chargesError } from '../state/cart';
import { Modal } from './Modal';
import { Icon } from './ui';

const QUICK_CHARGES = [100, 200, 500, 1000]; // 1, 2, 5, 10 DH : sachet, livraison…

// Frais supplémentaires ajoutés au ticket (livraison, sachet, service…) : un seul montant, qui s'ajoute au total.
export function ChargesModal({ current, onSave, onClose }: { current: number; onSave: (cents: number) => void; onClose: () => void }) {
  const [text, setText] = useState(current > 0 ? madInput(current) : '');
  const cents = text.trim() === '' ? 0 : parseMad(text);
  const error = chargesError(cents);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (cents !== null && !error) onSave(cents);
  }

  return (
    <Modal title="Frais supplémentaires" onClose={onClose}>
      <form className="pay" onSubmit={submit}>
        <label className="pay-field">
          <span>Montant des frais</span>
          <span className="money big">
            <input data-autofocus inputMode="decimal" autoComplete="off" placeholder="0,00" aria-invalid={!!error}
              value={text} onChange={(e) => setText(e.target.value)} />
            DH
          </span>
        </label>
        <div className="bills">
          {QUICK_CHARGES.map((c) => (
            <button type="button" key={c} onClick={() => setText(madInput((cents ?? 0) + c))}>+{formatMad(c)}</button>
          ))}
        </div>
        <p className="muted small">Livraison, sachet, service… Ils s’ajoutent au total du ticket.</p>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="modal-actions">
          {current > 0 && <button type="button" className="btn secondary" onClick={() => onSave(0)}>Retirer les frais</button>}
          <button type="button" className="btn secondary" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={!!error}><Icon name="check" size={18} />Valider</button>
        </div>
      </form>
    </Modal>
  );
}
