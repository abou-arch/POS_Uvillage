import { useState, type FormEvent } from 'react';
import { api, setToken } from '../api/client';
import type { Session } from '../types';

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState('caissier');
  const [password, setPassword] = useState('caissier');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(username, password);
      setToken(res.token);
      // Sprint mercredi : laisser le caissier choisir le magasin / la caisse s'il en a plusieurs.
      const store = res.stores[0];
      onLogin({ ...res, storeId: store.id, registerId: store.registers[0].id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <h1>Caisse</h1>
      <label>Utilisateur<input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></label>
      <label>Mot de passe<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <button disabled={loading}>{loading ? 'Connexion…' : 'Se connecter'}</button>
    </form>
  );
}
