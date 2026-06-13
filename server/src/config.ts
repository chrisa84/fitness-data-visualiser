export interface Config {
  /** Garmin-Sync database, opened read-only. */
  dbPath: string;
  /** Visualiser-owned writable database for events/annotations. */
  eventsDbPath: string;
  port: number;
  /** OpenRouter (OpenAI-compatible) settings for the AI query layer. */
  ai: {
    apiKey: string | undefined;
    model: string;
    baseUrl: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    dbPath: env.GARMIN_DB_PATH ?? '/path/to/garmin_sync.db',
    eventsDbPath: env.EVENTS_DB_PATH ?? 'visualiser-events.db',
    port: env.PORT ? Number(env.PORT) : 3001,
    ai: {
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL ?? 'anthropic/claude-3.7-sonnet',
      baseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    },
  };
}
