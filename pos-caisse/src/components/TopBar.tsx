import type { ReactNode } from 'react';
import { placeOf } from '../state/session';
import { describeItem } from '../sync/sync';
import type { SyncState } from '../sync/useSync';
import type { Session } from '../types';
import { SyncStatus } from './SyncStatus';
import { Avatar, Icon } from './ui';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('{n}', String(n)));

// En-tête commun à l'écran d'ouverture et à l'écran de caisse : où l'on est, la synchro, qui est connecté.
export function TopBar({ session, sync, children, onLogout }: {
  session: Session;
  sync: SyncState;
  children?: ReactNode;
  onLogout: () => void;
}) {
  const { storeName, registerName } = placeOf(session);
  const rejected = sync.outbox.filter((e) => e.error !== null).length;
  return (
    <header className="topbar">
      <span className="brand"><span className="logo"><Icon name="register" size={18} /></span>Caisse</span>
      <span className="where"><Icon name="store" size={16} />{storeName}<span className="dot">·</span>{registerName}</span>
      <SyncStatus connection={sync.connection} pending={sync.outbox.length} rejected={rejected} onSync={() => sync.sync(true)} />
      <span className="spacer" />
      {children}
      <span className="who" title={session.user.name}><Avatar name={session.user.name} /><span className="label">{session.user.name}</span></span>
      <button className="btn ghost" onClick={onLogout}><Icon name="logout" size={18} />Déconnexion</button>
    </header>
  );
}

// Opérations refusées par l'API ou illisibles : elles restent sur la caisse, à faire vérifier.
export function SyncBanners({ sync, unreadable }: { sync: SyncState; unreadable: number }) {
  const rejected = sync.outbox.filter((e) => e.error !== null);
  const shown = rejected.slice(0, 2).map((e) => `${describeItem(e)} : ${e.error}`).join(' · ');
  return (
    <>
      {rejected.length > 0 && (
        <p className="banner notice">
          <Icon name="alert" size={18} />
          <span>
            {plural(rejected.length, 'Une opération a été refusée par le serveur', '{n} opérations ont été refusées par le serveur')}
            {' '}({shown}{rejected.length > 2 ? ' · …' : ''}) : gardée{rejected.length > 1 ? 's' : ''} sur la caisse,
            à faire vérifier. Cliquez sur l’indicateur pour réessayer.
          </span>
        </p>
      )}
      {unreadable > 0 && (
        <p className="banner">
          <Icon name="alert" size={18} />
          {plural(unreadable, 'Une opération gardée sur la caisse est illisible', '{n} opérations gardées sur la caisse sont illisibles')}
          {' '}: rien n’est envoyé ni effacé, à faire vérifier.
        </p>
      )}
    </>
  );
}
