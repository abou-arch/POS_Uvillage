// Relit une requête Dexie à chaque changement des tables qu'elle lit (liveQuery est fourni par Dexie).
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';

export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[], initial: T) {
  const [state, setState] = useState<{ value: T; loaded: boolean; error: unknown }>({ value: initial, loaded: false, error: null });
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: (value) => setState({ value, loaded: true, error: null }),
      error: (error) => setState((s) => ({ ...s, loaded: true, error })),
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la requête est recréée à chaque rendu : seules les dépendances comptent
  }, deps);
  return state;
}
