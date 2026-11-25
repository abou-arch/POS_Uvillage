// Reprise des exports de Falcon POS dans la base du serveur :
//   npm run import:falcon -- <articles.xlsx> [fournisseurs.xlsx] [--store st_2] [--update] [--dry-run]
// articles.xlsx : l'export « tableExport » de la liste des articles ; fournisseurs.xlsx : « Liste des fournisseurs ».
// --update : un article dont le code est déjà en base prend les valeurs de Falcon (sinon il est ignoré).
// --dry-run : lit les fichiers et affiche le rapport sans rien écrire. Base : DB_PATH (défaut data/pos.db).
import { readFileSync } from 'node:fs';
import { all, get, openDb } from '../src/db.js';
import { importFalcon, MAX_IMPORTED_STOCK, parseProducts, parseSuppliers } from '../src/importFalcon.js';
import { readSheet } from '../src/xlsx.js';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? null : argv.splice(i, 2)[1] ?? ''; };
const dryRun = argv.includes('--dry-run') && argv.splice(argv.indexOf('--dry-run'), 1).length > 0;
const storeArg = flag('--store');
const update = argv.includes('--update') && argv.splice(argv.indexOf('--update'), 1).length > 0;
const [productsFile, suppliersFile] = argv;
if (!productsFile) {
  console.error('Usage : npm run import:falcon -- <articles.xlsx> [fournisseurs.xlsx] [--store st_2] [--dry-run]');
  process.exit(1);
}

const { products, report } = parseProducts(readSheet(readFileSync(productsFile)));
const suppliers = suppliersFile ? parseSuppliers(readSheet(readFileSync(suppliersFile))) : [];

const list = (items, fmt, max = 15) => items.slice(0, max).map((x) => `    ${fmt(x)}`).join('\n') + (items.length > max ? `\n    … et ${items.length - max} autres` : '');
console.log(`Lu : ${products.length} articles, ${suppliers.length} fournisseurs.`);
if (report.renamedCodes.length) console.log(`  ${report.renamedCodes.length} codes en double dans Falcon, renommés :\n${list(report.renamedCodes, (r) => `${r.from} → ${r.to} (${r.name})`)}`);
if (report.zeroPrice.length) console.log(`  ${report.zeroPrice.length} articles à 0 DH : repris inactifs, à compléter au back-office.`);
if (report.absurdStock.length) console.log(`  ${report.absurdStock.length} stocks au-delà de ${MAX_IMPORTED_STOCK} non repris (mis à 0, à compter à l'inventaire) :\n${list(report.absurdStock, (r) => `${r.code} ${r.name} : ${r.falcon}`)}`);
if (report.invalid.length) console.log(`  ${report.invalid.length} lignes illisibles ignorées : ${report.invalid.join(', ')}`);
if (dryRun) { console.log('--dry-run : rien n’a été écrit.'); process.exit(0); }

const db = openDb(process.env.DB_PATH ?? 'data/pos.db');
const stores = all(db, 'SELECT id, name FROM stores WHERE active = 1 ORDER BY id');
const store = storeArg ? stores.find((s) => s.id === storeArg) : stores.length === 1 ? stores[0] : null;
if (!store) {
  console.error(storeArg ? `Magasin ${storeArg} introuvable.` : `Précisez le magasin avec --store (${stores.map((s) => `${s.id} = ${s.name}`).join(', ') || 'aucun magasin en base'}).`);
  process.exit(1);
}
const admin = get(db, "SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY created_at LIMIT 1");
if (!admin) { console.error('Aucun administrateur en base : créez-le d’abord (ADMIN_USERNAME / ADMIN_PASSWORD).'); process.exit(1); }

const r = importFalcon(db, { products, suppliers, storeId: store.id, userId: admin.id, update });
console.log(`Importé dans « ${store.name} » : ${r.products} articles créés, ${r.productsUpdated} mis à jour (${r.productsSkipped} déjà présents, ignorés), ${r.categories} catégories, ${r.brands} marques, `
  + `${r.stockLines} stocks repris ; ${r.suppliers} fournisseurs (${r.suppliersSkipped} déjà présents), ${r.openingDues} soldes dus repris en factures d'ouverture.`);
