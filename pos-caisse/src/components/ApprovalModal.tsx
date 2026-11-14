import { useEffect, useState, type FormEvent } from 'react';
import { isPinFormat, pinMatches } from '../lib/pin';
import {
  ACTION_LABELS, afterFailure, loadPinLock, lockLabel, lockRemaining, MAX_PIN_FAILURES, NO_LOCK, savePinLock, type GuardedAction,
} from '../state/permissions';
import type { Approver } from '../types';
import { Modal } from './Modal';
import { Icon } from './ui';

// Autorisation d'un responsable (§11) : le responsable se choisit dans la liste, puis tape son PIN, vérifié sur la
// caisse avec l'empreinte téléchargée (hors ligne aussi). 3 PIN faux de suite : plus d'essai pendant 1 minute.
export function ApprovalModal({ action, detail, approvers, onApproved, onCancel }: {
  action: GuardedAction;
  detail: string | null; // ce qui est autorisé : montant, articles…
  approvers: Approver[];
  onApproved: (approver: Approver) => void;
  onCancel: () => void;
}) {
  const [userId, setUserId] = useState(approvers.length === 1 ? approvers[0].user_id : '');
  const [pin, setPin] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [lock, setLock] = useState(loadPinLock);
  const remaining = lockRemaining(lock, now);
  const approver = approvers.find((a) => a.user_id === userId) ?? null;

  // Pendant un blocage, le compte à rebours se met à jour chaque seconde.
  useEffect(() => {
    if (remaining === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (checking) return;
    const current = loadPinLock(); // un autre essai a pu avoir lieu (autre fenêtre, autre onglet)
    setLock(current);
    setNow(Date.now());
    if (lockRemaining(current, Date.now()) > 0) return;
    if (!approver) return setError('Choisissez le responsable.');
    if (!isPinFormat(pin)) return setError('PIN invalide : des chiffres seulement.');
    setChecking(true);
    let ok: boolean;
    try {
      ok = await pinMatches(pin, approver.pin);
    } catch {
      setChecking(false);
      return setError('Vérification du PIN impossible sur ce poste : ouvrez la caisse par son adresse https.');
    }
    setChecking(false);
    setPin('');
    if (ok) {
      savePinLock(NO_LOCK);
      onApproved(approver);
      return;
    }
    const next = afterFailure(loadPinLock(), Date.now());
    savePinLock(next);
    setLock(next);
    setNow(Date.now());
    const left = MAX_PIN_FAILURES - next.failures;
    // Bloqué : le compte à rebours remplace le message, et disparaît avec le blocage.
    setError(next.lockedUntil > 0 ? null : `PIN incorrect. ${left === 1 ? 'Encore 1 essai' : `Encore ${left} essais`} avant un blocage d’1 minute.`);
    document.getElementById('approval-pin')?.focus();
  }

  if (approvers.length === 0) {
    return (
      <Modal title="Autorisation responsable" onClose={onCancel}>
        <div className="modal-body">
          <p className="approval-action"><strong>{ACTION_LABELS[action]}</strong>{detail && <span>{detail}</span>}</p>
          <p className="notice" role="alert">
            <Icon name="alert" size={18} />
            Aucun responsable avec un code PIN n’est connu de cette caisse. Connectez la caisse au serveur pour télécharger
            la liste, ou faites l’opération connecté en responsable.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn secondary" data-autofocus onClick={onCancel}>Fermer</button>
          </div>
        </div>
      </Modal>
    );
  }

  const shown = remaining > 0 ? `${MAX_PIN_FAILURES} PIN faux de suite : nouvel essai possible dans ${lockLabel(remaining)}.` : error;

  return (
    <Modal title="Autorisation responsable" onClose={onCancel} className="approval">
      <form onSubmit={(e) => void submit(e)}>
        <p className="approval-action"><strong>{ACTION_LABELS[action]}</strong>{detail && <span>{detail}</span>}</p>
        <label>
          <span>Responsable</span>
          <select value={userId} data-autofocus={approvers.length > 1 ? true : undefined}
            onChange={(e) => { setUserId(e.target.value); setError(null); document.getElementById('approval-pin')?.focus(); }}>
            {approvers.length > 1 && <option value="" disabled>Choisir…</option>}
            {approvers.map((a) => <option key={a.user_id} value={a.user_id}>{a.name}</option>)}
          </select>
        </label>
        <label>
          <span>Code PIN du responsable</span>
          <input id="approval-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={12} className="pin"
            data-autofocus={approvers.length === 1 ? true : undefined} disabled={remaining > 0} value={pin}
            aria-invalid={!!error} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError(null); }} />
        </label>
        {shown && <p className="field-error" role="alert">{shown}</p>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>Annuler</button>
          <button className="btn primary" disabled={checking || remaining > 0 || !approver || pin === ''}>
            <Icon name="lock" size={18} />{checking ? 'Vérification…' : 'Autoriser'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
