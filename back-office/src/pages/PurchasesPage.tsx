// Factures d'achat : la marchandise reçue entre en stock, le prix d'achat des articles est mis à jour, et ce qui reste à
// payer au fournisseur est suivi règlement par règlement.
import { useMemo, useState } from 'react'
import { api, ApiError, qs } from '../api/client'
import { PAY_METHOD_LABELS, type PayMethod, type Product, type Purchase, type PurchaseDetail, type PurchaseList, type Supplier } from '../api/types'
import { PAGE_SIZE, Pager } from '../components/Pager'
import { PeriodPicker } from '../components/PeriodPicker'
import { Badge, Button, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Panel, SearchInput, Stat } from '../components/ui'
import { csvMad, downloadCsv, toCsv } from '../lib/csv'
import { centsToInput, formatDateTime, formatDay, formatMad, formatQuantity, parseMad, parseQuantity, plural } from '../lib/format'
import { go, useApp, useDebounced, useLoad } from '../lib/hooks'
import { dayIn, periodRange } from '../lib/period'
import { dueAfter, lineTotal, purchaseTotal } from '../lib/purchase'

const PAY_METHODS = Object.keys(PAY_METHOD_LABELS) as PayMethod[]

export function PurchasesPage() {
  const { storeId, period, timeZone } = useApp()
  const [search, setSearch] = useState('')
  const [due, setDue] = useState(false)
  const [offset, setOffset] = useState(0)
  const [creating, setCreating] = useState(false)
  const q = useDebounced(search)
  const range = periodRange(period, timeZone)
  const key = JSON.stringify([storeId, range, q, due, offset])
  const { data, error, loading, reload } = useLoad(
    () => api.get<PurchaseList>(`/admin/purchases${qs({ store_id: storeId, ...range, search: q, due, limit: PAGE_SIZE, offset })}`), key)

  async function exportCsv() {
    const all = await api.get<PurchaseList>(`/admin/purchases${qs({ store_id: storeId, ...range, search: q, due, limit: 500 })}`)
    downloadCsv('factures-achat.csv', toCsv(['Facture', 'Réf. fournisseur', 'Date', 'Fournisseur', 'Magasin', 'Total', 'Réglé', 'Reste dû'],
      all.items.map((p) => [p.number, p.invoice_ref, formatDay(p.invoice_date), p.supplier_name, p.store_name, csvMad(p.total), csvMad(p.paid), csvMad(p.due)])))
  }

  return (
    <>
      <PageHeader title="Factures d’achat" subtitle="Marchandise reçue des fournisseurs : entrée en stock et règlements." actions={<>
        <Button icon="download" disabled={!data?.count} onClick={exportCsv}>Exporter</Button>
        <Button icon="plus" variant="primary" onClick={() => setCreating(true)}>Nouvelle facture</Button>
      </>} />
      <PeriodPicker />
      <div className="toolbar">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setOffset(0) }} placeholder="N° de facture, référence ou fournisseur" />
        <div className="chips">
          <button type="button" className={`chip${!due ? ' on' : ''}`} onClick={() => { setDue(false); setOffset(0) }}>Toutes</button>
          <button type="button" className={`chip${due ? ' on' : ''}`} onClick={() => { setDue(true); setOffset(0) }}>À payer</button>
        </div>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {data && (
        <div className="stats">
          <Stat label="Factures" value={data.count} />
          <Stat label="Total des achats" value={formatMad(data.total)} />
          <Stat label="Réglé" value={formatMad(data.paid)} tone="green" />
          <Stat label="Reste à payer" value={formatMad(data.due)} tone={data.due ? 'amber' : undefined} />
        </div>
      )}
      <Panel>
        {!data ? loading && <Loading /> : data.items.length === 0 ? <Empty>Aucune facture d’achat sur la période.</Empty> : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Facture</th><th>Date</th><th>Fournisseur</th><th>Magasin</th><th className="num">Total</th><th className="num">Réglé</th><th className="num">Reste dû</th></tr></thead>
                <tbody>{data.items.map((p) => <PurchaseTr key={p.id} p={p} />)}</tbody>
              </table>
            </div>
            <Pager offset={offset} total={data.count} onChange={setOffset} />
          </>
        )}
      </Panel>
      {creating && <PurchaseForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); go(`/achats/${id}`) }} />}
    </>
  )
}

export function PurchaseTr({ p }: { p: Purchase }) {
  return (
    <tr className="clickable" onClick={() => go(`/achats/${p.id}`)}>
      <td><a href={`#/achats/${p.id}`} onClick={(e) => e.stopPropagation()}>{p.number}</a>{p.invoice_ref && <span className="sub">réf. {p.invoice_ref}</span>}</td>
      <td className="nowrap">{formatDay(p.invoice_date)}</td>
      <td>{p.supplier_name}</td><td>{p.store_name}</td>
      <td className="num">{formatMad(p.total)}</td><td className="num">{formatMad(p.paid)}</td>
      <td className="num">{p.due > 0 ? <Badge tone="amber">{formatMad(p.due)}</Badge> : <Badge tone="green">Payée</Badge>}</td>
    </tr>
  )
}

export function PurchasePage({ id }: { id: string }) {
  const { timeZone } = useApp()
  const { data, error, loading, reload } = useLoad(() => api.get<PurchaseDetail>(`/admin/purchases/${encodeURIComponent(id)}`), id)
  const [paying, setPaying] = useState(false)
  if (error) return <><PageHeader title="Facture d’achat" back="#/achats" /><ErrorBox error={error} onRetry={reload} /></>
  if (!data) return loading ? <Loading /> : null
  const p = data.purchase
  return (
    <>
      <PageHeader title={`Facture ${p.number}`} back="#/achats"
        subtitle={<><a href={`#/fournisseurs/${p.supplier_id}`}>{p.supplier_name}</a> · {formatDay(p.invoice_date)} · {p.store_name}{p.invoice_ref ? ` · réf. ${p.invoice_ref}` : ''}</>}
        actions={<Button icon="wallet" variant="primary" disabled={p.due <= 0} onClick={() => setPaying(true)}>Enregistrer un règlement</Button>} />
      <div className="stats">
        <Stat label="Total" value={formatMad(p.total)} hint={plural(data.lines.length, 'article')} />
        <Stat label="Réglé" value={formatMad(p.paid)} tone="green" />
        <Stat label="Reste dû" value={formatMad(p.due)} tone={p.due > 0 ? 'amber' : 'green'} />
      </div>
      {p.note && <p className="notice"><Icon name="info" />{p.note}</p>}
      <Panel title="Articles reçus">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Article</th><th className="num">Quantité</th><th className="num">Prix d’achat</th><th className="num">Total</th></tr></thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.line}>
                  <td><a href={`#/articles/${l.product_id}`}>{l.name}</a><span className="sub">{l.code}</span></td>
                  <td className="num">{formatQuantity(l.quantity, l.unit)}</td>
                  <td className="num">{formatMad(l.unit_cost)}{l.unit === 'kg' ? ' /kg' : ''}</td>
                  <td className="num">{formatMad(l.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total</td><td className="num">{formatMad(p.total)}</td></tr></tfoot>
          </table>
        </div>
      </Panel>
      <Panel title="Règlements">
        {data.payments.length === 0 ? <Empty>Aucun règlement.</Empty> : (
          <ul className="list">
            {data.payments.map((x) => (
              <li key={x.id}>
                <Icon name="wallet" />
                <span className="grow">{PAY_METHOD_LABELS[x.method]} · {formatDay(x.paid_on)}
                  <span className="sub muted small"> · {x.user_name ?? '—'} · saisi le {formatDateTime(x.created_at, timeZone)}{x.note ? ` · ${x.note}` : ''}</span></span>
                <strong className="num">{formatMad(x.amount)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p className="muted small">Saisie par {p.created_by_name ?? '—'} le {formatDateTime(p.created_at, timeZone)}. La marchandise est entrée en stock à l’enregistrement.</p>
      {paying && <PaymentForm purchase={p} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); reload() }} />}
    </>
  )
}

interface Line { product: Product; quantity: string; cost: string }

/** Nouvelle facture : fournisseur, magasin, articles reçus, premier règlement facultatif. Idempotente (id fixé à l'ouverture). */
export function PurchaseForm({ supplierId, onClose, onSaved }: { supplierId?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const { me, storeId, timeZone, notify } = useApp()
  const [purchaseId] = useState(() => crypto.randomUUID())
  const [supplier, setSupplier] = useState(supplierId ?? '')
  const [store, setStore] = useState(storeId || me.stores[0]?.id || '')
  const [today] = useState(() => dayIn(new Date(), timeZone))
  const [date, setDate] = useState(today)
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [search, setSearch] = useState('')
  const [paid, setPaid] = useState('')
  const [method, setMethod] = useState<PayMethod>('cash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const suppliers = useLoad(() => api.get<Supplier[]>('/admin/suppliers'), 'suppliers')
  const products = useLoad(() => api.get<Product[]>('/admin/products?status=active'), 'products-active')
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q || !products.data) return []
    return products.data.filter((p) => !lines.some((l) => l.product.id === p.id)
      && (p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || (p.barcode ?? '') === q)).slice(0, 8)
  }, [search, products.data, lines])

  const parsed = lines.map((l) => ({ quantity: parseQuantity(l.quantity, l.product.unit), unitCost: parseMad(l.cost) }))
  const total = purchaseTotal(parsed)
  const paidCents = paid.trim() ? parseMad(paid) : 0
  const due = total !== null && paidCents !== null ? dueAfter(total, paidCents) : null
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '2000-01-01' && date <= today
  const invalid = !supplier || !store || !dateOk || total === null || paidCents === null || due === null
  const activeSuppliers = (suppliers.data ?? []).filter((s) => s.active || s.id === supplier)

  function add(p: Product) {
    setLines((ls) => [...ls, { product: p, quantity: '', cost: p.cost_price ? centsToInput(p.cost_price) : '' }])
    setSearch('')
  }
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  async function submit() {
    if (invalid) return
    setBusy(true)
    setError(null)
    try {
      await api.post<PurchaseDetail>('/admin/purchases', {
        id: purchaseId, supplier_id: supplier, store_id: store, invoice_date: date, invoice_ref: ref.trim() || null, note: note.trim() || null,
        lines: lines.map((l, i) => ({ product_id: l.product.id, quantity: parsed[i].quantity, unit_cost: parsed[i].unitCost })),
        ...(paidCents ? { payment: { amount: paidCents, method } } : {}),
      })
      notify(`Facture enregistrée. Stock mis à jour pour ${plural(lines.length, 'article')}.`)
      onSaved(purchaseId)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal wide title="Nouvelle facture d’achat" onClose={onClose} footer={<>
      <span className="grow muted">Total <strong>{total === null ? '—' : formatMad(total)}</strong>{due !== null && total ? ` · reste dû ${formatMad(due)}` : ''}</span>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" icon="check" busy={busy} disabled={invalid} onClick={submit}>Enregistrer</Button>
    </>}>
      <div className="form">
        <Field label="Fournisseur" hint={suppliers.data && suppliers.data.length === 0 ? 'Créez d’abord un fournisseur.' : undefined}>
          <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">Choisir…</option>
            {activeSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Magasin (reçoit le stock)">
          <select value={store} onChange={(e) => setStore(e.target.value)}>{me.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </Field>
        <Field label="Date de la facture" error={dateOk ? null : 'Date invalide ou future'}>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Référence fournisseur (facultatif)"><input value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} placeholder="N° de facture ou de BL" /></Field>
      </div>
      <SearchInput value={search} onChange={setSearch} placeholder="Ajouter un article : code, nom ou code-barres" />
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
      {lines.length === 0 ? <Empty>Cherchez un article ci-dessus pour l’ajouter à la facture.</Empty> : (
        <div className="table-wrap">
          <table className="lines-editor">
            <thead><tr><th>Article</th><th>Quantité reçue</th><th>Prix d’achat unitaire (DH)</th><th className="num">Total</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.product.id}>
                  <td>{l.product.name}<span className="sub">{l.product.code} · {l.product.unit === 'kg' ? 'kg, 3 décimales' : 'pièces'}</span></td>
                  <td><input value={l.quantity} inputMode="decimal" aria-label="Quantité" aria-invalid={!!l.quantity && parsed[i].quantity === null}
                    onChange={(e) => update(i, { quantity: e.target.value })} /></td>
                  <td><input value={l.cost} inputMode="decimal" aria-label="Prix d’achat" aria-invalid={!!l.cost && parsed[i].unitCost === null}
                    onChange={(e) => update(i, { cost: e.target.value })} placeholder="0,00" /></td>
                  <td className="num">{parsed[i].quantity !== null && parsed[i].unitCost !== null ? formatMad(lineTotal(parsed[i].quantity!, parsed[i].unitCost!)) : '—'}</td>
                  <td><Button small variant="ghost" icon="trash" title="Retirer" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="form">
        <Field label="Réglé maintenant (DH, facultatif)" error={paid && paidCents === null ? 'Montant invalide' : due === null && total !== null && paidCents !== null ? 'Plus que le total' : null}>
          <input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Moyen">
          <select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
            {PAY_METHODS.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>)}
          </select>
        </Field>
        <Field label="Note (facultatif)" wide><input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
        {total !== null && <div className="form-actions"><Button small onClick={() => setPaid(centsToInput(total))}>Tout régler</Button></div>}
      </div>
      {error && <p className="alert"><Icon name="alert" />{error}</p>}
    </Modal>
  )
}

/** Règlement d'une facture : idempotent (id fixé à l'ouverture), jamais plus que le reste dû. */
function PaymentForm({ purchase, onClose, onSaved }: { purchase: Purchase; onClose: () => void; onSaved: () => void }) {
  const { timeZone, notify } = useApp()
  const [paymentId] = useState(() => crypto.randomUUID())
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PayMethod>('cash')
  const [today] = useState(() => dayIn(new Date(), timeZone))
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cents = parseMad(amount)
  const tooMuch = cents !== null && cents > purchase.due
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today
  async function submit() {
    if (cents === null || cents <= 0 || tooMuch || !dateOk) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/admin/purchases/${purchase.id}/payments`, { id: paymentId, amount: cents, method, paid_on: date, note: note.trim() || null })
      notify(`Règlement de ${formatMad(cents)} enregistré.`)
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`Régler ${purchase.number}`} onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" icon="check" busy={busy} disabled={cents === null || cents <= 0 || tooMuch || !dateOk} onClick={submit}>Enregistrer</Button>
    </>}>
      <p>Reste dû à {purchase.supplier_name} : <strong>{formatMad(purchase.due)}</strong></p>
      <div className="form">
        <Field label="Montant (DH)" error={amount && cents === null ? 'Montant invalide' : tooMuch ? 'Plus que le reste dû' : null}>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Moyen">
          <select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
            {PAY_METHODS.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>)}
          </select>
        </Field>
        <Field label="Date" error={dateOk ? null : 'Date invalide ou future'}><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Note (facultatif)"><input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="N° de chèque, virement…" /></Field>
        <div className="form-actions"><Button small onClick={() => setAmount(centsToInput(purchase.due))}>Tout le reste dû</Button></div>
      </div>
      {error && <p className="alert"><Icon name="alert" />{error}</p>}
    </Modal>
  )
}
