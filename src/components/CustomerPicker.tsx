import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { searchCustomers } from '../db/customers';
import { prefillFrom, type CustomerForm } from '../state/customers';
import type { Customer } from '../types';
import { NewCustomerModal } from './NewCustomerModal';
import { Icon } from './ui';

const MIN_SEARCH = 2; // caractères tapés avant de lancer la recherche
const DEBOUNCE_MS = 300; // attente après la dernière frappe avant d'appeler l'API
const MAX_SUGGESTIONS = 8;

type Option = { kind: 'customer'; customer: Customer } | { kind: 'create' };

const details = (c: Customer) =>
  [c.matricule && `Matricule ${c.matricule}`, c.phone ?? 'Sans téléphone'].filter(Boolean).join(' · ');

// Sélecteur de client comme dans Falcon POS : recherche avec suggestions, « + » pour créer,
// « × » pour revenir au client de passage (customer = null).
export function CustomerPicker({ customer, onChange, onDone }: {
  customer: Customer | null;
  onChange: (customer: Customer | null) => void;
  onDone: () => void; // rend la main à la douchette
}) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<{ q: string; list: Customer[]; offline: boolean } | null>(null);
  const [creating, setCreating] = useState<Partial<CustomerForm> | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (q.length < MIN_SEARCH) return;
    let current = true; // ignore la réponse d'une recherche dépassée par une frappe plus récente
    const timer = setTimeout(() => {
      // Sans réponse du serveur, la recherche porte sur les clients déjà vus sur cette caisse.
      void searchCustomers(q).then(({ list, offline }) => {
        if (current) setFound({ q, list: list.slice(0, MAX_SUGGESTIONS), offline });
      });
    }, DEBOUNCE_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [q]);

  const results = found && found.q === q && q.length >= MIN_SEARCH ? found : null;
  // Hors ligne, pas de création : le client doit exister sur le serveur avant d'être rattaché à une vente.
  const options: Option[] = results
    ? [...results.list.map((c): Option => ({ kind: 'customer', customer: c })), ...(results.offline ? [] : [{ kind: 'create' } as const])]
    : [];
  const activeIndex = Math.min(active, options.length - 1);

  function reset() {
    setQuery('');
    setOpen(false);
    setActive(0);
  }

  function choose(option: Option) {
    if (option.kind === 'create') {
      setOpen(false);
      setCreating(prefillFrom(q)); // ce qui a été tapé pré-remplit le nom, le matricule ou le téléphone
      return;
    }
    onChange(option.customer);
    reset();
    onDone();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (options.length) setActive((activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (e.key === 'Enter' && open && options[activeIndex]) {
      e.preventDefault();
      choose(options[activeIndex]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  if (customer) {
    return (
      <div className="customer">
        <Icon name="user" size={18} />
        <span className="customer-text" title={`${customer.name} · ${details(customer)}`}>
          <strong>{customer.name}</strong>
          <small>{details(customer)}</small>
        </span>
        <button type="button" className="clear" title="Revenir à « Client de passage »" aria-label="Revenir à Client de passage"
          onClick={() => { onChange(null); onDone(); }}><Icon name="x" size={16} /></button>
      </div>
    );
  }

  return (
    <div className="customer-picker">
      <div className="field">
        <Icon name="user" size={18} />
        <input role="combobox" aria-label="Client : rechercher par nom, matricule ou téléphone" aria-autocomplete="list"
          aria-expanded={open} aria-controls={listId}
          aria-activedescendant={open && options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          placeholder="Client de passage" autoComplete="off" value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
      </div>
      <button type="button" className="add" title="Nouveau client" aria-label="Nouveau client"
        onClick={() => setCreating(prefillFrom(q))}><Icon name="plus" /></button>

      {open && (
        // mousedown annulé : le champ garde le focus pendant le clic sur une suggestion.
        <ul id={listId} role="listbox" className="suggestions" onMouseDown={(e) => e.preventDefault()}>
          {q.length < MIN_SEARCH ? (
            <li className="hint">Tapez au moins {MIN_SEARCH} caractères du nom, du matricule ou du téléphone.</li>
          ) : !results ? (
            <li className="hint">Recherche…</li>
          ) : (
            <>
              {results.offline && <li className="hint failed">Hors ligne : clients déjà vus sur cette caisse seulement.</li>}
              {results.list.length === 0 && <li className="hint">Aucun client trouvé.</li>}
              {options.map((o, i) => (
                <li key={o.kind === 'customer' ? o.customer.id : 'create'} id={`${listId}-${i}`} role="option"
                  aria-selected={i === activeIndex} className={o.kind === 'create' ? 'create' : undefined}
                  onMouseEnter={() => setActive(i)} onClick={() => choose(o)}>
                  {o.kind === 'customer'
                    ? <span className="option-text"><strong>{o.customer.name}</strong><small>{details(o.customer)}</small></span>
                    : <><Icon name="plus" size={16} />Nouveau client « {q} »</>}
                </li>
              ))}
            </>
          )}
        </ul>
      )}

      {creating && (
        <NewCustomerModal initial={creating}
          onCreated={(c) => { setCreating(null); reset(); onChange(c); onDone(); }}
          onClose={() => { setCreating(null); onDone(); }} />
      )}
    </div>
  );
}
