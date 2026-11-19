import { useCallback, useEffect, useState } from 'react';
import { useCashSessions } from '../db/cashSessions';
import { allowedPage, type ManagementPage } from '../state/permissions';
import { useSync } from '../sync/useSync';
import type { Session } from '../types';
import { ManageContext } from './management/shared';
import { ManagementScreen } from './management/ManagementScreen';
import { OpeningScreen } from './OpeningScreen';
import { PosScreen } from './PosScreen';

/** Page de gestion lue dans l'adresse (« #gestion/ventes »…) : un F5 ou le bouton Précédent retrouvent la page. */
const HASH_PAGES: Record<string, ManagementPage> = {
  'tableau-de-bord': 'dashboard', ventes: 'sales', sessions: 'sessions', articles: 'products', clients: 'customers', rapports: 'reports',
};
const PAGE_HASH = Object.fromEntries(Object.entries(HASH_PAGES).map(([k, v]) => [v, k])) as Record<ManagementPage, string>;

function readHash(): { page: string | null } | null {
  const m = /^#gestion(?:\/([\w-]+))?$/.exec(window.location.hash);
  return m ? { page: m[1] ? HASH_PAGES[m[1]] ?? null : null } : null;
}

// Caisse choisie : écran d'ouverture tant qu'aucune session n'est ouverte, sinon écran de caisse. La session
// est relue sur le poste : après un F5 ou une coupure, la caisse reprend la session en cours.
// La synchro tourne sur les deux écrans : la clôture part aussi depuis l'écran d'ouverture.
// L'espace Gestion s'ouvre par-dessus (bouton de l'en-tête) : l'écran de caisse reste monté, le panier est gardé.
export function CashRegister({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const sync = useSync(session.storeId);
  const cash = useCashSessions(session.registerId);
  const [closedNow, setClosedNow] = useState<string | null>(null);
  const [managing, setManaging] = useState(readHash);

  useEffect(() => {
    const onHash = () => setManaging(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((page?: ManagementPage) => {
    window.location.hash = `gestion/${PAGE_HASH[allowedPage(session.user.role, page)]}`;
  }, [session.user.role]);
  const closeManagement = useCallback(() => {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    setManaging(null);
  }, []);

  // Déconnexion depuis la Gestion : l'adresse est remise à zéro, le caissier suivant arrive sur la caisse.
  const logoutFromManagement = () => { closeManagement(); onLogout(); };

  if (!cash.loaded) return <div className="auth-screen"><p className="muted">Chargement de la caisse…</p></div>;
  return (
    <ManageContext.Provider value={navigate}>
      {cash.open ? (
        <PosScreen key={cash.open.id} session={session} cashSession={cash.open} sync={sync} unreadableSessions={cash.unreadable}
          onClosed={setClosedNow} onLogout={onLogout} />
      ) : (
        <OpeningScreen session={session} sync={sync} lastClosed={cash.lastClosed} closedNow={closedNow}
          unreadable={sync.outboxUnreadable + cash.unreadable} storageError={cash.storageError || sync.storageError} onLogout={onLogout} />
      )}
      {managing && (
        <ManagementScreen session={session} sync={sync} page={allowedPage(session.user.role, managing.page)}
          onNavigate={navigate} onClose={closeManagement}
          onLogout={logoutFromManagement} />
      )}
    </ManageContext.Provider>
  );
}
