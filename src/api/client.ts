// Client HTTP de la caisse. Seul fichier à modifier pour pointer vers la vraie API (VITE_API_URL).
import type { Auth, Brand, Category, Customer, Product, Sale } from '../types';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

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
  const sentToken = token;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
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
    request<Product[]>(`/products?store_id=${storeId}${updatedSince ? `&updated_since=${encodeURIComponent(updatedSince)}` : ''}`),
  customers: (search = '') => request<Customer[]>(`/customers?search=${encodeURIComponent(search)}`),
  createCustomer: (c: Omit<Customer, 'matricule'> & { matricule?: string | null }) =>
    request<Customer>('/customers', { method: 'POST', body: JSON.stringify(c) }),
  createSale: (sale: Sale) =>
    request<{ id: string; status: string; stock_warning: boolean }>('/sales', { method: 'POST', body: JSON.stringify(sale) }),
  syncSales: (sales: Sale[]) =>
    request<{ results: { id: string; status: string }[] }>('/sales/batch', { method: 'POST', body: JSON.stringify({ sales }) }),
};
