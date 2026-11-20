import { useState } from 'react';
import { TIME_ZONE } from '../config/store';
import { cancelGiveBack } from '../lib/cancelSale';
import { receiptDate, type ReceiptData } from '../lib/receipt';
import { formatMad } from '../lib/totals.js';
import { Modal } from './Modal';
import { Icon } from './ui';

// Annulation d'une vente de la session (§5, contrat 0.8) : ce que le caissier rend au client, puis confirmation. Un
// caissier fait ensuite autoriser l'annulation par un responsable (PIN, §11). Rien n'est enregistré avant.
export function CancelSaleModal({ data, blocker, onConfirm, onClose }: {
  data: ReceiptData;
  blocker: string | null; // ce qui empêche l'annulation (déjà un retour, autre session…), ou null
  onConfirm: () => Promise<string | null>; // message d'erreur, ou null quand c'est enregistré
  onClose: () => void;
}) {
  const { sale } = data;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const giveBack = cancelGiveBack(sale.payments);

  async function confirm() {
    if (saving || blocker) return;
    setSaving(true);
    setError(await onConfirm());
    setSaving(false);
  }

  return (
    <Modal title={`Annuler la vente ${sale.number}`} onClose={onClose}>
      <div className="pay">
        <dl className="session-info">
          <div><dt>Date</dt><dd>{receiptDate(sale.created_at, TIME_ZONE)}</dd></div>
          <div><dt>Client</dt><dd>{data.customer ?? 'Client de passage'}</dd></div>
          <div><dt>Articles</dt><dd>{sale.lines.length} ligne{sale.lines.length > 1 ? 's' : ''}, remis en stock</dd></div>
          <div className="strong"><dt>Total TTC</dt><dd>{formatMad(sale.totals.ttc)}</dd></div>
        </dl>
        {blocker ? (
          <p className="alert" role="alert"><Icon name="alert" size={18} />{blocker}</p>
        ) : (
          <>
            <ul className="give-back" aria-label="À rendre au client">
              {giveBack.map((g) => <li key={g.label}><span>{g.label}</span><strong>{formatMad(g.amount)}</strong></li>)}
            </ul>
            <p className="muted small">
              La vente reste dans le journal, marquée « annulée » : elle ne compte plus dans le chiffre ni dans les montants
              attendus à la clôture.
            </p>
          </>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose} data-autofocus>Ne pas annuler</button>
          <button type="button" className="btn danger" disabled={!!blocker || saving} onClick={() => void confirm()}>
            <Icon name="x" size={18} />Annuler la vente
          </button>
        </div>
      </div>
    </Modal>
  );
}
