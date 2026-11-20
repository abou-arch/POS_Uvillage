// Outils partagés par les routes du back-office : magasins visés, période, pagination, identifiants.
import { randomUUID } from 'node:crypto';
import { requireStore } from '../core.js';
import { nowIso } from '../db.js';
import { fail, isDate } from '../validate.js';

export const DAY = 86_400_000;
export const inList = (ids) => ids.map(() => '?').join(',') || 'NULL';
export const newId = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;

/** Magasins visés : celui demandé (s'il est permis) ou tous ceux de l'utilisateur. */
export function storesOf(req) {
  const wanted = req.query.store_id ? String(req.query.store_id) : '';
  if (!wanted) return req.user.store_ids;
  requireStore(req, wanted);
  return [wanted];
}

/** Période [from, to[ en dates ISO ; 30 derniers jours par défaut ; 400 jours au plus. */
export function periodOf(req) {
  const to = req.query.to ? String(req.query.to) : nowIso(new Date(Date.now() + 60_000));
  const from = req.query.from ? String(req.query.from) : nowIso(new Date(Date.parse(to) - 30 * DAY));
  if (!isDate(from) || !isDate(to) || Date.parse(from) >= Date.parse(to)) fail(400, 'INVALID_PERIOD', 'Période invalide');
  if (Date.parse(to) - Date.parse(from) > 400 * DAY) fail(400, 'INVALID_PERIOD', 'Période trop longue (400 jours au plus)');
  return { from: nowIso(new Date(from)), to: nowIso(new Date(to)) };
}

export function pageOf(req, max = 500) {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? '100', 10) || 100, 1), max);
  const offset = Math.max(Number.parseInt(req.query.offset ?? '0', 10) || 0, 0);
  return { limit, offset };
}
