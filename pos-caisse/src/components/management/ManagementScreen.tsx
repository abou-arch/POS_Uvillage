import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useManagementData } from '../../db/management';
import { managementPages, PAGE_LABELS, type ManagementPage } from '../../state/permissions';
import { placeOf } from '../../state/session';
import type { SyncState } from '../../sync/useSync';
import type { Session } from '../../types';
import { PrintSheet } from '../Ticket';
import { TopBar } from '../TopBar';
import { Icon, type IconName } from '../ui';
import { ManageContext, type ManagementPrint, type PageProps, type SaleRequest } from './shared';
import { CustomersPage } from './CustomersPage';
import { DashboardPage } from './DashboardPage';
import { ProductsPage } from './ProductsPage';
import { ReportsPage } from './ReportsPage';
import { SalesPage } from './SalesPage';
import { SessionsPage } from './SessionsPage';
import './management.css';

const PAGE_ICONS: Record<ManagementPage, IconName> = {
  dashboard: 'chart', sales: 'receipt', sessions: 'cash', products: 'box', customers: 'users', reports: 'report',
};

/**
 * Impression depuis la Gestion : l'écran de caisse, resté ouvert dessous, garde peut-être sa dernière feuille ; la
 * classe print-management la cache pour que seule la feuille demandée ici sorte (voir @media print dans App.css).
 */
function useManagementPrint() {
  const [job, setJob] = useState<{ job: ManagementPrint } | null>(null);
  useEffect(() => {
    if (!job) return;
    const body = document.body;
    const done = () => body.classList.remove('print-management');
    body.classList.add('print-management');
    window.addEventListener('afterprint', done, { once: true });
    window.print();
    return () => { window.removeEventListener('afterprint', done); done(); };
  }, [job]);
  return { job: job?.job ?? null, print: (j: ManagementPrint) => setJob({ job: j }) };
}

// Espace « Gestion » du poste (inspiré du back-office d'un point de vente : tableau de bord, commandes, sessions,
// articles, clients, rapports), ouvert en plein écran au-dessus de la caisse : le panier en cours est gardé, et
// les raccourcis de paiement (F2, F4) ne partent pas tant qu'une fenêtre est ouverte. Tout est calculé à partir de
// ce que ce poste a enregistré, même hors ligne.
export function ManagementScreen({ session, sync, page, openSessionId, onSaleAction, onNavigate, onClose, onLogout }: {
  session: Session;
  sync: SyncState;
  page: ManagementPage;
  openSessionId: string | null;
  onSaleAction: ((request: SaleRequest) => void) | null;
  onNavigate: (page: ManagementPage) => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { data, loaded, error } = useManagementData(session.storeId, session.registerId);
  const { job, print } = useManagementPrint();
  const pages = managementPages(session.user.role);
  const { storeName, registerName } = placeOf(session);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  // Changement de page : on remonte en haut du contenu.
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [page]);

  const props: PageProps = { session, data, print, onNavigate, openSessionId, onSaleAction };
  return (
    <dialog ref={ref} className="management" aria-label="Gestion de la caisse"
      onCancel={(e) => { e.preventDefault(); if (e.target === ref.current) onClose(); }}>
      <ManageContext.Provider value={null}>
        <TopBar session={session} sync={sync} onLogout={onLogout}>
          <button className="held-button back" onClick={onClose} title="Revenir à l’écran de caisse (Échap)">
            <Icon name="register" size={18} /><span className="label">Retour à la caisse</span>
          </button>
        </TopBar>
      </ManageContext.Provider>
      <div className="m-layout">
        <nav className="m-nav" aria-label="Pages de gestion">
          <p className="m-nav-title"><Icon name="grid" size={16} />Gestion<small>{storeName} · {registerName}</small></p>
          {pages.map((p) => (
            <button key={p} type="button" className={`m-nav-item${p === page ? ' on' : ''}`} aria-current={p === page ? 'page' : undefined}
              onClick={() => onNavigate(p)}>
              <Icon name={PAGE_ICONS[p]} size={18} /><span>{PAGE_LABELS[p]}</span>
            </button>
          ))}
          <p className="m-nav-note">
            Données enregistrées sur ce poste (31 derniers jours), disponibles hors ligne. Le catalogue et les clients se
            modifient dans le back-office.
          </p>
        </nav>
        <div className="m-content" ref={content}>
          <h1 className="m-title">{PAGE_LABELS[page]}</h1>
          {error ? (
            <p className="alert" role="alert"><Icon name="alert" size={18} />Base locale illisible : données indisponibles sur ce poste.</p>
          ) : !loaded ? (
            <p className="muted">Chargement…</p>
          ) : (
            <div className="m-page" key={page}>
              {page === 'dashboard' && <DashboardPage {...props} />}
              {page === 'sales' && <SalesPage {...props} />}
              {page === 'sessions' && <SessionsPage {...props} />}
              {page === 'products' && <ProductsPage {...props} />}
              {page === 'customers' && <CustomersPage {...props} />}
              {page === 'reports' && <ReportsPage {...props} />}
            </div>
          )}
        </div>
      </div>
      {job?.kind === 'doc' && <PrintSheet doc={job.doc} className="management-print" />}
      {job?.kind === 'page' && createPortal(<div className="ticket-print management-print">{job.node}</div>, document.body)}
    </dialog>
  );
}
