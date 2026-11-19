import { useState, type FormEvent } from 'react'
import { api, ApiError, apiUrlProblem, setToken } from '../api/client'
import type { User } from '../api/types'
import { Button, Icon } from './ui'

/** Connexion (§2). Un caissier n'a pas accès au back-office : son token est aussitôt révoqué. */
export function Login({ onLogged }: { onLogged: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(apiUrlProblem())
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (apiUrlProblem()) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ token: string; user: User }>('/auth/login', { username: username.trim(), password })
      setToken(res.token)
      if (res.user.role === 'cashier') {
        await api.post('/auth/logout').catch(() => {})
        setToken(null)
        setError('Le back-office est réservé aux responsables et à l’administrateur.')
        return
      }
      onLogged()
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Identifiant ou mot de passe incorrect.' : (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-screen">
      <form className="card login" onSubmit={submit}>
        <div className="card-head">
          <span className="logo big"><Icon name="chart" size={28} /></span>
          <h1>Gestion</h1>
          <p className="muted">Catalogue, stock, ventes, clients et rapports des magasins.</p>
        </div>
        <label className="form-field">
          <span className="label">Identifiant</span>
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={100} />
        </label>
        <label className="form-field">
          <span className="label">Mot de passe</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={200} />
        </label>
        {error && <p className="alert" role="alert"><Icon name="alert" />{error}</p>}
        <Button type="submit" variant="primary" busy={busy} disabled={!username.trim() || !password}>Se connecter</Button>
      </form>
    </main>
  )
}
