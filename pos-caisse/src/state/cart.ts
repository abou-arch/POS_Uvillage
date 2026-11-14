// État du panier (useReducer). Les règles de validation vivent ici, pas dans les composants.
import type { CartLine, Customer, Product } from '../types';

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
  | { type: 'add'; product: Product }
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
      const p = action.product;
      const existing = state.lines.find((l) => l.product_id === p.id);
      if (existing) {
        return apply(state, { type: 'setQuantity', productId: p.id, quantity: existing.quantity + 1 });
      }
      const line: CartLine = {
        product_id: p.id, name: p.name, quantity: 1, unit_price_ttc: p.price_ttc,
        discount: 0, tva_rate: p.tva_rate, stock: p.stock,
      };
      return { ...state, lines: [...state.lines, line] };
    }
    case 'setQuantity':
      return {
        ...state,
        lines: state.lines.map((l) =>
          l.product_id === action.productId ? { ...l, quantity: clamp(action.quantity, 0.001, MAX_QUANTITY) } : l),
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
