import type { ReactNode } from 'react';

// Pictogrammes dessinés en SVG (pas de dépendance) : trait de 2 px, couleur du texte autour.
const paths = {
  register: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  store: <><path d="M4 10v10h16V10" /><path d="M3 10l2-6h14l2 6zM9 20v-5h6v5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>,
  logout: <><path d="M9 4H5v16h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  barcode: <path d="M4 5v14M7 5v14M11 5v14M14 5v14M17 5v14M20 5v14" />,
  cart: <><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h9.8a1 1 0 0 0 1-.8L21 7H6" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></>,
  minus: <path d="M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  pause: <path d="M9 5v14M15 5v14" />,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></>,
  cash: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 10v4M18 10v4" /></>,
  printer: <><path d="M7 9V3h10v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /></>,
  alert: <><path d="M12 3L2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></>,
} satisfies Record<string, ReactNode>;

export function Icon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/** Initiale de l'utilisateur dans une pastille. */
export function Avatar({ name }: { name: string }) {
  return <span className="avatar" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>;
}
