// Liste des ventes à envoyer : chaque changement est écrit tout de suite dans localStorage.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Sale } from '../types';
import { loadPending, savePending, type PendingSale } from './sales';

export function usePendingSales() {
  const [queue, setQueue] = useState(loadPending);
  const [saved, setSaved] = useState(true); // false : stockage local indisponible
  const current = useRef(queue);

  // Seules les ventes lisibles changent : les entrées illisibles sont réécrites telles quelles à chaque fois.
  const commit = useCallback((change: (l: PendingSale[]) => PendingSale[]) => {
    current.current = { ...current.current, sales: change(current.current.sales) };
    setSaved(savePending(current.current));
    setQueue(current.current);
  }, []);

  return useMemo(() => ({
    list: queue.sales,
    unreadable: queue.unreadable.length, // ni envoyées ni effacées, à faire vérifier
    saved,
    add: (sale: Sale) => commit((l) => [...l, { sale, error: null }]),
    remove: (id: string) => commit((l) => l.filter((p) => p.sale.id !== id)),
    reject: (id: string, error: string) => commit((l) => l.map((p) => (p.sale.id === id ? { ...p, error } : p))),
  }), [queue, saved, commit]);
}
