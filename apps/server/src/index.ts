import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRoute } from './api/health';
import { loadServerConfig } from './config/server';

const app = new Hono();

app.use(
  '/api/*',
  cors({
    origin: ['http://127.0.0.1:5173', 'http://localhost:5173'],
  }),
);

app.route('/api', healthRoute);

const config = loadServerConfig();

serve(
  { fetch: app.fetch, hostname: '127.0.0.1', port: config.port },
  (info) => {
    console.log(`Aiko server listening on http://127.0.0.1:${info.port}`);
  },
);