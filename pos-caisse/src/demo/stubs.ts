// Remplacements de la démo (build --mode demo) pour ce que server.js importe et qui n'a pas de sens dans une page.

/** « cors » : la fausse API est dans la page, pas d'autre origine. */
export default function cors() {
  return (_req: unknown, _res: unknown, next: () => void) => next();
}

/** « ./breakline.js » : pas de passerelle BreakLine dans la démo (BREAKLINE_URL n'est jamais défini). */
export function startBreakline() {
  return null;
}
