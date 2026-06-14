import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = buildApp({
  dbPath: config.dbPath,
  eventsDbPath: config.eventsDbPath,
  webDistPath: config.webDistPath,
  ai: config.ai,
});

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
