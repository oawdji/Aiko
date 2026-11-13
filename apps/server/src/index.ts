import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRoute } from './api/health';
import { bootstrapRoute } from './bootstrap/route';
import { conversationsRoute } from './conversations/route';
import { chatRoute } from './chat/route';
import { settingsRoute } from './settings/route';
import { memoriesRoute } from './memories/route';
import { devMockChatRoute } from './api/dev-mock-chat';
import { loadServerConfig } from './config/server';
import { loadDbConfig } from './config/db';
import { loadLlmConfig } from './config/llm';
import { getDb } from './db';
import { runMigrations } from './db/migrate';
import { ensureMemorySearchIndex } from './memories/search-index';
import { seedDefaultData } from './db/seed';

const app = new Hono();

app.use(
  '/api/*',
  cors({
    origin: ['http://127.0.0.1:5173', 'http://localhost:5173'],
  }),
);

app.route('/api', healthRoute);
app.route('/api', bootstrapRoute);
app.route('/api', conversationsRoute);
app.route('/api', chatRoute);
app.route('/api', settingsRoute);
app.route('/api', memoriesRoute);
// mock 端点仅限开发环境，不随生产构建暴露
if (process.env.NODE_ENV !== 'production') {
  app.route('/api', devMockChatRoute);
}

try {
  const llm = loadLlmConfig();
  console.log(`LLM ready: ${llm.baseUrl} / ${llm.model}`);
} catch (error) {
  console.warn(`[warn] ${error instanceof Error ? error.message : String(error)}`);
}

const config = loadServerConfig();

const dbConfig = loadDbConfig();
const db = getDb();
runMigrations(db, dbConfig.migrationsFolder);
ensureMemorySearchIndex(db);
seedDefaultData(db, new Date().toISOString());
console.log(`Database ready (migrations + seed applied): ${db.databasePath}`);

serve(
  { fetch: app.fetch, hostname: '127.0.0.1', port: config.port },
  (info) => {
    console.log(`Aiko server listening on http://127.0.0.1:${info.port}`);
  },
);