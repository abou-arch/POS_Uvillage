// Dernier ticket de la caisse, gardé dans localStorage pour pouvoir le réimprimer même après un rechargement.
import { browserStorage, isRecord, readJson, writeJson } from '../lib/storage';
import type { ReceiptData } from '../lib/receipt';
import { isSale } from './sales';

const receiptKey = (registerId: string) => `pos.lastReceipt.${registerId}`;

const isReceiptData = (v: unknown): v is ReceiptData =>
  isRecord(v) && isSale(v.sale) && typeof v.cashier === 'string' && (v.customer === null || typeof v.customer === 'string');

/** Dernier ticket de cette caisse, ou null s'il n'y en a pas (ou s'il est illisible : rien à réimprimer). */
export function loadLastReceipt(registerId: string, storage = browserStorage()): ReceiptData | null {
  const saved = readJson(receiptKey(registerId), storage);
  return isReceiptData(saved) && saved.sale.register_id === registerId ? saved : null;
}

export const saveLastReceipt = (registerId: string, receipt: ReceiptData, storage = browserStorage()) =>
  writeJson(receiptKey(registerId), receipt, storage);
