import { useState, type FormEvent } from 'react';
import { MAX_TEXT_LENGTH } from '../lib/cashSession';
import { paymentError } from '../lib/customerPayment';
import { madInput, parseMad } from '../lib/money';
import { formatMad } from '../lib/totals.js';
import { METHOD_LABELS } from '../state/payment';
import type { CountedMethod, Customer } from '../types';
import { CustomerPicker } from './CustomerPicker';
import { Modal } from './Modal';
import { Icon } from './ui';

const METHODS: { method: CountedMethod; hint: string }[] = [
  { method: 'cash', hint: 'Dans le tiroir' },
  { method: 'card', hint: 'Terminal de paiement' },
  { method: 'mobile', hint: 'Paiement mobile' },
  { method: 'qr', hint: 'Scan du QR code' },
];

/** Ce que le caissier a saisi, pour l'enregistrement (PosScreen). */
export interface PaymentChoice { customer: Customer; method: CountedMethod; amount: number; note: string; balance: number | null }

// Règlement d'une dette (§4, contrat 0.8) : un client qui a acheté à crédit paie ce qu'il doit. Le reste dû vient de la
// recherche en ligne ; hors ligne, il n'est pas connu : le règlement reste possible et l'API le signale s'il dépasse.
export function CustomerPaymentModal({ onSave, onClose }: {
  onSave: (choice: PaymentChoice) => Promise<string | null>; // message d'erreur, ou null quand c'est enregistré
  onClose: () => void;
}) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [method, setMethod] = useState<CountedMethod>('cash');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const balance = customer?.balance ?? null;
  const amount = parseMad(text);
  const error = !customer ? 'Choisissez le client qui règle.' : paymentError(amount, balance);
  // Erreur montrée pendant la saisie du montant, ou après un essai d'enregistrement.
  const shown = tried || (customer && text.trim() !== '') ? error : null;

  function pick(c: Customer | null) {
    setCustomer(c);
    setSaveError(null);
    // Le plus souvent, le client règle tout ce qu'il doit : le montant est proposé, modifiable.
    setText(c?.balance !== undefined && c.balance > 0 ? madInput(c.balance) : '');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (error || !customer || amount === null || saving) return;
    setSaving(true);
    setSaveError(await onSave({ customer, method, amount, note, balance }));
    setSaving(false);
  }

  return (
    <Modal title="Règlement d’un client" onClose={onClose}>
      <form className="pay" onSubmit={submit}>
        <div className="payment-customer">
          <span className="label-text">Client</span>
          <CustomerPicker customer={customer} onChange={pick} onDone={() => document.getElementById('payment-amount')?.focus()} />
        </div>
        {customer && (
          balance === null ? (
            <p className="notice small" role="status"><Icon name="alert" size={16} />
              Reste dû inconnu (caisse hors ligne) : vérifiez avec le client. Le serveur signalera un règlement en trop.</p>
          ) : (
            <p className={`balance-due${balance > 0 ? '' : ' none'}`} role="status">
              Reste dû : <strong>{formatMad(Math.max(balance, 0))}</strong>{balance < 0 ? ` (avoir de ${formatMad(-balance)})` : ''}
            </p>
          )
        )}
        <div className="segmented three" role="radiogroup" aria-label="Moyen de paiement">
          {METHODS.map((m) => (
            <button key={m.method} type="button" role="radio" aria-checked={method === m.method}
              className={method === m.method ? 'active' : ''} onClick={() => setMethod(m.method)}>
              <strong>{METHOD_LABELS[m.method]}</strong><small>{m.hint}</small>
            </button>
          ))}
        </div>
        <label className="pay-field">
          <span>Montant reçu</span>
          <span className="money big">
            <input id="payment-amount" inputMode="decimal" autoComplete="off" placeholder="0,00"
              aria-invalid={!!shown && !!customer} value={text} onChange={(e) => { setText(e.target.value); setSaveError(null); }} />
            DH
          </span>
        </label>
        <label>
          <span>Note <small>(facultative)</small></span>
          <input value={note} maxLength={MAX_TEXT_LENGTH} autoComplete="off" placeholder="Ex. : règlement de la facture d’octobre"
            onChange={(e) => setNote(e.target.value)} />
        </label>
        {(saveError ?? shown) && <p className="field-error" role="alert">{saveError ?? shown}</p>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={saving}><Icon name="check" size={18} />Encaisser le règlement</button>
        </div>
      </form>
    </Modal>
  );
}
