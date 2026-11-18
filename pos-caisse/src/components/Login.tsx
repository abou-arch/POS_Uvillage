import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { isAuth } from '../state/session';
import type { Auth } from '../types';
import { Icon } from './ui';

const DEMO = import.meta.env.MODE === 'demo';

/** Démo (npm run build:demo) : comptes de test de la fausse API, et remise à zéro des données du navigateur. */
function DemoAccounts() {
  async function reset() {
    if (!confirm('Effacer les ventes, sessions et réglages de la démo dans ce navigateur ?')) return;
    (await import('../demo/install')).resetDemo();
  }
  return (
    <div className="demo-note">
      <p><strong>Démo</strong> : aucune donnée réelle, tout reste dans ce navigateur.</p>
      <table>
        <tbody>
          <tr><td>Caissier</td><td><code>caissier</code> / <code>caissier</code></td><td /></tr>
          <tr><td>Responsable</td><td><code>responsable</code> / <code>responsable</code></td><td>PIN <code>246810</code></td></tr>
          <tr><td>Admin</td><td><code>admin</code> / <code>admin</code></td><td>PIN <code>135790</code></td></tr>
        </tbody>
      </table>
      <button type="button" className="btn secondary" onClick={reset}>Réinitialiser la démo</button>
    </div>
  );
}

export function Login({ onLogin, notice }: { onLogin: (auth: Auth) => void; notice?: string | null }) {
  // Compte de test de la fausse API prérempli en développement et dans la démo seulement : la version de production
  // (npm run build) n'embarque aucun identifiant.
  const prefill = import.meta.env.DEV || DEMO ? 'caissier' : '';
  const [username, setUsername] = useState(prefill);
  const [password, setPassword] = useState(prefill);
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
        {DEMO && <DemoAccounts />}
      </form>
    </div>
  );
}
