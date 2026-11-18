// Démo sans serveur (npm run build:demo, publiée sur GitHub Pages) : la fausse API, mock-api/server.js tel quel,
// tourne dans la page. Les appels de src/api/client.ts vers VITE_API_URL (une adresse qui n'existe pas,
// voir .env.demo) sont servis ici au lieu de partir sur le réseau. Mêmes données et mêmes règles que `npm run mock`.
// Chaque testeur a ses propres données, gardées dans son navigateur.
import { DEMO_STATE_KEY } from './state';
import { listeningApp } from './express';
import { precomputePbkdf2 } from './crypto';

const BASE = import.meta.env.VITE_API_URL ?? '';

export async function installDemoApi() {
  // server.js lit process.env (PORT, HOST, BREAKLINE_URL) : aucun n'est défini dans la démo.
  const g = globalThis as { process?: unknown };
  g.process ??= { env: {} };
  // Empreintes des PIN (§11) préparées par Web Crypto : mêmes réglages que server.js (600 000 itérations, sel de
  // 16 octets, 32 octets d'empreinte). Si server.js change, il retombe sur le calcul synchrone, juste plus lent.
  const { users } = await import('../../mock-api/data.js');
  const pins = users.filter((u) => u.pin && ['manager', 'admin'].includes(u.role)).map((u) => u.pin!);
  await precomputePbkdf2(pins, 600_000, 32, 16);
  await import('../../mock-api/server.js');
  const app = listeningApp();
  if (!app || !BASE) throw new Error('Démo : la fausse API n’a pas démarré.');

  const networkFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (!url.href.startsWith(BASE)) return networkFetch(input, init);
    let body: unknown;
    try {
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    } catch {
      return Response.json({ error: { code: 'INVALID_JSON', message: 'Corps illisible', details: {} } }, { status: 400 });
    }
    const result = await app.handle({
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      query: Object.fromEntries(url.searchParams),
      body,
    });
    return Response.json(result.body, { status: result.status });
  };
}

/**
 * Efface les données de la démo (fausse API et caisse) pour repartir de zéro. Seulement les nôtres : sur
 * GitHub Pages, d'autres sites du même compte partagent l'origine (et donc localStorage).
 */
export async function resetDemo() {
  localStorage.removeItem(DEMO_STATE_KEY);
  for (const key of Object.keys(localStorage)) if (key.startsWith('pos.')) localStorage.removeItem(key);
  const { db } = await import('../db/db');
  db.close();
  await db.delete();
  location.reload();
}
