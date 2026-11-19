// Formes renvoyées par l'API (contrat §2 à §12). Montants en centimes.

export type Role = 'admin' | 'manager' | 'cashier'
export type Unit = 'unit' | 'kg'
export type Method = 'cash' | 'card' | 'mobile' | 'credit'

export interface User { id: string; name: string; role: Role; username?: string }

export interface Register { id: string; name: string; active: boolean }
export interface BarcodeRule { prefix: string; type: 'weight' | 'price'; integer_digits: number; decimal_digits: number }
export interface Store {
  id: string; name: string; address: string; ice: string; active: boolean
  closing_difference_threshold: number; cashier_max_discount_percent: number | null; cashier_max_discount: number | null
  registers: Register[]; barcode_rules?: BarcodeRule[]
}
export interface Settings { tva_rates: number[]; timezone: string }
export interface Me { user: User; stores: Store[]; settings: Settings }

export interface Product {
  id: string; code: string; barcode: string | null; name: string; name_ar: string | null
  category_id: string | null; category_name: string | null; brand_id: string | null; brand_name: string | null
  price_ttc: number; cost_price: number | null; tva_rate: number; unit: Unit; image_url: string | null
  stock_alert: number; expiry_date: string | null; active: boolean; updated_at: string
  stock_by_store: Record<string, number>; stock_total: number
}
export interface Category { id: string; name: string; name_ar?: string | null; product_count: number }

export type MoveKind = 'sale' | 'refund' | 'cancel' | 'receipt' | 'adjustment' | 'inventory'
export interface StockMove {
  id: string; product_id: string; code: string; name: string; unit: Unit; store_id: string; store_name: string
  delta: number; kind: MoveKind; ref_id: string | null; note: string | null; user_name: string | null; created_at: string
}

export interface SaleLine {
  id?: string; product_id: string; name: string; quantity: number; unit?: Unit; unit_price_ttc: number; discount: number
  tva_rate: number; total_ht: number; total_tva: number; total_ttc: number
}
export interface Payment { method: Method; amount: number }
export interface SaleDoc {
  id: string; number: string; store_id: string; register_id: string; session_id: string; cashier_id: string
  approved_by?: string | null; customer_id: string | null; created_at: string; lines: SaleLine[]; other_charges: number
  global_discount: number; totals: { ht: number; tva: number; ttc: number }; payments: Payment[]; amount_received: number
  change_given: number; status: 'completed' | 'cancelled'
}
export interface RefundDoc {
  id: string; number: string; created_at: string; reason: string; reason_text: string | null
  lines: { line_index: number; name: string; quantity: number; unit?: Unit; total_ttc: number }[]
  totals: { ht: number; tva: number; ttc: number }; payments: Payment[]
}
export interface Warnings { price: boolean; approval: boolean; session_closed: boolean }
export interface SaleRow {
  id: string; number: string; created_at: string; store_id: string; store_name: string | null; register_name: string | null
  session_id: string; cashier_name: string | null; customer_id: string | null; customer_name: string | null
  status: 'completed' | 'cancelled'; items: number; total_ttc: number; paid: number; due: number; refunded_ttc: number
  methods: Method[]; warnings: Warnings
}
export interface SaleList { total: number; sums: { ttc: number; paid: number; due: number }; rows: SaleRow[] }
export interface SaleDetail {
  sale: SaleDoc; store: { id: string; name: string; address: string; ice: string } | null; register: { id: string; name: string } | null
  customer: { id: string; name: string; phone: string | null; matricule: string | null } | null
  cashier_name: string | null; approved_by_name: string | null; cancelled_at: string | null; cancelled_by_name: string | null
  received_at: string; warnings: Warnings; refunds: RefundDoc[]
}
export interface RefundRow {
  id: string; number: string; created_at: string; store_name: string | null; sale_id: string; sale_number: string
  customer_name: string | null; cashier_name: string | null; reason: string; reason_text: string | null; total_ttc: number
  payments: Payment[]; approval_warning: boolean
}

export interface Count { method: 'cash' | 'card' | 'mobile'; expected: number; counted: number; difference: number }
export interface Session {
  id: string; store_id: string; register_id: string; status: 'open' | 'closed'; opened_by: string; opened_at: string
  opening_cash: number; opening_note: string | null; closed_by: string | null; closed_at: string | null
  counts: Count[] | null; closing_note: string | null; store_name: string | null; register_name: string | null
  opened_by_name: string | null; closed_by_name: string | null; forced: boolean; expected_mismatch: boolean
  approval_warning: boolean; api_expected: Record<'cash' | 'card' | 'mobile', number> | null; difference: number | null
}
export interface CashMovement {
  id: string; type: 'in' | 'out'; amount: number; reason: string; created_by_name: string | null; created_at: string
  session_closed: boolean; approval_warning: boolean
}
export interface SessionDetail extends Session {
  movements: CashMovement[]; sales: { count: number; ttc: number; cancelled: number }; refunds: { count: number; ttc: number }
}

export interface Customer {
  id: string; name: string; phone: string | null; matricule: string | null; created_at: string
  balance: number; sales_count: number; sales_ttc: number; last_sale_at: string | null
}
export interface CustomerPayment {
  id: string; method: 'cash' | 'card' | 'mobile'; amount: number; note: string | null; user_name: string | null
  store_name: string | null; created_at: string
}
export interface CustomerDetail {
  customer: Omit<Customer, 'balance' | 'sales_count' | 'sales_ttc' | 'last_sale_at'>; balance: number; sales: SaleRow[]
  refunds: { id: string; number: string; created_at: string; total_ttc: number; credit: number }[]; payments: CustomerPayment[]
}

export interface AdminUser {
  id: string; username: string; name: string; role: Role; active: boolean; has_pin: boolean; store_ids: string[]; created_at: string
}

export interface Summary {
  sales_count: number; sales_ttc: number; sales_ht: number; sales_tva: number; refunds_count: number; refunds_ttc: number
  net_ttc: number; net_ht: number; net_tva: number; average_basket: number; cancelled_count: number; cancelled_ttc: number
  discounts: number; credit_given: number; margin: number | null
}
export interface Report {
  summary: Summary
  by_day: { day: string; sales_count: number; sales_ttc: number; refunds_ttc: number }[]
  by_hour: { hour: number; sales_count: number; sales_ttc: number }[]
  by_method: { method: Method; sales: number; refunds: number; net: number }[]
  by_product: { product_id: string; code: string; name: string; category_id: string | null; quantity: number; ttc: number; cost: number; margin: number }[]
  by_category: { category_id: string | null; name: string; quantity: number; ttc: number }[]
  by_cashier: { user_id: string; name: string; sales_count: number; sales_ttc: number }[]
  by_store: { store_id: string; name: string; sales_count: number; sales_ttc: number; refunds_ttc: number }[]
  vat: { rate: number; ht: number; tva: number; ttc: number }[]
}
export interface StockAlert {
  product_id: string; code: string; name: string; unit: Unit; stock_alert: number; store_id: string; store_name: string; stock: number
}
export interface Dashboard {
  period: { from: string; to: string }; report: Report; previous: { from: string; to: string; summary: Summary }
  stock_alerts: { count: number; items: StockAlert[] }
  open_sessions: (Session & { expected: Record<'cash' | 'card' | 'mobile', number> })[]
  warnings: { price: number; approval: number; session_closed: number; expected_mismatch: number }
  customers_due: { count: number; total: number; top: Customer[] }
}

export const METHOD_LABELS: Record<Method, string> = { cash: 'Espèces', card: 'Carte', mobile: 'Mobile', credit: 'Crédit' }
export const ROLE_LABELS: Record<Role, string> = { admin: 'Administrateur', manager: 'Responsable', cashier: 'Caissier' }
export const REASON_LABELS: Record<string, string> = {
  defective: 'Défectueux', cashier_error: 'Erreur de caisse', changed_mind: 'Changement d’avis', other: 'Autre',
}
export const MOVE_LABELS: Record<MoveKind, string> = {
  sale: 'Vente', refund: 'Retour', cancel: 'Annulation', receipt: 'Réception', adjustment: 'Ajustement', inventory: 'Inventaire',
}
