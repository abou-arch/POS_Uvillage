import { useState, type ChangeEvent, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { rememberCustomer } from '../db/customers';
import { uuidv4 } from '../lib/uuid';
import { buildCustomer, MAX_DISCOUNT_PERCENT, MAX_MATRICULE_LENGTH, MAX_NAME_LENGTH, type CustomerErrors, type CustomerForm } from '../state/customers';
import type { Customer } from '../types';
import { Modal } from './Modal';
import { Icon } from './ui';

export function NewCustomerModal({ initial, special = false, onCreated, onClose }: {
  initial: Partial<CustomerForm>;
  special?: boolean; // client spécial : une remise en % sur tous ses tickets
  onCreated: (customer: Customer) => void;
  onClose: () => void;
}) {
  const [id] = useState(uuidv4); // gardé entre deux essais : un renvoi après coupure ne crée pas de doublon
  const [form, setForm] = useState<CustomerForm>({ name: '', phone: '', matricule: '', ...(special ? { discount: '' } : {}), ...initial });
  const [errors, setErrors] = useState<CustomerErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const bind = (key: keyof CustomerForm) => ({
    value: form[key] ?? '',
    'aria-invalid': !!errors[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setForm({ ...form, [key]: e.target.value });
      setErrors({ ...errors, [key]: undefined });
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = buildCustomer(form, id);
    if (!result.ok) return setErrors(result.errors);
    setSaving(true);
    setFailure(null);
    try {
      const created = await api.createCustomer(result.customer);
      void rememberCustomer(created); // retrouvable hors ligne
      onCreated(created);
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'Serveur injoignable : le client n’est pas enregistré.');
      setSaving(false);
    }
  }

  return (
    <Modal title={special ? 'Nouveau client spécial' : 'Nouveau client'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label>
          <span>Nom</span>
          <input data-autofocus maxLength={MAX_NAME_LENGTH} autoComplete="off" {...bind('name')} />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </label>
        <label>
          <span>Matricule <small>facultatif, chiffres seulement ({MAX_MATRICULE_LENGTH} au plus)</small></span>
          <input inputMode="numeric" placeholder="2023001542" autoComplete="off" {...bind('matricule')} />
          {errors.matricule && <span className="field-error">{errors.matricule}</span>}
        </label>
        <label>
          <span>Téléphone <small>facultatif, nécessaire pour les SMS</small></span>
          <input type="tel" inputMode="tel" placeholder="06 12 34 56 78" autoComplete="off" {...bind('phone')} />
          {errors.phone && <span className="field-error">{errors.phone}</span>}
        </label>
        {special && (
          <label>
            <span>Remise sur tous ses tickets <small>en %, de 1 à {MAX_DISCOUNT_PERCENT}</small></span>
            <span className="money"><input inputMode="numeric" placeholder="10" autoComplete="off" {...bind('discount')} />%</span>
            {errors.discount && <span className="field-error">{errors.discount}</span>}
          </label>
        )}
        {failure && <p className="alert" role="alert"><Icon name="alert" size={18} />{failure}</p>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={saving}>{saving ? 'Enregistrement…' : special ? 'Créer le client spécial' : 'Créer le client'}</button>
        </div>
      </form>
    </Modal>
  );
}
