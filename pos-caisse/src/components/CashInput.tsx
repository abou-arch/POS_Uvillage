import { DENOMINATIONS } from '../config/cash';
import { denominationLabel } from '../lib/cashSession';
import { formatMad } from '../lib/totals.js';
import type { CashInputState } from '../state/useCashInput';

// Montant d'espèces : saisi directement, ou compté billet par billet et pièce par pièce (total calculé).
export function CashInput({ input, label, hint, invalid, disabled, autoFocus }: {
  input: CashInputState;
  label: string;
  hint?: string;
  invalid: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const bills = DENOMINATIONS.filter((d) => d.kind === 'billet');
  const coins = DENOMINATIONS.filter((d) => d.kind === 'pièce');

  const row = (value: number, kind: string) => {
    const text = input.quantities[value] ?? '';
    const quantity = /^\d+$/.test(text.trim()) ? Number(text.trim()) : 0;
    return (
      <label key={value} className="cash-count-row">
        <span className="denom">{denominationLabel(value)}</span>
        <span className="times" aria-hidden>×</span>
        <input inputMode="numeric" autoComplete="off" placeholder="0" disabled={disabled} value={text}
          aria-label={`Nombre de ${kind}s de ${denominationLabel(value)}`}
          onChange={(e) => input.setQuantity(value, e.target.value)} />
        <span className="sub">{quantity > 0 ? formatMad(quantity * value) : ''}</span>
      </label>
    );
  };

  return (
    <div className="cash-input">
      <div className="cash-input-head">
        <span>{label}{hint && <> <small>{hint}</small></>}</span>
        <div className="segmented compact" role="radiogroup" aria-label={`${label} : façon de saisir`}>
          <button type="button" role="radio" aria-checked={input.mode === 'direct'} disabled={disabled}
            className={input.mode === 'direct' ? 'active' : ''} onClick={() => input.setMode('direct')}>Montant</button>
          <button type="button" role="radio" aria-checked={input.mode === 'count'} disabled={disabled}
            className={input.mode === 'count' ? 'active' : ''} onClick={() => input.setMode('count')}>Billets et pièces</button>
        </div>
      </div>
      {input.mode === 'direct' ? (
        <span className="money big">
          <input autoFocus={autoFocus} data-autofocus={autoFocus || undefined} inputMode="decimal" autoComplete="off"
            placeholder="0,00" disabled={disabled} aria-label={label} aria-invalid={invalid}
            value={input.text} onChange={(e) => input.setText(e.target.value)} />
          DH
        </span>
      ) : (
        <div className="cash-count">
          <div className="cash-count-col" aria-label="Billets">{bills.map((d) => row(d.value, 'billet'))}</div>
          <div className="cash-count-col" aria-label="Pièces">{coins.map((d) => row(d.value, 'pièce'))}</div>
          <div className="cash-count-total">
            <span>Total compté</span>
            <strong>{input.cents === null ? '—' : formatMad(input.cents)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
