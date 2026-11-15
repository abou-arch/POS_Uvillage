import { useState } from 'react';
import { readQuantity } from '../state/cart';
import type { Unit } from '../types';
import { Icon } from './ui';

const shown = (quantity: number, unit: Unit) =>
  unit === 'kg' ? quantity.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : String(quantity);

/**
 * Quantité d'une ligne du panier (§1, contrat 0.7). À la pièce : boutons − / + et nombre entier (1,5 est refusé).
 * Au poids : le poids en kg, au gramme près. Une saisie refusée ne change pas le panier et la raison s'affiche.
 */
export function QuantityField({ quantity, unit, onChange }: { quantity: number; unit: Unit; onChange: (q: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null); // texte en cours de saisie ; null : la quantité du panier
  const [error, setError] = useState<string | null>(null);

  function change(text: string) {
    setDraft(text);
    const read = readQuantity(text, unit);
    if (read.error === null) {
      setError(null);
      if (read.quantity !== quantity) onChange(read.quantity);
    } else {
      // Nombre complet mais refusé (1,5 à la pièce, 4 décimales…) : on le dit tout de suite. « 0, » en cours de frappe : rien.
      setError(Number(text.trim().replace(',', '.')) > 0 ? read.error : null);
    }
  }

  // Fin de saisie : une saisie refusée laisse la quantité d'avant et garde la raison affichée.
  function commit() {
    if (draft !== null) {
      const read = readQuantity(draft, unit);
      if (read.error !== null) setError(read.error);
    }
    setDraft(null);
  }

  const step = (delta: number) => { setError(null); onChange(quantity + delta); };
  const input = (
    <input inputMode={unit === 'kg' ? 'decimal' : 'numeric'} autoComplete="off" value={draft ?? shown(quantity, unit)}
      aria-label={unit === 'kg' ? 'Poids en kg' : 'Quantité'} aria-invalid={error !== null}
      onFocus={(e) => e.currentTarget.select()} onChange={(e) => change(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        commit();
        document.getElementById('scan')?.focus(); // la douchette reste prête
      }} />
  );

  return (
    <div className="quantity-cell">
      {unit === 'kg' ? (
        <div className="stepper weight">{input}<span className="unit">kg</span></div>
      ) : (
        <div className="stepper">
          <button type="button" aria-label="Enlever un" disabled={quantity <= 1} onClick={() => step(-1)}><Icon name="minus" size={16} /></button>
          {input}
          <button type="button" aria-label="Ajouter un" onClick={() => step(1)}><Icon name="plus" size={16} /></button>
        </div>
      )}
      {error && <small className="quantity-error" role="alert">{error}</small>}
    </div>
  );
}
