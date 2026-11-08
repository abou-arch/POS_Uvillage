import { useState } from 'react';
import { formatMad, saleTotals } from '../lib/totals.js';
import type { HeldSale } from '../state/held';
import { Modal } from './Modal';
import { Icon } from './ui';

/** Heure de mise en attente ; la date aussi si ce n'est pas aujourd'hui. */
function heldTime(iso: string, now = new Date()) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString('fr-FR')} ${time}`;
}

// Liste d'attente : reprendre un panier (confirmation si le panier en cours n'est pas vide) ou le supprimer.
export function HeldListModal({ list, cartEmpty, onResume, onDelete, onClose }: {
  list: HeldSale[];
  cartEmpty: boolean;
  onResume: (id: string, holdCurrent: boolean) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState<{ id: string; kind: 'resume' | 'delete' } | null>(null);

  function resume(id: string) {
    if (cartEmpty) onResume(id, false);
    else setConfirm({ id, kind: 'resume' });
  }

  return (
    <Modal title="Liste d’attente" className="wide" onClose={onClose}>
      <div className="held">
        {list.length === 0 ? (
          <p className="muted center">Aucune vente en attente sur cette caisse.</p>
        ) : (
          <ul>
            {list.map((h, i) => {
              const articles = h.cart.lines.reduce((n, l) => n + l.quantity, 0);
              const total = saleTotals(h.cart.lines, h.cart.otherCharges, h.cart.globalDiscount).ttc;
              const asking = confirm?.id === h.id ? confirm.kind : null;
              return (
                <li key={h.id}>
                  <div className="held-info">
                    <strong>{heldTime(h.held_at)} · {h.cart.customer?.name ?? 'Client de passage'}</strong>
                    <span className="muted">
                      {articles.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} article{articles > 1 ? 's' : ''}
                      {h.note && <> · « {h.note} »</>}
                    </span>
                  </div>
                  <strong className="held-total">{formatMad(total)}</strong>
                  {asking === 'resume' ? (
                    <div className="held-confirm" role="alert">
                      <span>Le panier en cours n’est pas vide.</span>
                      <button type="button" className="btn primary" data-autofocus={i === 0 || undefined}
                        onClick={() => onResume(h.id, true)}>Mettre l’actuel en attente</button>
                      <button type="button" className="btn danger" onClick={() => onResume(h.id, false)}>Remplacer</button>
                      <button type="button" className="btn secondary" onClick={() => setConfirm(null)}>Annuler</button>
                    </div>
                  ) : asking === 'delete' ? (
                    <div className="held-confirm" role="alert">
                      <span>Supprimer cette vente en attente ?</span>
                      <button type="button" className="btn danger" onClick={() => { setConfirm(null); onDelete(h.id); }}>Supprimer</button>
                      <button type="button" className="btn secondary" onClick={() => setConfirm(null)}>Annuler</button>
                    </div>
                  ) : (
                    <div className="held-actions">
                      <button type="button" className="btn primary" data-autofocus={i === 0 || undefined}
                        onClick={() => resume(h.id)}>Reprendre</button>
                      <button type="button" className="remove" aria-label="Supprimer la vente en attente" title="Supprimer"
                        onClick={() => setConfirm({ id: h.id, kind: 'delete' })}><Icon name="trash" size={18} /></button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
