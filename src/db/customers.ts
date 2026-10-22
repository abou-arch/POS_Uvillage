// Clients déjà vus sur la caisse (résultats de recherche, clients créés) : la recherche marche aussi hors ligne.
import { api } from '../api/client';
import type { Customer } from '../types';
import { db } from './db';

const digits = (s: string) => s.replace(/\D/g, '');

/**
 * Recherche sur les clients en cache : nom, téléphone ou matricule, comme l'API. Un numéro tapé à la marocaine
 * (06…) retrouve aussi le téléphone enregistré au format international (+2126…).
 */
export function matchesCustomer(c: Customer, search: string): boolean {
  const q = search.trim().toLowerCase();
  const d = digits(q);
  const phone = c.phone === null ? '' : digits(c.phone);
  const local = /^0[5-7]/.test(d) ? `212${d.slice(1)}` : d;
  return c.name.toLowerCase().includes(q)
    || (d.length > 0 && (phone.includes(d) || phone.includes(local) || (c.matricule ?? '').includes(d)));
}

/** Recherche en ligne ; sans réponse de l'API, recherche dans le cache (`offline: true`). */
export async function searchCustomers(search: string): Promise<{ list: Customer[]; offline: boolean }> {
  try {
    const list = await api.customers(search);
    db.customers.bulkPut(list).catch(() => {}); // cache au mieux : la recherche ne doit pas échouer pour lui
    return { list, offline: false };
  } catch {
    const cached = await db.customers.toArray().catch(() => [] as Customer[]);
    return { list: cached.filter((c) => matchesCustomer(c, search)), offline: true };
  }
}

export const rememberCustomer = (c: Customer) => db.customers.put(c).catch(() => {});
