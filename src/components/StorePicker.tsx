import { useState } from 'react';
import { initialStore, onlyRegister } from '../state/session';
import type { Auth, Store } from '../types';

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
    <div className="picker">
      {store ? (
        <>
          <h1>Choisissez la caisse</h1>
          <p className="muted">{store.name}</p>
          {store.registers.length === 0 && <p className="error">Aucune caisse dans ce magasin.</p>}
          <div className="choices" key={store.id}>
            {store.registers.map((r, i) => (
              <button key={r.id} autoFocus={i === 0} onClick={() => onSelect(store.id, r.id)}>{r.name}</button>
            ))}
          </div>
          {auth.stores.length > 1 && <button className="link" onClick={() => setStore(null)}>← Changer de magasin</button>}
        </>
      ) : (
        <>
          <h1>Choisissez le magasin</h1>
          {auth.stores.length === 0 && <p className="error">Aucun magasin n'est rattaché à ce compte.</p>}
          <div className="choices" key="stores">
            {auth.stores.map((s) => (
              <button key={s.id} autoFocus={s === firstOpen} disabled={s.registers.length === 0} onClick={() => pickStore(s)}>
                {s.name}
                <span className="muted">{registerCount(s)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <footer>
        <span className="muted">{auth.user.name}</span>
        <button className="link" onClick={onLogout}>Déconnexion</button>
      </footer>
    </div>
  );
}

const registerCount = (s: Store) =>
  s.registers.length === 0 ? 'aucune caisse' : s.registers.length === 1 ? '1 caisse' : `${s.registers.length} caisses`;
