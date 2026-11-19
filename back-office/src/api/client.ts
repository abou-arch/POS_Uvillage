// Tous les appels réseau du back-office passent par ici (contrat §2, §5, §12).
// Le token est gardé pour l'onglet seulement (sessionStorage) : fermer l'onglet déconnecte.

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4100/api'

/** Adresse de l'API refusée : https obligatoire hors du poste de développement. */
export function apiUrlProblem(url = API_URL): string | null {
  try {
    const u = new URL(url)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    if (u.protocol !== 'https:' && !local) return 'L’adresse de l’API doit être en https.'
    return null
  } catch {
    return 'Adresse de l’API invalide (VITE_API_URL).'
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const TOKEN_KEY = 'back-office-token'
let token: string | null = (() => {
  try { return sessionStorage.getItem(TOKEN_KEY) } catch { return null }
})()
let onUnauthorized: (() => void) | null = null

export const hasToken = () => token !== null
export function setToken(t: string | null) {
  token = t
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // stockage indisponible (navigation privée stricte) : la connexion dure tant que la page est ouverte
  }
}
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn }

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Serveur injoignable. Vérifiez la connexion et que le serveur est lancé.')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const e = data?.error
    if (res.status === 401 && path !== '/auth/login') onUnauthorized?.()
    throw new ApiError(res.status, e?.code ?? 'HTTP', e?.message ?? `Erreur ${res.status}`, e?.details ?? {})
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: (path: string) => request<void>('DELETE', path),
}

/** Paramètres d'URL sans les valeurs vides. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === true ? '1' : String(v))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}
