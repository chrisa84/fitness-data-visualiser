import { existsSync } from 'node:fs';
import fastifyCompress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import OpenAI from 'openai';
import { openDb, openEventsDb } from './db.js';
import type { CompletionClient } from './ai/chat.js';
import { registerActivityRoutes } from './routes/activities.js';
import { registerAiSettingsRoutes } from './routes/aiSettings.js';
import { registerAnalysisRoutes, registerEventRoutes } from './routes/analysis.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerDailyHealthRoutes } from './routes/dailyHealth.js';
import { registerIntradayRoutes } from './routes/intraday.js';
import { registerPerformanceRoutes } from './routes/performance.js';
import { registerRouteRoutes } from './routes/routes.js';
import { registerTrainingPlanRoutes } from './routes/trainingPlans.js';
import { registerTrainingPlanGenerationRoutes } from './routes/trainingPlanGeneration.js';

export interface AppOptions {
  dbPath: string;
  /** Writable events DB. Defaults to an in-memory DB (used by tests). */
  eventsDbPath?: string;
  /** Built web bundle directory to serve. When unset, the server is API-only. */
  webDistPath?: string;
  logger?: boolean;
  ai?: {
    apiKey: string | undefined;
    baseUrl: string;
  };
}

/** Parse a comma-separated email allowlist into lowercased, trimmed entries. */
function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function buildApp({ dbPath, eventsDbPath = ':memory:', webDistPath, logger = true, ai }: AppOptions) {
  const app = Fastify({ logger });
  void app.register(fastifyCompress, { global: true });
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

  // Account gate for an authenticated (oauth2-proxy) deploy. When an allowlist is
  // configured, every request must carry a proxy-injected email header that matches
  // (the app sits behind the proxy on an internal network, so the header can't be
  // spoofed). This gates the whole app — shell and PWA assets too, not just /api —
  // so a wrong-account session sees nothing at all.
  //
  // Fail closed: in deploy posture (serving the built web bundle) the gate is
  // mandatory, so a forgotten allowlist refuses to start rather than silently
  // opening to anyone the proxy authenticates. Local dev is API-only (no bundle)
  // and on loopback, so it stays open with no allowlist.
  const allowedEmails = parseAllowlist(process.env.ALLOWED_EMAILS ?? process.env.ALLOWED_EMAIL);
  const requireAuth =
    process.env.REQUIRE_AUTH != null
      ? /^(1|true|yes)$/i.test(process.env.REQUIRE_AUTH)
      : Boolean(webDistPath);
  if (requireAuth && allowedEmails.length === 0) {
    throw new Error(
      'Refusing to start: auth is required (deploy posture) but no ALLOWED_EMAILS is configured. ' +
        'Set ALLOWED_EMAILS to the permitted account(s), or set REQUIRE_AUTH=0 to run open.',
    );
  }
  if (allowedEmails.length > 0) {
    app.addHook('onRequest', async (request, reply) => {
      const raw = request.headers['x-forwarded-email'] ?? request.headers['x-auth-request-email'];
      const email = Array.isArray(raw) ? raw[0] : raw;
      if (typeof email !== 'string' || !allowedEmails.includes(email.toLowerCase())) {
        return reply.code(403).send({ error: 'forbidden' });
      }
    });
  }

  app.get('/api/health', async () => {
    const row = db.prepare('SELECT COUNT(*) AS n FROM daily_summary').get() as { n: number };
    return { status: 'ok', dailySummaryRows: row.n };
  });

  // Runtime config — lets the client pick up secrets that can't be baked in at build time.
  app.get('/api/config', async () => ({
    stadiaApiKey: process.env.STADIA_API_KEY ?? '',
  }));

  // Elevation proxy — opentopodata.org doesn't send CORS headers so the browser
  // can't call it directly. We forward server-side and re-serve the result.
  app.get('/api/elevation', async (request, reply) => {
    const { locations } = request.query as { locations?: string };
    if (!locations) return reply.code(400).send({ error: 'locations required' });
    const upstream = await fetch(
      `https://api.opentopodata.org/v1/srtm90m?locations=${encodeURIComponent(locations)}`,
    );
    if (!upstream.ok) return reply.code(502).send({ error: 'upstream error', status: upstream.status });
    const json = await upstream.json();
    return json;
  });

  registerDailyHealthRoutes(app, db);
  registerActivityRoutes(app, db);
  registerIntradayRoutes(app, db);
  registerPerformanceRoutes(app, db);
  registerAnalysisRoutes(app, db);
  registerEventRoutes(app, eventsDb);
  registerRouteRoutes(app, eventsDb);
  registerAiSettingsRoutes(app, eventsDb);
  registerTrainingPlanRoutes(app, eventsDb);
  registerTrainingPlanGenerationRoutes(app, { client: aiClient, db, eventsDb });
  registerChatRoutes(app, { client: aiClient, db, eventsDb });

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
