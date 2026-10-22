// Accès à localStorage. Il peut être indisponible (stockage bloqué ou plein) : la caisse doit continuer à marcher.
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Texte enregistré tel quel, ou null s'il est absent ou si le stockage est indisponible. */
export function readText(key: string, storage = browserStorage()): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Valeur JSON enregistrée, ou null si absente, illisible ou stockage indisponible. */
export function readJson(key: string, storage = browserStorage()): unknown {
  try {
    return JSON.parse(readText(key, storage) ?? 'null');
  } catch {
    return null;
  }
}

// Ce que renvoie readJson n'est pas fiable (stockage abîmé, autre version de la caisse) : on le vérifie avant usage.
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
export const isId = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** Enregistre une valeur JSON ; false si le stockage est plein ou bloqué. */
export function writeJson(key: string, value: unknown, storage = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
