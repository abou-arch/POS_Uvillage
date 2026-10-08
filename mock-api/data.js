// Données fictives reprises des captures du POS actuel.
// Les taux de TVA sont des valeurs de test, pas des taux validés.
// Montants en centimes de dirham (MAD).

export const users = [
  { id: 'u_1', username: 'admin', password: 'admin', name: 'Falcon', role: 'admin', store_ids: ['st_1', 'st_2'] },
  { id: 'u_2', username: 'caissier', password: 'caissier', name: 'Caissier 1', role: 'cashier', store_ids: ['st_2'] },
];

export const stores = [
  { id: 'st_1', name: 'Magasin centre', registers: [{ id: 'reg_1', name: 'Caisse 1' }, { id: 'reg_2', name: 'Caisse 2' }] },
  { id: 'st_2', name: 'Magasin quartier', registers: [{ id: 'reg_3', name: 'Caisse 1' }] },
];

export const categories = [
  { id: 'cat_1', name: 'Boulangerie', name_ar: 'مخبزة' },
  { id: 'cat_2', name: 'Crèmerie', name_ar: 'ألبان' },
  { id: 'cat_3', name: 'Sauces', name_ar: 'صلصات' },
  { id: 'cat_4', name: 'Conserves', name_ar: 'معلبات' },
  { id: 'cat_5', name: 'Boissons', name_ar: 'مشروبات' },
  { id: 'cat_6', name: 'Chips', name_ar: 'رقائق البطاطا' },
  { id: 'cat_7', name: 'Épicerie sucrée', name_ar: 'مواد البقالة الحلوة' },
  { id: 'cat_8', name: 'Électronique', name_ar: 'إلكترونيات' },
];

export const brands = [
  { id: 'br_1', name: 'Isabel' },
  { id: 'br_2', name: 'Oraimo' },
  { id: 'br_3', name: 'Solis' },
  { id: 'br_4', name: 'Nestlé' },
  { id: 'br_5', name: 'Ain Atlas' },
];

const p = (n, code, barcode, name, name_ar, category_id, brand_id, price_ttc, tva_rate, stock, expiry_date = null) => ({
  id: `p_${n}`, code, barcode, name, name_ar, category_id, brand_id, price_ttc, tva_rate,
  image_url: null, stock_alert: 5, expiry_date, active: true,
  updated_at: '2026-10-04T10:00:00Z',
  stock_by_store: { st_1: stock, st_2: Math.floor(stock / 2) },
});

export const products = [
  p(1, 'IT0001', '6110000000011', 'PAIN NORMAL', 'خبز عادي', 'cat_1', null, 150, 0, 120),
  p(2, 'IT0002', '6110000000028', 'BAGUETTE', 'كوميرة', 'cat_1', null, 200, 0, 80),
  p(3, 'IT0003', '6110000000035', 'PETITE BAGUETTE', 'كوميرة صغيرة', 'cat_1', null, 100, 0, 60),
  p(4, 'IT0004', '6110000000042', 'OEUF', 'بيض', 'cat_2', null, 150, 0, 300),
  p(5, 'IT0005', '6110000000059', 'FROMAGE', 'فرماج', 'cat_2', null, 100, 7, 90),
  p(6, 'IT0006', '6110000000066', 'MILLE FEUILLE', null, 'cat_7', null, 100, 20, 45, '2025-09-26'),
  p(7, 'IT0007', '6110000000073', 'FROMAGE CARRÉE', null, 'cat_2', null, 100, 7, 70),
  p(8, 'IT0008', '6110000000080', 'KIRI', null, 'cat_2', null, 200, 7, 55),
  p(9, 'IT0009', '6110000000097', 'THON ISABEL TOMATE', null, 'cat_4', 'br_1', 1000, 20, 40),
  p(10, 'IT0010', '6110000000103', 'THON ISABEL VÉGÉTAL', null, 'cat_4', 'br_1', 1000, 20, 35),
  p(11, 'IT0011', '6110000000110', 'AQUAFINA 5L', null, 'cat_5', null, 1300, 20, 25),
  p(12, 'IT0012', '6110000000127', 'AIN ATLAS 5L', null, 'cat_5', 'br_5', 1300, 20, 25),
  p(13, 'IT0013', '6110000000134', 'NESQUIK CHOCOLATE PLASTICBOX', null, 'cat_7', 'br_4', 3000, 20, 12),
  p(14, 'IT0014', '6110000000141', 'CHEETOS', null, 'cat_6', null, 1000, 20, 0),
  p(15, 'IT0015', '6110000000158', 'ROSTOY', null, 'cat_6', null, 2500, 20, 18),
  p(16, 'IT0017', '6110000000172', 'SOLIS TOMATE 350G', null, 'cat_3', 'br_3', 900, 20, 30, '2026-05-01'),
  p(17, 'IT0018', '6110000000189', 'SOLIS TOMATE 200G', null, 'cat_3', 'br_3', 600, 20, 3, '2026-07-01'),
  p(18, 'IT0040', '6110000000400', 'ORAIMO FREEPODS 3C', null, 'cat_8', 'br_2', 24900, 20, 0),
  p(19, 'IT0041', '6110000000417', 'CHARGEUR ORAIMO C53', null, 'cat_8', 'br_2', 8900, 20, 4),
];

export const customers = [
  { id: 'c_1', name: 'Ahmed', phone: '+212600000001', ice: null },
  { id: 'c_2', name: 'Épicerie Fatima', phone: '+212600000002', ice: '001234567000089' },
];

export const sales = new Map();
