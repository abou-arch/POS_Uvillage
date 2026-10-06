// Types alignés sur docs/API_CONTRACT.md. Montants en centimes.

export type Role = 'admin' | 'manager' | 'cashier';

export interface User { id: string; name: string; role: Role }
export interface Register { id: string; name: string }
export interface Store { id: string; name: string; registers: Register[] }

export interface Session {
  token: string;
  user: User;
  stores: Store[];
  storeId: string;
  registerId: string;
}

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
  price_ttc: number;
  tva_rate: number;
  image_url: string | null;
  stock: number;
  stock_alert: number;
  expiry_date: string | null;
  active: boolean;
  updated_at: string;
}

export interface Customer { id: string; name: string; phone: string | null; ice: string | null }

export interface CartLine {
  product_id: string;
  name: string;
  quantity: number;
  unit_price_ttc: number;
  discount: number;
  tva_rate: number;
  stock: number;
}

export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'credit';
export interface Payment { method: PaymentMethod; amount: number }

export interface SaleLine extends Omit<CartLine, 'stock'> {
  total_ht: number;
  total_tva: number;
  total_ttc: number;
}

export interface Sale {
  id: string;
  number: string;
  store_id: string;
  register_id: string;
  cashier_id: string;
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
