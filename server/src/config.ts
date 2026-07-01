export interface Config {
  /** Garmin-Sync database, opened read-only. */
  dbPath: string;
  /** Visualiser-owned writable database for events/annotations. */
  eventsDbPath: string;
  /**
   * Directory of the built web bundle to serve alongside the API. When unset
   * (e.g. local dev, where Vite serves the web), the server is API-only.
   */
  webDistPath: string | undefined;
  port: number;
  /** Listen host. Defaults to loopback; set to 0.0.0.0 in a container. */
  host: string;
  /**
   * OpenRouter (OpenAI-compatible) client settings for the AI query layer.
   * The model itself is user-configurable at runtime (see `ai_settings` /
   * `/api/ai-settings`), not baked in here.
   */
  ai: {
    apiKey: string | undefined;
    baseUrl: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    dbPath: env.GARMIN_DB_PATH ?? '/path/to/garmin_sync.db',
    eventsDbPath: env.EVENTS_DB_PATH ?? 'visualiser-events.db',
    webDistPath: env.WEB_DIST_PATH,
    port: env.PORT ? Number(env.PORT) : 3001,
    host: env.HOST ?? '127.0.0.1',
    ai: {
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    },
  };
}
