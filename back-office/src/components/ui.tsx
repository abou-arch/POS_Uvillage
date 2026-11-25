// Briques d'interface du back-office : icônes, boutons, fenêtres, champs, états de chargement.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

const PATHS = {
  dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  receipt: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  register: 'M3 4h18v12H3zM8 20h8M12 16v4',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  layers: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  store: 'M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  menu: 'M3 6h18M3 12h18M3 18h18',
  calendar: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18',
  wallet: 'M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-4M18 12a2 2 0 0 0 0 4h4v-4z',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  truck: 'M1 4h14v12H1zM15 9h4l3 3v4h-7M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  bag: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  cart: 'M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM20 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6M14 8v5M11.5 10.5h5',
  coins: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  minus: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12h8',
  clipboard: 'M9 2h6v4H9zM9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3M9 13l2 2 4-4',
  merge: 'M6 3v6a6 6 0 0 0 6 6h6M15 12l3 3-3 3M6 21v-6',
  invoice: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

type ButtonProps = {
  children?: ReactNode; icon?: IconName; variant?: 'primary' | 'danger' | 'ghost' | 'default'; small?: boolean
  type?: 'button' | 'submit'; disabled?: boolean; busy?: boolean; onClick?: () => void; title?: string; form?: string
}
export function Button({ children, icon, variant = 'default', small, type = 'button', disabled, busy, onClick, title, form }: ButtonProps) {
  return (
    <button type={type} className={`btn ${variant}${small ? ' small' : ''}`} disabled={disabled || busy} onClick={onClick}
      title={title} aria-label={!children ? title : undefined} form={form}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={small ? 16 : 18} />}
      {children}
    </button>
  )
}

/** Durée de sortie d'une fenêtre (--dur-exit), 0 si l'utilisateur a demandé de réduire les animations. */
function exitDelay(el: Element) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0
  return parseFloat(getComputedStyle(el).getPropertyValue('--dur-exit')) || 0
}

/** Fenêtre modale (dialog natif : focus gardé, Échap pour fermer ; courte sortie quand l'utilisateur la ferme). */
export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [closing, setClosing] = useState(false)
  function close() {
    const d = ref.current
    if (closing) return
    const wait = d ? exitDelay(d) : 0
    if (!wait) { onClose(); return }
    setClosing(true)
    window.setTimeout(onClose, wait)
  }
  useEffect(() => {
    const d = ref.current
    if (!d || d.open) return
    d.showModal()
    // showModal() donne le focus au premier élément focalisable (le bouton Fermer) : on le rend au premier champ.
    d.querySelector<HTMLElement>('.modal-body input:not([type="hidden"]):not([disabled]), .modal-body select:not([disabled]), .modal-body textarea')?.focus()
  }, [])
  return (
    <dialog ref={ref} className={`modal${wide ? ' wide' : ''}${closing ? ' closing' : ''}`} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); close() }}>
      <header>
        <h2 id={titleId}>{title}</h2>
        <Button icon="x" variant="ghost" small title="Fermer" onClick={close} />
      </header>
      <div className="modal-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  )
}

export function Field({ label, hint, error, children, wide }: { label: string; hint?: string; error?: string | null; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`form-field${wide ? ' wide' : ''}${error ? ' invalid' : ''}`}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="error-text">{error}</span> : hint && <span className="hint">{hint}</span>}
    </label>
  )
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{label}</div>
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Erreur inattendue'
  return (
    <div className="alert" role="alert">
      <Icon name="alert" />
      <span>{message}</span>
      {onRetry && <button type="button" className="link" onClick={onRetry}>Réessayer</button>}
    </div>
  )
}

export function Empty({ children, icon = 'info' }: { children: ReactNode; icon?: IconName }) {
  return <div className="empty"><Icon name={icon} size={22} /><span>{children}</span></div>
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export function Panel({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel${className ? ` ${className}` : ''}`}>
      {(title || actions) && <header className="panel-head">{title && <h2>{title}</h2>}<div className="spacer" />{actions}</header>}
      {children}
    </section>
  )
}

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <div className="page-header">
      {back && <a className="back" href={back}><Icon name="arrowLeft" size={16} />Retour</a>}
      <div className="page-title">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </div>
  )
}

/** Indicateur clé : valeur, libellé, variation facultative. */
export function Stat({ label, value, delta, tone, hint }: { label: string; value: ReactNode; delta?: number | null; tone?: 'green' | 'amber' | 'red'; hint?: ReactNode }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {delta !== undefined && delta !== null && (
        <span className={`delta ${delta >= 0 ? 'up' : 'down'}`}>{delta > 0 ? '+' : ''}{delta.toLocaleString('fr-FR')} % vs période précédente</span>
      )}
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="search">
      <Icon name="search" size={16} />
      <input type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
