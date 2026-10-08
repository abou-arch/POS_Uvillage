import { useRef, useState, type Dispatch, type FormEvent } from 'react';
import { formatMad, lineTotals, saleTotals } from '../lib/totals.js';
import { canSendSms, type CartAction, type CartState } from '../state/cart';
import type { Product } from '../types';
import { CustomerPicker } from './CustomerPicker';
import { Icon } from './ui';

interface Props {
  cart: CartState;
  dispatch: Dispatch<CartAction>;
  products: Product[];
}

const formatQuantity = (q: number) => q.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

export function Cart({ cart, dispatch, products }: Props) {
  const scanRef = useRef<HTMLInputElement>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const totals = saleTotals(cart.lines, cart.otherCharges, cart.globalDiscount);
  const quantity = cart.lines.reduce((n, l) => n + l.quantity, 0);
  const setQuantity = (productId: string, q: number) => dispatch({ type: 'setQuantity', productId, quantity: q });
  // Après le choix du client ou la fermeture d'une fenêtre, la douchette doit retrouver son champ.
  const focusScan = () => setTimeout(() => scanRef.current?.focus(), 0);

  // Une douchette tape le code puis « Entrée » : on traite donc la saisie comme un formulaire.
  function scan(e: FormEvent) {
    e.preventDefault();
    const typed = scanRef.current?.value.trim() ?? '';
    const value = typed.toLowerCase();
    if (!value) return;
    const product = products.find((p) => p.barcode === value || p.code.toLowerCase() === value)
      ?? products.find((p) => p.name.toLowerCase().includes(value));
    if (product) dispatch({ type: 'add', product });
    setNotFound(product ? null : typed);
    if (scanRef.current) scanRef.current.value = '';
  }

  return (
    <section className="panel cart-panel">
      <div className="cart-top">
        <form className="scan" onSubmit={scan}>
          <div className="field">
            <Icon name="barcode" />
            <input id="scan" ref={scanRef} autoFocus autoComplete="off" onInput={() => setNotFound(null)}
              placeholder="Scanner un code-barres, ou taper un code ou un nom" aria-label="Scanner ou rechercher un article" />
            <kbd>Ctrl+Maj+S</kbd>
          </div>
          {notFound && <p className="scan-error" role="alert">Aucun article pour « {notFound} »</p>}
        </form>
        <CustomerPicker customer={cart.customer} onDone={focusScan}
          onChange={(customer) => dispatch({ type: 'setCustomer', customer })} />
      </div>

      {cart.lines.length === 0 ? (
        <div className="empty">
          <Icon name="cart" size={44} />
          <strong>Le panier est vide</strong>
          <span>Scannez un article, ou touchez-le dans la liste à droite.</span>
        </div>
      ) : (
        <div className="lines">
          <table>
            <thead>
              <tr><th>Article</th><th className="num col-price">Prix</th><th>Quantité</th><th>Remise</th><th className="num">Total</th><th /></tr>
            </thead>
            <tbody>
              {cart.lines.map((l) => (
                <tr key={l.product_id}>
                  <td>
                    <div className="item-name">{l.name}</div>
                    <div className="item-meta">
                      {/* Sur écran étroit, le prix unitaire passe sous le nom au lieu d'avoir sa colonne. */}
                      <span className="meta-price">{formatMad(l.unit_price_ttc)} · </span>
                      <span className={l.quantity > l.stock ? 'warn' : ''}>
                        {l.quantity > l.stock ? `Stock insuffisant : ${l.stock}` : `Stock : ${l.stock}`}
                      </span>
                    </div>
                  </td>
                  <td className="num col-price">{formatMad(l.unit_price_ttc)}</td>
                  <td>
                    <div className="stepper">
                      <button type="button" aria-label="Enlever un" disabled={l.quantity <= 1}
                        onClick={() => setQuantity(l.product_id, l.quantity - 1)}><Icon name="minus" size={16} /></button>
                      <input type="number" min={0.001} step={1} value={l.quantity} aria-label="Quantité"
                        onChange={(e) => setQuantity(l.product_id, Number(e.target.value))} />
                      <button type="button" aria-label="Ajouter un"
                        onClick={() => setQuantity(l.product_id, l.quantity + 1)}><Icon name="plus" size={16} /></button>
                    </div>
                  </td>
                  <td>
                    <span className="money">
                      <input type="number" min={0} step={0.5} value={l.discount / 100} aria-label="Remise en dirhams"
                        onChange={(e) => dispatch({ type: 'setDiscount', productId: l.product_id, discount: Number(e.target.value) * 100 })} />
                      DH
                    </span>
                  </td>
                  <td className="num line-total">{formatMad(lineTotals(l.quantity, l.unit_price_ttc, l.discount, l.tva_rate).ttc)}</td>
                  <td>
                    <button type="button" className="remove" aria-label={`Retirer ${l.name}`} title="Retirer la ligne"
                      onClick={() => dispatch({ type: 'remove', productId: l.product_id })}><Icon name="trash" size={18} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="summary">
        <div className="adjust">
          <label>Autres charges
            <span className="money">
              <input type="number" min={0} step={0.5} value={cart.otherCharges / 100}
                onChange={(e) => dispatch({ type: 'setOtherCharges', amount: Number(e.target.value) * 100 })} />
              DH
            </span>
          </label>
          <label>Remise globale
            <span className="money">
              <input type="number" min={0} step={0.5} value={cart.globalDiscount / 100}
                onChange={(e) => dispatch({ type: 'setGlobalDiscount', amount: Number(e.target.value) * 100 })} />
              DH
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={cart.sendSms} disabled={!canSendSms(cart)} onChange={() => dispatch({ type: 'toggleSms' })} />
            Envoyer un SMS au client
            {!canSendSms(cart) && <small>({cart.customer ? 'client sans téléphone' : 'client de passage'})</small>}
          </label>
        </div>
        <div className="total">
          <span className="label">Total à payer</span>
          <strong className="amount">{formatMad(totals.ttc)}</strong>
          <span className="details">Qté {formatQuantity(quantity)} · HT {formatMad(totals.ht)} · TVA {formatMad(totals.tva)}</span>
        </div>
      </div>

      {/* Sprints vendredi / samedi : brancher paiement, mise en attente et ticket. Même ordre que Falcon POS. */}
      <div className="actions">
        <button className="action hold" disabled><strong><Icon name="pause" size={18} />Mise en attente</strong><small>Reprendre plus tard</small></button>
        {/* « Multiple » de Falcon POS : plusieurs moyens de paiement pour une vente. */}
        <button className="action multiple" disabled><strong><Icon name="card" size={18} />Paiement mixte</strong><small>Carte, mobile, crédit…</small></button>
        <button className="action cash" disabled><strong><Icon name="cash" size={18} />Espèces</strong><small>Avec rendu de monnaie</small></button>
        {/* « Pay All » de Falcon POS : tout le total en espèces, sans fenêtre. */}
        <button className="action exact" disabled><strong><Icon name="check" size={18} />Montant exact</strong><small>Espèces, sans rendu</small></button>
      </div>
    </section>
  );
}
