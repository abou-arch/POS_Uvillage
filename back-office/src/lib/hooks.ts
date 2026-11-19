// État partagé du back-office (utilisateur, magasin choisi, période) et petits outils React.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Me } from '../api/types'
import type { Period } from './period'

export interface AppState {
  me: Me
  /** Magasin choisi en haut de l'écran ; '' = tous les magasins de l'utilisateur. */
  storeId: string
  setStoreId: (id: string) => void
  period: Period
  setPeriod: (p: Period) => void
  timeZone: string
  isAdmin: boolean
  reloadMe: () => Promise<void>
  notify: (message: string, tone?: 'ok' | 'error') => void
}

export const AppContext = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp hors de AppContext')
  return ctx
}

export interface Loaded<T> { data: T | null; error: unknown; loading: boolean; reload: () => void }

/**
 * Charge des données ; recharge quand `key` change (ou sur `reload`). Une réponse arrivée après une plus récente est
 * ignorée. Pendant un rechargement de la même clé, les données affichées restent ; pour une autre clé, elles s'effacent.
 */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [tick, setTick] = useState(0)
  const request = `${key}#${tick}`
  const [state, setState] = useState<{ key: string | null; request: string | null; data: T | null; error: unknown }>(
    { key: null, request: null, data: null, error: null })
  useEffect(() => {
    let alive = true
    load().then(
      (data) => { if (alive) setState({ key, request, data, error: null }) },
      (error) => { if (alive) setState((s) => ({ key, request, data: s.key === key ? s.data : null, error })) },
    )
    return () => { alive = false }
    // `load` change à chaque rendu ; la clé dit quand recharger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  const current = state.request === request
  return { data: state.key === key ? state.data : null, error: current ? state.error : null, loading: !current, reload }
}

/** Valeur qui suit `value` après `ms` sans changement (recherche pendant la frappe). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Route lue dans l'adresse : #/ventes/123 → ['ventes', '123']. */
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const [parts, setParts] = useState(read)
  useEffect(() => {
    const on = () => setParts(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return parts
}

export const go = (path: string) => { window.location.hash = path }
