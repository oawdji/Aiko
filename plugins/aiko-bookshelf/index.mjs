import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const CHAPTER_RE = /^(第[一二三四五六七八九十百千零0-9]+[章卷回节部]|序章|序言|楔子|尾声|后记|CHAPTER\s+[0-9IVXLC]+).*$/im;
const CHUNK_TARGET = 1000;

export function install(api) {
  const dataBooksDir = path.join(api.dataDir, "books");
  mkdirSync(dataBooksDir, { recursive: true });

  const getAgentId = () => {
    const row = api.db.sqlite.prepare("SELECT value_json FROM app_settings WHERE key = 'default_agent_id'").get();
    if (!row) return "agent-default";
    try { return JSON.parse(row.value_json); } catch { return "agent-default"; }
  };

  api.db.sqlite.exec([
    "CREATE TABLE IF NOT EXISTS books (",
    "  id TEXT PRIMARY KEY,",
    "  agent_id TEXT NOT NULL,",
    "  title TEXT NOT NULL,",
    "  author TEXT,",
    "  format TEXT NOT NULL,",
    "  file_path TEXT NOT NULL,",
    "  status TEXT NOT NULL DEFAULT 'processing',",
    "  total_chunks INTEGER NOT NULL DEFAULT 0,",
    "  created_at TEXT NOT NULL,",
    "  updated_at TEXT NOT NULL,",
    "  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE",
    ");",
    "CREATE TABLE IF NOT EXISTS book_chunks (",
    "  id TEXT PRIMARY KEY,",
    "  book_id TEXT NOT NULL,",
    "  chunk_index INTEGER NOT NULL,",
    "  chapter TEXT,",
    "  content TEXT NOT NULL,",
    "  UNIQUE (book_id, chunk_index),",
    "  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE",
    ");",
    "CREATE VIRTUAL TABLE IF NOT EXISTS book_chunks_fts USING fts5(",
    "  content, chapter, book_id UNINDEXED, chunk_index UNINDEXED",
    ");",
  ].join("\n"));

  // ---- TXT / EPUB 解析 ----
  function parseTxt(buf) {
    const text = buf.toString("utf-8");
    const lines = text.split(/\r?\n/);
    const chapters = [];
    let cur = { title: null, lines: [] };
    for (const line of lines) {
      if (CHAPTER_RE.test(line.trim())) {
        if (cur.lines.some((l) => l.trim())) chapters.push(cur);
        cur = { title: line.trim(), lines: [] };
      } else {
        cur.lines.push(line);
      }
    }
    if (cur.lines.some((l) => l.trim())) chapters.push(cur);
    return chapters.length > 0 ? chapters : [{ title: null, lines }];
  }

  function parseEpub(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("epub: zip EOCD not found");
    const count = buf.readUInt16LE(eocd + 10);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    const entries = new Map();
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) break;
      const method = buf.readUInt16LE(p + 10);
      const csize = buf.readUInt32LE(p + 20);
      const nameLen = buf.readUInt16LE(p + 28);
      const extraLen = buf.readUInt16LE(p + 30);
      const commentLen = buf.readUInt16LE(p + 32);
      const lho = buf.readUInt32LE(p + 42);
      const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf-8");
      entries.set(name, { method, csize, lho });
      p += 46 + nameLen + extraLen + commentLen;
    }
    const readEntry = (name) => {
      const e = entries.get(name);
      if (!e) throw new Error("epub: missing " + name);
      const lho = e.lho;
      const nameLen = buf.readUInt16LE(lho + 26);
      const data = buf.slice(lho + 30 + nameLen, lho + 30 + nameLen + e.csize);
      return e.method === 0 ? data : inflateRawSync(data);
    };
    const container = readEntry("META-INF/container.xml").toString("utf-8");
    const opfPath = container.match(/full-path="([^"]+)"/)?.[1];
    if (!opfPath) throw new Error("epub: rootfile not found");
    const opfDir = path.posix.dirname(opfPath);
    const opf = readEntry(opfPath).toString("utf-8");
    const manifest = new Map();
    for (const m of opf.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"[^>]*/g)) manifest.set(m[1], m[2]);
    const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((m) => m[1]);
    const decode = (s) => s
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, String.fromCharCode(34)).replace(/&#39;/g, String.fromCharCode(39)).replace(/&nbsp;/g, " ");
    const chapters = [];
    for (const idref of spine) {
      const href = manifest.get(idref);
      if (!href) continue;
      const htmlPath = decodeURIComponent(path.posix.join(opfDir, href));
      let html;
      try { html = readEntry(htmlPath).toString("utf-8"); } catch { continue; }
      const title = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/)?.[1];
      const text = decode(
        html
          .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
          .replace(/<[^>]+>/g, "\n"),
      ).replace(/\n{3,}/g, "\n\n").trim();
      if (text) chapters.push({ title: decode((title || "").trim()) || null, lines: text.split("\n") });
    }
    if (chapters.length === 0) throw new Error("epub: no text content");
    return chapters;
  }
  function chunkChapters(chapters) {
    const chunks = [];
    let idx = 0;
    for (const ch of chapters) {
      const paras = ch.lines.filter((l) => l.trim());
      let buf = [];
      let size = 0;
      const flush = () => {
        if (buf.length === 0) return;
        chunks.push({ index: idx++, chapter: ch.title, content: buf.join("\n").trim() });
        buf = [];
        size = 0;
      };
      for (const para of paras) {
        buf.push(para);
        size += para.length;
        if (size >= CHUNK_TARGET) flush();
      }
      flush();
    }
    if (chunks.length >= 2) {
      const last = chunks[chunks.length - 1];
      if (last.content.length < 200) {
        const prev = chunks[chunks.length - 2];
        prev.content += "\n" + last.content;
        chunks.pop();
      }
    }
    return chunks;
  }

  function insertChunks(bookId, chunks) {
    const ins = api.db.sqlite.prepare(
      "INSERT INTO book_chunks (id, book_id, chunk_index, chapter, content) VALUES (?, ?, ?, ?, ?)"
    );
    const fts = api.db.sqlite.prepare(
      "INSERT INTO book_chunks_fts (content, chapter, book_id, chunk_index) VALUES (?, ?, ?, ?)"
    );
    const insertAll = api.db.sqlite.transaction((list) => {
      for (const ch of list) {
        const id = "bkchunk_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        ins.run(id, bookId, ch.index, ch.chapter, ch.content);
        fts.run(ch.content, ch.chapter, bookId, ch.index);
      }
    });
    insertAll(chunks);
  }

  async function indexVectors(bookId, chunks) {
    const client = api.memory.getSharedMemoryClient();
    if (typeof client.indexItems !== "function") return;
    const items = chunks.map((ch) => ({ id: bookId + ":" + ch.index, text: ch.content }));
    await client.indexItems("book:" + bookId, items);
  }
  function setStatus(bookId, status, totalChunks) {
    api.db.sqlite
      .prepare("UPDATE books SET status = ?, total_chunks = COALESCE(?, total_chunks), updated_at = ? WHERE id = ?")
      .run(status, totalChunks ?? null, new Date().toISOString(), bookId);
  }
  async function processBook(bookId, filePath, format) {
    try {
      const buf = readFileSync(filePath);
      const chapters = format === "epub" ? parseEpub(buf) : parseTxt(buf);
      const chunks = chunkChapters(chapters);
      insertChunks(bookId, chunks);
      setStatus(bookId, "ready", chunks.length);
      await indexVectors(bookId, chunks).catch(() => {});
    } catch (error) {
      setStatus(bookId, "failed", null);
      console.warn("[aiko-bookshelf] parse failed:", error instanceof Error ? error.message : error);
    }
  }  api.contextContributorRegistry.register({
    id: "aiko-bookshelf.shelf",
    description: "书架 + 知识边界：她的阅读记忆只来自书架",
    order: 25,
    contribute() {
      const agentId = getAgentId();
      const books = api.db.sqlite
      .prepare("SELECT title, author FROM books WHERE agent_id = ? AND status = 'ready' ORDER BY created_at DESC")
      .all(agentId);
      // reading_sessions 属于 Phase B（共读），表可能尚不存在——降级为无共读
      let active = null;
      try {
        active = api.db.sqlite
        .prepare("SELECT b.title AS title, s.chunk_cursor AS cursor FROM reading_sessions s JOIN books b ON b.id = s.book_id WHERE s.agent_id = ? AND s.status = 'active'")
        .get(agentId);
      } catch {}
      if (books.length === 0 && !active) return null;
      const lines = ["### 你的书架"];
      if (books.length > 0) {
        lines.push("你的阅读记忆仅来自这些书：" + books.map((b) => "《" + b.title + "》" + (b.author ? "（" + b.author + "）" : "")).join("、"));
        lines.push("书架之外的书你没有读过——被问到时坦率承认没读过，可以说\"放进书架我们一起读\"。讨论书架内的书时，以书中实际内容为准，不编造情节和引文。");
      } else {
        lines.push("你的书架还是空的——你没有读过任何书，被问到时坦率承认。");
      }
      if (active) {
        lines.push("你们正在共读《" + active.title + "》，已读到第 " + (active.cursor + 1) + " 段。");
      }
      return lines.join("\n");
    },
  });  const router = api.createRouter();
  const respondErr = (c, code, message, status) => c.json({ code, message }, status);
  router.post("/books/upload", async (c) => {
    try {
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File)) return respondErr(c, "INVALID_REQUEST", "file is required", 400);
      const lower = file.name.toLowerCase();
      const ext = lower.endsWith(".epub") ? "epub" : lower.endsWith(".txt") ? "txt" : null;
      if (!ext) return respondErr(c, "INVALID_REQUEST", "only .txt / .epub supported", 400);
      const agentId = getAgentId();
      const id = "book_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      const dir = path.join(api.dataDir, "books", id);
      mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, "source." + ext);
      writeFileSync(filePath, Buffer.from(await file.arrayBuffer()));
      const now = new Date().toISOString();
      const title = file.name.replace(/\.(txt|epub)$/i, "");
      api.db.sqlite
      .prepare("INSERT INTO books (id, agent_id, title, author, format, file_path, status, total_chunks, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, 'processing', 0, ?, ?)")
      .run(id, agentId, title, ext, filePath, now, now);
      setImmediate(() => { void processBook(id, filePath, ext); });
      const row = api.db.sqlite.prepare("SELECT * FROM books WHERE id = ?").get(id);
      return c.json({ ok: true, book: { id: row.id, title: row.title, author: row.author, format: row.format, status: row.status, totalChunks: row.total_chunks, createdAt: row.created_at, updatedAt: row.updated_at } }, 201);
    } catch (error) {
      return respondErr(c, "BOOK_PARSE_FAILED", error instanceof Error ? error.message : "upload failed", 500);
    }
  });
  router.get("/books", (c) => {
    const rows = api.db.sqlite.prepare("SELECT * FROM books ORDER BY created_at DESC").all();
    return c.json({ books: rows.map((r) => ({ id: r.id, agentId: r.agent_id, title: r.title, author: r.author, format: r.format, status: r.status, totalChunks: r.total_chunks, createdAt: r.created_at, updatedAt: r.updated_at })) });
  });
  router.get("/books/:id", (c) => {
    const row = api.db.sqlite.prepare("SELECT * FROM books WHERE id = ?").get(c.req.param("id"));
    if (!row) return respondErr(c, "BOOK_NOT_FOUND", "book not found", 404);
    const chapters = api.db.sqlite
    .prepare("SELECT DISTINCT chapter FROM book_chunks WHERE book_id = ? AND chapter IS NOT NULL ORDER BY chunk_index")
    .all(row.id)
    .map((r) => r.chapter);
    return c.json({ book: { id: row.id, title: row.title, author: row.author, format: row.format, status: row.status, totalChunks: row.total_chunks, chapters, createdAt: row.created_at, updatedAt: row.updated_at } });
  });
  router.get("/books/:id/chunks", (c) => {
    const q = c.req.query();
    const limit = Math.min(Math.max(Number(q.limit ?? 20), 1), 200);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const rows = api.db.sqlite
    .prepare("SELECT chunk_index, chapter, content FROM book_chunks WHERE book_id = ? ORDER BY chunk_index LIMIT ? OFFSET ?")
    .all(c.req.param("id"), limit, offset);
    return c.json({ chunks: rows.map((r) => ({ index: r.chunk_index, chapter: r.chapter, content: r.content })) });
  });
  router.delete("/books/:id", (c) => {
    const id = c.req.param("id");
    const row = api.db.sqlite.prepare("SELECT file_path FROM books WHERE id = ?").get(id);
    if (!row) return respondErr(c, "BOOK_NOT_FOUND", "book not found", 404);
    api.db.sqlite.prepare("DELETE FROM books WHERE id = ?").run(id);
    api.memory.getSharedMemoryClient().removeCollection?.("book:" + id);
    rmSync(path.join(api.dataDir, "books", id), { recursive: true, force: true });
    return c.json({ ok: true, deletedAt: new Date().toISOString() });
  });
  api.mount("/api", router);
}