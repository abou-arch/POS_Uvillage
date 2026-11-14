// Client HTTP de la caisse. Seul fichier à modifier pour pointer vers la vraie API (VITE_API_URL).
import type {
  Auth, Brand, CashMovement, CashSession, CashSessionClosing, CashSessionOpening, Category, Customer, Product, Refund, Sale,
  SaleLookup,
} from '../types';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';
const TIMEOUT_MS = 10_000; // la caisse ne doit pas rester bloquée quand le réseau ne répond plus

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * En production, mot de passe et token ne circulent qu'en HTTPS : sur le Wi-Fi d'un magasin, du HTTP se lit
 * en clair. Seule exception : une API sur le poste lui-même (essais avec la fausse API). Renvoie le problème, ou null.
 */
export function apiUrlProblem(base: string, production: boolean): string | null {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return `Adresse de l’API invalide (VITE_API_URL = « ${base} »).`;
  }
  if (production && url.protocol !== 'https:' && !LOCAL_HOSTS.includes(url.hostname)) {
    return `Adresse de l’API non sécurisée (${url.origin}) : configurez une adresse en https dans VITE_API_URL.`;
  }
  return null;
}

/** Problème de configuration qui interdit tout appel à l'API (affiché à la place de la caisse). */
export const apiConfigError = apiUrlProblem(BASE, import.meta.env.PROD);

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let token: string | null = null;
export const setToken = (t: string | null) => { token = t; };

// Prévenu quand l'API refuse le token (401) : session expirée, ou fausse API relancée qui a oublié ses tokens.
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn; };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Erreur simple (pas ApiError) : pour la synchro, c'est « pas de réseau », les ventes restent sur la caisse.
  if (apiConfigError) throw new Error(apiConfigError);
  const sentToken = token;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      ...(sentToken ? { Authorization: `Bearer ${sentToken}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => null);
  // Un 401 sans token (mauvais identifiants) ou sur un ancien token (reconnexion entre-temps) ne déconnecte pas.
  if (res.status === 401 && sentToken && sentToken === token) onUnauthorized?.();
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? res.statusText);
  return body as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<Auth>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  categories: () => request<Category[]>('/categories'),
  brands: () => request<Brand[]>('/brands'),
  products: (storeId: string, updatedSince?: string) =>
    request<Product[]>(`/products?store_id=${encodeURIComponent(storeId)}${updatedSince ? `&updated_since=${encodeURIComponent(updatedSince)}` : ''}`),
  customers: (search = '') => request<Customer[]>(`/customers?search=${encodeURIComponent(search)}`),
  createCustomer: (c: Omit<Customer, 'matricule'> & { matricule?: string | null }) =>
    request<Customer>('/customers', { method: 'POST', body: JSON.stringify(c) }),
  createSale: (sale: Sale) =>
    request<{ id: string; status: string; stock_warning: boolean }>('/sales', { method: 'POST', body: JSON.stringify(sale) }),
  syncSales: (sales: Sale[]) =>
    request<{ results: { id: string; status: string }[] }>('/sales/batch', { method: 'POST', body: JSON.stringify({ sales }) }),
  // Retours (§5 et §10)
  saleByNumber: (number: string) => request<SaleLookup>(`/sales/by-number/${encodeURIComponent(number)}`),
  createRefund: (refund: Refund) =>
    request<{ id: string; status: string; session_closed?: boolean }>('/refunds', { method: 'POST', body: JSON.stringify(refund) }),
  // Sessions de caisse (§9)
  currentCashSession: (registerId: string) =>
    request<{ session: CashSession | null }>(`/cash-sessions/current?register_id=${encodeURIComponent(registerId)}`),
  openCashSession: (opening: CashSessionOpening) =>
    request<{ id: string; status: string }>('/cash-sessions', { method: 'POST', body: JSON.stringify(opening) }),
  addCashMovement: (movement: CashMovement) =>
    request<{ id: string; status: string; session_closed?: boolean }>('/cash-movements', { method: 'POST', body: JSON.stringify(movement) }),
  closeCashSession: (sessionId: string, closing: CashSessionClosing) =>
    request<{ id: string; status: string; expected_mismatch?: boolean }>(
      `/cash-sessions/${encodeURIComponent(sessionId)}/close`, { method: 'POST', body: JSON.stringify(closing) },
    ),
};
