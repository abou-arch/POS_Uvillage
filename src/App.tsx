import { useEffect, useState } from 'react';
import { setToken, setUnauthorizedHandler } from './api/client';
import { Login } from './components/Login';
import { PosScreen } from './components/PosScreen';
import { StorePicker } from './components/StorePicker';
import { clearSession, isSession, loadSession, saveSession, selectRegister } from './state/session';
import type { Auth, Session } from './types';
import './App.css';

// Session relue au chargement de la page (F5) : le client API doit connaître le token avant le premier appel.
const restored = loadSession();
setToken(restored?.token ?? null);

export default function App() {
  const [session, setSession] = useState<Auth | Session | null>(restored);
  const [notice, setNotice] = useState<string | null>(null);

  // Token refusé par l'API (expiré, ou fausse API relancée) : retour au login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      setToken(null);
      setSession(null);
      setNotice('Session expirée, reconnectez-vous.');
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

  if (!session) {
    return <Login notice={notice} onLogin={(auth) => { setNotice(null); update(selectRegister(auth)); }} />;
  }
  if (!isSession(session)) {
    return <StorePicker auth={session} onLogout={() => update(null)}
      onSelect={(storeId, registerId) => update(selectRegister(session, storeId, registerId))} />;
  }
  return <PosScreen key={session.registerId} session={session} onLogout={() => update(null)} />;
}
