// Fournisseurs : coordonnées, factures d'achat, reste dû.
import { useState, type FormEvent } from 'react'
import { api, ApiError, qs } from '../api/client'
import type { Supplier, SupplierDetail } from '../api/types'
import { Badge, Button, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Panel, SearchInput, Stat } from '../components/ui'
import { csvMad, downloadCsv, toCsv } from '../lib/csv'
import { formatDay, formatMad, plural } from '../lib/format'
import { go, useApp, useDebounced, useLoad } from '../lib/hooks'
import { PurchaseForm, PurchaseTr } from './PurchasesPage'

export function SuppliersPage() {
  const [search, setSearch] = useState('')
  const [due, setDue] = useState(false)
  const [creating, setCreating] = useState(false)
  const q = useDebounced(search)
  const { data, error, loading, reload } = useLoad(() => api.get<Supplier[]>(`/admin/suppliers${qs({ search: q, due })}`), `${q}|${due}`)
  const totalDue = (data ?? []).reduce((n, s) => n + Math.max(0, s.due), 0)

  function exportCsv() {
    downloadCsv('fournisseurs.csv', toCsv(['Nom', 'Téléphone', 'E-mail', 'ICE', 'Factures', 'Total acheté', 'Réglé', 'Reste dû', 'Dernier achat'],
      (data ?? []).map((s) => [s.name, s.phone, s.email, s.ice, s.purchases_count, csvMad(s.purchases_total), csvMad(s.paid), csvMad(s.due),
        s.last_purchase_on ? formatDay(s.last_purchase_on) : ''])))
  }

  return (
    <>
      <PageHeader title="Fournisseurs" subtitle={data ? `${plural(data.length, 'fournisseur')} · reste à payer ${formatMad(totalDue)}` : undefined} actions={<>
        <Button icon="download" disabled={!data?.length} onClick={exportCsv}>Exporter</Button>
        <Button icon="plus" variant="primary" onClick={() => setCreating(true)}>Nouveau fournisseur</Button>
      </>} />
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom, téléphone, e-mail ou ICE" />
        <div className="chips">
          <button type="button" className={`chip${!due ? ' on' : ''}`} onClick={() => setDue(false)}>Tous</button>
          <button type="button" className={`chip${due ? ' on' : ''}`} onClick={() => setDue(true)}>À payer</button>
        </div>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      <Panel>
        {!data ? loading && <Loading /> : data.length === 0 ? <Empty>Aucun fournisseur trouvé.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nom</th><th>Téléphone</th><th>ICE</th><th className="num">Factures</th><th className="num">Total acheté</th>
                <th>Dernier achat</th><th className="num">Reste dû</th></tr></thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id} className={`clickable${s.active ? '' : ' inactive'}`} onClick={() => go(`/fournisseurs/${s.id}`)}>
                    <td><a href={`#/fournisseurs/${s.id}`} onClick={(e) => e.stopPropagation()}>{s.name}</a>{!s.active && <span className="sub">inactif</span>}</td>
                    <td>{s.phone ?? '—'}</td><td>{s.ice ?? '—'}</td>
                    <td className="num">{s.purchases_count}</td><td className="num">{formatMad(s.purchases_total)}</td>
                    <td className="nowrap">{s.last_purchase_on ? formatDay(s.last_purchase_on) : '—'}</td>
                    <td className="num">{s.due > 0 ? <Badge tone="amber">{formatMad(s.due)}</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {creating && <SupplierForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); go(`/fournisseurs/${id}`) }} />}
    </>
  )
}

export function SupplierPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(() => api.get<SupplierDetail>(`/admin/suppliers/${encodeURIComponent(id)}`), id)
  const [editing, setEditing] = useState(false)
  const [buying, setBuying] = useState(false)
  if (error) return <><PageHeader title="Fournisseur" back="#/fournisseurs" /><ErrorBox error={error} onRetry={reload} /></>
  if (!data) return loading ? <Loading /> : null
  const s = data.supplier
  return (
    <>
      <PageHeader title={s.name} back="#/fournisseurs"
        subtitle={[s.phone, s.email, s.ice && `ICE ${s.ice}`, !s.active && 'inactif'].filter(Boolean).join(' · ') || 'Sans coordonnées'}
        actions={<>
          <Button icon="edit" onClick={() => setEditing(true)}>Modifier</Button>
          <Button icon="plus" variant="primary" disabled={!s.active} onClick={() => setBuying(true)}>Nouvelle facture d’achat</Button>
        </>} />
      <div className="stats">
        <Stat label="Reste à payer" value={formatMad(s.due)} tone={s.due > 0 ? 'amber' : 'green'} />
        <Stat label="Factures" value={s.purchases_count} hint={s.last_purchase_on ? `dernière le ${formatDay(s.last_purchase_on)}` : undefined} />
        <Stat label="Total acheté" value={formatMad(s.purchases_total)} hint={`réglé ${formatMad(s.paid)}`} />
      </div>
      {(s.address || s.note) && (
        <Panel title="Coordonnées">
          <dl className="kv">
            {s.address && <><dt>Adresse</dt><dd>{s.address}</dd></>}
            {s.note && <><dt>Note</dt><dd>{s.note}</dd></>}
          </dl>
        </Panel>
      )}
      <Panel title="Factures d’achat">
        {data.purchases.length === 0 ? <Empty>Aucune facture d’achat pour ce fournisseur.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Facture</th><th>Date</th><th>Fournisseur</th><th>Magasin</th><th className="num">Total</th><th className="num">Réglé</th><th className="num">Reste dû</th></tr></thead>
              <tbody>{data.purchases.map((p) => <PurchaseTr key={p.id} p={p} />)}</tbody>
            </table>
          </div>
        )}
      </Panel>
      {editing && <SupplierForm supplier={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload() }} />}
      {buying && <PurchaseForm supplierId={s.id} onClose={() => setBuying(false)} onSaved={(pid) => { setBuying(false); go(`/achats/${pid}`) }} />}
    </>
  )
}

export function SupplierForm({ supplier, onClose, onSaved }: { supplier?: Supplier; onClose: () => void; onSaved: (id: string) => void }) {
  const { notify } = useApp()
  const [f, setF] = useState({
    name: supplier?.name ?? '', phone: supplier?.phone ?? '', email: supplier?.email ?? '', ice: supplier?.ice ?? '',
    address: supplier?.address ?? '', note: supplier?.note ?? '', active: supplier?.active ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }))
  const phoneOk = !f.phone.trim() || /^\+?\d{6,15}$/.test(f.phone.replace(/[\s.-]/g, ''))
  const emailOk = !f.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())
  const iceOk = !f.ice.trim() || /^\d{15}$/.test(f.ice.trim())
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = {
        name: f.name.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null, ice: f.ice.trim() || null,
        address: f.address.trim() || null, note: f.note.trim() || null, active: f.active,
      }
      const saved = supplier ? await api.put<Supplier>(`/admin/suppliers/${supplier.id}`, body) : await api.post<Supplier>('/admin/suppliers', body)
      notify('Fournisseur enregistré.')
      onSaved(saved.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={supplier ? `Modifier ${supplier.name}` : 'Nouveau fournisseur'} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button type="submit" form="supplier-form" variant="primary" busy={busy} disabled={!f.name.trim() || !phoneOk || !emailOk || !iceOk}>Enregistrer</Button>
    </>}>
      <form id="supplier-form" className="form" onSubmit={submit}>
        <Field label="Nom" wide><input autoFocus value={f.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Téléphone" error={phoneOk ? null : '6 à 15 chiffres'}><input type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label="E-mail" error={emailOk ? null : 'Adresse invalide'}><input type="email" value={f.email} maxLength={100} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="ICE" error={iceOk ? null : '15 chiffres'}><input inputMode="numeric" value={f.ice} onChange={(e) => set({ ice: e.target.value })} /></Field>
        <Field label="Adresse" wide><input value={f.address} maxLength={300} onChange={(e) => set({ address: e.target.value })} /></Field>
        <Field label="Note" wide><input value={f.note} maxLength={200} onChange={(e) => set({ note: e.target.value })} placeholder="Jours de livraison, contact commercial…" /></Field>
        {supplier && <label className="check form-field wide"><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />Fournisseur actif</label>}
        {error && <p className="alert form-field wide"><Icon name="alert" />{error}</p>}
      </form>
    </Modal>
  )
}
