import { useState } from 'react';
import { formatMad } from '../lib/totals.js';
import { Modal } from './Modal';
import { Icon } from './ui';

// QR code du commerçant, affiché au client s'il n'est pas déjà collé au comptoir. Fichier à déposer dans public/.
const QR_IMAGE = '/qr-paiement.png';

// Paiement par scan de QR code : le client scanne avec son application et paie le total ; la caissière valide la vente
// une fois le paiement confirmé sur son téléphone ou l'application du commerçant. Pas de rendu de monnaie.
export function QrPaymentModal({ total, onPay, onClose }: { total: number; onPay: () => void; onClose: () => void }) {
  const [hasImage, setHasImage] = useState(true);
  return (
    <Modal title="Paiement par QR code" onClose={onClose}>
      <form className="pay" onSubmit={(e) => { e.preventDefault(); onPay(); }}>
        <div className="pay-due"><span>Total à payer</span><strong>{formatMad(total)}</strong></div>
        <div className="qr-pay">
          {hasImage && <img src={QR_IMAGE} alt="QR code de paiement du magasin" onError={() => setHasImage(false)} />}
          <p>Le client scanne le QR code et paie <strong>{formatMad(total)}</strong>.</p>
          <p className="muted small">Validez seulement quand le paiement apparaît comme reçu.</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Annuler</button>
          <button className="btn validate" data-autofocus><Icon name="check" size={18} />Paiement reçu</button>
        </div>
      </form>
    </Modal>
  );
}
