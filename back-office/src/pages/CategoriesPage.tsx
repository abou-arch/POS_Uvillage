// Catégories (nom FR + AR) et marques du catalogue.
import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import type { Category } from '../api/types'
import { Button, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Panel } from '../components/ui'
import { useApp, useLoad } from '../lib/hooks'
import { plural } from '../lib/format'

export function CategoriesPage() {
  return (
    <>
      <PageHeader title="Catégories et marques" subtitle="Les caisses classent les articles par catégorie." />
      <div className="grid">
        <Kind path="categories" title="Catégories" withAr />
        <Kind path="brands" title="Marques" />
      </div>
    </>
  )
}

function Kind({ path, title, withAr }: { path: 'categories' | 'brands'; title: string; withAr?: boolean }) {
  const { notify } = useApp()
  const { data, error, loading, reload } = useLoad(() => api.get<Category[]>(`/admin/${path}`), path)
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const [merging, setMerging] = useState<Category | null>(null)

  async function remove(c: Category) {
    try {
      await api.del(`/admin/${path}/${c.id}`)
      notify(`${c.name} supprimé.`)
      reload()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Suppression impossible.', 'error')
    }
  }

  return (
    <Panel title={title} actions={<Button small icon="plus" onClick={() => setEditing('new')}>Ajouter</Button>}>
      {error ? <ErrorBox error={error} onRetry={reload} /> : !data ? loading && <Loading /> : data.length === 0 ? <Empty>Aucune pour l’instant. Créez-en une avec « Ajouter ».</Empty> : (
        <ul className="list">
          {data.map((c) => (
            <li key={c.id}>
              <span className="grow">{c.name}{c.name_ar && <span className="muted" dir="rtl"> · {c.name_ar}</span>}
                <span className="sub muted small"> · {plural(c.product_count, 'article')}</span></span>
              <Button small variant="ghost" icon="edit" title="Modifier" onClick={() => setEditing(c)} />
              <Button small variant="ghost" icon="merge" title="Fusionner avec une autre (doublon)" disabled={data.length < 2} onClick={() => setMerging(c)} />
              <Button small variant="ghost" icon="trash" title={c.product_count ? 'Utilisée par des articles' : 'Supprimer'}
                disabled={c.product_count > 0} onClick={() => remove(c)} />
            </li>
          ))}
        </ul>
      )}
      {editing && <NameForm path={path} withAr={withAr} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); reload() }} />}
      {merging && data && <MergeForm path={path} item={merging} others={data.filter((x) => x.id !== merging.id)} onClose={() => setMerging(null)}
        onDone={() => { setMerging(null); reload() }} />}
    </Panel>
  )
}

function NameForm({ path, withAr, item, onClose, onSaved }: {
  path: string; withAr?: boolean; item: Category | null; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [nameAr, setNameAr] = useState(item?.name_ar ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const body = { name: name.trim(), name_ar: nameAr.trim() || null }
      if (item) await api.put(`/admin/${path}/${item.id}`, body)
      else await api.post(`/admin/${path}`, body)
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={item ? `Modifier ${item.name}` : 'Ajouter'} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button type="submit" form="name-form" variant="primary" busy={busy} disabled={!name.trim()}>Enregistrer</Button>
    </>}>
      <form id="name-form" className="form" onSubmit={submit}>
        <Field label="Nom" wide><input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        {withAr && <Field label="Nom arabe (facultatif)" wide><input dir="rtl" value={nameAr} maxLength={80} onChange={(e) => setNameAr(e.target.value)} /></Field>}
        {error && <p className="alert form-field wide"><Icon name="alert" />{error}</p>}
      </form>
    </Modal>
  )
}

/** Fusion de doublons (« LRS EPICES » et « EPICES ») : les articles passent dans celle qu'on garde, l'autre est supprimée. */
function MergeForm({ path, item, others, onClose, onDone }: {
  path: 'categories' | 'brands'; item: Category; others: Category[]; onClose: () => void; onDone: () => void
}) {
  const { notify } = useApp()
  const [into, setInto] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = others.find((o) => o.id === into)
  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ moved: number }>(`/admin/${path}/${item.id}/merge`, { into })
      notify(`${item.name} fusionnée dans ${target?.name} : ${plural(res.moved, 'article')} déplacé${res.moved > 1 ? 's' : ''}.`)
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Fusion impossible.')
      setBusy(false)
    }
  }
  return (
    <Modal title={`Fusionner ${item.name}`} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" icon="merge" busy={busy} disabled={!into} onClick={submit}>Fusionner</Button>
    </>}>
      <div className="form">
        <Field label="Garder" wide hint={`Les ${plural(item.product_count, 'article')} de « ${item.name} » y passeront, puis « ${item.name} » sera supprimée.`}>
          <select autoFocus value={into} onChange={(e) => setInto(e.target.value)}>
            <option value="">Choisir…</option>
            {others.map((o) => <option key={o.id} value={o.id}>{o.name} ({plural(o.product_count, 'article')})</option>)}
          </select>
        </Field>
        {error && <p className="alert form-field wide"><Icon name="alert" />{error}</p>}
      </div>
    </Modal>
  )
}
