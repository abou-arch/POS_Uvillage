import { useMemo, useState } from 'react';
import { byProduct, csvMad, inPeriod, periodRange, STOCK_LABELS, stockStatus, stockSummary, type StockStatus } from '../../lib/stats';
import { formatMad } from '../../lib/totals.js';
import { formatQuantity, unitPrice } from '../../lib/units';
import { Icon } from '../ui';
import { Chips, Empty, ExportButton, Stat } from './common';
import { downloadCsv, TZ, useNow, type PageProps } from './shared';

type StockFilter = 'all' | StockStatus;
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const PAGE = 150;

// Articles du magasin (catalogue en cache sur le poste) : prix, TVA, unité, stock et alertes, quantité vendue sur
// 30 jours par cette caisse. Lecture seule : le catalogue se modifie dans le back-office (§3).
export function ProductsPage({ session, data }: PageProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [stock, setStock] = useState<StockFilter>('all');
  const [limit, setLimit] = useState(PAGE);

  const now = useNow();
  const today = periodRange('today', now, TZ).to;
  const categoryName = useMemo(() => new Map(data.categories.map((c) => [c.id, c.name])), [data.categories]);
  const sold = useMemo(() => {
    const month = periodRange('month', now, TZ);
    const rows = byProduct(
      data.receipts.map((r) => r.sale).filter((s) => inPeriod(s.created_at, month, TZ)),
      data.refunds.filter((r) => inPeriod(r.created_at, month, TZ)),
    );
    return new Map(rows.map((r) => [r.product_id, r]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la période ne change qu'avec le jour
  }, [data.receipts, data.refunds, today]);

  const summary = stockSummary(data.products);
  const q = fold(query);
  const list = data.products.filter((p) =>
    (!category || p.category_id === category)
    && (stock === 'all' || stockStatus(p) === stock)
    && (!q || fold(`${p.code} ${p.name} ${p.barcode ?? ''}`).includes(q) || (p.name_ar ?? '').includes(query.trim())));

  function exportCsv() {
    downloadCsv(`articles-${session.storeId}.csv`, [
      ['Code', 'Code-barres', 'Article', 'Article (arabe)', 'Catégorie', 'Unité', 'Prix TTC', 'TVA %', 'Stock', 'Seuil d’alerte', 'État', 'Vendu 30 j'],
      ...list.map((p) => [
        p.code, p.barcode ?? '', p.name, p.name_ar ?? '', (p.category_id && categoryName.get(p.category_id)) || '', p.unit === 'kg' ? 'kg' : 'pièce',
        csvMad(p.price_ttc), p.tva_rate, String(p.stock).replace('.', ','), String(p.stock_alert).replace('.', ','),
        STOCK_LABELS[stockStatus(p)], String(sold.get(p.id)?.quantity ?? 0).replace('.', ','),
      ]),
    ]);
  }

  return (
    <>
      <div className="stats">
        <Stat icon="box" label="Articles en vente" value={summary.count} />
        <Stat icon="alert" label="En rupture" value={summary.out} tone={summary.out ? 'red' : 'green'} />
        <Stat icon="alert" label="Stock bas" value={summary.low} tone={summary.low ? 'amber' : 'green'} />
        <Stat icon="cash" label="Valeur du stock (prix de vente)" value={formatMad(summary.value)} />
      </div>
      <div className="m-toolbar">
        <label className="field m-search">
          <Icon name="search" />
          <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} autoComplete="off"
            placeholder="Code, nom ou code-barres" aria-label="Rechercher un article" />
        </label>
        <select value={category} onChange={(e) => { setCategory(e.target.value); setLimit(PAGE); }} aria-label="Catégorie">
          <option value="">Toutes les catégories</option>
          {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <Chips label="Stock" value={stock} onChange={(v) => { setStock(v); setLimit(PAGE); }}
          options={[
            { value: 'all', label: 'Tous' }, { value: 'low', label: 'Stock bas', count: summary.low },
            { value: 'out', label: 'Rupture', count: summary.out },
          ]} />
        <span className="spacer" />
        <ExportButton onClick={exportCsv} disabled={list.length === 0} />
      </div>

      {data.products.length === 0 ? <Empty>Catalogue vide sur ce poste : connectez la caisse au serveur une première fois.</Empty>
        : list.length === 0 ? <Empty>Aucun article ne correspond.</Empty> : (
          <div className="m-table-wrap">
            <table className="m-table">
              <thead>
                <tr><th>Code</th><th>Article</th><th className="hide-sm">Catégorie</th><th className="num">Prix TTC</th>
                  <th className="num hide-sm">TVA</th><th className="num">Stock</th><th className="num hide-sm">Vendu 30 j</th></tr>
              </thead>
              <tbody>
                {list.slice(0, limit).map((p) => {
                  const status = stockStatus(p);
                  const s = sold.get(p.id);
                  return (
                    <tr key={p.id}>
                      <td className="mono">{p.code}</td>
                      <td><strong>{p.name}</strong>{p.name_ar && <small dir="rtl" lang="ar">{p.name_ar}</small>}</td>
                      <td className="hide-sm">{(p.category_id && categoryName.get(p.category_id)) || <span className="muted">—</span>}</td>
                      <td className="num">{unitPrice(p.price_ttc, p.unit)}</td>
                      <td className="num hide-sm">{p.tva_rate} %</td>
                      <td className="num">
                        {formatQuantity(p.stock, p.unit)}
                        {status !== 'ok' && <span className={`badge ${status === 'out' ? 'red' : 'amber'}`}>{STOCK_LABELS[status]}</span>}
                      </td>
                      <td className="num hide-sm">{s && s.quantity !== 0 ? formatQuantity(s.quantity, p.unit) : <span className="muted">0</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {list.length > limit && (
              <button type="button" className="btn secondary more" onClick={() => setLimit((l) => l + PAGE)}>
                Afficher {Math.min(PAGE, list.length - limit)} articles de plus
              </button>
            )}
          </div>
        )}
    </>
  );
}
