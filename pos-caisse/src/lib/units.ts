// Unités de vente (§1 et §3, contrat 0.7) : à la pièce, quantité entière ; au poids, en kg au gramme près.
import type { Unit } from '../types';
import { formatMad } from './totals.js';

/** Unité d'une ligne. Une ligne d'avant le contrat 0.7 n'en a pas : au poids si sa quantité est décimale. */
export const lineUnit = (l: { unit?: Unit; quantity: number }): Unit => l.unit ?? (Number.isInteger(l.quantity) ? 'unit' : 'kg');

/** La quantité respecte l'unité : entière à la pièce, 3 décimales au plus au kg. */
export const fitsUnit = (unit: Unit, quantity: number) =>
  unit === 'unit' ? Number.isInteger(quantity) : Math.abs(quantity * 1000 - Math.round(quantity * 1000)) < 1e-6;

/** « 2 » à la pièce ; « 0,750 kg » au poids. */
export function formatQuantity(quantity: number, unit: Unit): string {
  return unit === 'kg'
    ? `${quantity.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`
    : quantity.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

/** Prix unitaire : « 1,50 DH » à la pièce ; « 25,00 DH/kg » au poids. */
export const unitPrice = (price: number, unit: Unit) => (unit === 'kg' ? `${formatMad(price)}/kg` : formatMad(price));

/** Détail d'une ligne : « 2 × 1,50 DH » ; « 0,750 kg × 25,00 DH/kg ». */
export const quantityDetail = (quantity: number, price: number, unit: Unit) =>
  `${formatQuantity(quantity, unit)} × ${unitPrice(price, unit)}`;
