// Ventes en attente (bouton « Mise en attente ») : propres à la caisse, jamais envoyées à l'API (cf. contrat, fin).
// Elles vivent dans IndexedDB (table held) ; loadHeld/saveHeld lisent l'ancien emplacement localStorage, pour la migration.
import { browserStorage, isId, isRecord, readText, writeJson } from '../lib/storage';
import type { CartLine, Customer, Product } from '../types';
import { MAX_QUANTITY, type CartState } from './cart';

/** Un panier mis de côté, avec l'heure et la note facultative du caissier. */
export interface HeldSale { id: string; held_at: string; note: string; cart: CartState }

/** Comme la file des ventes à envoyer : une entrée illisible n'est jamais jetée, elle est réécrite telle quelle. */
export interface HeldList { sales: HeldSale[]; unreadable: unknown[] }

export const MAX_NOTE_LENGTH = 60;

const heldKey = (registerId: string) => `pos.heldSales.${registerId}`;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isRate = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
const isQuantity = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_QUANTITY;
const isNullableText = (v: unknown) => v === null || typeof v === 'string';
const isCustomer = (v: unknown): v is Customer =>
  isRecord(v) && isId(v.id) && typeof v.name === 'string' && isNullableText(v.phone) && isNullableText(v.matricule);
const isLine = (v: unknown): v is CartLine =>
  isRecord(v) && isId(v.product_id) && typeof v.name === 'string' && isQuantity(v.quantity)
  && isCents(v.unit_price_ttc) && isCents(v.discount) && isRate(v.tva_rate)
  && typeof v.stock === 'number' && Number.isFinite(v.stock);
const isCart = (v: unknown): v is CartState =>
  isRecord(v) && Array.isArray(v.lines) && v.lines.length > 0 && v.lines.every(isLine)
  && (v.customer === null || isCustomer(v.customer))
  && isCents(v.otherCharges) && isCents(v.globalDiscount) && typeof v.sendSms === 'boolean';
export const isHeldSale = (v: unknown): v is HeldSale =>
  isRecord(v) && isId(v.id) && typeof v.held_at === 'string' && ISO_UTC.test(v.held_at)
  && typeof v.note === 'string' && isCart(v.cart);

/** Relit les ventes en attente de cette caisse, vérifiées une à une. */
export function loadHeld(registerId: string, storage = browserStorage()): HeldList {
  const text = readText(heldKey(registerId), storage);
  let saved: unknown;
  try {
    saved = JSON.parse(text ?? 'null');
  } catch {
    saved = text; // pas du JSON (modifié à la main) : le texte brut est gardé tel quel
  }
  const entries: unknown[] = Array.isArray(saved) ? saved : saved === null ? [] : [saved];
  return { sales: entries.filter(isHeldSale), unreadable: entries.filter((e) => !isHeldSale(e)) };
}

export const saveHeld = (registerId: string, { sales, unreadable }: HeldList, storage = browserStorage()) =>
  writeJson(heldKey(registerId), [...sales, ...unreadable], storage);

/** Note nettoyée : espaces superflus retirés, longueur bornée. */
export const cleanNote = (note: string) => note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_LENGTH);

/** Met un panier de côté. Un panier vide ne se met pas en attente. */
export function holdCart(cart: CartState, note: string, id: string, now: Date): HeldSale {
  if (cart.lines.length === 0) throw new Error('Le panier est vide.');
  return { id, held_at: now.toISOString(), note: cleanNote(note), cart };
}

export interface PriceChange { product_id: string; name: string; before: number; after: number }

/**
 * À la reprise : prix, TVA, nom et stock repris du catalogue actuel.
 * `changes` = lignes dont le prix a changé ; `missing` = articles absents du catalogue (retirés ou désactivés),
 * laissés tels quels pour que le caissier décide. Catalogue vide (pas chargé) : rien n'est vérifié.
 */
export function refreshFromCatalog(cart: CartState, products: Product[]):
  { cart: CartState; changes: PriceChange[]; missing: string[]; checked: boolean } {
  if (products.length === 0) return { cart, changes: [], missing: [], checked: false };
  const byId = new Map(products.filter((p) => p.active).map((p) => [p.id, p]));
  const changes: PriceChange[] = [];
  const missing: string[] = [];
  const lines = cart.lines.map((l) => {
    const p = byId.get(l.product_id);
    if (!p) {
      missing.push(l.name);
      return l;
    }
    if (p.price_ttc !== l.unit_price_ttc) {
      changes.push({ product_id: l.product_id, name: p.name, before: l.unit_price_ttc, after: p.price_ttc });
    }
    return { ...l, name: p.name, unit_price_ttc: p.price_ttc, tva_rate: p.tva_rate, stock: p.stock };
  });
  return { cart: { ...cart, lines }, changes, missing, checked: true };
}
