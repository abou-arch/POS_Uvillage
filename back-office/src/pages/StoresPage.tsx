// Magasins et caisses (administrateur) : mentions du ticket (adresse, ICE), seuils de clôture et de remise,
// caisses, règles des codes-barres de la balance (§3). Valeurs de démonstration à remplacer par celles du client.
import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import type { BarcodeRule, Register, Store } from '../api/types'
import { Badge, Button, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Panel } from '../components/ui'
import { centsToInput, formatMad, parseMad } from '../lib/format'
import { useApp, useLoad } from '../lib/hooks'

export function StoresPage() {
  const { reloadMe } = useApp()
  const { data, error, loading, reload } = useLoad(() => api.get<Store[]>('/admin/stores'), 'stores')
  const [editing, setEditing] = useState<Store | 'new' | null>(null)
  const [rules, setRules] = useState<Store | null>(null)
  const [register, setRegister] = useState<{ store: Store; register: Register | null } | null>(null)
  const done = () => { setEditing(null); setRules(null); setRegister(null); reload(); void reloadMe() }
  return (
    <>
      <PageHeader title="Magasins et caisses" subtitle="Les caisses reçoivent ces réglages à la connexion." actions={
        <Button icon="plus" variant="primary" onClick={() => setEditing('new')}>Nouveau magasin</Button>
      } />
      <p className="notice"><Icon name="info" />Adresses, ICE et format de la balance sont des valeurs provisoires : à remplacer par celles du client.</p>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {!data ? loading && <Loading /> : data.length === 0 ? <Empty>Aucun magasin.</Empty> : (
        <div className="grid">
          {data.map((s) => (
            <Panel key={s.id} title={s.name} actions={<>
              {!s.active && <Badge>Fermé</Badge>}
              <Button small icon="edit" onClick={() => setEditing(s)}>Modifier</Button>
            </>}>
              <dl className="kv">
                <dt>Adresse</dt><dd style={{ whiteSpace: 'pre-line' }}>{s.address || '—'}</dd>
                <dt>ICE</dt><dd>{s.ice || '—'}</dd>
                <dt>Écart de clôture toléré</dt><dd>{formatMad(s.closing_difference_threshold)}</dd>
                <dt>Remise max. du caissier</dt><dd>{[s.cashier_max_discount_percent !== null && `${s.cashier_max_discount_percent} %`,
                  s.cashier_max_discount !== null && formatMad(s.cashier_max_discount)].filter(Boolean).join(' et ') || 'Sans plafond'}</dd>
              </dl>
              <div className="panel-head"><h2>Caisses</h2><div className="spacer" /><Button small icon="plus" onClick={() => setRegister({ store: s, register: null })}>Ajouter</Button></div>
              <ul className="list">
                {s.registers.map((r) => (
                  <li key={r.id}>
                    <Icon name="register" /><span className="grow">{r.name}<span className="sub muted small"> · {r.id}</span></span>
                    {!r.active && <Badge>Désactivée</Badge>}
                    <Button small variant="ghost" icon="edit" title="Modifier" onClick={() => setRegister({ store: s, register: r })} />
                  </li>
                ))}
              </ul>
              <div className="panel-head"><h2>Balance</h2><div className="spacer" /><Button small icon="edit" onClick={() => setRules(s)}>Règles</Button></div>
              <ul className="list">
                {(s.barcode_rules ?? []).length === 0 ? <li className="muted">Pas de balance.</li> : s.barcode_rules!.map((r) => (
                  <li key={r.prefix}><Badge tone="blue">{r.prefix}</Badge><span className="grow">{r.type === 'weight' ? 'Poids' : 'Prix'} : {r.integer_digits} chiffre(s) + {r.decimal_digits} décimale(s)</span></li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
      {editing && <StoreForm store={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={done} />}
      {rules && <RulesForm store={rules} onClose={() => setRules(null)} onSaved={done} />}
      {register && <RegisterForm {...register} onClose={() => setRegister(null)} onSaved={done} />}
    </>
  )
}

function StoreForm({ store, onClose, onSaved }: { store: Store | null; onClose: () => void; onSaved: () => void }) {
  const { notify } = useApp()
  const [f, setF] = useState({
    name: store?.name ?? '', address: store?.address ?? '', ice: store?.ice ?? '', threshold: centsToInput(store?.closing_difference_threshold ?? 2000),
    pct: store?.cashier_max_discount_percent === null || store?.cashier_max_discount_percent === undefined ? '' : String(store.cashier_max_discount_percent),
    max: centsToInput(store?.cashier_max_discount), active: store?.active ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }))
  const threshold = parseMad(f.threshold)
  const pct = f.pct.trim() === '' ? null : /^\d{1,3}$/.test(f.pct) && Number(f.pct) <= 100 ? Number(f.pct) : NaN
  const max = f.max.trim() === '' ? null : parseMad(f.max)
  const iceOk = !f.ice.trim() || /^\d{15}$/.test(f.ice.trim())
  const invalid = !f.name.trim() || threshold === null || Number.isNaN(pct) || (f.max.trim() !== '' && max === null) || !iceOk
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const body = { name: f.name.trim(), address: f.address.trim(), ice: f.ice.trim(), closing_difference_threshold: threshold,
      cashier_max_discount_percent: pct, cashier_max_discount: max, active: f.active }
    try {
      if (store) await api.put(`/admin/stores/${store.id}`, body)
      else await api.post('/admin/stores', body)
      notify('Magasin enregistré.')
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={store ? `Modifier ${store.name}` : 'Nouveau magasin'} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button type="submit" form="store-form" variant="primary" busy={busy} disabled={invalid}>Enregistrer</Button>
    </>}>
      <form id="store-form" className="form" onSubmit={submit}>
        <Field label="Nom" wide><input autoFocus value={f.name} maxLength={80} onChange={(e) => set('name')(e.target.value)} /></Field>
        <Field label="Adresse (imprimée sur le ticket)" wide><textarea rows={2} value={f.address} maxLength={300} onChange={(e) => set('address')(e.target.value)} /></Field>
        <Field label="ICE" error={iceOk ? null : '15 chiffres'}><input inputMode="numeric" value={f.ice} maxLength={15} onChange={(e) => set('ice')(e.target.value)} /></Field>
        <Field label="Écart de clôture toléré (DH)" hint="Au-delà, un responsable valide la clôture." error={threshold === null ? 'Montant invalide' : null}>
          <input inputMode="decimal" value={f.threshold} onChange={(e) => set('threshold')(e.target.value)} />
        </Field>
        <Field label="Remise max. du caissier (%)" hint="Vide : pas de plafond en %." error={Number.isNaN(pct) ? '0 à 100' : null}>
          <input inputMode="numeric" value={f.pct} onChange={(e) => set('pct')(e.target.value)} />
        </Field>
        <Field label="Remise max. du caissier (DH)" hint="Vide : pas de plafond en DH." error={f.max.trim() && max === null ? 'Montant invalide' : null}>
          <input inputMode="decimal" value={f.max} onChange={(e) => set('max')(e.target.value)} />
        </Field>
        {store && <label className="check form-field wide"><span className="check"><input type="checkbox" checked={f.active} onChange={(e) => set('active')(e.target.checked)} />Magasin ouvert</span></label>}
        {error && <p className="alert form-field wide"><Icon name="alert" />{error}</p>}
      </form>
    </Modal>
  )
}

function RegisterForm({ store, register, onClose, onSaved }: { store: Store; register: Register | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(register?.name ?? `Caisse ${store.registers.length + 1}`)
  const [active, setActive] = useState(register?.active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (register) await api.put(`/admin/registers/${register.id}`, { name: name.trim(), active })
      else await api.post(`/admin/stores/${store.id}/registers`, { name: name.trim() })
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={register ? `Modifier ${register.name}` : `Nouvelle caisse · ${store.name}`} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button type="submit" form="register-form" variant="primary" busy={busy} disabled={!name.trim()}>Enregistrer</Button>
    </>}>
      <form id="register-form" className="form" onSubmit={submit}>
        <Field label="Nom" wide><input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
        {register && <label className="check form-field wide"><span className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Caisse en service</span></label>}
        {error && <p className="alert form-field wide"><Icon name="alert" />{error}</p>}
      </form>
    </Modal>
  )
}

function RulesForm({ store, onClose, onSaved }: { store: Store; onClose: () => void; onSaved: () => void }) {
  const [rules, setRules] = useState<BarcodeRule[]>(store.barcode_rules ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = (i: number, patch: Partial<BarcodeRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api.put(`/admin/stores/${store.id}/barcode-rules`, { rules })
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }
  const digits = (n: number) => Array.from({ length: n + 1 }, (_, i) => i)
  return (
    <Modal wide title={`Balance · ${store.name}`} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" busy={busy} onClick={submit}>Enregistrer</Button>
    </>}>
      <p className="muted">Codes EAN-13 imprimés par la balance : préfixe, code article, valeur (poids en kg ou prix en DH), chiffre de contrôle. Format exact à demander au client (§8 point 12).</p>
      {rules.length === 0 ? <Empty>Aucune règle : le magasin n’a pas de balance.</Empty> : (
        <div className="table-wrap">
          <table className="lines-editor">
            <thead><tr><th>Préfixe</th><th>Valeur</th><th>Chiffres entiers</th><th>Décimales</th><th>Code article</th><th /></tr></thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={i}>
                  <td><input value={r.prefix} inputMode="numeric" maxLength={5} aria-label="Préfixe" onChange={(e) => update(i, { prefix: e.target.value.replace(/\D/g, '') })} /></td>
                  <td><select value={r.type} onChange={(e) => update(i, { type: e.target.value as BarcodeRule['type'], decimal_digits: Math.min(r.decimal_digits, e.target.value === 'price' ? 2 : 3) })}>
                    <option value="weight">Poids (kg)</option><option value="price">Prix (DH)</option></select></td>
                  <td><select value={r.integer_digits} onChange={(e) => update(i, { integer_digits: Number(e.target.value) })}>{digits(6).map((n) => <option key={n}>{n}</option>)}</select></td>
                  <td><select value={r.decimal_digits} onChange={(e) => update(i, { decimal_digits: Number(e.target.value) })}>{digits(r.type === 'price' ? 2 : 3).map((n) => <option key={n}>{n}</option>)}</select></td>
                  <td className="muted">{Math.max(0, 12 - r.prefix.length - r.integer_digits - r.decimal_digits)} chiffre(s)</td>
                  <td><Button small variant="ghost" icon="trash" title="Retirer" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div><Button small icon="plus" onClick={() => setRules((rs) => [...rs, { prefix: '2', type: 'weight', integer_digits: 2, decimal_digits: 3 }])}>Ajouter une règle</Button></div>
      {error && <p className="alert"><Icon name="alert" />{error}</p>}
    </Modal>
  )
}
