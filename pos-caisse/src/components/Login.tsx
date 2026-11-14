import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { isAuth } from '../state/session';
import type { Auth } from '../types';
import { Icon } from './ui';

export function Login({ onLogin, notice }: { onLogin: (auth: Auth) => void; notice?: string | null }) {
  // Compte de test de la fausse API prérempli en développement seulement : la version de production
  // (npm run build) n'embarque aucun identifiant.
  const [username, setUsername] = useState(import.meta.env.DEV ? 'caissier' : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? 'caissier' : '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const auth = await api.login(username, password);
      // Réponse incomplète (par exemple sans seuil d'écart de clôture, §2) : la caisse ne pourrait pas la relire.
      if (!isAuth(auth)) {
        setError('Réponse du serveur inattendue : connexion impossible. Prévenez le responsable.');
        return;
      }
      onLogin(auth);
    } catch (err) {
      // Seule l'API donne un message lisible ; sinon le serveur n'a pas répondu.
      setError(err instanceof ApiError ? err.message : 'Serveur injoignable. Vérifiez la connexion.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="card login" onSubmit={submit}>
        <div className="card-head">
          <span className="logo big"><Icon name="register" size={28} /></span>
          <h1>Caisse</h1>
          <p className="muted">Connectez-vous pour ouvrir la caisse.</p>
        </div>
        {notice && <p className="notice"><Icon name="alert" size={18} />{notice}</p>}
        <label>Utilisateur
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </label>
        <label>Mot de passe
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="alert" role="alert"><Icon name="alert" size={18} />{error}</p>}
        <button className="btn primary" disabled={loading}>{loading ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    </div>
  );
}
