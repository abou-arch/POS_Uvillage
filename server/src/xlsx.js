// Lecture minimale d'un classeur .xlsx (première feuille, valeurs seulement), sans dépendance : un .xlsx est une
// archive zip de fichiers XML. Sert à reprendre les exports de Falcon POS (articles, fournisseurs).
import { inflateRawSync } from 'node:zlib';

/** Fichiers de l'archive zip : nom → contenu (Buffer). Méthodes 0 (stocké) et 8 (deflate). */
export function unzip(buf) {
  // Fin du répertoire central : signature 0x06054b50, cherchée depuis la fin (commentaire de 64 Ko au plus).
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('Fichier .xlsx illisible (archive zip attendue)');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Répertoire du .xlsx illisible');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s) => s.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-f]+));/gi, (_, name, dec, hex) => {
  if (dec) return String.fromCodePoint(Number(dec));
  if (hex) return String.fromCodePoint(parseInt(hex, 16));
  return { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[name.toLowerCase()];
});
const textOf = (xml) => decode([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

/** Index de colonne d'une référence de cellule : « A3 » → 0, « J3 » → 9, « AA1 » → 26. */
export const columnOf = (ref) => [...ref.match(/^[A-Z]+/)[0]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Lignes de la première feuille, chaque ligne un tableau de textes ('' pour une cellule vide). */
export function readSheet(buf) {
  const files = unzip(buf);
  const sheet = files.get('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('Feuille introuvable dans le .xlsx');
  const shared = files.has('xl/sharedStrings.xml')
    ? [...files.get('xl/sharedStrings.xml').toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];
  const rows = [];
  for (const row of sheet.toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      if (!ref) continue;
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const body = c[2] ?? '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = '';
      if (type === 'inlineStr') value = textOf(body);
      else if (type === 's' && v !== undefined) value = shared[Number(v)] ?? '';
      else if (v !== undefined) value = decode(v);
      cells[columnOf(ref)] = value;
    }
    rows.push(Array.from(cells, (x) => x ?? ''));
  }
  return rows;
}
