// Vérification d'une vente relue (outbox, dernier ticket) et lecture de l'ancien emplacement localStorage
// des ventes à envoyer et des compteurs de tickets, pour la migration vers IndexedDB (db/migrate.ts).
import { browserStorage, isId, isRecord, readJson, readText, writeJson } from '../lib/storage';
import type { Payment, PaymentMethod, Sale, SaleLine } from '../types';
import { METHOD_LABELS } from './payment';

/** Vente gardée sur la caisse ; `error` = refus du serveur, à faire vérifier. */
export interface PendingSale { sale: Sale; error: string | null }

/**
 * Ventes gardées sur la caisse, vérifiées une à une à la lecture. Une entrée illisible (abîmée, ou écrite
 * par une autre version de la caisse) n'est ni envoyée ni jetée : elle est réécrite telle quelle, à faire vérifier.
 */
export interface PendingQueue { sales: PendingSale[]; unreadable: unknown[] }

/** La dernière vente encaissée, telle que le caissier la voit. */
export interface LastSale { sale: Sale; status: 'sending' | 'sent' | 'offline' | 'rejected'; message?: string }

const PENDING_KEY = 'pos.pendingSales';
const counterKey = (registerId: string) => `pos.ticketCounter.${registerId}`;

// Une vente relue doit avoir exactement la forme que construit buildSale (§1 et §5 du contrat).
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isRate = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100; // en %
const isQuantity = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0; // décimale au poids
const isDate = (v: unknown): v is string => typeof v === 'string' && ISO_UTC.test(v) && !Number.isNaN(Date.parse(v));
const isMethod = (v: unknown): v is PaymentMethod => typeof v === 'string' && Object.hasOwn(METHOD_LABELS, v);
const isPayment = (v: unknown): v is Payment => isRecord(v) && isMethod(v.method) && isCents(v.amount);
const isLine = (v: unknown): v is SaleLine =>
  isRecord(v) && isId(v.product_id) && typeof v.name === 'string' && isQuantity(v.quantity)
  && isCents(v.unit_price_ttc) && isCents(v.discount) && isRate(v.tva_rate)
  && isCents(v.total_ht) && isCents(v.total_tva) && isCents(v.total_ttc);
export const isSale = (v: unknown): v is Sale =>
  isRecord(v) && typeof v.id === 'string' && UUID_V4.test(v.id) && isId(v.number)
  && isId(v.store_id) && isId(v.register_id) && isId(v.cashier_id) && (v.customer_id === null || isId(v.customer_id))
  && isDate(v.created_at) && Array.isArray(v.lines) && v.lines.length > 0 && v.lines.every(isLine)
  && isCents(v.other_charges) && isCents(v.global_discount)
  && isRecord(v.totals) && isCents(v.totals.ht) && isCents(v.totals.tva) && isCents(v.totals.ttc)
  && Array.isArray(v.payments) && v.payments.length > 0 && v.payments.every(isPayment)
  && isCents(v.amount_received) && isCents(v.change_given)
  && typeof v.send_sms === 'boolean' && (v.status === 'completed' || v.status === 'cancelled');
const isPendingSale = (v: unknown): v is PendingSale =>
  isRecord(v) && isSale(v.sale) && (v.error === null || typeof v.error === 'string');

/** Relit la file. Ce qui n'est pas une liste (texte abîmé, autre version de la caisse) est gardé comme entrée illisible. */
export function loadPending(storage = browserStorage()): PendingQueue {
  const text = readText(PENDING_KEY, storage);
  let saved: unknown;
  try {
    saved = JSON.parse(text ?? 'null');
  } catch {
    saved = text; // pas du JSON (modifié à la main) : le texte brut est gardé, avec les ventes qu'il contient
  }
  const entries: unknown[] = Array.isArray(saved) ? saved : saved === null ? [] : [saved];
  return { sales: entries.filter(isPendingSale), unreadable: entries.filter((e) => !isPendingSale(e)) };
}

/** Enregistre la file : les ventes, puis les entrées illisibles telles qu'elles ont été lues. */
export const savePending = ({ sales, unreadable }: PendingQueue, storage = browserStorage()) =>
  writeJson(PENDING_KEY, [...sales, ...unreadable], storage);

/** Dernier numéro de ticket utilisé par cette caisse sur ce poste (0 au départ). */
export function lastCounter(registerId: string, storage = browserStorage()): number {
  const n = readJson(counterKey(registerId), storage);
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
}
