// Session de la caisse : connexion, magasin et caisse choisis, conservés dans localStorage pour survivre à un F5.
import { browserStorage, isId, isRecord } from '../lib/storage';
import type { Auth, Register, Session, Store, User } from '../types';

export const SESSION_KEY = 'pos.session';

/** Magasin proposé d'office : seulement s'il n'y en a qu'un. */
export const initialStore = (stores: Store[]): Store | null => (stores.length === 1 ? stores[0] : null);

/** Caisse prise d'office : seulement si le magasin n'en a qu'une. */
export const onlyRegister = (store: Store): Register | null => (store.registers.length === 1 ? store.registers[0] : null);

/** Pas d'écran de choix s'il n'y a qu'un magasin avec une seule caisse. */
export function autoSelection(stores: Store[]): { storeId: string; registerId: string } | null {
  const store = initialStore(stores);
  const register = store && onlyRegister(store);
  return store && register ? { storeId: store.id, registerId: register.id } : null;
}

export const isSession = (s: Auth | Session): s is Session => 'storeId' in s;

/**
 * Complète la connexion avec le magasin et la caisse demandés s'ils existent,
 * sinon avec le choix automatique. À défaut, il reste à passer par l'écran de choix.
 */
export function selectRegister(auth: Auth, storeId?: string, registerId?: string): Auth | Session {
  const base: Auth = { token: auth.token, user: auth.user, stores: auth.stores };
  const store = auth.stores.find((s) => s.id === storeId);
  const register = store?.registers.find((r) => r.id === registerId);
  const chosen = store && register ? { storeId: store.id, registerId: register.id } : autoSelection(auth.stores);
  return chosen ? { ...base, ...chosen } : base;
}

export function saveSession(session: Auth | Session, storage = browserStorage()) {
  try {
    storage?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Stockage plein ou bloqué : la session marche quand même, mais ne survivra pas à un F5.
  }
}

/** N'efface que la session : les ventes en attente ou à envoyer ne doivent jamais partir avec la déconnexion. */
export function clearSession(storage = browserStorage()) {
  try {
    storage?.removeItem(SESSION_KEY);
  } catch {
    // Stockage bloqué : rien à effacer.
  }
}

const isUser = (v: unknown): v is User =>
  isRecord(v) && isId(v.id) && typeof v.name === 'string' && ['admin', 'manager', 'cashier'].includes(v.role as string);
const isRegister = (v: unknown): v is Register => isRecord(v) && isId(v.id) && typeof v.name === 'string';
const isStore = (v: unknown): v is Store =>
  isRecord(v) && isId(v.id) && typeof v.name === 'string' && Array.isArray(v.registers) && v.registers.every(isRegister);
const isAuth = (v: unknown): v is Auth =>
  isRecord(v) && isId(v.token) && isUser(v.user) && Array.isArray(v.stores) && v.stores.every(isStore);

/** Session sauvegardée, vérifiée champ par champ : rien d'utilisable → null (retour au login). */
export function loadSession(storage = browserStorage()): Auth | Session | null {
  let saved: unknown;
  try {
    saved = JSON.parse(storage?.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
  if (!isAuth(saved)) return null;
  const { storeId, registerId } = saved as Partial<Session>;
  return selectRegister(saved, storeId, registerId);
}
