import { useEffect, useRef, useState, type ReactNode } from 'react';
import { prefersReducedMotion } from './fx';

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
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  swap: <path d="M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7" />,
  report: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  grid: <><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  // Pictogrammes des catégories d'articles (voir lib/categoryLook.ts).
  bread: <><path d="M6 20v-8a4 4 0 0 1-1-7.5C6.5 3.6 9 3 12 3s5.5.6 7 1.5a4 4 0 0 1-1 7.5v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z" /><path d="M10 9.5l1 1M13.5 13l1 1" /></>,
  dairy: <><path d="M8 2h8v3l3 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9l3-4z" /><path d="M8 5h8M5 9h14" /><path d="M12 13.5c-1.2 1.4-1.8 2.4-1.8 3.2a1.8 1.8 0 0 0 3.6 0c0-.8-.6-1.8-1.8-3.2z" /></>,
  sauce: <><path d="M10 2h4v4l2 3v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3z" /><path d="M8 13h8M8 17h8" /></>,
  can: <><ellipse cx="12" cy="5" rx="7" ry="2.5" /><path d="M5 5v14c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5" /><path d="M5 10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></>,
  drink: <><path d="M6 8h12l-1.4 12.2a1 1 0 0 1-1 .8H8.4a1 1 0 0 1-1-.8z" /><path d="M12 8l2-6h3" /><path d="M6.5 12.5h11" /></>,
  chips: <><path d="M7 3h10l1 3-1 6 1 6-1 3H7l-1-3 1-6-1-6z" /><circle cx="12" cy="12" r="2.5" /></>,
  sweets: <><circle cx="12" cy="12" r="4" /><path d="M8.5 10L4 7v10l4.5-3M15.5 10L20 7v10l-4.5-3" /></>,
  plug: <><path d="M9 2v5M15 2v5" /><path d="M6 7h12v4a6 6 0 0 1-12 0z" /><path d="M12 17v5" /></>,
  weight: <><circle cx="12" cy="6" r="3" /><path d="M7.5 10h9l2.5 11H5z" /></>,
  produce: <><path d="M12 7c-2-2-7-1.5-7 4 0 4 3 9 5 9 1 0 1.5-.5 2-.5s1 .5 2 .5c2 0 5-5 5-9 0-5.5-5-6-7-4z" /><path d="M12 7c0-2 1-4 3-4" /></>,
  tag: <><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
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

/** Montant qui défile jusqu'à sa nouvelle valeur (≈ 0,45 s), comme un compteur. Affichage seulement : la valeur
 *  finale est toujours exacte, et le système réglé sur « réduire les animations » l'affiche directement. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const current = useRef(value); // valeur affichée : un nouveau changement repart d'ici, même en pleine animation
  useEffect(() => {
    const from = current.current;
    if (from === value) return;
    const duration = prefersReducedMotion() ? 0 : 450; // sans animation : la valeur finale dès l'image suivante
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      const v = Math.round(from + (value - from) * (1 - (1 - t) ** 3)); // entiers : des centimes, jamais de flottants
      current.current = v;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{format(shown)}</>;
}
