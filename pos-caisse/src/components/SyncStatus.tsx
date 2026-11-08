import type { Connection } from '../sync/useSync';

const LABELS: Record<Connection, string> = { online: 'En ligne', offline: 'Hors ligne', syncing: 'Synchro…' };

// Indicateur de l'en-tête : connexion au serveur et ventes pas encore reçues. Un clic lance la synchro tout de suite
// (et renvoie aussi les ventes refusées, une fois vérifiées).
export function SyncStatus({ connection, pending, rejected, onSync }: {
  connection: Connection;
  pending: number;
  rejected: number;
  onSync: () => void;
}) {
  return (
    <button type="button" className={`sync-status ${connection}`} onClick={onSync} disabled={connection === 'syncing'}
      title="Synchroniser maintenant" aria-live="polite">
      <span className="led" aria-hidden="true" />
      {LABELS[connection]}
      <span className="sep" aria-hidden="true">·</span>
      <span className={pending > 0 ? 'pending' : ''}>{pending} à envoyer</span>
      {rejected > 0 && <span className="rejected">dont {rejected} refusée{rejected > 1 ? 's' : ''}</span>}
    </button>
  );
}
