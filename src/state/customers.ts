// Saisie d'un nouveau client : on refuse les valeurs aberrantes avant de les envoyer à l'API.
import { uuidv4 } from '../lib/uuid';
import type { Customer } from '../types';

export interface CustomerForm { name: string; phone: string; matricule: string }
export type CustomerErrors = Partial<Record<keyof CustomerForm, string>>;

export const MAX_NAME_LENGTH = 80;
export const MAX_MATRICULE_LENGTH = 15; // 10 chiffres au plus en général : on garde de la marge

/**
 * Téléphone nettoyé (espaces, points, tirets, parenthèses) et mis au format international :
 * un numéro marocain 05… / 06… / 07… devient +212…. Renvoie null si le numéro n'est pas plausible.
 */
export function normalizePhone(input: string): string | null {
  let n = input.replace(/[\s.\-()]/g, '');
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  n = n.replace(/^\+2120(?=[5-7])/, '+212'); // « +212 (0)6… »
  if (/^0[5-7]\d{8}$/.test(n)) return `+212${n.slice(1)}`;
  if (/^212[5-7]\d{8}$/.test(n)) return `+${n}`;
  return /^\+\d{8,15}$/.test(n) ? n : null;
}

/**
 * Ce que le caissier a tapé dans la recherche, pour pré-remplir la fiche d'un nouveau client :
 * un début de téléphone (+…, 00…, 05/06/07…), sinon des chiffres = un matricule, sinon un nom.
 */
export function prefillFrom(text: string): Partial<CustomerForm> {
  const t = text.trim();
  const compact = t.replace(/[\s.\-()]/g, '');
  if (/^(\+|00|0[5-7]|212[5-7])\d*$/.test(compact)) return { phone: t };
  if (/^\d+$/.test(compact)) return { matricule: compact };
  return t ? { name: t } : {};
}

/**
 * Vérifie le formulaire et construit le client. L'id est fourni par l'appelant (généré une fois
 * à l'ouverture de la fenêtre) : un renvoi après une erreur réseau ne crée donc pas de doublon.
 */
export function buildCustomer(form: CustomerForm, id: string = uuidv4()):
  { ok: true; customer: Customer } | { ok: false; errors: CustomerErrors } {
  const errors: CustomerErrors = {};
  const name = form.name.trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Le nom est obligatoire.';
  else if (name.length > MAX_NAME_LENGTH) errors.name = `${MAX_NAME_LENGTH} caractères au maximum.`;

  const phone = form.phone.trim() ? normalizePhone(form.phone) : null;
  if (form.phone.trim() && !phone) errors.phone = 'Numéro invalide (ex. 06 12 34 56 78).';

  const matricule = form.matricule.replace(/\s/g, ''); // les zéros du début sont gardés
  if (matricule && (!/^\d+$/.test(matricule) || matricule.length > MAX_MATRICULE_LENGTH)) {
    errors.matricule = `Le matricule ne contient que des chiffres (${MAX_MATRICULE_LENGTH} au plus).`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, customer: { id, name, phone, matricule: matricule || null } };
}
