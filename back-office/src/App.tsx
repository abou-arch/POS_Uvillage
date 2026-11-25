// Coquille du back-office : connexion, menu, magasin et période choisis, pages.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, hasToken, setToken, setUnauthorizedHandler } from './api/client'
import type { Me } from './api/types'
import { ROLE_LABELS } from './api/types'
import { Login } from './components/Login'
import { Button, ErrorBox, Icon, Loading, type IconName } from './components/ui'
import { AppContext, type AppState, useRoute } from './lib/hooks'
import { presetPeriod, type Period } from './lib/period'
import { CategoriesPage } from './pages/CategoriesPage'
import { CustomerPage, CustomersPage } from './pages/CustomersPage'
import { DashboardPage } from './pages/DashboardPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { ProductPage, ProductsPage } from './pages/ProductsPage'
import { InventoriesPage, InventorySheetPage } from './pages/InventoryPage'
import { PurchasePage, PurchasesPage } from './pages/PurchasesPage'
import { RefundsPage } from './pages/RefundsPage'
import { ReportsPage } from './pages/ReportsPage'
import { SalePage, SalesPage } from './pages/SalesPage'
import { SessionPage, SessionsPage } from './pages/SessionsPage'
import { SettingsPage } from './pages/SettingsPage'
import { StockPage } from './pages/StockPage'
import { StoresPage } from './pages/StoresPage'
import { SupplierPage, SuppliersPage } from './pages/SuppliersPage'
import { UsersPage } from './pages/UsersPage'

interface NavItem { path: string; label: string; icon: IconName; admin?: boolean }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Pilotage', items: [
    { path: 'tableau-de-bord', label: 'Tableau de bord', icon: 'dashboard' },
    { path: 'rapports', label: 'Rapports', icon: 'chart' },
  ] },
  { group: 'Ventes', items: [
    { path: 'ventes', label: 'Ventes', icon: 'receipt' },
    { path: 'retours', label: 'Retours', icon: 'undo' },
    { path: 'sessions', label: 'Sessions de caisse', icon: 'register' },
  ] },
  { group: 'Catalogue', items: [
    { path: 'articles', label: 'Articles', icon: 'tag' },
    { path: 'categories', label: 'Catégories et marques', icon: 'layers' },
    { path: 'stock', label: 'Stock', icon: 'box' },
    { path: 'inventaires', label: 'Inventaires', icon: 'clipboard' },
  ] },
  { group: 'Achats', items: [
    { path: 'fournisseurs', label: 'Fournisseurs', icon: 'truck' },
    { path: 'achats', label: 'Factures d’achat', icon: 'invoice' },
    { path: 'depenses', label: 'Dépenses', icon: 'minus' },
  ] },
  { group: 'Clients', items: [{ path: 'clients', label: 'Clients', icon: 'users' }] },
  { group: 'Administration', items: [
    { path: 'utilisateurs', label: 'Utilisateurs', icon: 'user', admin: true },
    { path: 'magasins', label: 'Magasins et caisses', icon: 'store', admin: true },
    { path: 'reglages', label: 'Réglages', icon: 'settings', admin: true },
  ] },
]

export default function App() {
  const [logged, setLogged] = useState(hasToken())
  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {})
    setToken(null)
    setLogged(false)
    window.location.hash = ''
  }, [])
  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setLogged(false) })
    return () => setUnauthorizedHandler(null)
  }, [])
  if (!logged) return <Login onLogged={() => setLogged(true)} />
  return <Session onLogout={logout} />
}

function Session({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<unknown>(null)
  const reloadMe = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/admin/me'))
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [])
  useEffect(() => {
    let alive = true
    api.get<Me>('/admin/me').then((m) => { if (alive) setMe(m) }, (e) => { if (alive) setError(e) })
    return () => { alive = false }
  }, [])
  if (error && !me) return <main className="center-screen"><ErrorBox error={error} onRetry={reloadMe} /><Button onClick={onLogout}>Se déconnecter</Button></main>
  if (!me) return <main className="center-screen"><Loading /></main>
  return <Shell me={me} reloadMe={reloadMe} onLogout={onLogout} />
}

const STORE_KEY = 'back-office-store'

function Shell({ me, reloadMe, onLogout }: { me: Me; reloadMe: () => Promise<void>; onLogout: () => void }) {
  const timeZone = me.settings.timezone
  const [storeId, setStoreIdState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY) ?? ''
      return me.stores.some((s) => s.id === saved) ? saved : ''
    } catch { return '' }
  })
  const setStoreId = (id: string) => {
    setStoreIdState(id)
    try { localStorage.setItem(STORE_KEY, id) } catch { /* préférence non gardée */ }
  }
  const [period, setPeriod] = useState<Period>(() => presetPeriod('today', new Date(), timeZone))
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error'; id: number } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const notify = useCallback((message: string, tone: 'ok' | 'error' = 'ok') => setToast({ message, tone, id: Date.now() }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const isAdmin = me.user.role === 'admin'
  const route = useRoute()
  const state: AppState = useMemo(() => ({ me, storeId, setStoreId, period, setPeriod, timeZone, isAdmin, reloadMe, notify }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me, storeId, period, timeZone, isAdmin, reloadMe, notify])
  const section = route[0] ?? 'tableau-de-bord'

  return (
    <AppContext.Provider value={state}>
      <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
        <aside className="sidebar">
          <div className="brand"><span className="logo"><Icon name="chart" size={18} /></span><span>Gestion</span></div>
          <nav aria-label="Menu">
            {NAV.map((g) => {
              const items = g.items.filter((i) => !i.admin || isAdmin)
              if (!items.length) return null
              return (
                <div key={g.group} className="nav-group">
                  <span className="nav-title">{g.group}</span>
                  {items.map((i) => (
                    <a key={i.path} href={`#/${i.path}`} className={section === i.path ? 'active' : undefined} onClick={() => setMenuOpen(false)}
                      aria-current={section === i.path ? 'page' : undefined}>
                      <Icon name={i.icon} />{i.label}
                    </a>
                  ))}
                </div>
              )
            })}
          </nav>
        </aside>
        <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
        <div className="main">
          <header className="topbar">
            <button type="button" className="menu-btn" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}><Icon name="menu" /></button>
            <label className="store-select">
              <Icon name="store" size={16} />
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Magasin">
                {me.stores.length > 1 && <option value="">Tous les magasins</option>}
                {me.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="spacer" />
            <span className="who">
              <span className="avatar" aria-hidden="true">{me.user.name.slice(0, 1).toUpperCase()}</span>
              <span className="who-text"><strong>{me.user.name}</strong><small className="muted">{ROLE_LABELS[me.user.role]}</small></span>
            </span>
            <Button icon="logout" variant="ghost" small title="Se déconnecter" onClick={onLogout} />
          </header>
          <main className="content">{page(route, isAdmin)}</main>
        </div>
      </div>
      {toast && <div key={toast.id} className={`toast ${toast.tone}`} role="status"><Icon name={toast.tone === 'ok' ? 'check' : 'alert'} />{toast.message}</div>}
    </AppContext.Provider>
  )
}

function page([section = 'tableau-de-bord', id]: string[], isAdmin: boolean): ReactNode {
  switch (section) {
    case 'tableau-de-bord': return <DashboardPage />
    case 'rapports': return <ReportsPage />
    case 'ventes': return id ? <SalePage id={id} /> : <SalesPage />
    case 'retours': return <RefundsPage />
    case 'sessions': return id ? <SessionPage id={id} /> : <SessionsPage />
    case 'articles': return id ? <ProductPage id={id} /> : <ProductsPage />
    case 'categories': return <CategoriesPage />
    case 'stock': return <StockPage />
    case 'inventaires': return id ? <InventorySheetPage id={id} /> : <InventoriesPage />
    case 'clients': return id ? <CustomerPage id={id} /> : <CustomersPage />
    case 'fournisseurs': return id ? <SupplierPage id={id} /> : <SuppliersPage />
    case 'achats': return id ? <PurchasePage id={id} /> : <PurchasesPage />
    case 'depenses': return <ExpensesPage />
    case 'utilisateurs': return isAdmin ? <UsersPage /> : <Forbidden />
    case 'magasins': return isAdmin ? <StoresPage /> : <Forbidden />
    case 'reglages': return isAdmin ? <SettingsPage /> : <Forbidden />
    default: return <div className="empty"><Icon name="info" />Page introuvable. <a href="#/tableau-de-bord">Tableau de bord</a></div>
  }
}

const Forbidden = () => <div className="empty"><Icon name="lock" />Réservé à l’administrateur.</div>
