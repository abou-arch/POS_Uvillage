import { createPortal } from 'react-dom';
import { THANK_YOU } from '../config/store';
import type { Receipt, ReceiptRow } from '../lib/receipt';

const Row = ({ label, value, className = '' }: ReceiptRow & { className?: string }) => (
  <div className={`t-row ${className}`}><span>{label}</span><span>{value}</span></div>
);

// Ticket 80 mm. Rendu directement dans <body>, hors de l'écran de caisse : à l'impression, la feuille
// @media print cache tout le reste (voir App.css). À l'écran, il n'est pas affiché.
export function Ticket({ receipt, copy }: { receipt: Receipt; copy: boolean }) {
  const { store } = receipt;
  return createPortal(
    <div className="ticket-print">
      <div className="receipt">
        <header className="t-center">
          <strong className="t-store">{store.name}</strong>
          {store.address.map((line) => <div key={line}>{line}</div>)}
          {store.ice && <div>ICE : {store.ice}</div>}
        </header>
        {copy && <p className="t-center t-strong">*** DUPLICATA ***</p>}
        {receipt.cancelled && <p className="t-center t-strong">*** VENTE ANNULÉE ***</p>}
        <hr />
        <Row label="Ticket" value={receipt.number} />
        <Row label="Date" value={receipt.date} />
        <Row label="Caissier" value={receipt.cashier} />
        <Row label="Client" value={receipt.customer} />
        <hr />
        {receipt.lines.map((l, i) => (
          <div className="t-line" key={i}>
            <div className="t-name">{l.name}</div>
            <Row label={l.detail} value={l.total} />
            {l.discount && <Row label="  Remise" value={l.discount} />}
          </div>
        ))}
        {receipt.adjustments.length > 0 && <hr />}
        {receipt.adjustments.map((r) => <Row key={r.label} {...r} />)}
        <hr />
        <table className="t-vat">
          <thead><tr><th>TVA</th><th>Base HT</th><th>TVA</th></tr></thead>
          <tbody>
            {receipt.vat.map((g) => <tr key={g.rate}><td>{g.rate}</td><td>{g.ht}</td><td>{g.tva}</td></tr>)}
          </tbody>
        </table>
        <hr />
        <Row label="Total HT" value={receipt.totals.ht} />
        <Row label="Total TVA" value={receipt.totals.tva} />
        <Row label="TOTAL TTC" value={receipt.totals.ttc} className="t-total" />
        <hr />
        {receipt.payments.map((r, i) => <Row key={i} {...r} />)}
        <hr />
        <footer className="t-center">
          {THANK_YOU.map((line) => <div key={line} lang={/[؀-ۿ]/.test(line) ? 'ar' : undefined}>{line}</div>)}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
