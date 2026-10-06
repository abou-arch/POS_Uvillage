import { useRef, type Dispatch, type FormEvent } from 'react';
import { formatMad, lineTotals, saleTotals } from '../lib/totals.js';
import type { CartAction, CartState } from '../state/cart';
import type { Product } from '../types';

interface Props {
  cart: CartState;
  dispatch: Dispatch<CartAction>;
  products: Product[];
}

export function Cart({ cart, dispatch, products }: Props) {
  const scanRef = useRef<HTMLInputElement>(null);
  const totals = saleTotals(cart.lines, cart.otherCharges, cart.globalDiscount);
  const quantity = cart.lines.reduce((n, l) => n + l.quantity, 0);

  // Une douchette tape le code puis « Entrée » : on traite donc la saisie comme un formulaire.
  function scan(e: FormEvent) {
    e.preventDefault();
    const value = scanRef.current?.value.trim().toLowerCase();
    if (!value) return;
    const product = products.find((p) => p.barcode === value || p.code.toLowerCase() === value)
      ?? products.find((p) => p.name.toLowerCase().includes(value));
    if (product) dispatch({ type: 'add', product });
    if (scanRef.current) scanRef.current.value = '';
  }

  return (
    <section className="cart-panel">
      <div className="cart-head">
        <span>{cart.customer ? cart.customer.name : 'Client de passage'}</span>
        {/* Sprint vendredi : recherche / ajout rapide de client */}
        <form onSubmit={scan}>
          <input id="scan" ref={scanRef} placeholder="Nom / code-barres / code article [Ctrl+Shift+S]" />
        </form>
      </div>

      <table>
        <thead>
          <tr><th>Article</th><th>Stock</th><th>Qté</th><th>Prix</th><th>Remise</th><th>Total</th><th /></tr>
        </thead>
        <tbody>
          {cart.lines.map((l) => (
            <tr key={l.product_id}>
              <td>{l.name}</td>
              <td className={l.quantity > l.stock ? 'warn' : ''}>{l.stock}</td>
              <td>
                <input type="number" min={0.001} step={1} value={l.quantity}
                  onChange={(e) => dispatch({ type: 'setQuantity', productId: l.product_id, quantity: Number(e.target.value) })} />
              </td>
              <td>{formatMad(l.unit_price_ttc)}</td>
              <td>
                <input type="number" min={0} step={0.5} value={l.discount / 100}
                  onChange={(e) => dispatch({ type: 'setDiscount', productId: l.product_id, discount: Number(e.target.value) * 100 })} />
              </td>
              <td>{formatMad(lineTotals(l.quantity, l.unit_price_ttc, l.discount, l.tva_rate).ttc)}</td>
              <td><button className="link" onClick={() => dispatch({ type: 'remove', productId: l.product_id })}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {cart.lines.length === 0 && <p className="muted center">Scannez ou cliquez sur un article.</p>}

      <div className="extras">
        <label><input type="checkbox" checked={cart.sendSms} onChange={() => dispatch({ type: 'toggleSms' })} /> Envoyer un SMS au client</label>
        <label>Autres charges
          <input type="number" min={0} step={0.5} value={cart.otherCharges / 100}
            onChange={(e) => dispatch({ type: 'setOtherCharges', amount: Number(e.target.value) * 100 })} />
        </label>
        <label>Remise totale
          <input type="number" min={0} step={0.5} value={cart.globalDiscount / 100}
            onChange={(e) => dispatch({ type: 'setGlobalDiscount', amount: Number(e.target.value) * 100 })} />
        </label>
      </div>

      <div className="totals">
        <div><span>Quantité</span><strong>{quantity}</strong></div>
        <div><span>Total HT</span><strong>{formatMad(totals.ht)}</strong></div>
        <div><span>TVA</span><strong>{formatMad(totals.tva)}</strong></div>
        <div><span>Total TTC</span><strong className="big">{formatMad(totals.ttc)}</strong></div>
      </div>

      {/* Sprints vendredi / samedi : brancher paiement, mise en attente et ticket */}
      <div className="actions">
        <button className="hold" disabled>Mise en attente</button>
        <button className="multiple" disabled>Multiple</button>
        <button className="cash" disabled>Espèces</button>
        <button className="payall" disabled>Pay All</button>
      </div>
    </section>
  );
}
