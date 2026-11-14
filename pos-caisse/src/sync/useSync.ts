// Synchronisation de la caisse : vide l'outbox puis met le catalogue à jour, au démarrage, quand le réseau
// revient, toutes les 30 s (moins souvent après des échecs), après chaque opération et sur clic de l'indicateur.
// Elle tourne tant qu'une caisse est choisie, session ouverte ou non : la clôture part aussi depuis l'écran d'ouverture.
import { useCallback, useEffect, useRef, useState } from 'react';
import { syncCatalog } from '../db/catalog';
import { db } from '../db/db';
import { ensureMigrated } from '../db/migrate';
import { dexieOutbox, isOutboxEntry } from '../db/outbox';
import { useLiveQuery } from '../db/useLiveQuery';
import { apiSenders, createSyncLoop, flushOutbox } from './sync';

export type Connection = 'online' | 'offline' | 'syncing';

/** Ce que la dernière synchro a dit de chaque opération : reçue, ou refusée avec le motif. */
export type Outcome = { status: 'sent' } | { status: 'rejected'; error: string };

const MAX_OUTCOMES = 50;

export function useSync(storeId: string) {
  const [connection, setConnection] = useState<Connection>(() => (navigator.onLine ? 'syncing' : 'offline'));
  const [outcomes, setOutcomes] = useState<Map<string, Outcome>>(() => new Map());
  const loop = useRef<ReturnType<typeof createSyncLoop> | null>(null);
  const outbox = useLiveQuery(() => db.outbox.orderBy('queued_at').toArray(), [], []);

  useEffect(() => {
    const record = (sent: string[], rejected: { id: string; error: string }[]) => {
      if (sent.length === 0 && rejected.length === 0) return;
      setOutcomes((prev) => {
        const next = new Map(prev);
        for (const id of sent) next.set(id, { status: 'sent' });
        for (const r of rejected) next.set(r.id, { status: 'rejected', error: r.error });
        return new Map([...next].slice(-MAX_OUTCOMES));
      });
    };

    const l = createSyncLoop(async (force) => {
      setConnection('syncing');
      try {
        await ensureMigrated(); // les ventes à envoyer de l'ancienne version partent aussi
        const flush = await flushOutbox(dexieOutbox, apiSenders, { includeErrors: force });
        record(flush.sent, flush.rejected);
        if (flush.status !== 'done') {
          setConnection('offline');
          return flush.status === 'unauthorized' ? 'unauthorized' : 'offline';
        }
        await syncCatalog(storeId);
      } catch {
        setConnection('offline'); // API injoignable pour le catalogue, ou base locale indisponible
        return 'offline';
      }
      setConnection('online');
      return 'ok';
    });
    loop.current = l;
    void l.start();
    const onOnline = () => void l.online();
    const onOffline = () => setConnection('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      l.stop();
      loop.current = null;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [storeId]);

  const valid = outbox.value.filter(isOutboxEntry);
  return {
    connection,
    outbox: valid,
    outboxLoaded: outbox.loaded,
    outboxUnreadable: outbox.value.length - valid.length,
    storageError: outbox.error !== null, // IndexedDB indisponible : impossible de vendre hors ligne
    outcomes,
    sync: useCallback((force = false) => void loop.current?.trigger(force), []),
  };
}

export type SyncState = ReturnType<typeof useSync>;
