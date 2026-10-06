// Client HTTP de la caisse. Seul fichier à modifier pour pointer vers la vraie API (VITE_API_URL).
import type { Brand, Category, Customer, Product, Sale, Store, User } from '../types';

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? res.statusText);
  return body as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; user: User; stores: Store[] }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  categories: () => request<Category[]>('/categories'),
  brands: () => request<Brand[]>('/brands'),
  products: (storeId: string, updatedSince?: string) =>
    request<Product[]>(`/products?store_id=${storeId}${updatedSince ? `&updated_since=${encodeURIComponent(updatedSince)}` : ''}`),
  customers: (search = '') => request<Customer[]>(`/customers?search=${encodeURIComponent(search)}`),
  createCustomer: (c: Omit<Customer, 'ice'> & { ice?: string | null }) =>
    request<Customer>('/customers', { method: 'POST', body: JSON.stringify(c) }),
  createSale: (sale: Sale) =>
    request<{ id: string; status: string; stock_warning: boolean }>('/sales', { method: 'POST', body: JSON.stringify(sale) }),
  syncSales: (sales: Sale[]) =>
    request<{ results: { id: string; status: string }[] }>('/sales/batch', { method: 'POST', body: JSON.stringify({ sales }) }),
};
