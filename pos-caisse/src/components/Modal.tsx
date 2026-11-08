import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Icon } from './ui';

// Fenêtre modale sur <dialog> : le focus reste dedans, Échap ferme, le fond est assombri.
// Le champ marqué data-autofocus reçoit le focus à l'ouverture.
export function Modal({ title, onClose, className = '', children }: {
  title: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog ref={ref} className={`modal ${className}`} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header>
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="close" aria-label="Fermer" onClick={onClose}><Icon name="x" /></button>
      </header>
      {children}
    </dialog>
  );
}
