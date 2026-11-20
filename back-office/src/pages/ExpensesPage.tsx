// Dépenses du magasin (loyer, électricité, salaires…) : saisie, répartition par catégorie, suppression d'une erreur.
import { useState } from 'react'
import { api, ApiError, qs } from '../api/client'
import { EXPENSE_LABELS, PAY_METHOD_LABELS, type ExpenseCategory, type ExpenseList, type PayMethod } from '../api/types'
import { Donut } from '../components/charts'
import { EXPENSE_COLORS } from '../lib/charts'
import { PeriodPicker } from '../components/PeriodPicker'
import { Button, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHeader, Panel, Stat } from '../components/ui'
import { csvMad, downloadCsv, toCsv } from '../lib/csv'
import { formatDay, formatMad, parseMad } from '../lib/format'
import { useApp, useLoad } from '../lib/hooks'
import { dayIn, periodLabel, periodRange } from '../lib/period'

const EXPENSE_CATEGORIES = Object.keys(EXPENSE_LABELS) as ExpenseCategory[]
const PAY_METHODS = Object.keys(PAY_METHOD_LABELS) as PayMethod[]

export function ExpensesPage() {
  const { storeId, period, timeZone, notify } = useApp()
  const [category, setCategory] = useState<'' | ExpenseCategory>('')
  const [creating, setCreating] = useState(false)
  const range = periodRange(period, timeZone)
  const { data, error, loading, reload } = useLoad(
    () => api.get<ExpenseList>(`/admin/expenses${qs({ store_id: storeId, ...range, category })}`), JSON.stringify([storeId, range, category]))

  async function remove(id: string, label: string) {
    if (!window.confirm(`Supprimer la dépense « ${label} » ? Elle disparaîtra des totaux.`)) return
    try {
      await api.del(`/admin/expenses/${id}`)
      notify('Dépense supprimée.')
      reload()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Suppression impossible.', 'error')
    }
  }

  function exportCsv() {
    downloadCsv('depenses.csv', toCsv(['Date', 'Catégorie', 'Magasin', 'Moyen', 'Montant', 'Note', 'Saisie par'],
      (data?.items ?? []).map((e) => [formatDay(e.spent_on), EXPENSE_LABELS[e.category], e.store_name, PAY_METHOD_LABELS[e.method], csvMad(e.amount), e.note, e.user_name])))
  }

  return (
    <>
      <PageHeader title="Dépenses" subtitle={`Charges du magasin · ${periodLabel(period)}`} actions={<>
        <Button icon="download" disabled={!data?.items.length} onClick={exportCsv}>Exporter</Button>
        <Button icon="plus" variant="primary" onClick={() => setCreating(true)}>Nouvelle dépense</Button>
      </>} />
      <PeriodPicker />
      <div className="chips">
        <button type="button" className={`chip${category === '' ? ' on' : ''}`} onClick={() => setCategory('')}>Toutes</button>
        {EXPENSE_CATEGORIES.map((c) => (
          <button key={c} type="button" className={`chip${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>{EXPENSE_LABELS[c]}</button>
        ))}
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {!data ? loading && <Loading /> : (
        <>
          <div className="grid">
            <div className="stats one">
              <Stat label="Total des dépenses" value={formatMad(data.total)} tone={data.total ? 'red' : undefined} hint={`${data.items.length} dépense(s)`} />
              <Stat label="Plus grosse catégorie" value={data.by_category[0] ? EXPENSE_LABELS[data.by_category[0].category] : '—'}
                hint={data.by_category[0] ? formatMad(data.by_category[0].amount) : undefined} />
            </div>
            <Panel title="Répartition par catégorie">
              <Donut label="Dépenses par catégorie" format={formatMad} colors={EXPENSE_COLORS}
                slices={data.by_category.map((c) => ({ key: c.category, label: EXPENSE_LABELS[c.category], value: c.amount }))} />
            </Panel>
          </div>
          <Panel title="Dépenses">
            {data.items.length === 0 ? <Empty>Aucune dépense sur la période.</Empty> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Catégorie</th><th>Magasin</th><th>Moyen</th><th>Note</th><th className="num">Montant</th><th /></tr></thead>
                  <tbody>
                    {data.items.map((e) => (
                      <tr key={e.id}>
                        <td className="nowrap">{formatDay(e.spent_on)}</td>
                        <td>{EXPENSE_LABELS[e.category]}</td>
                        <td>{e.store_name}</td>
                        <td>{PAY_METHOD_LABELS[e.method]}</td>
                        <td>{e.note ?? '—'}<span className="sub">{e.user_name ?? ''}</span></td>
                        <td className="num">{formatMad(e.amount)}</td>
                        <td><Button small variant="ghost" icon="trash" title="Supprimer" onClick={() => remove(e.id, `${EXPENSE_LABELS[e.category]} ${formatMad(e.amount)}`)} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={5}>Total</td><td className="num">{formatMad(data.total)}</td><td /></tr></tfoot>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
      {creating && <ExpenseForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
    </>
  )
}

/** Nouvelle dépense : idempotente (id fixé à l'ouverture) ; « Autre » demande une précision. */
function ExpenseForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { me, storeId, timeZone, notify } = useApp()
  const [expenseId] = useState(() => crypto.randomUUID())
  const [store, setStore] = useState(storeId || me.stores[0]?.id || '')
  const [category, setCategory] = useState<ExpenseCategory>('rent')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PayMethod>('cash')
  const [today] = useState(() => dayIn(new Date(), timeZone))
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cents = parseMad(amount)
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '2000-01-01' && date <= today
  const noteMissing = category === 'other' && !note.trim()
  const invalid = !store || cents === null || cents <= 0 || !dateOk || noteMissing
  async function submit() {
    if (invalid) return
    setBusy(true)
    setError(null)
    try {
      await api.post('/admin/expenses', { id: expenseId, store_id: store, category, amount: cents, method, spent_on: date, note: note.trim() || null })
      notify(`Dépense de ${formatMad(cents)} enregistrée.`)
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Nouvelle dépense" onClose={onClose} footer={<>
      <Button onClick={onClose}>Annuler</Button>
      <Button variant="primary" icon="check" busy={busy} disabled={invalid} onClick={submit}>Enregistrer</Button>
    </>}>
      <div className="form">
        <Field label="Catégorie">
          <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_LABELS[c]}</option>)}
          </select>
        </Field>
        <Field label="Montant (DH)" error={amount && (cents === null || cents <= 0) ? 'Montant invalide' : null}>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Date" error={dateOk ? null : 'Date invalide ou future'}><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Payé en">
          <select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
            {PAY_METHODS.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>)}
          </select>
        </Field>
        <Field label="Magasin"><select value={store} onChange={(e) => setStore(e.target.value)}>{me.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label={category === 'other' ? 'Précision (obligatoire)' : 'Note (facultatif)'} error={noteMissing && note !== '' ? 'Précisez la dépense' : null}>
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Facture Lydec d’octobre…" />
        </Field>
      </div>
      {error && <p className="alert"><Icon name="alert" />{error}</p>}
    </Modal>
  )
}
