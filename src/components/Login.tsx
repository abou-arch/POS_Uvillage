import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { Auth } from '../types';

export function Login({ onLogin, notice }: { onLogin: (auth: Auth) => void; notice?: string | null }) {
  const [username, setUsername] = useState('caissier');
  const [password, setPassword] = useState('caissier');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      onLogin(await api.login(username, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <h1>Caisse</h1>
      {notice && <p className="notice">{notice}</p>}
      <label>Utilisateur<input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></label>
      <label>Mot de passe<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <button disabled={loading}>{loading ? 'Connexion…' : 'Se connecter'}</button>
    </form>
  );
}
