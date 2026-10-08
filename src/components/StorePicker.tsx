import { useState } from 'react';
import { initialStore, onlyRegister } from '../state/session';
import type { Auth, Store } from '../types';
import { Avatar, Icon } from './ui';

// Choix du magasin puis de la caisse après la connexion, seulement quand il y a vraiment un choix à faire.
export function StorePicker({ auth, onSelect, onLogout }: {
  auth: Auth;
  onSelect: (storeId: string, registerId: string) => void;
  onLogout: () => void;
}) {
  const [store, setStore] = useState<Store | null>(() => initialStore(auth.stores));
  const firstOpen = auth.stores.find((s) => s.registers.length > 0);

  function pickStore(s: Store) {
    const register = onlyRegister(s);
    if (register) onSelect(s.id, register.id);
    else setStore(s);
  }

  return (
    <div className="auth-screen">
      <div className="card picker">
        <ol className="steps">
          <li className={store ? 'done' : 'current'}>Magasin</li>
          <li className="sep" aria-hidden="true" />
          <li className={store ? 'current' : ''}>Caisse</li>
        </ol>
        {store ? (
          <>
            <div className="card-title">
              <h1>Choisissez la caisse</h1>
              <p className="muted">{store.name}</p>
            </div>
            {store.registers.length === 0 && <p className="alert">Aucune caisse dans ce magasin.</p>}
            <div className="choices" key={store.id}>
              {store.registers.map((r, i) => (
                <button key={r.id} className="choice" autoFocus={i === 0} onClick={() => onSelect(store.id, r.id)}>
                  <span className="choice-icon"><Icon name="register" /></span>
                  <span className="choice-text"><strong>{r.name}</strong></span>
                  <Icon name="chevronRight" />
                </button>
              ))}
            </div>
            {auth.stores.length > 1 && (
              <button className="link back" onClick={() => setStore(null)}><Icon name="chevronLeft" size={16} />Changer de magasin</button>
            )}
          </>
        ) : (
          <>
            <div className="card-title">
              <h1>Choisissez le magasin</h1>
              <p className="muted">Où travaillez-vous aujourd'hui ?</p>
            </div>
            {auth.stores.length === 0 && <p className="alert">Aucun magasin n'est rattaché à ce compte.</p>}
            <div className="choices" key="stores">
              {auth.stores.map((s) => (
                <button key={s.id} className="choice" autoFocus={s === firstOpen} disabled={s.registers.length === 0}
                  onClick={() => pickStore(s)}>
                  <span className="choice-icon"><Icon name="store" /></span>
                  <span className="choice-text"><strong>{s.name}</strong><span className="muted">{registerCount(s)}</span></span>
                  <Icon name="chevronRight" />
                </button>
              ))}
            </div>
          </>
        )}
        <footer>
          <span className="who"><Avatar name={auth.user.name} />{auth.user.name}</span>
          <button className="link" onClick={onLogout}>Déconnexion</button>
        </footer>
      </div>
    </div>
  );
}

const registerCount = (s: Store) =>
  s.registers.length === 0 ? 'aucune caisse' : s.registers.length === 1 ? '1 caisse' : `${s.registers.length} caisses`;
