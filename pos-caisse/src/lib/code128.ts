// Code-barres Code 128 (norme ISO/IEC 15417), écrit pour la caisse, sans dépendance : il imprime le numéro de ticket
// sur le ticket de vente pour que la douchette le relise lors d'un retour (§10).
// Jeu B pour le texte (caractères ASCII imprimables), jeu C pour les suites de chiffres (deux chiffres par symbole,
// le code est plus court, donc ses barres plus larges sur un ticket de 80 mm).

/**
 * Largeurs des 107 symboles, en modules : barre, espace, barre, espace, barre, espace (le stop a une barre finale).
 * Index = valeur du symbole. 103, 104, 105 = Start A, B, C ; 106 = Stop.
 */
export const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const CODE_B = 100; // dans le jeu C : passer au jeu B
const CODE_C = 99; // dans le jeu B : passer au jeu C
const STOP = 106;

/** Valeurs des symboles (start, données, clé de contrôle, stop). Lève une erreur sur un caractère non imprimable. */
export function code128Values(text: string): number[] {
  if (text === '') throw new Error('Code-barres : texte vide.');
  const values: number[] = [];
  let set: 'B' | 'C' | null = null;
  let i = 0;
  while (i < text.length) {
    let digits = 0;
    while (i + digits < text.length && /\d/.test(text[i + digits])) digits += 1;
    // Le jeu C ne vaut la peine qu'à partir de 4 chiffres (2 symboles gagnés, moins le changement de jeu).
    if (digits >= 4) {
      if (set !== 'C') values.push(set === null ? START_C : CODE_C);
      set = 'C';
      const pairs = Math.floor(digits / 2);
      for (let k = 0; k < pairs; k += 1) values.push(Number(text.slice(i + 2 * k, i + 2 * k + 2)));
      i += 2 * pairs;
      continue;
    }
    const code = text.charCodeAt(i);
    if (code < 32 || code > 126) throw new Error(`Code-barres : caractère « ${text[i]} » impossible à coder.`);
    if (set !== 'B') values.push(set === null ? START_B : CODE_B);
    set = 'B';
    values.push(code - 32);
    i += 1;
  }
  const checksum = values.reduce((sum, v, k) => sum + v * Math.max(k, 1), 0) % 103; // le start compte une fois
  return [...values, checksum, STOP];
}

/** Largeurs successives (barre, espace, barre…) du code-barres, en modules, sans les marges blanches. */
export function code128(text: string): number[] {
  return code128Values(text).flatMap((v) => [...PATTERNS[v]].map(Number));
}
