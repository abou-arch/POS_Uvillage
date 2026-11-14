// Impression 80 mm : un seul document à la fois (ticket de vente, ticket de retour, ticket d'entrée / sortie d'espèces,
// ou rapport de session X ou de clôture).
import { useCallback, useEffect, useState } from 'react';
import type { MovementReceipt, Receipt, RefundReceipt, SessionReceipt } from '../lib/receipt';

export type PrintDoc =
  | { kind: 'sale'; receipt: Receipt; copy: boolean }
  | { kind: 'refund'; receipt: RefundReceipt }
  | { kind: 'movement'; receipt: MovementReceipt }
  | { kind: 'session'; report: SessionReceipt };

/** L'impression part après le rendu, pour que la feuille imprimée soit bien celle qui vient d'être demandée. */
export function usePrint() {
  const [job, setJob] = useState<{ doc: PrintDoc } | null>(null);
  useEffect(() => {
    if (job) window.print();
  }, [job]);
  return { doc: job?.doc ?? null, print: useCallback((doc: PrintDoc) => setJob({ doc }), []) };
}
