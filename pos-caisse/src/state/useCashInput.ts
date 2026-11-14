// Saisie d'un montant d'espèces, soit directement (« 560,00 »), soit en comptant billets et pièces.
// Utilisée pour le fond de caisse à l'ouverture et pour les espèces comptées à la clôture.
import { useState } from 'react';
import { countTotal, parseCashCount } from '../lib/cashSession';
import { parseMad } from '../lib/money';
import type { CashCountLine } from '../types';

export type CashInputMode = 'direct' | 'count';

export function useCashInput(onEdit: () => void = () => {}) {
  const [mode, setMode] = useState<CashInputMode>('direct');
  const [text, setText] = useState('');
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const count = parseCashCount(quantities);
  const empty = mode === 'direct' ? text.trim() === '' : Object.values(quantities).every((q) => q.trim() === '');

  let cents: number | null;
  if (mode === 'direct') cents = text.trim() === '' ? null : parseMad(text);
  else cents = count.error ? null : countTotal(count.lines); // rien de compté : tiroir vide, 0 DH

  return {
    mode,
    text,
    quantities,
    empty,
    /** Montant en centimes ; null s'il n'est pas lisible (ou pas encore saisi en mode direct). */
    cents,
    /** Erreur du comptage billet par billet (nombre illisible, total aberrant). */
    countError: mode === 'count' ? count.error : null,
    /** Détail envoyé à la clôture (§9) : null quand le total est saisi directement. */
    cashCount: (mode === 'count' && !count.error ? count.lines : null) as CashCountLine[] | null,
    setMode: (m: CashInputMode) => { setMode(m); onEdit(); },
    setText: (t: string) => { setText(t); onEdit(); },
    setQuantity: (value: number, q: string) => { setQuantities((prev) => ({ ...prev, [value]: q })); onEdit(); },
  };
}

export type CashInputState = ReturnType<typeof useCashInput>;
