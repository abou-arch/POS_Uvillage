// Contrôles de format communs (§1 du contrat) et erreurs au format du contrat.

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);
export const isInt = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isInteger(v) && v >= min && v <= max;
export const isDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
export const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 100;
export const isText = (v, max = 200) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
export const isNote = (v) => v === null || v === undefined || isText(v);
export const isOptId = (v) => v === undefined || v === null || isId(v);
/** Quantité > 0 avec 3 décimales au plus. */
export const isQuantity = (v) => typeof v === 'number' && v > 0 && v < 1e7 && Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;
/** §5 : entière à la pièce, 3 décimales au plus au kg ; sans unité (caisse d'avant 0.7) : acceptée. */
export const fitsUnit = (unit, q) => unit === undefined
  || (unit === 'unit' && Number.isInteger(q)) || (unit === 'kg' && Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6);

export const METHODS = ['cash', 'card', 'mobile', 'credit'];
export const REASONS = ['defective', 'cashier_error', 'changed_mind', 'other'];
export const sumOf = (list, fn) => list.reduce((n, x) => n + fn(x), 0);
export const creditOf = (payments) => sumOf((payments ?? []).filter((p) => p.method === 'credit'), (p) => p.amount);
export const round3 = (n) => Math.round(n * 1000) / 1000;

/** Erreur métier : levée dans une route, transformée en réponse { error } par le gestionnaire commun. */
export class HttpError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const fail = (status, code, message, details) => { throw new HttpError(status, code, message, details); };
export const body = (status, code, message, details = {}) => ({ status, body: { error: { code, message, details } } });

/** Texte nettoyé (espaces) ou null ; max caractères. */
export const clean = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);
