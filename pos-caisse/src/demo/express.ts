// Remplace « express » pour la démo (build --mode demo) : la fausse API (mock-api/server.js) tourne alors dans la
// page, sans serveur. Seul ce que server.js utilise existe : use, get, post, listen, express.json, req.params,
// req.query, req.body, req.headers, res.status, res.json. Les requêtes arrivent par handle() (voir install.ts).

/** Requête reçue par handle() : méthode, chemin, en-têtes (en minuscules), paramètres d'URL, corps décodé. */
export interface DemoIncoming {
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}
export interface DemoRequest extends DemoIncoming {
  params: Record<string, string>;
  [extra: string]: unknown; // ce que les middlewares ajoutent (req.user)
}
export interface DemoResponse {
  status(code: number): DemoResponse;
  json(body: unknown): DemoResponse;
}
export interface DemoResult { status: number; body: unknown }
type Next = (error?: unknown) => void;
type Handler = (req: DemoRequest, res: DemoResponse, next: Next) => unknown;

interface Layer {
  method: string | null; // null : middleware (app.use), pour toutes les méthodes
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export interface DemoApp {
  use(pathOrHandler: string | Handler, ...handlers: Handler[]): DemoApp;
  get(path: string, ...handlers: Handler[]): DemoApp;
  post(path: string, ...handlers: Handler[]): DemoApp;
  listen(port?: unknown, host?: unknown, callback?: () => void): DemoApp;
  handle(request: DemoIncoming): Promise<DemoResult>;
}

/** « /api/stores/:id » → expression régulière ; prefix : app.use, qui couvre aussi tout ce qui est en dessous. */
function compile(path: string, prefix: boolean) {
  const keys: string[] = [];
  const source = path.replace(/\/+$/, '').split('/')
    .map((part) => (part.startsWith(':') ? (keys.push(part.slice(1)), '([^/]+)') : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return { pattern: new RegExp(`^${source}${prefix ? '(?:/|$)' : '/?$'}`), keys };
}

let listening: DemoApp | null = null;
/** L'application qui a appelé listen() : celle de server.js une fois importé. */
export const listeningApp = () => listening;

function express(): DemoApp {
  const stack: Layer[] = [];
  const add = (method: string | null) => (first: string | Handler, ...rest: Handler[]) => {
    const [path, handlers] = typeof first === 'string' ? [first, rest] : ['', [first, ...rest]];
    const { pattern, keys } = compile(path, method === null);
    for (const handler of handlers) stack.push({ method, pattern, keys, handler });
    return app;
  };

  const app: DemoApp = {
    use: add(null),
    get: add('GET'),
    post: add('POST'),
    listen(_port, _host, callback) {
      listening = app;
      callback?.();
      return app;
    },
    handle(request) {
      return new Promise((resolve) => {
        const req: DemoRequest = { ...request, params: {} };
        let status = 200;
        let done = false;
        const res: DemoResponse = {
          status(code) { status = code; return res; },
          json(body) {
            if (!done) { done = true; resolve({ status, body }); }
            return res;
          },
        };
        let index = 0;
        const next: Next = (error) => {
          if (done) return;
          if (error !== undefined) {
            res.status(500).json({ error: { code: 'INTERNAL', message: String(error), details: {} } });
            return;
          }
          while (index < stack.length) {
            const layer = stack[index++];
            if (layer.method && layer.method !== req.method) continue;
            const match = layer.pattern.exec(req.path);
            if (!match) continue;
            req.params = Object.fromEntries(layer.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
            try {
              const result = layer.handler(req, res, next);
              if (result instanceof Promise) result.catch(next);
            } catch (e) {
              next(e);
            }
            return;
          }
          res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route inconnue : ${req.method} ${req.path}`, details: {} } });
        };
        next();
      });
    },
  };
  return app;
}

/** Le corps arrive déjà décodé (install.ts) : rien à faire. */
express.json = (): Handler => (_req, _res, next) => next();

export default express;
