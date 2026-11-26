// Douchette sur un clavier AZERTY (ou tout autre clavier) : lecture par TOUCHE PHYSIQUE.
//
// Une douchette USB se comporte comme un clavier QWERTY américain : elle « appuie » sur les touches physiques du
// code (Digit1, KeyA…). Sur un poste AZERTY, le système traduit ces touches avec SA disposition : sans Verr. Maj
// le « 1 » devient « & », le « A » devient « Q »… `KeyboardEvent.code` désigne la touche physique, quelle que
// soit la disposition : on reconstruit donc le code lu par la douchette à partir de `code`, pas de `key`.
//
// Si une douchette est au contraire réglée sur la disposition du poste (AZERTY), `key` est juste et `code` ne l'est
// pas : les deux lectures sont gardées, et celle qui retrouve un article de la base est retenue.

export interface Stroke {
  key: string; // caractère produit par la disposition du poste
  code: string; // touche physique (« Digit1 », « KeyA »…)
  shift: boolean;
  time: number; // ms
}

/** Entre deux caractères d'une douchette : quelques ms. Un humain qui tape met bien plus de temps. */
export const MAX_GAP_MS = 50;
/** En dessous, ce n'est pas une rafale : on garde ce que le champ contient. */
export const MIN_BURST = 3;

const DIGITS_SHIFT = ")!@#$%^&*(";
const SYMBOLS: Record<string, [string, string]> = {
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  Backquote: ["`", "~"],
  Comma: [",", "<"],
  Period: [".", ">"],
  Slash: ["/", "?"],
  Space: [" ", " "],
  NumpadDecimal: [".", "."],
  NumpadSubtract: ["-", "-"],
  NumpadAdd: ["+", "+"],
  NumpadMultiply: ["*", "*"],
  NumpadDivide: ["/", "/"],
};

/** Caractère de la touche physique `code` sur un clavier américain, ou null si la touche n'est pas imprimable. */
export function usChar(code: string, shift: boolean): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return shift ? letter[1] : letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return shift ? DIGITS_SHIFT[Number(digit[1])] : digit[1];
  const pad = /^Numpad([0-9])$/.exec(code);
  if (pad) return pad[1];
  const symbol = SYMBOLS[code];
  return symbol ? symbol[shift ? 1 : 0] : null;
}

/**
 * À appeler à chaque touche pressée dans le champ de scan. Les touches non imprimables (Maj, Verr. Maj, Entrée…) et
 * les raccourcis (Ctrl, Alt) ne comptent pas. Une pause plus longue que MAX_GAP_MS recommence la série.
 */
export function recordStroke(
  strokes: Stroke[],
  e: Pick<
    KeyboardEvent,
    "key" | "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey"
  >,
  now: number,
): void {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (usChar(e.code, e.shiftKey) === null && e.key.length !== 1) return;
  const last = strokes[strokes.length - 1];
  if (last && now - last.time > MAX_GAP_MS) strokes.length = 0;
  strokes.push({ key: e.key, code: e.code, shift: e.shiftKey, time: now });
}

/** Rafale de touches assez rapide et assez longue pour venir d'une douchette. */
export const isBurst = (strokes: Stroke[]): boolean =>
  strokes.length >= MIN_BURST;

/**
 * Texte réellement lu par la douchette. `typed` : ce que contient le champ (saisie manuelle, gardée telle quelle
 * si ce n'est pas une rafale). `isKnown` : le texte correspond-il à un article ? Priorité : lecture physique,
 * puis lecture du clavier, puis (rien de connu) lecture physique, la plus probable pour une douchette USB.
 */
export function readScan(
  strokes: Stroke[],
  typed: string,
  isKnown: (text: string) => boolean,
): string {
  if (!isBurst(strokes)) return typed;
  const physical = strokes.map((s) => usChar(s.code, s.shift));
  const keys = strokes.map((s) => (s.key.length === 1 ? s.key : null));
  const fromPhysical = physical.every((c): c is string => c !== null)
    ? physical.join("")
    : null;
  const fromKeys = keys.every((c): c is string => c !== null)
    ? keys.join("")
    : null;
  const candidates = [fromPhysical, fromKeys].filter(
    (c): c is string => c !== null,
  );
  if (candidates.length === 0) return typed;
  return candidates.find(isKnown) ?? candidates[0];
}
