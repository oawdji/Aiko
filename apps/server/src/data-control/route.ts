import { Hono } from 'hono';
import { getDb } from '../db';
import { deleteAllData, exportAllData } from './service';

/**
 * 数据控制接口（api-contract §6.7）：
 * GET /api/export / DELETE /api/data。
 * 本地单用户无鉴权；DELETE 是破坏性操作，前端必须显式确认。
 */
export const dataControlRoute = new Hono()
  .get('/export', (c) => c.json(exportAllData(getDb())))
  .delete('/data', (c) => c.json(deleteAllData(getDb())));
