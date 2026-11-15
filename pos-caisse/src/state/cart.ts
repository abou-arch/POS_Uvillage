// État du panier (useReducer). Les règles de validation vivent ici, pas dans les composants.
import { fitsUnit, lineUnit } from '../lib/units';
import type { CartLine, Customer, Product, Unit } from '../types';

export interface CartState {
  lines: CartLine[];
  customer: Customer | null; // null = client de passage
  otherCharges: number;
  globalDiscount: number;
  sendSms: boolean;
}

export const emptyCart: CartState = { lines: [], customer: null, otherCharges: 0, globalDiscount: 0, sendSms: false };

export const MAX_QUANTITY = 9999; // garde-fou contre les saisies aberrantes du POS actuel

export type CartAction =
  | { type: 'add'; product: Product; quantity?: number } // quantity : le poids en kg d'un article au poids (1 par défaut)
  | { type: 'setQuantity'; productId: string; quantity: number }
  | { type: 'setDiscount'; productId: string; discount: number }
  | { type: 'remove'; productId: string }
  | { type: 'setCustomer'; customer: Customer | null }
  | { type: 'setOtherCharges'; amount: number }
  | { type: 'setGlobalDiscount'; amount: number }
  | { type: 'toggleSms' }
  | { type: 'clear' }
  | { type: 'restore'; state: CartState };

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(Number.isFinite(n) ? n : min, min), max);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Quantité refusée (§1, contrat 0.7) : un article à la pièce se vend à l'unité (pas 1,5), un article au poids en kg
 * au gramme près. null si elle convient.
 */
export function quantityError(unit: Unit, quantity: number): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return unit === 'kg' ? 'Poids invalide.' : 'Quantité invalide.';
  if (quantity > MAX_QUANTITY) return `${MAX_QUANTITY.toLocaleString('fr-FR')} au plus.`;
  if (!fitsUnit(unit, quantity)) {
    return unit === 'unit' ? 'Article vendu à la pièce : quantité entière (pas de 1,5).' : 'Poids : 3 décimales au plus (au gramme près).';
  }
  return null;
}

/** Quantité tapée par le caissier (« 2 », « 0,750 ») : la quantité, ou pourquoi elle est refusée. */
export function readQuantity(text: string, unit: Unit): { quantity: number; error: null } | { quantity: null; error: string } {
  const t = text.trim().replace(',', '.');
  const error = /^\d+(\.\d+)?$/.test(t)
    ? quantityError(unit, Number(t))
    : unit === 'kg' ? 'Poids invalide : en kg, par exemple 0,750.' : 'Quantité invalide.';
  return error ? { quantity: null, error } : { quantity: unit === 'kg' ? round3(Number(t)) : Number(t), error: null };
}

/** Nombre d'articles du panier : les pièces, plus une par article au poids (0,750 kg d'olives = 1 article). */
export const articleCount = (lines: CartLine[]) => lines.reduce((n, l) => n + (lineUnit(l) === 'kg' ? 1 : l.quantity), 0);

/** Un SMS n'est possible que si le client a un téléphone (le client de passage n'en a pas). */
export const canSendSms = (state: CartState) => !!state.customer?.phone;

/** Montant d'une ligne avant sa remise : la base de la remise de ligne. */
export const lineGross = (l: CartLine) => Math.round(l.quantity * l.unit_price_ttc);

/**
 * Une remise ne dépasse jamais ce qu'elle réduit, sinon le total deviendrait négatif :
 * remise de ligne ≤ montant de la ligne (même après une baisse de quantité),
 * remise globale ≤ total des lignes + autres charges (même après le retrait d'un article).
 */
function withinLimits(state: CartState): CartState {
  const lines = state.lines.map((l) => (l.discount > lineGross(l) ? { ...l, discount: lineGross(l) } : l));
  const maxGlobal = lines.reduce((s, l) => s + lineGross(l) - l.discount, 0) + state.otherCharges;
  return { ...state, lines, globalDiscount: Math.min(state.globalDiscount, maxGlobal) };
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  return withinLimits(apply(state, action));
}

function apply(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      // Le même article ajouté deux fois s'additionne sur sa ligne : deux sachets pesés font un seul poids.
      const p = action.product;
      const unit: Unit = p.unit === 'kg' ? 'kg' : 'unit';
      const quantity = action.quantity ?? 1;
      if (quantityError(unit, quantity)) return state;
      const existing = state.lines.find((l) => l.product_id === p.id);
      if (existing) {
        return apply(state, { type: 'setQuantity', productId: p.id, quantity: round3(existing.quantity + quantity) });
      }
      const line: CartLine = {
        product_id: p.id, name: p.name, unit, quantity, unit_price_ttc: p.price_ttc,
        discount: 0, tva_rate: p.tva_rate, stock: p.stock,
      };
      return { ...state, lines: [...state.lines, line] };
    }
    case 'setQuantity':
      // Quantité refusée (1,5 pour un article à la pièce, poids au dixième de gramme…) : le panier ne change pas.
      return {
        ...state,
        lines: state.lines.map((l) =>
          l.product_id === action.productId && !quantityError(lineUnit(l), action.quantity) ? { ...l, quantity: action.quantity } : l),
      };
    case 'setDiscount':
      return {
        ...state,
        lines: state.lines.map((l) =>
          l.product_id === action.productId
            ? { ...l, discount: clamp(Math.round(action.discount), 0, Math.round(l.quantity * l.unit_price_ttc)) }
            : l),
      };
    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.product_id !== action.productId) };
    case 'setCustomer': {
      const next = { ...state, customer: action.customer };
      return { ...next, sendSms: next.sendSms && canSendSms(next) };
    }
    case 'setOtherCharges':
      return { ...state, otherCharges: clamp(Math.round(action.amount), 0, 10_000_000) };
    case 'setGlobalDiscount':
      return { ...state, globalDiscount: clamp(Math.round(action.amount), 0, 10_000_000) };
    case 'toggleSms':
      return canSendSms(state) ? { ...state, sendSms: !state.sendSms } : state;
    case 'clear':
      return emptyCart;
    case 'restore':
      return action.state;
  }
}
