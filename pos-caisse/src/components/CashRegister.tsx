import { useState } from 'react';
import { useCashSessions } from '../db/cashSessions';
import { useSync } from '../sync/useSync';
import type { Session } from '../types';
import { OpeningScreen } from './OpeningScreen';
import { PosScreen } from './PosScreen';

// Caisse choisie : écran d'ouverture tant qu'aucune session n'est ouverte, sinon écran de caisse. La session
// est relue sur le poste : après un F5 ou une coupure, la caisse reprend la session en cours.
// La synchro tourne sur les deux écrans : la clôture part aussi depuis l'écran d'ouverture.
export function CashRegister({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const sync = useSync(session.storeId);
  const cash = useCashSessions(session.registerId);
  const [closedNow, setClosedNow] = useState<string | null>(null);

  if (!cash.loaded) return <div className="auth-screen"><p className="muted">Chargement de la caisse…</p></div>;
  if (cash.open) {
    return (
      <PosScreen key={cash.open.id} session={session} cashSession={cash.open} sync={sync} unreadableSessions={cash.unreadable}
        onClosed={setClosedNow} onLogout={onLogout} />
    );
  }
  return (
    <OpeningScreen session={session} sync={sync} lastClosed={cash.lastClosed} closedNow={closedNow}
      unreadable={sync.outboxUnreadable + cash.unreadable} storageError={cash.storageError || sync.storageError} onLogout={onLogout} />
  );
}
