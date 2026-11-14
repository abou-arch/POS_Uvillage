import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AUTO_PRINT, storeInfo, TIME_ZONE } from '../config/store';
import { openCashSession, sessionReceipt, unknownServerSession } from '../db/cashSessions';
import { buildOpening, MAX_TEXT_LENGTH, openingError, type LocalCashSession } from '../lib/cashSession';
import { receiptDate, signedMad } from '../lib/receipt';
import { METHOD_LABELS } from '../state/payment';
import { uuidv4 } from '../lib/uuid';
import { placeOf } from '../state/session';
import { useCashInput } from '../state/useCashInput';
import { usePrint } from '../state/usePrint';
import type { SyncState } from '../sync/useSync';
import type { CashSession, Session } from '../types';
import { CashInput } from './CashInput';
import { PrintSheet } from './Ticket';
import { SyncBanners, TopBar } from './TopBar';
import { Icon } from './ui';

/** « aucun écart », ou les écarts de la dernière clôture : « écart espèces -10,00 DH ». */
function gapsText(session: LocalCashSession): string {
  const gaps = (session.counts ?? []).filter((c) => c.difference !== 0);
  if (gaps.length === 0) return 'aucun écart';
  return gaps.map((c) => `écart ${METHOD_LABELS[c.method].toLowerCase()} ${signedMad(c.difference)}`).join(', ');
}

type ServerCheck =
  | { status: 'checking' }
  | { status: 'free' }
  | { status: 'unreachable' }
  | { status: 'conflict'; session: CashSession };

// Aucune session ouverte sur cette caisse : on l'ouvre avec le fond de caisse. Marche hors ligne ; en ligne, la
// caisse vérifie d'abord qu'aucune session n'est déjà ouverte ailleurs sur cette caisse (§9).
export function OpeningScreen({ session, sync, lastClosed, closedNow, unreadable, storageError, onLogout }: {
  session: Session;
  sync: SyncState;
  lastClosed: LocalCashSession | null;
  closedNow: string | null; // session qui vient d'être clôturée sur ce poste : son rapport s'imprime tout seul
  unreadable: number;
  storageError: boolean;
  onLogout: () => void;
}) {
  const cash = useCashInput(); // fond de caisse saisi directement ou compté billet par billet
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [server, setServer] = useState<ServerCheck>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const autoPrinted = useRef<string | null>(null);
  const { doc, print } = usePrint();
  const { storeName, registerName } = placeOf(session);
  const reachable = sync.connection !== 'offline'; // ne change qu'à la perte ou au retour du réseau
  const retry = server.status === 'unreachable' && sync.connection === 'online'; // la synchro passe : on revérifie

  const amountError = cash.countError ?? (cash.empty && cash.mode === 'direct' && !tried ? null : openingError(cash.cents));
  const blocked = storageError || server.status === 'conflict' || server.status === 'checking';

  // Vérifié à l'affichage, quand le réseau revient (ou que la synchro passe après un échec), et sur demande.
  useEffect(() => {
    let cancelled = false;
    unknownServerSession(session.registerId)
      .then((s) => { if (!cancelled) setServer(s ? { status: 'conflict', session: s } : { status: 'free' }); })
      .catch(() => { if (!cancelled) setServer({ status: 'unreachable' }); });
    return () => { cancelled = true; };
  }, [session.registerId, reachable, retry, attempt]);

  const printClosing = useCallback(async (closed: LocalCashSession) => {
    try {
      print({ kind: 'session', report: await sessionReceipt(closed, registerName, storeInfo(session.storeId, storeName)) });
    } catch {
      setFailure('Impression impossible : stockage local indisponible.');
    }
  }, [print, registerName, session.storeId, storeName]);

  // Juste après la clôture, le rapport s'imprime tout seul, comme le ticket après une vente.
  useEffect(() => {
    if (!AUTO_PRINT || !closedNow || lastClosed?.id !== closedNow || autoPrinted.current === closedNow) return;
    autoPrinted.current = closedNow;
    void printClosing(lastClosed);
  }, [closedNow, lastClosed, printClosing]);

  function recheck() {
    setServer({ status: 'checking' });
    setAttempt((n) => n + 1);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    const cents = cash.cents;
    if (blocked || saving || cash.countError || openingError(cents) || cents === null) return;
    setSaving(true);
    try {
      const opening = buildOpening({
        id: uuidv4(), storeId: session.storeId, registerId: session.registerId, openedBy: session.user.id,
        openingCash: cents, note, now: new Date(),
      });
      await openCashSession(opening, session.user.name);
      sync.sync(); // l'écran de caisse s'affiche dès que la session est écrite sur le poste
    } catch (err) {
      setFailure(err instanceof Error && err.message.startsWith('Une session')
        ? err.message
        : 'Stockage local indisponible : la caisse n’est pas ouverte. Réessayez.');
      setSaving(false);
    }
  }

  return (
    <div className="pos">
      <TopBar session={session} sync={sync} onLogout={onLogout} />
      {storageError && (
        <p className="banner"><Icon name="alert" size={18} />Base locale indisponible : impossible d’ouvrir la caisse sur ce poste.</p>
      )}
      <SyncBanners sync={sync} unreadable={unreadable} />
      <div className="opening">
        <form className="card opening-card" onSubmit={submit}>
          <div className="card-title">
            <h1>Ouverture de caisse</h1>
            <p className="muted">{storeName} · {registerName}</p>
          </div>

          {server.status === 'conflict' && (
            <div className="alert column" role="alert">
              <strong>Une session est déjà ouverte sur cette caisse.</strong>
              <span>
                {Number.isNaN(Date.parse(server.session.opened_at)) ? 'Ouverte' : `Ouverte le ${receiptDate(server.session.opened_at, TIME_ZONE)}`}
                , sur un autre poste ou avant un effacement des données de ce poste. Elle doit être clôturée avant d’en ouvrir une nouvelle : voyez avec le responsable.
              </span>
              <button type="button" className="link" onClick={recheck}>Vérifier à nouveau</button>
            </div>
          )}
          {server.status === 'unreachable' && (
            <p className="notice">
              <Icon name="alert" size={18} />
              <span>
                Serveur injoignable : la caisse s’ouvre quand même, l’ouverture sera envoyée au retour du réseau.{' '}
                <button type="button" className="link" onClick={recheck}>Vérifier à nouveau</button>
              </span>
            </p>
          )}

          <CashInput input={cash} label="Fond de caisse" hint="espèces dans le tiroir au début de la session"
            invalid={!!amountError} disabled={storageError} autoFocus />
          <label>
            <span>Note <small>(facultative)</small></span>
            <input value={note} maxLength={MAX_TEXT_LENGTH} autoComplete="off" disabled={storageError}
              onChange={(e) => setNote(e.target.value)} />
          </label>
          {amountError && <p className="field-error" role="alert">{amountError}</p>}
          {failure && <p className="field-error" role="alert">{failure}</p>}
          <button className="btn validate big" disabled={blocked || saving}>
            <Icon name="register" size={20} />
            {server.status === 'checking' ? 'Vérification…' : 'Ouvrir la caisse'}
          </button>

          {lastClosed && (
            <div className="last-closing">
              <span className="muted">
                Dernière clôture : {lastClosed.closed_at ? receiptDate(lastClosed.closed_at, TIME_ZONE) : '—'}
                {lastClosed.closed_by_name ? ` par ${lastClosed.closed_by_name}` : ''}
                {lastClosed.counts && <> · {gapsText(lastClosed)}</>}
              </span>
              <button type="button" className="link" onClick={() => void printClosing(lastClosed)}>
                <Icon name="printer" size={16} />Réimprimer le rapport de clôture
              </button>
            </div>
          )}
        </form>
      </div>
      <PrintSheet doc={doc} />
    </div>
  );
}
