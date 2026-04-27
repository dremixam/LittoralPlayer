import express, { type Request, type Response, type NextFunction } from 'express';
import { OpenAPIBackend } from 'openapi-backend';
import swaggerUi from 'swagger-ui-express';
import yaml from 'js-yaml';
import fs from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { app as electronApp } from 'electron';
import { handlers } from './handlers';
import { attachWebSocket } from './ws';
import { getApiPort } from '../settings';
import type { ApiServerInfo } from '../../shared/models';

let server: HttpServer | null = null;
let serverInfo: ApiServerInfo | null = null;

export async function startApiServer(): Promise<ApiServerInfo> {
  if (serverInfo) return serverInfo;

  const specPath = resolveSpecPath();
  const api = new OpenAPIBackend({ definition: specPath, quick: true });

  api.register({
    notFound: handlers.notFound,
    validationFail: handlers.validationFail,
    notImplemented: handlers.notImplemented,
  });

  // Enregistre tous les operationId définis dans les handlers
  for (const [opId, handler] of Object.entries(handlers)) {
    if (['notFound', 'validationFail', 'notImplemented'].includes(opId)) continue;
    api.register(opId, handler);
  }

  await api.init();

  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // CORS local : on autorise tout en local. Restreindre selon vos besoins.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (_req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // Sert la spec OpenAPI brute pour outillage externe
  app.get('/openapi.yaml', (_req, res) => res.sendFile(specPath));
  app.get('/openapi.json', (_req, res) => {
    try {
      const doc = yaml.load(fs.readFileSync(specPath, 'utf8'));
      res.json(doc);
    } catch (err) {
      res.status(500).json({ code: 'spec_load_failed', message: (err as Error).message });
    }
  });

  // Swagger UI sur /docs
  try {
    const spec = yaml.load(fs.readFileSync(specPath, 'utf8')) as object;
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, {
      customSiteTitle: 'Littoral API',
    }));
  } catch (err) {
    console.warn('[api] Swagger UI not mounted:', (err as Error).message);
  }

  // Délègue toutes les autres routes à openapi-backend
  app.use((req, res) =>
    api.handleRequest(
      {
        method: req.method,
        path: req.path,
        body: req.body,
        query: req.query as Record<string, string | string[]>,
        headers: req.headers as Record<string, string | string[]>,
      },
      req,
      res,
    ),
  );

  // Gestion d'erreur générique
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api] error', err);
    res.status(500).json({ code: 'internal', message: err.message });
  });

  const httpServer = createServer(app);
  attachWebSocket(httpServer);

  const port = getApiPort();
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', () => resolve());
  });

  server = httpServer;
  serverInfo = { port, url: `http://127.0.0.1:${port}` };
  console.log(`[api] listening on ${serverInfo.url} (WS: ${serverInfo.url.replace('http', 'ws')}/events)`);
  return serverInfo;
}

export async function stopApiServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>(resolve => server!.close(() => resolve()));
  server = null;
  serverInfo = null;
}

export function getApiServerInfo(): ApiServerInfo | null {
  return serverInfo;
}

/**
 * Résout le chemin de la spec OpenAPI selon qu'on est en dev (cwd) ou packagé (resources/).
 */
function resolveSpecPath(): string {
  // En production, la spec est packagée dans extraResources (cf. electron-builder).
  // En dev, on charge depuis le repo.
  const candidates = [
    path.join(process.cwd(), 'openapi', 'tidal-player-api.yaml'),
    path.join(electronApp.getAppPath(), 'openapi', 'tidal-player-api.yaml'),
    path.join(process.resourcesPath ?? '', 'openapi', 'tidal-player-api.yaml'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  // Fallback : laisse openapi-backend lever une erreur claire
  return candidates[0]!;
}
