import { useState, type FormEvent } from 'react';
import { MAX_TEXT_LENGTH, MOVEMENT_LABELS, movementAmountError, movementError } from '../lib/cashSession';
import { parseMad } from '../lib/money';
import { formatMad } from '../lib/totals.js';
import type { CashMovementType } from '../types';
import { Modal } from './Modal';
import { Icon } from './ui';

const TYPES: { type: CashMovementType; hint: string }[] = [
  { type: 'in', hint: 'Argent mis dans le tiroir' },
  { type: 'out', hint: 'Argent retiré du tiroir' },
];

// Entrée ou sortie d'espèces hors vente : type, montant, motif obligatoire.
export function CashMovementModal({ expected, onSave, onClose }: {
  expected: number; // espèces attendues dans la caisse : on ne sort pas plus
  onSave: (type: CashMovementType, amount: number, reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<CashMovementType>('out');
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const amount = parseMad(text);
  const amountError = text.trim() === '' && !tried ? null : movementAmountError(type, amount, expected);
  const error = movementError(type, amount, reason, expected);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (error || amount === null || saving) return;
    setSaving(true);
    try {
      await onSave(type, amount, reason);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Entrée / sortie d’espèces" onClose={onClose}>
      <form className="pay" onSubmit={submit}>
        <div className="segmented" role="radiogroup" aria-label="Type de mouvement">
          {TYPES.map((t) => (
            <button key={t.type} type="button" role="radio" aria-checked={type === t.type}
              className={type === t.type ? 'active' : ''} onClick={() => setType(t.type)}>
              <strong>{MOVEMENT_LABELS[t.type]}</strong><small>{t.hint}</small>
            </button>
          ))}
        </div>
        <label className="pay-field">
          <span>Montant</span>
          <span className="money big">
            <input data-autofocus inputMode="decimal" autoComplete="off" placeholder="0,00"
              aria-invalid={!!amountError} value={text} onChange={(e) => setText(e.target.value)} />
            DH
          </span>
        </label>
        <label>
          <span>Motif <small>(obligatoire)</small></span>
          <input value={reason} maxLength={MAX_TEXT_LENGTH} autoComplete="off" placeholder="Ex. : achat de sacs, dépôt en banque"
            aria-invalid={tried && !amountError && !!error} onChange={(e) => setReason(e.target.value)} />
        </label>
        <p className="muted small">Espèces attendues dans la caisse : {formatMad(expected)}</p>
        {(amountError ?? (tried ? error : null)) && <p className="field-error" role="alert">{amountError ?? error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={saving}><Icon name="check" size={18} />Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
