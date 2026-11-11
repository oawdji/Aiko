import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRoute } from './api/health';
import { devMockChatRoute } from './api/dev-mock-chat';
import { loadServerConfig } from './config/server';
import { loadLlmConfig } from './config/llm';
import { getDb } from './db';

const app = new Hono();

app.use(
  '/api/*',
  cors({
    origin: ['http://127.0.0.1:5173', 'http://localhost:5173'],
  }),
);

app.route('/api', healthRoute);
app.route('/api', devMockChatRoute);

try {
  const llm = loadLlmConfig();
  console.log(`LLM ready: ${llm.baseUrl} / ${llm.model}`);
} catch (error) {
  console.warn(`[warn] ${error instanceof Error ? error.message : String(error)}`);
}

const config = loadServerConfig();

const db = getDb();
console.log(`Database ready: ${db.databasePath}`);

serve(
  { fetch: app.fetch, hostname: '127.0.0.1', port: config.port },
  (info) => {
    console.log(`Aiko server listening on http://127.0.0.1:${info.port}`);
  },
);