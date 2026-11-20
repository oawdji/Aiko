import Database from 'better-sqlite3';
const db = new Database('D:/code/ai/data/agent.sqlite', { readonly: true });
const rows = db.prepare(`
  SELECT m.id, m.conversation_id, m.role, m.content, m.status, m.created_at, m.error_code, m.metadata_json
  FROM messages m
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 40
`).all().reverse();
for (const r of rows) {
  const tag = r.status !== 'complete' ? ' [' + r.status + (r.error_code ? '/' + r.error_code : '') + ']' : '';
  const meta = r.metadata_json ? ' ' + r.metadata_json : '';
  console.log('--- ' + r.created_at + ' ' + r.role + tag + meta);
  console.log((r.content || '').slice(0, 400));
}
db.close();