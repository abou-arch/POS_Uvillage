// Clients : reste dû (ventes à crédit), historique d'achats, règlements de dette, fiche.
import { useState, type FormEvent } from 'react'
import { api, ApiError, qs } from '../api/client'
import { METHOD_LABELS, type Customer, type CustomerDetail } from '../api/types'
import { Badge, Button, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Panel, SearchInput, Stat } from '../components/ui'
import { csvMad, downloadCsv, toCsv } from '../lib/csv'
import { formatDateTime, formatMad, parseMad, plural } from '../lib/format'
import { go, useApp, useDebounced, useLoad } from '../lib/hooks'
import { SaleTr } from './SalesPage'

export function CustomersPage() {
  const { timeZone } = useApp()
  const [search, setSearch] = useState('')
  const [due, setDue] = useState(false)
  const [creating, setCreating] = useState(false)
  const q = useDebounced(search)
  const { data, error, loading, reload } = useLoad(() => api.get<Customer[]>(`/admin/customers${qs({ search: q, due })}`), `${q}|${due}`)
  const totalDue = (data ?? []).reduce((n, c) => n + Math.max(0, c.balance), 0)

  function exportCsv() {
    downloadCsv('clients.csv', toCsv(['Nom', 'Téléphone', 'Matricule', 'Achats', 'Total acheté', 'Reste dû', 'Dernier achat'],
      (data ?? []).map((c) => [c.name, c.phone, c.matricule, c.sales_count, csvMad(c.sales_ttc), csvMad(c.balance), formatDateTime(c.last_sale_at, timeZone)])))
  }

  return (
    <>
      <PageHeader title="Clients" subtitle={data ? `${plural(data.length, 'client')} · reste dû ${formatMad(totalDue)}` : undefined} actions={<>
        <Button icon="download" disabled={!data?.length} onClick={exportCsv}>Exporter</Button>
        <Button icon="plus" variant="primary" onClick={() => setCreating(true)}>Nouveau client</Button>
      </>} />
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom, téléphone ou matricule" />
        <div className="chips">
          <button type="button" className={`chip${!due ? ' on' : ''}`} onClick={() => setDue(false)}>Tous</button>
          <button type="button" className={`chip${due ? ' on' : ''}`} onClick={() => setDue(true)}>Qui doivent de l’argent</button>
        </div>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      <Panel>
        {!data ? loading && <Loading /> : data.length === 0 ? <Empty>Aucun client trouvé.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nom</th><th>Téléphone</th><th>Matricule</th><th className="num">Achats</th><th className="num">Total acheté</th><th>Dernier achat</th><th className="num">Reste dû</th></tr></thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => go(`/clients/${c.id}`)}>
                    <td><a href={`#/clients/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.name}</a></td>
                    <td>{c.phone ?? '—'}</td><td>{c.matricule ?? '—'}</td>
                    <td className="num">{c.sales_count}</td><td className="num">{formatMad(c.sales_ttc)}</td>
                    <td className="nowrap">{formatDateTime(c.last_sale_at, timeZone)}</td>
                    <td className="num">{c.balance > 0 ? <Badge tone="amber">{formatMad(c.balance)}</Badge> : c.balance < 0 ? <Badge tone="blue">avoir {formatMad(-c.balance)}</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {creating && <CustomerForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); go(`/clients/${id}`) }} />}
    </>
  )
}

export function CustomerPage({ id }: { id: string }) {
  const { timeZone } = useApp()
  const { data, error, loading, reload } = useLoad(() => api.get<CustomerDetail>(`/admin/customers/${encodeURIComponent(id)}`), id)
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState(false)
  if (error) return <><PageHeader title="Client" back="#/clients" /><ErrorBox error={error} onRetry={reload} /></>
  if (!data) return loading ? <Loading /> : null
  const c = data.customer
  const bought = data.sales.filter((s) => s.status === 'completed').reduce((n, s) => n + s.total_ttc, 0)
  return (
    <>
      <PageHeader title={c.name} back="#/clients" subtitle={[c.phone, c.matricule && `matricule ${c.matricule}`].filter(Boolean).join(' · ') || 'Sans téléphone ni matricule'}
        actions={<>
          <Button icon="edit" onClick={() => setEditing(true)}>Modifier</Button>
          <Button icon="wallet" variant="primary" disabled={data.balance <= 0} onClick={() => setPaying(true)}>Encaisser un règlement</Button>
        </>} />
      {data.balance < 0 && <p className="notice"><Icon name="info" />Ce client a un avoir de {formatMad(-data.balance)} : un article a été rendu à crédit après qu’il a réglé sa dette.</p>}
      <div className="stats">
        <Stat label="Reste dû" value={formatMad(Math.max(0, data.balance))} tone={data.balance > 0 ? 'amber' : 'green'} />
        <Stat label="Achats" value={data.sales.filter((s) => s.status === 'completed').length} hint={formatMad(bought)} />
        <Stat label="Règlements" value={data.payments.length} hint={formatMad(data.payments.reduce((n, p) => n + p.amount, 0))} />
      </div>
      <Panel title="Achats">
        {data.sales.length === 0 ? <Empty>Ce client n’a encore rien acheté.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ticket</th><th>Date</th><th>Magasin</th><th>Caissier</th><th>Client</th><th className="num">Total</th><th className="num">Payé</th><th className="num">Dû</th><th>Statut</th></tr></thead>
              <tbody>{data.sales.map((s) => <SaleTr key={s.id} s={s} timeZone={timeZone} />)}</tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Règlements reçus">
        {data.payments.length === 0 ? <Empty>Aucun règlement reçu.</Empty> : (
          <ul className="list">
            {data.payments.map((p) => (
              <li key={p.id}>
                <Icon name="wallet" />
                <span className="grow">{METHOD_LABELS[p.method]} · {formatDateTime(p.created_at, timeZone)}<span className="sub muted small"> · {p.store_name} · {p.user_name}{p.note ? ` · ${p.note}` : ''}</span></span>
                <strong className="num">{formatMad(p.amount)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload() }} />}
      {paying && <PaymentForm customerId={c.id} balance={data.balance} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); reload() }} />}
    </>
  )
}

function CustomerForm({ customer, onClose, onSaved }: { customer?: CustomerDetail['customer']; onClose: () => void; onSaved: (id: string) => void }) {
  const { notify } = useApp()
  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [matricule, setMatricule] = useState(customer?.matricule ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const phoneOk = !phone.trim() || /^\+?\d{6,15}$/.test(phone.replace(/[\s.-]/g, ''))
  const matriculeOk = !matricule.trim() || /^\d{1,15}$/.test(matricule.trim())
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = { name: name.trim(), phone: phone.trim() || null, matricule: matricule.trim() || null }
      const saved = customer ? await api.put<{ id: string }>(`/admin/customers/${customer.id}`, body) : await api.post<{ id: string }>('/admin/customers', body)
      notify('Client enregistré.')
      onSaved(saved.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={customer ? `Modifier ${customer.name}` : 'Nouveau client'} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button type="submit" form="customer-form" variant="primary" busy={busy} disabled={!name.trim() || !phoneOk || !matriculeOk}>Enregistrer</Button>
    </>}>
      <form id="customer-form" className="form" onSubmit={submit}>
        <Field label="Nom" wide><input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Téléphone" error={phoneOk ? null : '6 à 15 chiffres'}><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="06 12 34 56 78" /></Field>
        <Field label="Matricule universitaire" error={matriculeOk ? null : 'Chiffres seulement, 15 au plus'}><input inputMode="numeric" value={matricule} onChange={(e) => setMatricule(e.target.value)} /></Field>
        {error && <p className="alert form-field wide"><Icon name="alert" />{error}</p>}
      </form>
    </Modal>
  )
}

/** Règlement d'une dette, idempotent : l'id est fixé à l'ouverture, un double clic n'encaisse pas deux fois. */
function PaymentForm({ customerId, balance, onClose, onSaved }: { customerId: string; balance: number; onClose: () => void; onSaved: () => void }) {
  const { me, storeId, notify } = useApp()
  const [paymentId] = useState(() => crypto.randomUUID())
  const [store, setStore] = useState(storeId || me.stores[0]?.id || '')
  const [method, setMethod] = useState<'cash' | 'card' | 'mobile'>('cash')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cents = parseMad(amount)
  const tooMuch = cents !== null && cents > balance
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (cents === null || cents <= 0 || tooMuch) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/admin/customers/${customerId}/payments`, { id: paymentId, store_id: store, method, amount: cents, note: note.trim() || null })
      notify(`Règlement de ${formatMad(cents)} enregistré.`)
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Encaisser un règlement" onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button type="submit" form="payment-form" variant="primary" icon="check" busy={busy} disabled={cents === null || cents <= 0 || tooMuch}>Encaisser</Button>
    </>}>
      <p>Reste dû : <strong>{formatMad(balance)}</strong></p>
      <form id="payment-form" className="form" onSubmit={submit}>
        <Field label="Montant (DH)" error={amount && cents === null ? 'Montant invalide' : tooMuch ? 'Plus que le reste dû' : null}>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Moyen">
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="cash">Espèces</option><option value="card">Carte</option><option value="mobile">Mobile</option>
          </select>
        </Field>
        <Field label="Magasin"><select value={store} onChange={(e) => setStore(e.target.value)}>{me.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Note (facultatif)"><input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="form-actions"><Button small onClick={() => setAmount((balance / 100).toFixed(2).replace('.', ','))}>Tout le reste dû</Button></div>
        {error && <p className="alert form-field wide"><Icon name="alert" />{error}</p>}
      </form>
      <p className="muted small">Un règlement en espèces reçu au back-office n’entre pas dans le tiroir d’une caisse : rangez-le à part.</p>
    </Modal>
  )
}
