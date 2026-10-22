// Ventes en attente de la caisse : chaque changement est écrit tout de suite dans localStorage.
import { useCallback, useMemo, useRef, useState } from 'react';
import { loadHeld, saveHeld, type HeldSale } from './held';

export function useHeldSales(registerId: string) {
  const [held, setHeld] = useState(() => loadHeld(registerId));
  const [saved, setSaved] = useState(true); // false : stockage local indisponible
  const current = useRef(held);

  const commit = useCallback((change: (l: HeldSale[]) => HeldSale[]) => {
    current.current = { ...current.current, sales: change(current.current.sales) };
    setSaved(saveHeld(registerId, current.current));
    setHeld(current.current);
  }, [registerId]);

  return useMemo(() => ({
    list: held.sales,
    unreadable: held.unreadable.length,
    saved,
    add: (sale: HeldSale) => commit((l) => [...l, sale]),
    remove: (id: string) => commit((l) => l.filter((h) => h.id !== id)),
  }), [held, saved, commit]);
}
