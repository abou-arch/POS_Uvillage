// Types alignés sur docs/API_CONTRACT.md. Montants en centimes.

export type Role = 'admin' | 'manager' | 'cashier';

export interface User { id: string; name: string; role: Role }
export interface Register { id: string; name: string }
/**
 * closing_difference_threshold : écart de clôture autorisé dans ce magasin, en centimes (§2, §9).
 * cashier_max_discount_percent (0 à 100) et cashier_max_discount (centimes) : remise qu'un caissier fait seul (§2, §11) ;
 * null = pas de plafond de ce type.
 */
export interface Store {
  id: string;
  name: string;
  closing_difference_threshold: number;
  cashier_max_discount_percent: number | null;
  cashier_max_discount: number | null;
  registers: Register[];
}

/** Empreinte du PIN d'un responsable (§11) : PBKDF2 HMAC-SHA-256, sel et résultat en base64. */
export interface PinHash { algorithm: 'PBKDF2-SHA256'; iterations: number; salt: string; hash: string }

/** Responsable qui peut autoriser une opération dans un magasin (GET /api/stores/{id}/approvers, §11). */
export interface Approver { user_id: string; name: string; pin: PinHash }

// Réponse de POST /auth/login : connecté, magasin et caisse pas encore choisis.
export interface Auth { token: string; user: User; stores: Store[] }

export interface Session extends Auth {
  storeId: string;
  registerId: string;
}

/** Unité de vente (§3) : à la pièce (quantité entière) ou au poids (quantité en kg, 3 décimales, prix d'un kg). */
export type Unit = 'unit' | 'kg';

/**
 * Règle d'un code-barres de balance (GET /api/stores/{id}/barcode-rules, §3) : EAN-13 = préfixe, code article,
 * valeur (integer_digits + decimal_digits chiffres), chiffre de contrôle. weight : poids en kg ; price : prix TTC en DH.
 */
export interface BarcodeRule { prefix: string; type: 'weight' | 'price'; integer_digits: number; decimal_digits: number }

export interface Category { id: string; name: string; name_ar: string | null }
export interface Brand { id: string; name: string }

export interface Product {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  name_ar: string | null;
  category_id: string | null;
  brand_id: string | null;
  price_ttc: number; // prix d'un kg pour un article au poids
  tva_rate: number;
  unit: Unit;
  image_url: string | null;
  stock: number;
  stock_alert: number;
  expiry_date: string | null;
  active: boolean;
  updated_at: string;
}

// matricule : identifiant universitaire du client (chiffres seulement).
/** balance (contrat 0.8, §4) : reste dû d'après l'API, en centimes ; absent d'une API d'avant 0.8 et hors ligne. */
/** discount_percent (contrat 0.9) : client spécial, remise en % sur tous ses tickets, fixée par un responsable ; null sinon. */
export interface Customer {
  id: string; name: string; phone: string | null; matricule: string | null; balance?: number; discount_percent?: number | null;
}

export interface CartLine {
  product_id: string;
  name: string;
  unit: Unit;
  quantity: number; // en kg pour un article au poids
  unit_price_ttc: number;
  discount: number;
  tva_rate: number;
  stock: number;
}

export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'qr' | 'credit';
export interface Payment { method: PaymentMethod; amount: number }

export interface SaleLine extends Omit<CartLine, 'stock' | 'unit'> {
  /** UUID v4 de la ligne (contrat 0.5). Absent des ventes plus anciennes : leurs lignes se repèrent par leur position. */
  id?: string;
  /** Unité de l'article au moment de la vente (contrat 0.7). Absente des ventes plus anciennes. */
  unit?: Unit;
  total_ht: number;
  total_tva: number;
  total_ttc: number;
}

export interface Sale {
  id: string;
  number: string;
  store_id: string;
  register_id: string;
  session_id: string; // session de caisse ouverte au moment de la vente (§9)
  cashier_id: string;
  /** Responsable qui a autorisé une remise au-delà du plafond (§11). Absent des ventes d'avant le contrat 0.6. */
  approved_by?: string | null;
  customer_id: string | null;
  created_at: string;
  lines: SaleLine[];
  other_charges: number;
  global_discount: number;
  totals: { ht: number; tva: number; ttc: number };
  payments: Payment[];
  amount_received: number;
  change_given: number;
  send_sms: boolean;
  status: 'completed' | 'cancelled';
}

// Session de caisse (§9) : ouverte avec un fond de caisse, clôturée en comptant chaque moyen de paiement.

/** Ce que la caisse envoie à l'ouverture (POST /api/cash-sessions). */
export interface CashSessionOpening {
  id: string;
  store_id: string;
  register_id: string;
  opened_by: string;
  opened_at: string;
  opening_cash: number;
  opening_note: string | null;
}

/** Moyens de paiement comptés à la clôture : le crédit n'est pas de l'argent reçu. */
export type CountedMethod = Exclude<PaymentMethod, 'credit'>;

/** Attendu, compté et écart d'un moyen de paiement. difference = compté − attendu : négatif = il manque de l'argent. */
export interface MethodCount { method: CountedMethod; expected: number; counted: number; difference: number }

/** Une ligne du comptage des espèces : valeur du billet ou de la pièce (centimes) et nombre compté. */
export interface CashCountLine { value: number; quantity: number }

/** Ce que la caisse envoie à la clôture (POST /api/cash-sessions/{id}/close). */
export interface CashSessionClosing {
  closed_by: string;
  /** Responsable qui a autorisé la clôture d'un caissier au-delà du seuil (§11). Absent avant le contrat 0.6. */
  approved_by?: string | null;
  closed_at: string;
  counts: MethodCount[]; // cash, card, mobile, qr : une fois chacun (qr absent des clôtures faites avant le paiement QR)
  cash_count: CashCountLine[] | null; // null : total des espèces saisi directement
  closing_note: string | null;
}

/** Objet session renvoyé par l'API (GET /api/cash-sessions/current) : champs de clôture à null tant qu'elle est ouverte. */
export interface CashSession extends CashSessionOpening {
  status: 'open' | 'closed';
  closed_by: string | null;
  closed_at: string | null;
  counts: MethodCount[] | null;
  cash_count: CashCountLine[] | null;
  closing_note: string | null;
}

export type CashMovementType = 'in' | 'out';

/** Entrée ou sortie d'espèces hors vente (POST /api/cash-movements). */
export interface CashMovement {
  id: string;
  session_id: string;
  type: CashMovementType;
  amount: number;
  reason: string;
  created_by: string;
  /** Responsable qui a autorisé la sortie d'un caissier (§11). Absent des mouvements d'avant le contrat 0.6. */
  approved_by?: string | null;
  created_at: string;
}

// Retours et remboursements (§10) : un document à part, la vente d'origine n'est pas modifiée.

export type RefundReason = 'defective' | 'cashier_error' | 'changed_mind' | 'other';

/** Une ligne retournée : la ligne d'origine (position et id), la quantité et le montant rendu (§7). */
export interface RefundLine {
  original_line_id: string | null; // null pour une vente d'avant le contrat 0.5
  line_index: number;
  product_id: string;
  name: string;
  unit?: Unit; // celle de la ligne d'origine ; absente si elle n'en a pas (vente d'avant le contrat 0.7)
  quantity: number;
  unit_price_ttc: number;
  tva_rate: number;
  total_ht: number;
  total_tva: number;
  total_ttc: number;
}

/** Ce que la caisse envoie (POST /api/refunds). */
export interface Refund {
  id: string;
  number: string;
  store_id: string;
  register_id: string;
  session_id: string;
  original_sale_id: string;
  cashier_id: string;
  /** Responsable qui a autorisé le retour d'un caissier (§11). Absent des retours d'avant le contrat 0.6. */
  approved_by?: string | null;
  customer_id: string | null;
  created_at: string;
  reason: RefundReason;
  reason_text: string | null;
  lines: RefundLine[];
  totals: { ht: number; tva: number; ttc: number };
  payments: Payment[];
}

/** Réponse de GET /api/sales/by-number/{number} (§5). */
/** Règlement d'une dette encaissé à la caisse (POST /api/customer-payments, contrat 0.8, §4). */
export interface CustomerPayment {
  id: string; // UUID v4 généré par la caisse
  store_id: string;
  register_id: string;
  session_id: string;
  customer_id: string;
  method: CountedMethod;
  amount: number; // centimes, > 0
  note: string | null;
  created_by: string;
  created_at: string;
}

export interface SaleLookup {
  sale: Sale;
  customer: { id: string; name: string } | null;
  refunds: Refund[];
}
