import { useState, type FormEvent } from 'react';
import {
  closingError, COUNTED_METHODS, countedError, MAX_TEXT_LENGTH, methodCounts, thresholdError, type Counted, type Expected,
} from '../lib/cashSession';
import { madInput, parseSignedMad } from '../lib/money';
import { signedMad } from '../lib/receipt';
import { formatMad } from '../lib/totals.js';
import { METHOD_LABELS } from '../state/payment';
import { useCashInput } from '../state/useCashInput';
import type { CashCountLine, CountedMethod, Role } from '../types';
import { CashInput } from './CashInput';
import { Modal } from './Modal';
import { Icon } from './ui';

// Clôture (§9) : pour chaque moyen de paiement, attendu, compté et écart. Les espèces se comptent en saisissant
// le total ou billet par billet ; carte et mobile sont préremplis avec l'attendu, à corriger avec le total du
// terminal. Un écart doit être expliqué ; au-delà du seuil du magasin, un caissier ne valide pas seul.
// Impossible tant qu'une vente est en attente ou qu'un panier est en cours.
export function CloseSessionModal({ expected, role, threshold, blocker, onShowHeld, onConfirm, onClose }: {
  expected: Expected;
  role: Role;
  threshold: number;
  blocker: string | null;
  onShowHeld: (() => void) | null; // ventes en attente : à reprendre ou supprimer d'abord
  onConfirm: (counted: Counted, cashCount: CashCountLine[] | null, note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const edit = () => setConfirming(false); // un montant modifié se confirme à nouveau
  const cash = useCashInput(edit);
  const [card, setCard] = useState(() => madInput(expected.card));
  const [mobile, setMobile] = useState(() => madInput(expected.mobile));
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);

  // Carte et mobile : le total du terminal peut être négatif quand les retours de la session dépassent les ventes (§9).
  const read = (text: string) => (text.trim() === '' ? null : parseSignedMad(text));
  const counted: Counted = { cash: cash.cents, card: read(card), mobile: read(mobile) };
  const counts = methodCounts(expected, counted);
  const gap = counts?.some((c) => c.difference !== 0) ?? false;
  const overLimit = counts ? thresholdError(counts, threshold, role) : null;
  const error = cash.countError ?? closingError({ counted, expected, cashCount: cash.cashCount, note, role, threshold });
  const shown = cash.countError ?? overLimit ?? (tried ? error : null);

  if (blocker) {
    return (
      <Modal title="Clôturer la caisse" onClose={onClose}>
        <div className="modal-body">
          <p className="notice" role="alert"><Icon name="alert" size={18} />{blocker}</p>
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>Fermer</button>
            {onShowHeld && (
              <button type="button" className="btn primary" data-autofocus onClick={onShowHeld}>
                <Icon name="pause" size={18} />Voir la liste d’attente
              </button>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (error || saving) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setSaving(true);
    try {
      await onConfirm(counted, cash.cashCount, note);
    } finally {
      setSaving(false);
    }
  }

  const textOf: Record<Exclude<CountedMethod, 'cash'>, [string, (t: string) => void]> = { card: [card, setCard], mobile: [mobile, setMobile] };

  const cell = (method: CountedMethod) => {
    if (method === 'cash') return counted.cash === null ? '—' : formatMad(counted.cash);
    const [text, setText] = textOf[method];
    return (
      <span className="money">
        <input inputMode="decimal" autoComplete="off" aria-label={`${METHOD_LABELS[method]} : montant compté`}
          aria-invalid={text.trim() !== '' && countedError(counted[method], method) !== null}
          value={text} onChange={(e) => { setText(e.target.value); edit(); }} />
        DH
      </span>
    );
  };

  const differenceCell = (method: CountedMethod) => {
    const c = counted[method];
    if (c === null || countedError(c, method)) return <td>—</td>;
    const difference = c - expected[method];
    return <td className={difference === 0 ? 'ok' : 'gap'}>{signedMad(difference)}</td>;
  };

  return (
    <Modal title="Clôturer la caisse" className="closing" onClose={onClose}>
      <form className="pay" onSubmit={submit}>
        <CashInput input={cash} label="Espèces comptées dans le tiroir" invalid={!!cash.countError || (tried && cash.cents === null)}
          autoFocus />
        <table className="closing-table">
          <thead><tr><th>Moyen</th><th>Attendu</th><th>Compté</th><th>Écart</th></tr></thead>
          <tbody>
            {COUNTED_METHODS.map((method) => (
              <tr key={method}>
                <td>{METHOD_LABELS[method]}</td>
                <td>{formatMad(expected[method])}</td>
                <td>{cell(method)}</td>
                {differenceCell(method)}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Carte et mobile : corrigez si le total du terminal est différent.</p>
        <label>
          <span>Note de clôture <small>{gap ? '(obligatoire : il y a un écart)' : '(facultative)'}</small></span>
          <input value={note} maxLength={MAX_TEXT_LENGTH} autoComplete="off" placeholder={gap ? 'Expliquez l’écart' : ''}
            aria-invalid={tried && gap && note.trim() === ''} onChange={(e) => { setNote(e.target.value); edit(); }} />
        </label>
        {shown && <p className="field-error" role="alert">{shown}</p>}
        {confirming && !error && (
          <p className="notice" role="alert">
            <Icon name="alert" size={18} />La clôture est définitive : plus aucune vente ne pourra être faite dans cette session.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Annuler</button>
          <button className="btn danger" disabled={saving || overLimit !== null}>
            <Icon name="lock" size={18} />{confirming ? 'Confirmer la clôture' : 'Clôturer la caisse'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
