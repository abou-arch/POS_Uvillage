import { describe, expect, it } from 'vitest';
import express, { listeningApp } from './express';

const request = (method: string, path: string, extra: { headers?: Record<string, string>; body?: unknown; query?: Record<string, string> } = {}) =>
  ({ method, path, headers: extra.headers ?? {}, query: extra.query ?? {}, body: extra.body });

describe('express de la démo', () => {
  it('passe par les middlewares dans l’ordre, puis par la route qui correspond', async () => {
    const app = express();
    const seen: string[] = [];
    app.use((_req, _res, next) => { seen.push('tout'); next(); });
    app.post('/api/auth/login', (_req, res) => res.json({ token: 't' }));
    app.use('/api', (req, res, next) => {
      if (req.headers.authorization !== 'Bearer t') return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      req.user = 'u_1';
      next();
    });
    app.get('/api/stores/:id/approvers', (req, res) => res.json({ store: req.params.id, user: req.user, q: req.query.x }));

    expect(await app.handle(request('POST', '/api/auth/login'))).toEqual({ status: 200, body: { token: 't' } });
    expect((await app.handle(request('GET', '/api/stores/st_1/approvers'))).status).toBe(401);
    expect(await app.handle(request('GET', '/api/stores/st%202/approvers', { headers: { authorization: 'Bearer t' }, query: { x: '1' } })))
      .toEqual({ status: 200, body: { store: 'st 2', user: 'u_1', q: '1' } });
    expect(seen).toHaveLength(3);
  });

  it('distingue les méthodes, renvoie le statut choisi et 404 pour une route inconnue', async () => {
    const app = express();
    app.post('/api/sales', (_req, res) => res.status(201).json({ status: 'created' }));
    expect(await app.handle(request('POST', '/api/sales'))).toEqual({ status: 201, body: { status: 'created' } });
    expect((await app.handle(request('GET', '/api/sales'))).status).toBe(404);
    expect((await app.handle(request('POST', '/api/sales/batch'))).status).toBe(404);
  });

  it('attend un middleware asynchrone (latence simulée) et transforme une exception en 500', async () => {
    const app = express();
    app.use((_req, _res, next) => setTimeout(next, 5));
    app.get('/api/a', (_req, res) => res.json('ok'));
    app.get('/api/b', () => { throw new Error('panne'); });
    expect(await app.handle(request('GET', '/api/a'))).toEqual({ status: 200, body: 'ok' });
    expect((await app.handle(request('GET', '/api/b'))).status).toBe(500);
  });

  it('retient l’application qui écoute', () => {
    const app = express();
    let called = false;
    app.listen(4000, '127.0.0.1', () => { called = true; });
    expect(listeningApp()).toBe(app);
    expect(called).toBe(true);
  });
});
