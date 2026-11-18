// Effets visuels de la caisse (aucune règle métier) : l'article qui « vole » jusqu'au total, l'onde au toucher.
// Tous s'effacent si le système est réglé sur « réduire les animations ».

export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Une copie de la vignette touchée part en arc jusqu'à la carte « Total à payer », qui rebondit à l'arrivée. */
export function flyToCart(from: Element | null) {
  const target = document.querySelector<HTMLElement>('.cart-panel .total');
  if (!from || !target || prefersReducedMotion()) return;
  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const ghost = from.cloneNode(true) as HTMLElement;
  ghost.classList.add('fly-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  document.body.appendChild(ghost);

  // Trajectoire en cloche : la copie monte un peu avant de plonger vers le total en rapetissant.
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const lift = Math.min(140, Math.abs(dx) * 0.35 + 40);
  const frames = Array.from({ length: 11 }, (_, i) => {
    const t = i / 10;
    const x = dx * t;
    const y = dy * t - 4 * lift * t * (1 - t);
    return { transform: `translate(${x}px, ${y}px) scale(${1 - 0.8 * t}) rotate(${-14 * t}deg)`, opacity: t < 0.85 ? 1 : 0.4 };
  });
  const flight = ghost.animate(frames, { duration: 600, easing: 'cubic-bezier(.45, 0, .4, 1)' });
  flight.onfinish = () => {
    ghost.remove();
    target.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }],
      { duration: 280, easing: 'cubic-bezier(.34, 1.56, .64, 1)' },
    );
  };
  flight.oncancel = () => ghost.remove();
}

const RIPPLE_TARGETS = '.tile, .action, .chip, .btn, .bills button, .choice, .held-button, .segmented button, .stepper button';

/** Onde partant du doigt (ou de la souris) sur les boutons de la caisse : écran tactile, le geste se voit. */
export function installRipples() {
  document.addEventListener('pointerdown', (e) => {
    if (prefersReducedMotion() || !(e.target instanceof Element)) return;
    const el = e.target.closest<HTMLElement>(RIPPLE_TARGETS);
    if (!el || (el as HTMLButtonElement).disabled) return;
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const wave = document.createElement('span');
    wave.className = 'ripple';
    wave.setAttribute('aria-hidden', 'true');
    Object.assign(wave.style, {
      width: `${size}px`, height: `${size}px`,
      left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px`,
    });
    el.appendChild(wave);
    wave.addEventListener('animationend', () => wave.remove());
  });
}
