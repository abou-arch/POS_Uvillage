import { createPortal } from 'react-dom';
import { THANK_YOU, type StoreInfo } from '../config/store';
import { code128 } from '../lib/code128';
import type { MovementReceipt, Receipt, ReceiptRow, RefundReceipt, SessionReceipt } from '../lib/receipt';
import type { PrintDoc } from '../state/usePrint';

// Ce que l'imprimante 80 mm sort (voir state/usePrint.ts) : un ticket de vente, un ticket de retour, le ticket d'une
// entrée ou d'une sortie d'espèces, ou le rapport d'une session.
// Rendu directement dans <body>, hors de l'écran : à l'impression, la feuille @media print cache tout le reste
// (voir App.css). À l'écran, il n'est pas affiché.
export function PrintSheet({ doc }: { doc: PrintDoc | null }) {
  if (!doc) return null;
  return createPortal(
    <div className="ticket-print">
      {doc.kind === 'sale' && <SaleTicket receipt={doc.receipt} copy={doc.copy} />}
      {doc.kind === 'refund' && <RefundTicket receipt={doc.receipt} />}
      {doc.kind === 'movement' && <MovementTicket receipt={doc.receipt} />}
      {doc.kind === 'session' && <SessionTicket report={doc.report} />}
    </div>,
    document.body,
  );
}

const Row = ({ label, value, className = '' }: ReceiptRow & { className?: string }) => (
  <div className={`t-row ${className}`}><span>{label}</span><span>{value}</span></div>
);

const StoreHeader = ({ store }: { store: StoreInfo }) => (
  <header className="t-center">
    <strong className="t-store">{store.name}</strong>
    {store.address.map((line) => <div key={line}>{line}</div>)}
    {store.ice && <div>ICE : {store.ice}</div>}
  </header>
);

const VatTable = ({ vat }: { vat: { rate: string; ht: string; tva: string }[] }) => (
  <table className="t-vat">
    <thead><tr><th>TVA</th><th>Base HT</th><th>TVA</th></tr></thead>
    <tbody>
      {vat.map((g) => <tr key={g.rate}><td>{g.rate}</td><td>{g.ht}</td><td>{g.tva}</td></tr>)}
    </tbody>
  </table>
);

/**
 * Code-barres Code 128 du numéro de ticket, lu par la douchette pour retrouver la vente lors d'un retour.
 * Dessiné en SVG (une barre = un rectangle), avec la marge blanche que demande le lecteur de chaque côté.
 */
function Barcode({ value }: { value: string }) {
  const bars = code128(value);
  const quiet = 10; // zone blanche : 10 modules au moins
  const width = bars.reduce((s, w) => s + w, 0) + 2 * quiet;
  const starts = bars.map((_, i) => quiet + bars.slice(0, i).reduce((s, w) => s + w, 0));
  // Barres et espaces alternent : seules les barres (rangs pairs) sont dessinées.
  const rects = bars.map((w, i) => (i % 2 === 0 ? <rect key={i} x={starts[i]} y={0} width={w} height={40} /> : null));
  return (
    <svg className="t-barcode" viewBox={`0 0 ${width} 40`} preserveAspectRatio="none" shapeRendering="crispEdges"
      role="img" aria-label={`Code-barres ${value}`}>
      {rects}
    </svg>
  );
}

function SaleTicket({ receipt, copy }: { receipt: Receipt; copy: boolean }) {
  return (
    <div className="receipt">
      <StoreHeader store={receipt.store} />
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
      <VatTable vat={receipt.vat} />
      <hr />
      <Row label="Total HT" value={receipt.totals.ht} />
      <Row label="Total TVA" value={receipt.totals.tva} />
      <Row label="TOTAL TTC" value={receipt.totals.ttc} className="t-total" />
      <hr />
      {receipt.payments.map((r, i) => <Row key={i} {...r} />)}
      <hr />
      <Barcode value={receipt.number} />
      <p className="t-center">{receipt.number}</p>
      <hr />
      <footer className="t-center">
        {THANK_YOU.map((line) => <div key={line} lang={/[؀-ۿ]/.test(line) ? 'ar' : undefined}>{line}</div>)}
      </footer>
    </div>
  );
}

// Retour : ce qui est rendu au client, et comment. Signé par le client, comme preuve du remboursement.
function RefundTicket({ receipt }: { receipt: RefundReceipt }) {
  return (
    <div className="receipt">
      <StoreHeader store={receipt.store} />
      <hr />
      <p className="t-center t-title">REMBOURSEMENT</p>
      {receipt.copy && <p className="t-center t-strong">*** DUPLICATA ***</p>}
      <hr />
      {receipt.info.map((r) => <Row key={r.label} {...r} />)}
      <p>Motif : {receipt.reason}</p>
      <hr />
      {receipt.lines.map((l, i) => (
        <div className="t-line" key={i}>
          <div className="t-name">{l.name}</div>
          <Row label={l.detail} value={l.total} />
        </div>
      ))}
      <hr />
      <VatTable vat={receipt.vat} />
      <hr />
      <Row label="Total HT" value={receipt.totals.ht} />
      <Row label="Total TVA" value={receipt.totals.tva} />
      <Row label="TOTAL REMBOURSÉ" value={receipt.totals.ttc} className="t-total" />
      <hr />
      {receipt.payments.map((r, i) => <Row key={i} {...r} />)}
      <hr />
      <p>Signature du client :</p>
      <p className="t-sign" />
      <hr />
    </div>
  );
}

// Entrée ou sortie d'espèces : la preuve papier du mouvement, signée par celui qui prend ou dépose l'argent.
function MovementTicket({ receipt }: { receipt: MovementReceipt }) {
  return (
    <div className="receipt">
      <StoreHeader store={receipt.store} />
      <hr />
      <p className="t-center t-title">{receipt.title}</p>
      {receipt.copy && <p className="t-center t-strong">*** DUPLICATA ***</p>}
      <hr />
      {receipt.info.map((r) => <Row key={r.label} {...r} />)}
      <p>Motif : {receipt.reason}</p>
      <hr />
      <Row {...receipt.amount} className="t-total" />
      <hr />
      <p>Signature :</p>
      <p className="t-sign" />
      <hr />
    </div>
  );
}

// Rapport de session, même mise en page que le ticket : ventes, moyens de paiement, TVA par taux, espèces.
function SessionTicket({ report }: { report: SessionReceipt }) {
  return (
    <div className="receipt">
      <StoreHeader store={report.store} />
      <hr />
      <p className="t-center t-title">{report.title}</p>
      {report.subtitle && <p className="t-center">{report.subtitle}</p>}
      <hr />
      {report.info.map((r) => <Row key={r.label} {...r} />)}
      <hr />
      <p className="t-strong">VENTES</p>
      {report.sales.map((r) => <Row key={r.label} {...r} />)}
      <p className="t-strong">PAR MOYEN DE PAIEMENT</p>
      {report.methods.map((r) => <Row key={r.label} {...r} />)}
      {report.refunds.length > 0 && (
        <>
          <p className="t-strong">RETOURS</p>
          {report.refunds.map((r) => <Row key={r.label} {...r} />)}
        </>
      )}
      <hr />
      {report.vat.length > 0 && <VatTable vat={report.vat} />}
      {report.totals.map((r) => <Row key={r.label} {...r} />)}
      <hr />
      <p className="t-strong">ESPÈCES</p>
      {report.cash.map((r) => <Row key={r.label} {...r} />)}
      {report.movements.length > 0 && (
        <>
          <p className="t-strong">ENTRÉES ET SORTIES</p>
          {report.movements.map((r, i) => <Row key={i} {...r} />)}
        </>
      )}
      <hr />
      {report.result.map((block) => (
        <div key={block.title}>
          <p className="t-strong">{block.title}</p>
          {block.rows.map((r) => <Row key={r.label} label={r.label} value={r.value} className={r.strong ? 't-strong' : ''} />)}
        </div>
      ))}
      {report.cashCount.length > 0 && (
        <>
          <hr />
          <p className="t-strong">COMPTAGE DES ESPÈCES</p>
          {report.cashCount.map((r) => <Row key={r.label} {...r} />)}
        </>
      )}
      {report.notes.length > 0 && <hr />}
      {report.notes.map((note) => <p key={note}>{note}</p>)}
      {report.pending && <><hr /><p className="t-strong">{report.pending}</p></>}
      <hr />
    </div>
  );
}
