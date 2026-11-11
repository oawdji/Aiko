import { Hono } from 'hono';
import { getDb } from '../db';

export const healthRoute = new Hono().get('/health', (c) => {
  try {
    const db = getDb();
    db.sqlite.prepare('SELECT 1 AS ok').get();

    return c.json({
      status: 'ok',
      service: 'aiko-server',
      db: 'ok',
      time: new Date().toISOString(),
    });
  } catch (error) {
    return c.json(
      {
        status: 'error',
        service: 'aiko-server',
        db: 'error',
        message: error instanceof Error ? error.message : String(error),
      },
      503,
    );
  }
});