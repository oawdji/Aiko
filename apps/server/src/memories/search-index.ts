import type { DbHandle } from '../db/client';

/**
 * FTS5 全文索引（memory-emotion-design.md §5，sim_sem 本期实现）。
 * 默认 unicode61 分词器不切 CJK，因此写入索引前用 normalizeForFts 在连续汉字间插入空格。
 * FTS 同步由 repository 在写路径维护（本期无物理删除，软删记录由检索的 status 过滤排除）。
 */

const CJK = /([\u4e00-\u9fff])(?=[\u4e00-\u9fff])/g;

/** 连续汉字两两插入空格，使每个字符成为独立 token；非 CJK 内容不变。 */
export function normalizeForFts(text: string): string {
  return text.replace(CJK, '$1 ');
}

export function ensureMemorySearchIndex(handle: DbHandle): void {
  handle.sqlite.exec(
    'CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, memory_id UNINDEXED)',
  );
}
