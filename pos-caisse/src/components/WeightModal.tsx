import { useState, type FormEvent } from 'react';
import { quantityDetail, unitPrice } from '../lib/units';
import { formatMad, lineTotals } from '../lib/totals.js';
import { readQuantity } from '../state/cart';
import type { Product } from '../types';
import { Modal } from './Modal';
import { Icon } from './ui';

// Article au poids choisi sans étiquette de balance (tuile, code de base, nom) : le caissier tape le poids en kg.
export function WeightModal({ product, onAdd, onClose }: {
  product: Product;
  onAdd: (kg: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const read = readQuantity(text, 'kg');

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (read.quantity !== null) onAdd(read.quantity);
  }

  return (
    <Modal title={`Poids : ${product.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="pay-due"><span>Prix au kg</span><strong>{unitPrice(product.price_ttc, 'kg')}</strong></div>
        <label>Poids (kg)
          <input data-autofocus inputMode="decimal" autoComplete="off" placeholder="Ex. : 0,750" value={text}
            aria-invalid={tried && read.error !== null} onChange={(e) => { setText(e.target.value); setTried(false); }} />
        </label>
        {tried && read.error && <p className="field-error" role="alert">{read.error}</p>}
        {read.quantity !== null && (
          <p className="muted small">
            {quantityDetail(read.quantity, product.price_ttc, 'kg')} = <strong>{formatMad(lineTotals(read.quantity, product.price_ttc, 0, product.tva_rate).ttc)}</strong>
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Annuler</button>
          <button className="btn primary"><Icon name="plus" size={18} />Ajouter au panier</button>
        </div>
      </form>
    </Modal>
  );
}
