// Synchronisation de la caisse : vide l'outbox puis met le catalogue à jour, au démarrage, quand le réseau
// revient, toutes les 30 s (moins souvent après des échecs), après chaque opération et sur clic de l'indicateur.
// Elle tourne tant qu'une caisse est choisie, session ouverte ou non : la clôture part aussi depuis l'écran d'ouverture.
import { useCallback, useEffect, useRef, useState } from 'react';
import { syncApprovers } from '../db/approvers';
import { syncBarcodeRules } from '../db/barcodeRules';
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
const CATALOG_REFRESH_MS = 10_000;

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
        // Responsables et empreinte de leur PIN (§11) : en cas d'échec, la liste gardée sur la caisse reste valable.
        await syncApprovers(storeId).catch(() => {});
        // Règles des codes-barres de la balance (§3) : en cas d'échec, les règles gardées restent valables.
        await syncBarcodeRules(storeId).catch(() => {});
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

  // Le stock doit suivre sans rechargement : relecture toutes les 10 s quand tout va bien, et dès que la fenêtre
  // redevient visible ou reprend le focus. Passe par la boucle (jamais deux passages à la fois, vente envoyée avant lecture).
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void loop.current?.trigger(false);
    };
    const timer = window.setInterval(() => {
      if (loop.current?.failures === 0) refresh();
    }, CATALOG_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
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
