// Inventaire : feuilles de comptage. On ouvre un inventaire (tout le magasin ou un rayon), on compte article par article
// (chaque quantité est enregistrée tout de suite, plusieurs personnes peuvent compter en même temps), puis on valide :
// les écarts deviennent des mouvements de stock « Inventaire ».
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { api, ApiError } from '../api/client'
import { INVENTORY_STATUS, type Category, type Inventory, type InventoryRow } from '../api/types'
import { PAGE_SIZE, Pager } from '../components/Pager'
import { Badge, Button, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Panel, SearchInput, Stat } from '../components/ui'
import { csvMad, downloadCsv, toCsv } from '../lib/csv'
import { formatDateTime, formatMad, formatQuantity, parseQuantity, plural } from '../lib/format'
import { go, useApp, useLoad } from '../lib/hooks'
import { filterSheet, gapValue, sheetSummary, type SheetFilter } from '../lib/inventory'

const tone = (s: Inventory['status']) => (s === 'open' ? 'blue' : s === 'validated' ? 'green' : 'neutral')

export function InventoriesPage() {
  const { timeZone } = useApp()
  const { data, error, loading, reload } = useLoad(() => api.get<Inventory[]>('/admin/inventories'), 'inventories')
  const [creating, setCreating] = useState(false)
  const open = data?.find((i) => i.status === 'open')
  return (
    <>
      <PageHeader title="Inventaires" subtitle="Comptez le stock réel, rayon par rayon ou tout le magasin, puis validez : les écarts corrigent le stock."
        actions={open
          ? <Button variant="primary" icon="clipboard" onClick={() => go(`/inventaires/${open.id}`)}>Reprendre l’inventaire en cours</Button>
          : <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Nouvel inventaire</Button>} />
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      <Panel>
        {!data ? loading && <Loading /> : data.length === 0 ? <Empty icon="clipboard">Aucun inventaire pour l’instant. Commencez par « Nouvel inventaire ».</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Inventaire</th><th>Périmètre</th><th>Statut</th><th className="num">Comptés</th><th className="num">Écarts</th>
                <th className="num">Valeur des écarts</th><th>Ouvert</th><th>Terminé</th></tr></thead>
              <tbody>
                {data.map((i) => (
                  <tr key={i.id} className="clickable" onClick={() => go(`/inventaires/${i.id}`)}>
                    <td><a href={`#/inventaires/${i.id}`} onClick={(e) => e.stopPropagation()}>{i.name}</a><span className="sub">{i.store_name}</span></td>
                    <td>{i.category_name ?? 'Tout le magasin'}</td>
                    <td><Badge tone={tone(i.status)}>{INVENTORY_STATUS[i.status]}</Badge></td>
                    <td className="num">{i.counted.toLocaleString('fr-FR')}</td>
                    <td className="num">{i.gaps.toLocaleString('fr-FR')}</td>
                    <td className="num">{i.gaps ? formatMad(i.gap_value) : '—'}</td>
                    <td className="nowrap">{formatDateTime(i.created_at, timeZone)}<span className="sub">{i.created_by_name}</span></td>
                    <td className="nowrap">{i.closed_at ? <>{formatDateTime(i.closed_at, timeZone)}<span className="sub">{i.closed_by_name}</span></> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {creating && <NewInventory onClose={() => setCreating(false)} />}
    </>
  )
}

function NewInventory({ onClose }: { onClose: () => void }) {
  const { me, storeId, notify } = useApp()
  const categories = useLoad(() => api.get<Category[]>('/admin/categories'), 'categories')
  const month = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const [name, setName] = useState(`Inventaire ${month}`)
  const [store, setStore] = useState(storeId || me.stores[0]?.id || '')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const inv = await api.post<Inventory>('/admin/inventories', { store_id: store, name: name.trim(), category_id: category || null })
      notify('Inventaire ouvert : comptez les articles, chaque quantité est enregistrée tout de suite.')
      go(`/inventaires/${inv.id}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ouverture impossible.')
      setBusy(false)
    }
  }
  return (
    <Modal title="Nouvel inventaire" onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" icon="check" busy={busy} disabled={!name.trim() || !store} onClick={submit}>Ouvrir l’inventaire</Button>
    </>}>
      <div className="form">
        <Field label="Nom" wide><input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        {me.stores.length > 1 && (
          <Field label="Magasin">
            <select value={store} onChange={(e) => setStore(e.target.value)}>{me.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </Field>
        )}
        <Field label="Périmètre" hint="Un rayon à la fois est plus simple à compter ; tout le magasin pour l’inventaire annuel.">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Tout le magasin</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {error && <p className="alert form-field wide"><Icon name="alert" />{error}</p>}
      </div>
    </Modal>
  )
}

type SaveState = 'saving' | 'saved' | 'error'

export function InventorySheetPage({ id }: { id: string }) {
  const { timeZone, notify } = useApp()
  const { data, error, loading, reload } = useLoad(() => api.get<{ inventory: Inventory; rows: InventoryRow[] }>(`/admin/inventories/${encodeURIComponent(id)}`), id)
  const [rows, setRows] = useState<InventoryRow[] | null>(null)
  const [seen, setSeen] = useState<typeof data>(null)
  if (data !== seen) { setSeen(data); setRows(data?.rows ?? null) }
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<SheetFilter>('todo')
  const [category, setCategory] = useState('')
  const [offset, setOffset] = useState(0)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [states, setStates] = useState<Record<string, SaveState>>({})
  const [closing, setClosing] = useState<'validate' | 'cancel' | null>(null)
  const inputs = useRef(new Map<string, HTMLInputElement>())

  const all = useMemo(() => rows ?? [], [rows])
  // Inventaire terminé : plus rien « à compter », on montre toutes les lignes comptées.
  const isOpen = data?.inventory.status === 'open'
  const shown: SheetFilter = !isOpen && filter === 'todo' ? 'all' : filter
  const visible = useMemo(() => filterSheet(all, search, shown, category), [all, search, shown, category])
  const page = visible.slice(offset, offset + PAGE_SIZE)
  const summary = sheetSummary(all)
  const categories = useMemo(() => [...new Set(all.map((r) => r.category_name).filter((c): c is string => !!c))].sort(), [all])

  if (error) return <><PageHeader title="Inventaire" back="#/inventaires" /><ErrorBox error={error} onRetry={reload} /></>
  if (!data || !rows) return loading ? <Loading /> : null
  const inv = data.inventory
  const open = inv.status === 'open'

  const textOf = (r: InventoryRow) => texts[r.product_id] ?? (r.counted === null ? '' : String(r.counted).replace('.', ','))

  async function save(r: InventoryRow) {
    const text = textOf(r).trim()
    const before = r.counted === null ? '' : String(r.counted).replace('.', ',')
    if (text === before) return
    const counted = text === '' ? null : parseQuantity(text, r.unit, { allowZero: true })
    if (text !== '' && counted === null) { setStates((s) => ({ ...s, [r.product_id]: 'error' })); return }
    setStates((s) => ({ ...s, [r.product_id]: 'saving' }))
    try {
      const res = await api.put<{ counted: number | null; expected?: number; delta?: number; counted_at?: string }>(
        `/admin/inventories/${inv.id}/counts/${r.product_id}`, { counted })
      setRows((rs) => rs && rs.map((x) => (x.product_id !== r.product_id ? x : {
        ...x, counted: res.counted, expected: res.expected ?? null, delta: res.counted === null ? null : res.delta ?? null, counted_at: res.counted_at ?? null,
      })))
      setTexts((t) => { const { [r.product_id]: _done, ...rest } = t; return rest })
      setStates((s) => ({ ...s, [r.product_id]: 'saved' }))
    } catch (e) {
      setStates((s) => ({ ...s, [r.product_id]: 'error' }))
      notify(e instanceof ApiError ? e.message : 'Comptage non enregistré : vérifiez la connexion.', 'error')
    }
  }

  // Entrée enregistre et passe à l'article suivant de la page : on compte vite, au clavier ou à la douchette.
  function onKey(e: KeyboardEvent<HTMLInputElement>, r: InventoryRow, i: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = page[i + 1] && inputs.current.get(page[i + 1].product_id)
    if (next) next.focus() // la sortie du champ (blur) enregistre
    else void save(r)
  }

  function exportCsv() {
    downloadCsv(`${inv.name}.csv`, toCsv(
      ['Code', 'Article', 'Nom arabe', 'Catégorie', 'Unité', 'Stock théorique', 'Compté', 'Écart', 'Valeur de l’écart'],
      visible.map((r) => [r.code, r.name, r.name_ar, r.category_name, r.unit === 'kg' ? 'kg' : 'pièce', String(r.expected ?? r.stock).replace('.', ','),
        r.counted === null ? '' : String(r.counted).replace('.', ','), r.delta === null ? '' : String(r.delta).replace('.', ','),
        gapValue(r) === null ? '' : csvMad(gapValue(r)!)]),
    ))
  }

  return (
    <>
      <PageHeader title={inv.name} back="#/inventaires"
        subtitle={<>{inv.store_name} · {inv.category_name ?? 'tout le magasin'} · ouvert le {formatDateTime(inv.created_at, timeZone)} par {inv.created_by_name}
          {inv.closed_at && <> · {INVENTORY_STATUS[inv.status].toLowerCase()} le {formatDateTime(inv.closed_at, timeZone)}</>}</>}
        actions={<>
          <Badge tone={tone(inv.status)}>{INVENTORY_STATUS[inv.status]}</Badge>
          <Button icon="download" onClick={exportCsv}>Feuille (CSV)</Button>
          {open && <Button variant="danger" icon="x" onClick={() => setClosing('cancel')}>Annuler</Button>}
          {open && <Button variant="primary" icon="check" disabled={summary.counted === 0} onClick={() => setClosing('validate')}>Valider l’inventaire</Button>}
        </>} />
      <div className="stats">
        <Stat label="Comptés" value={`${summary.counted.toLocaleString('fr-FR')} / ${summary.total.toLocaleString('fr-FR')}`}
          hint={open ? `${plural(summary.total - summary.counted, 'article')} à compter` : undefined} />
        <Stat label="Manquants" value={summary.missing.toLocaleString('fr-FR')} tone={summary.missing ? 'red' : undefined} hint="compté < stock" />
        <Stat label="En trop" value={summary.surplus.toLocaleString('fr-FR')} tone={summary.surplus ? 'amber' : undefined} hint="compté > stock" />
        <Stat label="Valeur des écarts" value={formatMad(summary.value)} tone={summary.value < 0 ? 'red' : undefined} hint="au prix d’achat" />
      </div>
      {open && <p className="notice"><Icon name="info" />Tapez la quantité comptée puis Entrée : elle est enregistrée et le curseur passe à l’article suivant.
        Rien ne change dans le stock avant « Valider l’inventaire ».</p>}
      <div className="toolbar">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setOffset(0) }} placeholder="Code, nom ou nom arabe" />
        {!inv.category_id && categories.length > 1 && (
          <select value={category} onChange={(e) => { setCategory(e.target.value); setOffset(0) }} aria-label="Catégorie">
            <option value="">Toutes les catégories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <div className="chips">
          {([['todo', 'À compter'], ['counted', 'Comptés'], ['gaps', 'Écarts'], ['all', 'Tous']] as const).filter(([f]) => open || f !== 'todo').map(([f, label]) => (
            <button key={f} type="button" className={`chip${shown === f ? ' on' : ''}`} onClick={() => { setFilter(f); setOffset(0) }}>{label}</button>
          ))}
        </div>
      </div>
      <Panel>
        {page.length === 0 ? <Empty>{shown === 'todo' ? 'Tout est compté dans cette sélection.' : 'Aucun article dans cette sélection.'}</Empty> : (
          <div className="table-wrap">
            <table className="lines-editor">
              <thead><tr><th>Code</th><th>Article</th><th className="num">Stock théorique</th><th>Compté</th><th className="num">Écart</th>
                <th className="num">Valeur</th><th>Compté par</th></tr></thead>
              <tbody>
                {page.map((r, i) => {
                  const state = states[r.product_id]
                  const value = gapValue(r)
                  return (
                    <tr key={r.product_id} className={r.active ? undefined : 'inactive'}>
                      <td className="nowrap">{r.code}</td>
                      <td>{r.name}{r.name_ar && <span className="sub" dir="rtl">{r.name_ar}</span>}{!inv.category_id && <span className="sub">{r.category_name}</span>}</td>
                      <td className="num">{formatQuantity(r.expected ?? r.stock, r.unit)}</td>
                      <td className="nowrap">
                        {open ? (
                          <span className="count-cell">
                            <input ref={(el) => { if (el) inputs.current.set(r.product_id, el); else inputs.current.delete(r.product_id) }}
                              value={textOf(r)} inputMode="decimal" placeholder={r.unit === 'kg' ? 'kg' : 'qté'} aria-label={`Quantité comptée : ${r.name}`}
                              aria-invalid={state === 'error'} onChange={(e) => { setTexts((t) => ({ ...t, [r.product_id]: e.target.value })); setStates((s) => ({ ...s, [r.product_id]: undefined as never })) }}
                              onBlur={() => void save(r)} onKeyDown={(e) => onKey(e, r, i)} />
                            {state === 'saving' ? <span className="muted small">…</span> : state === 'saved' ? <Icon name="check" size={16} />
                              : state === 'error' ? <span className="field-error small">{r.unit === 'kg' ? 'kg, 3 déc.' : 'entier'}</span> : null}
                          </span>
                        ) : r.counted === null ? '—' : formatQuantity(r.counted, r.unit)}
                      </td>
                      <td className="num">{r.delta === null ? '—' : r.delta === 0 ? <Badge tone="green">0</Badge>
                        : <Badge tone={r.delta < 0 ? 'red' : 'amber'}>{r.delta > 0 ? '+' : ''}{formatQuantity(r.delta, r.unit)}</Badge>}</td>
                      <td className="num">{value === null ? <span className="muted">{r.delta && r.cost_price === null ? 'sans prix d’achat' : '—'}</span> : formatMad(value)}</td>
                      <td className="nowrap">{r.counted_at ? <>{r.counted_by_name}<span className="sub">{formatDateTime(r.counted_at, timeZone)}</span></> : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager offset={offset} total={visible.length} onChange={setOffset} />
      </Panel>
      {closing && <CloseInventory inventory={inv} summary={summary} kind={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); reload() }} />}
    </>
  )
}

function CloseInventory({ inventory, summary, kind, onClose, onDone }: {
  inventory: Inventory; summary: ReturnType<typeof sheetSummary>; kind: 'validate' | 'cancel'; onClose: () => void; onDone: () => void
}) {
  const { notify } = useApp()
  const [zero, setZero] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const left = summary.total - summary.counted
  async function submit() {
    setBusy(true)
    setError(null)
    try {
      if (kind === 'validate') {
        await api.post(`/admin/inventories/${inventory.id}/validate`, { zero_uncounted: zero })
        notify('Inventaire validé : le stock est corrigé et les caisses le recevront à leur prochaine synchronisation.')
      } else {
        await api.post(`/admin/inventories/${inventory.id}/cancel`, {})
        notify('Inventaire annulé : le stock n’a pas changé.')
      }
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Opération impossible.')
      setBusy(false)
    }
  }
  return (
    <Modal title={kind === 'validate' ? 'Valider l’inventaire' : 'Annuler l’inventaire'} onClose={onClose} footer={<>
      <Button onClick={onClose}>Retour</Button>
      <Button variant={kind === 'validate' ? 'primary' : 'danger'} icon="check" busy={busy} onClick={submit}>
        {kind === 'validate' ? 'Valider et corriger le stock' : 'Annuler l’inventaire'}</Button>
    </>}>
      {kind === 'cancel' ? (
        <p>Les {plural(summary.counted, 'comptage')} déjà saisis seront abandonnés. Le stock ne change pas.</p>
      ) : (
        <>
          <p>{plural(summary.counted, 'article')} compté{summary.counted > 1 ? 's' : ''} : {summary.missing} manquant{summary.missing > 1 ? 's' : ''},
            {' '}{summary.surplus} en trop, valeur des écarts {formatMad(summary.value)} au prix d’achat. Le stock de ces articles prendra la quantité comptée
            (les ventes faites depuis le comptage sont gardées).</p>
          {left > 0 && (<>
            <label className="check"><input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} />
              Mettre à 0 les {plural(left, 'article')} non compté{left > 1 ? 's' : ''}</label>
            <p className="muted small">À cocher seulement si tout le rayon a été compté : un article non compté est alors considéré absent.
              Sinon, leur stock ne change pas.</p>
          </>)}
          {inventory.missing_cost > 0 && <p className="muted small">{plural(inventory.missing_cost, 'écart')} sans prix d’achat : non chiffré{inventory.missing_cost > 1 ? 's' : ''} dans la valeur.</p>}
        </>
      )}
      {error && <p className="alert"><Icon name="alert" />{error}</p>}
    </Modal>
  )
}
