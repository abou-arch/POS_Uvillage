import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type FormEvent } from 'react';
import { categoryHue, categoryPictogram } from '../lib/categoryLook';
import { lookupScan } from '../lib/scan';
import { formatMad, lineTotals, saleTotals } from '../lib/totals.js';
import { formatQuantity, lineUnit, unitPrice } from '../lib/units';
import { articleCount, canSendSms, type CartAction, type CartState } from '../state/cart';
import type { DiscountExcess } from '../state/permissions';
import type { LastSale } from '../state/sales';
import type { BarcodeRule, Category, Payment, Product } from '../types';
import { CashModal } from './CashModal';
import { CustomerPicker } from './CustomerPicker';
import { HoldModal } from './HoldModal';
import { LastSalePanel } from './LastSalePanel';
import { MultiPaymentModal } from './MultiPaymentModal';
import { QuantityField } from './QuantityField';
import { CountUp, Icon } from './ui';

interface Props {
  cart: CartState;
  dispatch: Dispatch<CartAction>;
  products: Product[];
  categories: Category[]; // pour la pastille colorée de chaque ligne
  barcodeRules: BarcodeRule[]; // étiquettes de la balance (§3, contrat 0.7)
  onPick: (product: Product) => void; // article trouvé sans poids : au poids, le poids reste à saisir
  lastSale: LastSale | null;
  overLimit: DiscountExcess | null; // remises d'un caissier au-delà du plafond (§11) ; null : pas de plafond pour ce rôle
  onCheckout: (payments: Payment[], amountReceived: number) => void;
  onHold: (note: string) => void;
}

export function Cart({ cart, dispatch, products, categories, barcodeRules, onPick, lastSale, overLimit, onCheckout, onHold }: Props) {
  const scanRef = useRef<HTMLInputElement>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [paying, setPaying] = useState<'cash' | 'multiple' | 'hold' | null>(null);
  const totals = saleTotals(cart.lines, cart.otherCharges, cart.globalDiscount);
  const articles = articleCount(cart.lines);
  const payable = cart.lines.length > 0 && totals.ttc > 0;
  // Pastille de chaque ligne : teinte et pictogramme de la catégorie de l'article (comme sa vignette dans la grille).
  const looks = useMemo(() => {
    const categoryName = new Map(categories.map((c) => [c.id, c.name]));
    return new Map(products.map((p) => {
      const hue = categoryHue(p.category_id);
      return [p.id, {
        icon: categoryPictogram(p.category_id ? categoryName.get(p.category_id) : null),
        style: hue === null ? undefined : ({ '--hue': hue } as CSSProperties),
      }];
    }));
  }, [products, categories]);
  const setQuantity = (productId: string, q: number) => dispatch({ type: 'setQuantity', productId, quantity: q });
  // Après le choix du client ou la fermeture d'une fenêtre, la douchette doit retrouver son champ.
  const focusScan = () => setTimeout(() => scanRef.current?.focus(), 0);

  function pay(payments: Payment[], amountReceived: number) {
    setPaying(null);
    onCheckout(payments, amountReceived);
    focusScan();
  }
  const payExact = () => pay([{ method: 'cash', amount: totals.ttc }], totals.ttc);

  // Raccourcis de Falcon POS : F2 = Espèces, F4 = Montant exact (« Pay All »). Échap ferme les fenêtres.
  // Réinscrit à chaque rendu (pas de liste de dépendances) : le raccourci voit toujours le total à jour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2' && e.key !== 'F4') return;
      e.preventDefault();
      if (!payable || document.querySelector('dialog[open]')) return;
      if (e.key === 'F2') setPaying('cash');
      else payExact();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Une douchette tape le code puis « Entrée » : on traite donc la saisie comme un formulaire.
  function scan(e: FormEvent) {
    e.preventDefault();
    const found = lookupScan(scanRef.current?.value ?? '', products, barcodeRules);
    if (!found) return;
    if (found.kind === 'weighed') dispatch({ type: 'add', product: found.product, quantity: found.quantity });
    else if (found.kind === 'product') onPick(found.product);
    setScanError(found.kind === 'error' ? found.message : null);
    if (scanRef.current) scanRef.current.value = '';
  }

  return (
    <section className="panel cart-panel">
      <div className="cart-top">
        <form className="scan" onSubmit={scan}>
          <div className="field">
            <Icon name="barcode" />
            <input id="scan" ref={scanRef} autoFocus autoComplete="off" onInput={() => setScanError(null)}
              placeholder="Scanner un code-barres, ou taper un code ou un nom" aria-label="Scanner ou rechercher un article" />
            <kbd>Ctrl+Maj+S</kbd>
          </div>
          {scanError && <p className="scan-error" role="alert">{scanError}</p>}
        </form>
        <CustomerPicker customer={cart.customer} onDone={focusScan}
          onChange={(customer) => dispatch({ type: 'setCustomer', customer })} />
      </div>

      {cart.lines.length === 0 && lastSale ? (
        <LastSalePanel last={lastSale} />
      ) : cart.lines.length === 0 ? (
        <div className="empty">
          <span className="empty-art"><Icon name="cart" size={40} /></span>
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
              {cart.lines.map((l) => {
                const unit = lineUnit(l);
                const lineTtc = lineTotals(l.quantity, l.unit_price_ttc, l.discount, l.tva_rate).ttc;
                const look = looks.get(l.product_id);
                return (
                <tr key={l.product_id}>
                  <td>
                    <div className="item">
                      <span className={`item-badge ${look?.style ? '' : 'plain'}`} style={look?.style} aria-hidden="true">
                        <Icon name={look?.icon ?? 'tag'} size={18} />
                      </span>
                      <div className="item-text">
                        <div className="item-name">{l.name}</div>
                        <div className="item-meta">
                          {/* Sur écran étroit, le prix unitaire passe sous le nom au lieu d'avoir sa colonne. */}
                          <span className="meta-price">{unitPrice(l.unit_price_ttc, unit)} · </span>
                          <span className={l.quantity > l.stock ? 'warn' : ''}>
                            {l.quantity > l.stock ? 'Stock insuffisant' : 'Stock'} : {formatQuantity(l.stock, unit)}
                          </span>
                          {overLimit?.lines.includes(l.product_id) && (
                            <span className="warn approval-needed"> · Remise au-delà du plafond : PIN responsable au paiement</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="num col-price">{unitPrice(l.unit_price_ttc, unit)}</td>
                  <td>
                    <QuantityField quantity={l.quantity} unit={unit} onChange={(q) => setQuantity(l.product_id, q)} />
                  </td>
                  <td>
                    <span className="money">
                      <input type="number" min={0} step={0.5} value={l.discount / 100} aria-label="Remise en dirhams"
                        onChange={(e) => dispatch({ type: 'setDiscount', productId: l.product_id, discount: Number(e.target.value) * 100 })} />
                      DH
                    </span>
                  </td>
                  {/* La clé change avec le montant : le total de la ligne clignote à chaque modification. */}
                  <td className="num line-total"><span className="flash" key={lineTtc}>{formatMad(lineTtc)}</span></td>
                  <td>
                    <button type="button" className="remove" aria-label={`Retirer ${l.name}`} title="Retirer la ligne"
                      onClick={() => dispatch({ type: 'remove', productId: l.product_id })}><Icon name="trash" size={18} /></button>
                  </td>
                </tr>
                );
              })}
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
            {overLimit?.global && <small className="warn approval-needed">Au-delà du plafond : PIN responsable au paiement</small>}
          </label>
          <label className="check">
            <input type="checkbox" checked={cart.sendSms} disabled={!canSendSms(cart)} onChange={() => dispatch({ type: 'toggleSms' })} />
            Envoyer un SMS au client
            {!canSendSms(cart) && <small>({cart.customer ? 'client sans téléphone' : 'client de passage'})</small>}
          </label>
        </div>
        <div className="total">
          <span className="label">Total à payer</span>
          <strong className="amount"><CountUp value={totals.ttc} format={formatMad} /></strong>
          <span className="details">{articles} article{articles > 1 ? 's' : ''} · HT {formatMad(totals.ht)} · TVA {formatMad(totals.tva)}</span>
        </div>
      </div>

      {/* Même ordre que Falcon POS. */}
      <div className="actions">
        <button className="action hold" disabled={cart.lines.length === 0} onClick={() => setPaying('hold')}><strong><Icon name="pause" size={18} />Mise en attente</strong><small>Reprendre plus tard</small></button>
        {/* « Multiple » de Falcon POS : plusieurs moyens de paiement pour une vente. */}
        <button className="action multiple" disabled={!payable} onClick={() => setPaying('multiple')}>
          <strong><Icon name="card" size={18} />Paiement mixte</strong><small>Carte, mobile, crédit…</small>
        </button>
        <button className="action cash" disabled={!payable} onClick={() => setPaying('cash')}>
          <strong><Icon name="cash" size={18} />Espèces</strong><small>Avec rendu de monnaie · F2</small>
        </button>
        {/* « Pay All » de Falcon POS : tout le total en espèces, sans fenêtre. */}
        <button className="action exact" disabled={!payable} onClick={payExact}>
          <strong><Icon name="check" size={18} />Montant exact</strong><small>Espèces, sans rendu · F4</small>
        </button>
      </div>

      {paying === 'cash' && (
        <CashModal total={totals.ttc} onPay={(received) => pay([{ method: 'cash', amount: totals.ttc }], received)}
          onClose={() => { setPaying(null); focusScan(); }} />
      )}
      {paying === 'multiple' && (
        <MultiPaymentModal total={totals.ttc} hasCustomer={cart.customer !== null}
          onPay={(payments) => pay(payments, payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0))}
          onClose={() => { setPaying(null); focusScan(); }} />
      )}
      {paying === 'hold' && (
        <HoldModal total={totals.ttc} articles={articles}
          onHold={(note) => { setPaying(null); onHold(note); focusScan(); }}
          onClose={() => { setPaying(null); focusScan(); }} />
      )}
    </section>
  );
}
