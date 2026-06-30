import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import OpenAI from 'openai';
import { openDb, openEventsDb } from './db.js';
import type { CompletionClient } from './ai/chat.js';
import { registerActivityRoutes } from './routes/activities.js';
import { registerAnalysisRoutes, registerEventRoutes } from './routes/analysis.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerDailyHealthRoutes } from './routes/dailyHealth.js';
import { registerIntradayRoutes } from './routes/intraday.js';
import { registerPerformanceRoutes } from './routes/performance.js';
import { registerRouteRoutes } from './routes/routes.js';

export interface AppOptions {
  dbPath: string;
  /** Writable events DB. Defaults to an in-memory DB (used by tests). */
  eventsDbPath?: string;
  /** Built web bundle directory to serve. When unset, the server is API-only. */
  webDistPath?: string;
  logger?: boolean;
  ai?: {
    apiKey: string | undefined;
    model: string;
    baseUrl: string;
  };
}

export function buildApp({ dbPath, eventsDbPath = ':memory:', webDistPath, logger = true, ai }: AppOptions) {
  const app = Fastify({ logger });
  const db = openDb(dbPath);
  const eventsDb = openEventsDb(eventsDbPath);

  // The AI client is optional: without a key the chat endpoint returns 503.
  const aiClient: CompletionClient | null = ai?.apiKey
    ? new OpenAI({ apiKey: ai.apiKey, baseURL: ai.baseUrl })
    : null;

  app.addHook('onClose', async () => {
    db.close();
    eventsDb.close();
  });

  // Optional single-account gate for an authenticated (oauth2-proxy) deploy. When
  // ALLOWED_EMAIL is set, every /api request must carry a matching proxy-injected
  // email header (the app sits behind the proxy on an internal network, so the
  // header can't be spoofed). Scoped to /api so the app shell and PWA assets still
  // load. Unset locally — loopback has no auth — so dev is unaffected.
  const allowedEmail = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (allowedEmail) {
    app.addHook('onRequest', async (request, reply) => {
      if (!request.url.startsWith('/api')) return;
      const raw = request.headers['x-forwarded-email'] ?? request.headers['x-auth-request-email'];
      const email = Array.isArray(raw) ? raw[0] : raw;
      if (typeof email !== 'string' || email.toLowerCase() !== allowedEmail) {
        return reply.code(403).send({ error: 'forbidden' });
      }
    });
  }

  app.get('/api/health', async () => {
    const row = db.prepare('SELECT COUNT(*) AS n FROM daily_summary').get() as { n: number };
    return { status: 'ok', dailySummaryRows: row.n };
  });

  registerDailyHealthRoutes(app, db);
  registerActivityRoutes(app, db);
  registerIntradayRoutes(app, db);
  registerPerformanceRoutes(app, db);
  registerAnalysisRoutes(app, db);
  registerEventRoutes(app, eventsDb);
  registerRouteRoutes(app, eventsDb);
  registerChatRoutes(app, { client: aiClient, model: ai?.model ?? 'unset', db, eventsDb });

  // In production (single-container deploy) the API also serves the built web
  // bundle. Unknown non-API GET routes fall back to index.html so client-side
  // routing works on refresh/deep-link.
  if (webDistPath && existsSync(webDistPath)) {
    app.register(fastifyStatic, { root: webDistPath, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found', message: `${request.method} ${request.url}` });
    });
  }

  return app;
}
