// Utilisateurs (administrateur) : comptes, rôles, magasins, mot de passe et PIN des responsables (§11).
import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { ROLE_LABELS, type AdminUser, type Role } from '../api/types'
import { Badge, Button, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Panel } from '../components/ui'
import { useApp, useLoad } from '../lib/hooks'

export function UsersPage() {
  const { me } = useApp()
  const { data, error, loading, reload } = useLoad(() => api.get<AdminUser[]>('/admin/users'), 'users')
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null)
  const storeName = (id: string) => me.stores.find((s) => s.id === id)?.name ?? id
  return (
    <>
      <PageHeader title="Utilisateurs" subtitle="Caissiers, responsables et administrateurs." actions={
        <Button icon="plus" variant="primary" onClick={() => setEditing('new')}>Nouvel utilisateur</Button>
      } />
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      <Panel>
        {!data ? loading && <Loading /> : data.length === 0 ? <Empty>Aucun utilisateur.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Magasins</th><th>PIN</th><th>État</th><th /></tr></thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id} className={u.active ? undefined : 'inactive'}>
                    <td>{u.name}{u.id === me.user.id && <span className="sub">vous</span>}</td>
                    <td>{u.username}</td>
                    <td><Badge tone={u.role === 'admin' ? 'blue' : u.role === 'manager' ? 'green' : 'neutral'}>{ROLE_LABELS[u.role]}</Badge></td>
                    <td>{u.role === 'admin' ? 'Tous' : u.store_ids.map(storeName).join(', ')}</td>
                    <td>{u.role === 'cashier' ? '—' : u.has_pin ? <Badge tone="green">Oui</Badge> : <Badge tone="amber">Non</Badge>}</td>
                    <td>{u.active ? <Badge tone="green">Actif</Badge> : <Badge>Désactivé</Badge>}</td>
                    <td><Button small variant="ghost" icon="edit" title="Modifier" onClick={() => setEditing(u)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {editing && <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function UserForm({ user, onClose, onSaved }: { user: AdminUser | null; onClose: () => void; onSaved: () => void }) {
  const { me, notify } = useApp()
  const [username, setUsername] = useState(user?.username ?? '')
  const [name, setName] = useState(user?.name ?? '')
  const [role, setRole] = useState<Role>(user?.role ?? 'cashier')
  const [stores, setStores] = useState<string[]>(user?.store_ids ?? (me.stores.length === 1 ? [me.stores[0].id] : []))
  const [active, setActive] = useState(user?.active ?? true)
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [removePin, setRemovePin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const self = user?.id === me.user.id
  const passwordProblem = password && password.length < 8 ? '8 caractères au moins' : !user && !password ? 'Obligatoire' : null
  const pinProblem = pin && !/^\d{6}$/.test(pin) ? 'Exactement 6 chiffres' : null
  const usernameProblem = !user && username && !/^[A-Za-z0-9._-]{3,40}$/.test(username) ? '3 à 40 lettres, chiffres, point, tiret' : null
  const invalid = !name.trim() || (!user && !username) || !!usernameProblem || !!passwordProblem || !!pinProblem || (role !== 'admin' && stores.length === 0)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (invalid) return
    setBusy(true)
    setError(null)
    const body: Record<string, unknown> = { name: name.trim(), role, store_ids: stores, active }
    if (password) body.password = password
    if (role !== 'cashier' && pin) body.pin = pin
    if (role !== 'cashier' && removePin) body.pin = null
    try {
      if (user) await api.put(`/admin/users/${user.id}`, body)
      else await api.post('/admin/users', { ...body, username: username.trim() })
      notify(user ? 'Utilisateur enregistré.' : 'Utilisateur créé.')
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={user ? `Modifier ${user.name}` : 'Nouvel utilisateur'} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button type="submit" form="user-form" variant="primary" busy={busy} disabled={invalid}>Enregistrer</Button>
    </>}>
      <form id="user-form" className="form" onSubmit={submit}>
        <Field label="Nom affiché"><input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Identifiant de connexion" error={usernameProblem}>
          <input value={username} disabled={!!user} autoComplete="off" maxLength={40} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Rôle" hint={role === 'cashier' ? 'Caisse seulement.' : role === 'manager' ? 'Back-office de ses magasins, autorise les opérations en caisse.' : 'Tout, dans tous les magasins.'}>
          <select value={role} disabled={self} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="cashier">Caissier</option><option value="manager">Responsable</option><option value="admin">Administrateur</option>
          </select>
        </Field>
        <Field label={user ? 'Nouveau mot de passe (facultatif)' : 'Mot de passe'} error={passwordProblem}
          hint={user ? 'Le changer coupe les connexions en cours de ce compte.' : undefined}>
          <input type="password" autoComplete="new-password" value={password} maxLength={200} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {role !== 'admin' && (
          <div className="form-field wide">
            <span className="label">Magasins</span>
            <div className="checks">
              {me.stores.map((s) => (
                <label key={s.id} className="check">
                  <input type="checkbox" checked={stores.includes(s.id)}
                    onChange={(e) => setStores((x) => (e.target.checked ? [...x, s.id] : x.filter((id) => id !== s.id)))} />{s.name}
                </label>
              ))}
            </div>
            {stores.length === 0 && <span className="error-text">Au moins un magasin</span>}
          </div>
        )}
        {role !== 'cashier' && (
          <Field label={user?.has_pin ? 'Nouveau PIN (facultatif)' : 'PIN d’autorisation'} error={pinProblem}
            hint="6 chiffres, tapés en caisse pour autoriser une remise, un retour, un écart (§11). Différent du mot de passe.">
            <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} disabled={removePin} onChange={(e) => setPin(e.target.value)} />
          </Field>
        )}
        {role !== 'cashier' && user?.has_pin && (
          <label className="check form-field wide"><span className="check"><input type="checkbox" checked={removePin} onChange={(e) => setRemovePin(e.target.checked)} />Retirer le PIN</span></label>
        )}
        <label className="check form-field wide"><span className="check"><input type="checkbox" checked={active} disabled={self} onChange={(e) => setActive(e.target.checked)} />
          Compte actif</span></label>
        {error && <p className="alert form-field wide"><Icon name="alert" />{error}</p>}
      </form>
    </Modal>
  )
}
