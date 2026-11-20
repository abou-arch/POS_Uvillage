// Articles : liste (code, unité, stock, prix d'achat et de vente, TVA, statut), fiche, création et modification.
// Toute modification part vers les caisses à leur synchronisation suivante (updated_at, contrat §3).
import { useState, type FormEvent } from 'react'
import { api, ApiError, qs } from '../api/client'
import { MOVE_LABELS, type Category, type Product, type StockMove, type Unit } from '../api/types'
import { Badge, Button, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Panel, SearchInput } from '../components/ui'
import { csvMad, downloadCsv, toCsv } from '../lib/csv'
import { centsToInput, formatDateTime, formatMad, formatQuantity, parseMad, plural } from '../lib/format'
import { go, useApp, useDebounced, useLoad } from '../lib/hooks'

type Status = 'all' | 'active' | 'inactive' | 'low'

export function ProductsPage() {
  const { storeId, me } = useApp()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Status>('active')
  const [category, setCategory] = useState('')
  const [creating, setCreating] = useState(false)
  const q = useDebounced(search)
  const { data, error, loading, reload } = useLoad(
    () => api.get<Product[]>(`/admin/products${qs({ search: q, status: status === 'low' ? 'active' : status, category_id: category })}`),
    JSON.stringify([q, status, category]),
  )
  const categories = useLoad(() => api.get<Category[]>('/admin/categories'), 'categories')
  const stockOf = (p: Product) => (storeId ? p.stock_by_store[storeId] ?? 0 : p.stock_total)
  const alertOf = (p: Product) => (storeId ? p.stock_alert : p.stock_alert * me.stores.length)
  const rows = (data ?? []).filter((p) => status !== 'low' || stockOf(p) <= alertOf(p))

  function exportCsv() {
    downloadCsv('articles.csv', toCsv(
      ['Code', 'Code-barres', 'Nom', 'Nom arabe', 'Catégorie', 'Marque', 'Unité', 'Stock', 'Prix d’achat', 'Prix de vente TTC', 'TVA %', 'Statut'],
      rows.map((p) => [p.code, p.barcode, p.name, p.name_ar, p.category_name, p.brand_name, p.unit === 'kg' ? 'kg' : 'pièce',
        String(stockOf(p)).replace('.', ','), p.cost_price === null ? '' : csvMad(p.cost_price), csvMad(p.price_ttc), p.tva_rate,
        p.active ? 'Actif' : 'Inactif']),
    ))
  }

  return (
    <>
      <PageHeader title="Articles" subtitle={`${plural(rows.length, 'article')}${storeId ? ` · stock de ${me.stores.find((s) => s.id === storeId)?.name}` : ' · stock de tous les magasins'}`}
        actions={<>
          <Button icon="download" disabled={!rows.length} onClick={exportCsv}>Exporter</Button>
          <Button icon="plus" variant="primary" onClick={() => setCreating(true)}>Nouvel article</Button>
        </>} />
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Code, nom ou code-barres" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie">
          <option value="">Toutes les catégories</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="chips">
          {([['active', 'Actifs'], ['low', 'Stock bas'], ['inactive', 'Inactifs'], ['all', 'Tous']] as const).map(([s, label]) => (
            <button key={s} type="button" className={`chip${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>{label}</button>
          ))}
        </div>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      <Panel>
        {!data ? loading && <Loading /> : rows.length === 0 ? <Empty>Aucun article trouvé.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Code</th><th>Nom</th><th>Catégorie</th><th>Unité</th><th className="num">Stock</th><th className="num">Prix d’achat</th>
                <th className="num">Prix de vente</th><th className="num">TVA</th><th>Statut</th>
              </tr></thead>
              <tbody>
                {rows.map((p) => {
                  const stock = stockOf(p)
                  return (
                    <tr key={p.id} className={`clickable${p.active ? '' : ' inactive'}`} onClick={() => go(`/articles/${p.id}`)}>
                      <td className="nowrap"><a href={`#/articles/${p.id}`} onClick={(e) => e.stopPropagation()}>{p.code}</a><span className="sub">{p.barcode}</span></td>
                      <td>{p.name}{p.name_ar && <span className="sub" dir="rtl">{p.name_ar}</span>}</td>
                      <td>{p.category_name ?? <span className="muted">—</span>}</td>
                      <td>{p.unit === 'kg' ? 'kg' : 'pièce'}</td>
                      <td className="num">{stock <= 0 ? <Badge tone="red">{formatQuantity(stock, p.unit)}</Badge>
                        : stock <= alertOf(p) ? <Badge tone="amber">{formatQuantity(stock, p.unit)}</Badge> : formatQuantity(stock, p.unit)}</td>
                      <td className="num">{p.cost_price === null ? <span className="muted">—</span> : formatMad(p.cost_price)}</td>
                      <td className="num">{formatMad(p.price_ttc)}{p.unit === 'kg' && <span className="sub">le kg</span>}</td>
                      <td className="num">{p.tva_rate} %</td>
                      <td>{p.active ? <Badge tone="green">Actif</Badge> : <Badge>Inactif</Badge>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {creating && <ProductForm onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); go(`/articles/${p.id}`) }} />}
    </>
  )
}

export function ProductPage({ id }: { id: string }) {
  const { me, timeZone } = useApp()
  const { data, error, loading, reload } = useLoad(() => api.get<{ product: Product; moves: StockMove[] }>(`/admin/products/${encodeURIComponent(id)}`), id)
  const [editing, setEditing] = useState(false)
  if (error) return <><PageHeader title="Article" back="#/articles" /><ErrorBox error={error} onRetry={reload} /></>
  if (!data) return loading ? <Loading /> : null
  const p = data.product
  const margin = p.cost_price === null ? null : p.price_ttc - p.cost_price
  return (
    <>
      <PageHeader title={p.name} back="#/articles" subtitle={<>{p.code}{p.barcode && ` · ${p.barcode}`}{p.name_ar && <span dir="rtl"> · {p.name_ar}</span>}</>}
        actions={<>
          <a className="btn" href={`#/stock`}><Icon name="box" />Mouvement de stock</a>
          <Button icon="edit" variant="primary" onClick={() => setEditing(true)}>Modifier</Button>
        </>} />
      {!p.active && <p className="notice"><Icon name="info" />Article inactif : les caisses ne le proposent plus.</p>}
      <div className="grid">
        <Panel title="Fiche">
          <dl className="kv">
            <dt>Prix de vente</dt><dd>{formatMad(p.price_ttc)} TTC{p.unit === 'kg' ? ' le kg' : ''} · TVA {p.tva_rate} %</dd>
            <dt>Prix d’achat</dt><dd>{p.cost_price === null ? '—' : formatMad(p.cost_price)}</dd>
            <dt>Marge unitaire</dt><dd>{margin === null ? '—' : `${formatMad(margin)} (${p.price_ttc ? Math.round((margin / p.price_ttc) * 100) : 0} % du prix TTC)`}</dd>
            <dt>Catégorie</dt><dd>{p.category_name ?? '—'}</dd>
            <dt>Marque</dt><dd>{p.brand_name ?? '—'}</dd>
            <dt>Unité</dt><dd>{p.unit === 'kg' ? 'Au poids (kg)' : 'À la pièce'}</dd>
            <dt>Seuil d’alerte</dt><dd>{formatQuantity(p.stock_alert, p.unit)}</dd>
            <dt>Péremption</dt><dd>{p.expiry_date ? p.expiry_date.split('-').reverse().join('/') : '—'}</dd>
            <dt>Modifié</dt><dd>{formatDateTime(p.updated_at, timeZone)}</dd>
          </dl>
        </Panel>
        <Panel title="Stock par magasin">
          <ul className="list">
            {me.stores.map((s) => {
              const q = p.stock_by_store[s.id] ?? 0
              return (
                <li key={s.id}>
                  <Icon name="store" /><span className="grow">{s.name}</span>
                  <Badge tone={q <= 0 ? 'red' : q <= p.stock_alert ? 'amber' : 'green'}>{formatQuantity(q, p.unit)}</Badge>
                </li>
              )
            })}
          </ul>
        </Panel>
      </div>
      <Panel title="Derniers mouvements de stock">
        {data.moves.length === 0 ? <Empty>Aucun mouvement.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Magasin</th><th>Type</th><th className="num">Quantité</th><th>Par</th><th>Note</th></tr></thead>
              <tbody>
                {data.moves.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{formatDateTime(m.created_at, timeZone)}</td><td>{m.store_name}</td>
                    <td><Badge tone={m.delta > 0 ? 'green' : 'neutral'}>{MOVE_LABELS[m.kind]}</Badge></td>
                    <td className="num">{m.delta > 0 ? '+' : ''}{formatQuantity(m.delta, p.unit)}</td>
                    <td>{m.user_name ?? '—'}</td><td>{m.kind === 'sale' || m.kind === 'refund' || m.kind === 'cancel'
                      ? m.ref_id && m.kind !== 'refund' ? <a href={`#/ventes/${m.ref_id}`}>Voir le ticket</a> : '—' : m.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {editing && <ProductForm product={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload() }} />}
    </>
  )
}

/** Création ou modification d'un article. Prix saisis en DH, envoyés en centimes. */
export function ProductForm({ product, onClose, onSaved }: { product?: Product; onClose: () => void; onSaved: (p: Product) => void }) {
  const { me, notify } = useApp()
  const categories = useLoad(() => api.get<Category[]>('/admin/categories'), 'categories')
  const brands = useLoad(() => api.get<Category[]>('/admin/brands'), 'brands')
  const rates = me.settings.tva_rates
  const [f, setF] = useState({
    code: product?.code ?? '', barcode: product?.barcode ?? '', name: product?.name ?? '', name_ar: product?.name_ar ?? '',
    category_id: product?.category_id ?? '', brand_id: product?.brand_id ?? '', price: centsToInput(product?.price_ttc),
    cost: centsToInput(product?.cost_price), tva_rate: String(product?.tva_rate ?? rates[0] ?? 20), unit: (product?.unit ?? 'unit') as Unit,
    stock_alert: String(product?.stock_alert ?? 5), expiry_date: product?.expiry_date ?? '', image_url: product?.image_url ?? '',
    active: product?.active ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }))
  const price = parseMad(f.price)
  const cost = f.cost.trim() ? parseMad(f.cost) : null
  const alert = /^\d{1,7}$/.test(f.stock_alert) ? Number(f.stock_alert) : null
  const invalid = !f.code.trim() || !f.name.trim() || price === null || (f.cost.trim() !== '' && cost === null) || alert === null
    || (f.barcode.trim() !== '' && !/^\d{4,20}$/.test(f.barcode.trim()))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (invalid) return
    setBusy(true)
    setError(null)
    const body = {
      code: f.code.trim(), barcode: f.barcode.trim() || null, name: f.name.trim(), name_ar: f.name_ar.trim() || null,
      category_id: f.category_id || null, brand_id: f.brand_id || null, price_ttc: price, cost_price: cost, tva_rate: Number(f.tva_rate),
      unit: f.unit, stock_alert: alert, expiry_date: f.expiry_date || null, image_url: f.image_url.trim() || null, active: f.active,
    }
    try {
      const saved = product ? await api.put<Product>(`/admin/products/${product.id}`, body) : await api.post<Product>('/admin/products', body)
      notify(product ? 'Article enregistré. Les caisses le recevront à leur prochaine synchronisation.' : 'Article créé.')
      onSaved(saved)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal wide title={product ? `Modifier ${product.code}` : 'Nouvel article'} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button type="submit" form="product-form" variant="primary" icon="check" busy={busy} disabled={invalid}>Enregistrer</Button>
    </>}>
      <form id="product-form" className="form" onSubmit={submit}>
        <Field label="Code article"><input value={f.code} maxLength={30} required onChange={(e) => set('code')(e.target.value)} placeholder="IT0001" /></Field>
        <Field label="Code-barres" hint={f.unit === 'kg' ? 'Article pesé : code de base de la balance (valeur à zéro).' : 'EAN, 4 à 20 chiffres.'}
          error={f.barcode.trim() && !/^\d{4,20}$/.test(f.barcode.trim()) ? '4 à 20 chiffres' : null}>
          <input value={f.barcode} inputMode="numeric" maxLength={20} onChange={(e) => set('barcode')(e.target.value)} />
        </Field>
        <Field label="Nom (français)" wide><input value={f.name} maxLength={120} required onChange={(e) => set('name')(e.target.value)} /></Field>
        <Field label="Nom (arabe, facultatif)" wide><input dir="rtl" value={f.name_ar} maxLength={120} onChange={(e) => set('name_ar')(e.target.value)} /></Field>
        <Field label="Catégorie">
          <select value={f.category_id} onChange={(e) => set('category_id')(e.target.value)}>
            <option value="">—</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Marque">
          <select value={f.brand_id} onChange={(e) => set('brand_id')(e.target.value)}>
            <option value="">—</option>{brands.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Unité">
          <select value={f.unit} onChange={(e) => set('unit')(e.target.value)}>
            <option value="unit">À la pièce</option><option value="kg">Au poids (kg)</option>
          </select>
        </Field>
        <Field label={f.unit === 'kg' ? 'Prix de vente TTC (DH le kg)' : 'Prix de vente TTC (DH)'} error={f.price && price === null ? 'Montant invalide (2 décimales au plus)' : null}>
          <input value={f.price} inputMode="decimal" required onChange={(e) => set('price')(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Prix d’achat (DH, facultatif)" hint="Sert au calcul de la marge." error={f.cost.trim() && cost === null ? 'Montant invalide' : null}>
          <input value={f.cost} inputMode="decimal" onChange={(e) => set('cost')(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="TVA" hint="Taux définis dans les réglages.">
          <select value={f.tva_rate} onChange={(e) => set('tva_rate')(e.target.value)}>
            {rates.map((r) => <option key={r} value={r}>{r} %</option>)}
          </select>
        </Field>
        <Field label="Seuil d’alerte de stock" error={alert === null ? 'Nombre entier' : null}>
          <input value={f.stock_alert} inputMode="numeric" onChange={(e) => set('stock_alert')(e.target.value)} />
        </Field>
        <Field label="Date de péremption"><input type="date" value={f.expiry_date} onChange={(e) => set('expiry_date')(e.target.value)} /></Field>
        <Field label="Photo (adresse https, facultatif)" wide><input type="url" value={f.image_url} maxLength={500} onChange={(e) => set('image_url')(e.target.value)} placeholder="https://…" /></Field>
        <label className="check form-field wide"><span className="check"><input type="checkbox" checked={f.active} onChange={(e) => set('active')(e.target.checked)} />
          Actif (proposé aux caisses)</span></label>
        {error && <p className="alert form-field wide"><Icon name="alert" />{error}</p>}
      </form>
    </Modal>
  )
}
