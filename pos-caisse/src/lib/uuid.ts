// Identifiants UUID v4 générés par la caisse (clients, ventes) : indispensables pour le hors ligne.
// crypto.randomUUID n'existe qu'en contexte sécurisé (https ou localhost) : sinon on le construit à la main.
type UuidSource = Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => string };

export function uuidv4(source: UuidSource = crypto): string {
  if (typeof source.randomUUID === 'function') return source.randomUUID();
  const b = source.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
