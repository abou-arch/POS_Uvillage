// Stock : réception de marchandise, ajustement (casse, perte), inventaire ; journal des mouvements.
import { useMemo, useState } from 'react'
import { api, ApiError, qs } from '../api/client'
import { MOVE_LABELS, type MoveKind, type Product, type StockMove } from '../api/types'
import { PAGE_SIZE } from '../components/Pager'
import { PeriodPicker } from '../components/PeriodPicker'
import { Badge, Button, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Panel, SearchInput } from '../components/ui'
import { formatDateTime, formatQuantity, parseMad, parseQuantity, plural } from '../lib/format'
import { useApp, useLoad } from '../lib/hooks'
import { periodRange } from '../lib/period'

type Kind = 'receipt' | 'adjustment' | 'inventory'
const KINDS: { kind: Kind; label: string; help: string }[] = [
  { kind: 'receipt', label: 'Réception', help: 'Marchandise reçue : la quantité s’ajoute au stock. Le prix d’achat saisi met à jour la fiche.' },
  { kind: 'adjustment', label: 'Ajustement', help: 'Casse, perte, consommation : quantité négative pour retirer, positive pour ajouter. Motif obligatoire.' },
  { kind: 'inventory', label: 'Recompter un article', help: 'Quelques articles recomptés en rayon : le stock prend la valeur saisie. Pour un rayon entier ou tout le magasin, utilisez « Inventaires ».' },
]

export function StockPage() {
  const { storeId, period, timeZone } = useApp()
  const [kind, setKind] = useState<'' | MoveKind>('')
  const [form, setForm] = useState<Kind | null>(null)
  const range = periodRange(period, timeZone)
  const { data, error, loading, reload } = useLoad(
    () => api.get<StockMove[]>(`/admin/stock-moves${qs({ store_id: storeId, kind, ...range, limit: PAGE_SIZE * 4 })}`),
    JSON.stringify([storeId, kind, range]),
  )
  return (
    <>
      <PageHeader title="Stock" subtitle="Entrées, sorties et inventaires, magasin par magasin." actions={<>
        {KINDS.map((k) => <Button key={k.kind} icon={k.kind === 'receipt' ? 'plus' : k.kind === 'inventory' ? 'check' : 'edit'}
          variant={k.kind === 'receipt' ? 'primary' : 'default'} onClick={() => setForm(k.kind)}>{k.label}</Button>)}
        <a className="btn" href="#/inventaires"><Icon name="clipboard" />Inventaires</a>
      </>} />
      <PeriodPicker />
      <div className="chips">
        {([['', 'Tous'], ['receipt', 'Réceptions'], ['adjustment', 'Ajustements'], ['inventory', 'Inventaires'], ['sale', 'Ventes'], ['refund', 'Retours'], ['cancel', 'Annulations']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      <Panel title="Mouvements">
        {!data ? loading && <Loading /> : data.length === 0 ? <Empty>Aucun mouvement sur la période.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Article</th><th>Magasin</th><th>Type</th><th className="num">Quantité</th><th>Par</th><th>Note</th></tr></thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{formatDateTime(m.created_at, timeZone)}</td>
                    <td><a href={`#/articles/${m.product_id}`}>{m.name}</a><span className="sub">{m.code}</span></td>
                    <td>{m.store_name}</td>
                    <td><Badge tone={m.delta > 0 ? 'green' : 'neutral'}>{MOVE_LABELS[m.kind]}</Badge></td>
                    <td className="num">{m.delta > 0 ? '+' : ''}{formatQuantity(m.delta, m.unit)}</td>
                    <td>{m.user_name ?? '—'}</td>
                    <td>{m.note ?? (m.kind === 'sale' && m.ref_id ? <a href={`#/ventes/${m.ref_id}`}>Ticket</a> : '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {form && <MoveForm kind={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload() }} />}
    </>
  )
}

interface Line { product: Product; quantity: string; cost: string }

function MoveForm({ kind, onClose, onSaved }: { kind: Kind; onClose: () => void; onSaved: () => void }) {
  const { me, storeId, notify } = useApp()
  const [store, setStore] = useState(storeId || me.stores[0]?.id || '')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const products = useLoad(() => api.get<Product[]>('/admin/products?status=active'), 'products-active')
  const info = KINDS.find((k) => k.kind === kind)!
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 1 || !products.data) return []
    return products.data.filter((p) => !lines.some((l) => l.product.id === p.id)
      && (p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || (p.barcode ?? '') === q)).slice(0, 8)
  }, [search, products.data, lines])

  const parsed = lines.map((l) => ({
    quantity: parseQuantity(l.quantity, l.product.unit, { allowNegative: kind === 'adjustment', allowZero: kind === 'inventory' }),
    cost: l.cost.trim() ? parseMad(l.cost) : null,
  }))
  const invalid = !store || lines.length === 0 || parsed.some((p, i) => p.quantity === null || (lines[i].cost.trim() !== '' && p.cost === null))
    || (kind === 'adjustment' && !note.trim())

  function add(p: Product) {
    setLines((ls) => [...ls, { product: p, quantity: kind === 'inventory' ? String(p.stock_by_store[store] ?? 0).replace('.', ',') : '', cost: '' }])
    setSearch('')
  }
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api.post('/admin/stock-moves', {
        store_id: store, kind, note: note.trim() || null,
        lines: lines.map((l, i) => ({ product_id: l.product.id, quantity: parsed[i].quantity, ...(kind === 'receipt' && parsed[i].cost !== null ? { unit_cost: parsed[i].cost } : {}) })),
      })
      notify(`${info.label} enregistrée pour ${plural(lines.length, 'article')}.`)
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal wide title={info.label} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" icon="check" busy={busy} disabled={invalid} onClick={submit}>Enregistrer</Button>
    </>}>
      <p className="muted">{info.help}</p>
      <div className="form">
        <Field label="Magasin">
          <select value={store} onChange={(e) => setStore(e.target.value)} disabled={lines.length > 0 && kind === 'inventory'}>
            {me.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label={kind === 'adjustment' ? 'Motif (obligatoire)' : 'Note (facultatif)'}>
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)}
            placeholder={kind === 'receipt' ? 'Fournisseur, n° de bon de livraison' : kind === 'adjustment' ? 'Casse, produit périmé…' : 'Inventaire de fin de mois'} />
        </Field>
      </div>
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Ajouter un article : code, nom ou code-barres" />
      </div>
      {matches.length > 0 && (
        <ul className="list panel">
          {matches.map((p) => (
            <li key={p.id}>
              <span className="grow"><strong>{p.code}</strong> · {p.name}</span>
              <span className="muted small">stock {formatQuantity(p.stock_by_store[store] ?? 0, p.unit)}</span>
              <Button small icon="plus" onClick={() => add(p)}>Ajouter</Button>
            </li>
          ))}
        </ul>
      )}
      {lines.length === 0 ? <Empty>Cherchez un article ci-dessus pour l’ajouter.</Empty> : (
        <div className="table-wrap">
          <table className="lines-editor">
            <thead><tr><th>Article</th><th className="num">Stock actuel</th>
              <th>{kind === 'inventory' ? 'Quantité comptée' : kind === 'adjustment' ? 'Quantité (±)' : 'Quantité reçue'}</th>
              {kind === 'receipt' && <th>Prix d’achat (DH)</th>}<th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.product.id}>
                  <td>{l.product.name}<span className="sub">{l.product.code} · {l.product.unit === 'kg' ? 'kg, 3 décimales' : 'pièces'}</span></td>
                  <td className="num">{formatQuantity(l.product.stock_by_store[store] ?? 0, l.product.unit)}</td>
                  <td><input value={l.quantity} inputMode="decimal" aria-label="Quantité" aria-invalid={parsed[i].quantity === null}
                    onChange={(e) => update(i, { quantity: e.target.value })} /></td>
                  {kind === 'receipt' && <td><input value={l.cost} inputMode="decimal" aria-label="Prix d’achat" placeholder="inchangé"
                    onChange={(e) => update(i, { cost: e.target.value })} /></td>}
                  <td><Button small variant="ghost" icon="trash" title="Retirer" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="alert"><Icon name="alert" />{error}</p>}
    </Modal>
  )
}
