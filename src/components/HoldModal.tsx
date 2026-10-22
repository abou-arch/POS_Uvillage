import { useState, type FormEvent } from 'react';
import { formatMad } from '../lib/totals.js';
import { MAX_NOTE_LENGTH } from '../state/held';
import { Modal } from './Modal';
import { Icon } from './ui';

// Mise en attente : une note facultative (« client parti chercher sa carte »…), puis le panier est vidé.
export function HoldModal({ total, articles, onHold, onClose }: {
  total: number;
  articles: number;
  onHold: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    onHold(note);
  }

  return (
    <Modal title="Mettre en attente" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="pay-due">
          <span>{articles.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} article{articles > 1 ? 's' : ''}</span><strong>{formatMad(total)}</strong>
        </div>
        <label>Note <small>(facultative)</small>
          <input data-autofocus autoComplete="off" maxLength={MAX_NOTE_LENGTH} value={note}
            placeholder="Ex. : client parti chercher sa carte" onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Annuler</button>
          <button className="btn primary"><Icon name="pause" size={18} />Mettre en attente</button>
        </div>
      </form>
    </Modal>
  );
}
