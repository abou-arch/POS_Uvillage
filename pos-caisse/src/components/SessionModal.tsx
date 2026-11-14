import { TIME_ZONE } from '../config/store';
import { MOVEMENT_LABELS, type Expected, type LocalCashMovement, type LocalCashSession } from '../lib/cashSession';
import { receiptDate, receiptTime, signedMad } from '../lib/receipt';
import { formatMad } from '../lib/totals.js';
import { Modal } from './Modal';
import { Icon } from './ui';

// Session en cours : où en est la caisse, et ce qu'on peut y faire (entrée / sortie, rapport X, clôture).
export function SessionModal({
  session, salesCount, salesTotal, refundsCount, refundsTotal, expected, movements, onMovement, onReprintMovement, onReport, onCloseSession, onClose,
}: {
  session: LocalCashSession;
  salesCount: number;
  salesTotal: number;
  refundsCount: number;
  refundsTotal: number;
  expected: Expected;
  movements: LocalCashMovement[];
  onMovement: () => void;
  onReprintMovement: (movement: LocalCashMovement) => void;
  onReport: () => void;
  onCloseSession: () => void;
  onClose: () => void;
}) {
  const sorted = [...movements].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return (
    <Modal title="Session de caisse" className="wide" onClose={onClose}>
      <div className="session">
        <dl className="session-info">
          <div><dt>Ouverte le</dt><dd>{receiptDate(session.opened_at, TIME_ZONE)} par {session.opened_by_name}</dd></div>
          <div><dt>Fond de caisse</dt><dd>{formatMad(session.opening_cash)}</dd></div>
          <div><dt>Ventes</dt><dd>{salesCount} · {formatMad(salesTotal)}</dd></div>
          <div><dt>Retours</dt><dd>{refundsCount} · {signedMad(-refundsTotal)}</dd></div>
          <div><dt>Carte · mobile attendus</dt><dd>{formatMad(expected.card)} · {formatMad(expected.mobile)}</dd></div>
          <div className="strong"><dt>Espèces attendues</dt><dd>{formatMad(expected.cash)}</dd></div>
        </dl>
        {sorted.length > 0 && (
          <section className="session-moves" aria-label="Entrées et sorties d’espèces">
            <h3>Entrées et sorties</h3>
            <ul>
              {sorted.map((m) => (
                <li key={m.id}>
                  <span>{receiptTime(m.created_at, TIME_ZONE)} · {MOVEMENT_LABELS[m.type]} : {m.reason}</span>
                  <strong className={m.type}>{signedMad(m.type === 'in' ? m.amount : -m.amount)}</strong>
                  <button type="button" className="reprint" onClick={() => onReprintMovement(m)}
                    aria-label={`Réimprimer le ticket : ${MOVEMENT_LABELS[m.type].toLowerCase()} de ${formatMad(m.amount)}`} title="Réimprimer le ticket">
                    <Icon name="printer" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="choices">
          <button type="button" className="choice" data-autofocus onClick={onMovement}>
            <span className="choice-icon"><Icon name="swap" /></span>
            <span className="choice-text">
              <strong>Entrée / sortie d’espèces</strong>
              <span className="muted">Achat de fournitures, dépôt en banque, appoint de monnaie…</span>
            </span>
            <Icon name="chevronRight" />
          </button>
          <button type="button" className="choice" onClick={onReport}>
            <span className="choice-icon"><Icon name="report" /></span>
            <span className="choice-text">
              <strong>Rapport X</strong>
              <span className="muted">Imprime l’état de la session, sans la clôturer.</span>
            </span>
            <Icon name="printer" />
          </button>
          <button type="button" className="choice danger" onClick={onCloseSession}>
            <span className="choice-icon"><Icon name="lock" /></span>
            <span className="choice-text">
              <strong>Clôturer la caisse</strong>
              <span className="muted">Compter les espèces et fermer la session.</span>
            </span>
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>
    </Modal>
  );
}
