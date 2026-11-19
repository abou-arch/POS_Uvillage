// Éléments communs des pages de gestion : choix de la période, tuiles d'indicateurs, graphiques en barres
// (sans dépendance), états vides, bouton d'export.
import type { ReactNode } from 'react';
import { PERIOD_LABELS, type PeriodKey } from '../../lib/stats';
import { Icon, type IconName } from '../ui';

export function PeriodPicker({ value, onChange, keys = ['today', 'yesterday', 'week', 'month'] }: {
  value: PeriodKey;
  onChange: (key: PeriodKey) => void;
  keys?: PeriodKey[];
}) {
  return (
    <div className="chips" role="radiogroup" aria-label="Période">
      {keys.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={`chip${value === k ? ' active' : ''}`}
          onClick={() => onChange(k)}>{PERIOD_LABELS[k]}</button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, onChange, options, label }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`chip${value === o.value ? ' active' : ''}`}
          onClick={() => onChange(o.value)}>
          {o.label}{o.count !== undefined && <span className="chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Indicateur : libellé, valeur, et en dessous une évolution ou une précision. */
export function Stat({ icon, label, value, trend, hint, tone = 'blue' }: {
  icon: IconName;
  label: string;
  value: ReactNode;
  trend?: number | null; // évolution en % par rapport à la période d'avant
  hint?: ReactNode;
  tone?: 'blue' | 'green' | 'amber' | 'red';
}) {
  return (
    <div className={`stat tone-${tone}`}>
      <span className="stat-icon"><Icon name={icon} size={18} /></span>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {trend !== undefined && (
        <span className={`trend ${trend === null ? '' : trend >= 0 ? 'up' : 'down'}`}>
          {trend === null ? 'pas de comparaison' : `${trend > 0 ? '▲ +' : trend < 0 ? '▼ ' : ''}${trend} % vs période précédente`}
        </span>
      )}
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function Panel({ title, actions, children, className = '' }: {
  title: string; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`m-panel ${className}`} aria-label={title}>
      <header><h2>{title}</h2>{actions}</header>
      {children}
    </section>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="m-empty">{children}</p>;

export interface Bar { key: string; label: string; value: number; tip: string }

/**
 * Colonnes verticales (une seule série) : hauteur proportionnelle à la valeur, info-bulle au survol et au focus,
 * un libellé d'axe sur `every`. Une valeur négative (plus de retours que de ventes) part sous la ligne de base.
 * Le tableau des valeurs est lu par les lecteurs d'écran.
 */
export function Columns({ bars, every = 1, format, caption }: {
  bars: Bar[]; every?: number; format: (v: number) => string; caption: string;
}) {
  const max = Math.max(0, ...bars.map((b) => b.value));
  const min = Math.min(0, ...bars.map((b) => b.value));
  const range = max - min || 1;
  return (
    <figure className="columns">
      <div className="columns-plot" aria-hidden="true" style={{ ['--zero' as string]: `${(-min / range) * 100}%` }}>
        <span className="columns-max">{format(max)}</span>
        {bars.map((b, i) => {
          const h = (Math.abs(b.value) / range) * 100;
          return (
            <div key={b.key} className="column" data-tip={b.tip} tabIndex={-1}>
              <span className={`column-bar${b.value < 0 ? ' neg' : ''}${b.value === 0 ? ' zero' : ''}`} style={{ height: `${h}%` }} />
              <span className="column-label">{i % every === 0 ? b.label : ''}</span>
            </div>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>{bars.map((b) => <tr key={b.key}><th>{b.label}</th><td>{b.tip}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Barres horizontales : libellé, barre proportionnelle, valeur écrite (jamais la couleur seule). */
export function HBars({ rows, format, label }: {
  rows: { key: string; label: ReactNode; value: number; detail?: string }[];
  format: (v: number) => string;
  label: string;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="hbars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track"><span className={`hbar${r.value < 0 ? ' neg' : ''}`} style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} /></span>
          <span className="hbar-value">{format(r.value)}{r.detail && <small>{r.detail}</small>}</span>
        </li>
      ))}
    </ul>
  );
}

export const ExportButton = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => (
  <button type="button" className="btn secondary small" onClick={onClick} disabled={disabled}>
    <Icon name="download" size={16} />Exporter (CSV)
  </button>
);
