import { useEffect, useState } from 'react';
import { apiConfigError, setToken, setUnauthorizedHandler } from './api/client';
import { CashRegister } from './components/CashRegister';
import { Login } from './components/Login';
import { StorePicker } from './components/StorePicker';
import { forgetCustomers } from './db/customers';
import { db } from './db/db';
import { ensureMigrated } from './db/migrate';
import { clearSession, isSession, loadSession, saveSession, selectRegister } from './state/session';
import type { Auth, Session } from './types';
import './App.css';

// Session relue au chargement de la page (F5) : le client API doit connaître le token avant le premier appel.
const restored = loadSession();
setToken(restored?.token ?? null);
void ensureMigrated(); // données des versions précédentes (localStorage) → IndexedDB

export default function App() {
  const [session, setSession] = useState<Auth | Session | null>(restored);
  const [notice, setNotice] = useState<string | null>(null);

  // Token refusé par l'API (expiré, ou fausse API relancée) : retour au login. Les opérations à envoyer (ventes,
  // session de caisse) restent dans l'outbox (rien n'est effacé à la déconnexion) et repartent dès la reconnexion.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      setToken(null);
      setSession(null);
      setNotice('Connexion expirée, reconnectez-vous.');
      db.outbox.count().then((n) => {
        if (n === 1) setNotice('Connexion expirée, reconnectez-vous : l’opération gardée sur la caisse partira ensuite.');
        if (n > 1) setNotice(`Connexion expirée, reconnectez-vous : les ${n} opérations gardées sur la caisse partiront ensuite.`);
      }).catch(() => {});
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Chaque étape est sauvegardée aussitôt : un F5 retrouve l'écran en cours.
  function update(next: Auth | Session | null) {
    if (next) saveSession(next);
    else clearSession();
    setToken(next?.token ?? null);
    setSession(next);
  }

  // Déconnexion volontaire (fin de service) : les clients consultés quittent le poste, qui est partagé.
  // Les ventes à envoyer et en attente restent : elles appartiennent à la caisse, pas au caissier.
  function logout() {
    forgetCustomers();
    update(null);
  }

  if (apiConfigError) {
    return (
      <div className="auth-screen">
        <div className="card login" role="alert">
          <h1>Caisse non configurée</h1>
          <p className="alert">{apiConfigError}</p>
          <p className="muted">Rien n’est envoyé au serveur tant que l’adresse n’est pas corrigée.</p>
        </div>
      </div>
    );
  }
  if (!session) {
    return <Login notice={notice} onLogin={(auth) => { setNotice(null); update(selectRegister(auth)); }} />;
  }
  if (!isSession(session)) {
    return <StorePicker auth={session} onLogout={logout}
      onSelect={(storeId, registerId) => update(selectRegister(session, storeId, registerId))} />;
  }
  return <CashRegister key={session.registerId} session={session} onLogout={logout} />;
}
