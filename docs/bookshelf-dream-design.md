
# 书架·共读·梦境 设计文档

版本：v1（设计稿，未实现）
日期：2026-11-20
状态：Phase A / B / C 设计完成，待实施
关联文档：[memory-emotion-design.md](./archive/memory-emotion-design.md)、[semantic-retrieval-plan.md](./archive/semantic-retrieval-plan.md)、[persona-core.md](./persona-core.md)、[database-schema.md](./database-schema.md)

> 调研参考：
> - [wave2234/dream-system](https://github.com/wave2234/dream-system) —— AI 伴侣 REM 做梦层（会失败/素材真实/隔离蒸发）
> - [SilviaYue/dreamvault](https://github.com/SilviaYue/dreamvault) —— 梦，归本人：幻觉治理而非删除
> - [hanamorix/companion-emergence](https://github.com/hanamorix/companion-emergence) —— 本地伴侣框架（做梦/精力节律）
> - [racode246/leafbound](https://github.com/racode246/leafbound) —— EPUB 阅读器 + AI 陪读（位置感知/引用跳转）
> - [zhihao22233-cpu/zhidu-reader](https://github.com/zhihao22233-cpu/zhidu-reader) —— 《如何阅读一本书》四层次陪读方法论
> - [maniac8/galgame-emotion-agent](https://github.com/maniac8/galgame-emotion-agent) —— 多维关系状态机（含负面维度/冲突修复）

---

## 0. 目标与设计哲学

三个功能共同构成 Aiko 的"内心生活"外部化：

1. **梦境**：她的梦不是当场编造的，而是**从她的真实记忆中生成、有记录、有出处、会失败、只讲述一次**的产物（参考 dream-system 三原则 + DreamVault"梦归本人"）。
2. **书架**：她的"阅读记忆"**只来自用户放入书架的书**——书架之外坦率承认没读过。知识边界由"书架列表注入 + 检索限定 + 指令约束"三层实现（与 SillyTavern World Info / Data Bank 同思路）。
3. **共读**：她陪用户读书，**记得读到哪了**，基于当前内容 + 全书检索 + 划线讨论；讨论深度随关系阶段变化（参考 zhidu-reader 四层次）。

设计红线（继承项目哲学）：
- 梦**不污染记忆**：梦不进 memories 检索、不被提炼成事实、不混入聊天记录（dream-system 不变量 3 / DreamVault"治理梦游不治梦"）；
- 梦与日记**归本人**：用户可见可删，但不因"不真实"而被清除；
- 书架知识边界是**软约束**：LLM 预训练知识无法物理删除，采用"书架注入 + 检索限定 + 指令"三层约束，对叙述层足够；
- 所有 LLM 调用失败一律静默降级，不影响聊天主流程。

---

## 1. Phase A：书架（基础设施）

### 1.1 数据模型（迁移 0009）

```sql
books:
  id text PK                       -- book_<uuid>
  agent_id text NOT NULL FK agents(cascade)
  title text NOT NULL              -- 书名（用户填或从文件名解析）
  author text                      -- 可空
  format text NOT NULL             -- 'txt' | 'epub'
  file_path text NOT NULL          -- data/books/<book_id>/source.<ext>
  status text NOT NULL DEFAULT 'processing'   -- processing | ready | failed
  total_chunks integer NOT NULL DEFAULT 0
  created_at / updated_at text NOT NULL
```

向量入库：**复用 services/retrieval**，扩展 CLI 协议支持 collection 参数
（index/search 增加 collection 字段；默认 'memory'，书架用 'book:<bookId>'）。
Python 服务不可用时降级为 FTS-only（与 memories 同约定）。
FTS5 全文索引：book_chunks_fts 与 memories_fts 同模式，触发器同步。

### 1.2 解析管线

- TXT：UTF-8 读取（v1 限制，GBK 后续）；章节正则识别（第X章/卷/回），无章节标记则按 1000 字切块；
- EPUB：引入服务端解析库（候选 epub2），抽取 spine 文本按目录章节切分，图片跳过；
- 切块规则：章节内 800~1200 字切块，段落边界优先；每块记录 chapter + chunk_index；
- 状态机：processing（解析+切块+入 FTS）→ ready（可读）/ failed；
- 向量入库：ready 后异步批量（每块 embed → collection 'book:<id>'），失败降级 FTS-only。

### 1.3 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/books/upload | multipart 上传（file + 可选 title/author）→ 创建 book（processing）→ 异步解析 |
| GET | /api/books | 列表（status/totalChunks/title/author），created_at 倒序 |
| GET | /api/books/:id | 详情（含章节目录） |
| DELETE | /api/books/:id | 删除书 + 级联 chunks + 向量 collection 清理 |
| GET | /api/books/:id/chunks?chapter=&limit=&offset= | 分块读取（共读用） |

错误码：BOOK_PARSE_FAILED、BOOK_NOT_FOUND、INVALID_REQUEST。

### 1.4 知识边界（三层约束）

1. **书架注入**：新内置 ContextContributor builtin.bookshelf（order 25，记忆块之前）注入：

```
### 你的书架
你的阅读记忆仅来自这些书：《书名A》（作者X）、《书名B》……
书架之外的书你没有读过——被问到时坦率承认没读过，可以说"放进书架我们一起读"。
讨论书架内的书时，以书中实际内容为准，不编造情节和引文。
```

2. **检索限定**：聊书相关内容时，引用只来自 book_chunks（FTS / 向量 collection 'book:*'）；
3. **诚实边界**：LLM 预训练知识无法物理删除——本设计约束的是她的叙述（读过什么、引用什么），
   对冷门书与架空作品完全可靠，对著名作品依赖指令遵循（同类项目通行做法）。

### 1.5 事件

book_added / book_removed（agentId, bookId, title）发布到事件总线。

### 1.6 测试计划

- 解析：TXT 有章节/无章节/超长块切分；EPUB 目录抽取；GBK 降级提示；
- 状态机：processing → ready；解析失败 → failed；
- FTS 检索：关键词命中正确 chunk；collection 向量检索（Python 可用时）；
- 删除：级联 chunks + FTS + 向量 collection；
- API 契约测试。

---

## 2. Phase B：共读

### 2.1 数据模型（迁移 0010）

```sql
reading_sessions:
  id text PK                       -- rsess_<uuid>
  agent_id text NOT NULL FK agents(cascade)
  book_id text NOT NULL FK books(cascade)
  status text NOT NULL DEFAULT 'active'   -- active | finished | abandoned
  chunk_cursor integer NOT NULL DEFAULT 0     -- 下一个要读的 chunk index
  started_at / updated_at text NOT NULL
  UNIQUE (book_id)                 -- 一本书同时只有一个进行中 session（重读 = 重置 cursor）
```
```sql
reading_notes:
  id text PK                       -- note_<uuid>
  agent_id text NOT NULL FK agents(cascade)
  book_id text NOT NULL FK books(cascade)
  chunk_index integer NOT NULL
  quote text NOT NULL              -- 划线原文
  note text                        -- 评语/感想（她或用户）
  author text NOT NULL             -- 'user' | 'aiko'
  created_at text NOT NULL
```

### 2.2 共读流程

1. **开始/恢复**：POST /api/reading/sessions { bookId } → 创建（或恢复已有 session），
   返回 book + chunk_cursor + 最近读过的 1~2 块（恢复上下文）；
2. **翻页**：POST /api/reading/sessions/:id/next { count? }：
   - 返回接下来的块内容；
   - 异步生成她的即时感想（LLM：块内容 + 前 2 块摘要 + 关系维度 + 当前情绪 → 第一人称 2~3 句；
     失败静默无感想），感想以 author='aiko' 写入 reading_notes；
   - cursor 推进；读到末块 → session.status = finished；
3. **划线**：POST /api/reading/sessions/:id/notes { chunkIndex, quote, note? } → author='user'；
4. **聊天中聊书**：共读进行中，contributor builtin.reading-session（order 8）注入：
   当前书名 + 章节 + 最近读过的块摘要 + 她的最近感想；
5. **全书检索**：用户消息与书内容相关时（关键词/书名命中），book_chunks FTS/向量检索注入
   （contributor builtin.book-retrieval，order 35）；
6. **进度记忆**：cursor + 最近 notes 即"她记得你们读到哪了"；共读中的对话也可被事实抽取。

### 2.3 讨论深度随关系阶段（zhidu-reader 四层次映射）

| 关系阶段 | 她的陪读方式 |
|---|---|
| 初识 | 复述性回应：这段讲了什么 + 一句直白感想 |
| 熟络 | 情节讨论：角色动机、猜后续、"如果是你会怎么选" |
| 老友 | 主题探讨：与你们共同经历的联系、她自己的解读、可能观点相左 |

（由 relationship dimensions 注入的既有指引自然覆盖，共读感想 prompt 附带关系维度。）

### 2.4 API（补）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/reading/sessions | { bookId } → 创建/恢复 session |
| GET | /api/reading/sessions/active | 当前进行中共读（书 + 进度 + 最近笔记） |
| POST | /api/reading/sessions/:id/next | 推进读取（返回块 + 异步她感想） |
| POST | /api/reading/sessions/:id/notes | 用户划线 |
| GET | /api/reading/sessions/:id/notes | 笔记列表 |
| POST | /api/reading/sessions/:id/finish | 标记读完（写一条 episode 记忆："我们一起读完了《xxx》"） |

错误码：SESSION_NOT_FOUND、BOOK_NOT_READY、SESSION_ALREADY_FINISHED。

### 2.5 UI（前端）

- 书架面板（📖 旁新增 📚）：封面/标题列表 + 上传按钮 + 删除；
- 共读视图：正文流式块 + 她的感想气泡 + 划线交互 + "下一页"按钮；
- 划线列表：书架详情页查看。

### 2.6 测试计划

- session 创建/恢复/唯一约束；cursor 推进与末块 finished；
- 她感想：生成成功落 notes / 失败静默；
- 划线 CRUD；finished → 写 episode 记忆；
- contributor：共读中聊天注入书名/章节/感想；
- 门控与降级：BOOK_NOT_READY 拒绝开 session。

---

## 3. Phase C：梦境

### 3.1 设计原则（对齐调研结论）

| 来源 | 采用的原则 |
|---|---|
| dream-system | 梦可以不发生（服务端掷骰）；素材从真实记忆取（不由模型挑）；梦与记忆隔离；同人格生成 |
| DreamVault | 梦归本人——梦不因"无真实出处"被删除，但治理它"梦游"进记忆 |
| 认知科学 | 梦是记忆重组：素材 = 真实记忆的再加工 → 梦永远有真实出处 |

### 3.2 数据模型（迁移 0011）

```sql
dreams:
  id text PK                       -- dream_<uuid>
  agent_id text NOT NULL FK agents(cascade)
  dream_date text NOT NULL         -- 梦所属的"夜"（本地 YYYY-MM-DD）
  content text NOT NULL            -- 梦的叙述（第一人称，150~300 字）
  mood json NOT NULL               -- 生成时 PAD 快照
  source_memory_ids text NOT NULL DEFAULT '[]'   -- 素材记忆 id（溯源）
  surfaced_at text                 -- 梦痕浮出时间（单次消费；NULL = 从未讲过）
  created_at text NOT NULL

  UNIQUE (agent_id, dream_date)    -- 每晚最多一个梦
```

### 3.3 生成机制（惰性，同日记模式）

- **触发**：次日首次 bootstrap，检查"昨晚"（昨天本地日期）：
  - 已有 dream → 跳过（每夜最多一个）；
  - 昨日消息 < 5 条 → 跳过（没有素材的日子不做梦）；
  - **服务端掷骰**：基础概率 0.5；昨日负面情绪事件占比上调（低落/焦虑日 +0.2）；
- **素材抽取**：从 memories 随机抽 2~4 条，权重 = strength × (1 + |情绪值|)，
  允许抽到"我们一起读的书"相关 episode（她梦到书里的情节——真实出处）；
- **生成**：PERSONA_CORE_MD（同人格不变量）+ 睡眠配置 prompt：
  "以第一人称写一段 150~300 字的梦。元素必须来自给定素材（人、事、物、情绪），
   可以荒诞、跳跃、重组，但不要引入素材之外的现实事件。"
- **落库**：content + mood + source_memory_ids + surfaced_at=NULL；
- **失败**：LLM 失败 → 不落库，下次 bootstrap 重试（同日记）。

### 3.4 隔离不变量（五条，写死在实现注释里）

1. dreams 不进 memories 检索 / FTS / 语义向量；
2. dreams 不进 prompt 注入（除梦痕）；
3. 事实抽取不处理梦内容（scheduleFactExtraction 不感知 dreams）；
4. 梦痕单次消费：surfaced_at 标记后不再浮出；
5. 梦不自动进日记正文（梦境独立分区展示）。

### 3.5 梦痕（她"说"出来）

- **浮出条件**：trust ≥ 0.5 或 closeness ≥ 0.6（对齐锚点"熟悉之后才聊害怕和梦"）；
  不满足则梦保留但不浮出（她做了但没说——梦归本人）；
- **浮出方式**：对话注入（contributor builtin.dream-echo，order 12，情绪行之后）：
  "昨晚做了个梦……<content 一句话摘要>"——只注入一次，
  注入时标记 surfaced_at；之后不再注入（除非用户主动问）；
- **用户主动问**："你昨晚做梦了吗 / 梦到什么" → 检索最近 dreams（过期的也算——真实记录永久保留），
  她讲述 stored content 原文，并附溯源（"梦里那个厨房，是因为你说过在学做饭"——透明）。

### 3.6 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/dreams?limit=&offset= | 梦境记录列表（倒序，含 source_memory_ids） |
| GET | /api/dreams/:id | 单条（含溯源记忆内容） |
| DELETE | /api/dreams/:id | 删除（梦归本人，用户有权删除） |

错误码：DREAM_NOT_FOUND。

### 3.7 UI

- 日记面板新增「梦境」分区：列表（日期 + 摘要 + 情绪 emoji）+ 全文 + 溯源记忆引用 + 删除；
- 对话中：她浮出梦痕时就是一条普通 assistant 消息（自然）。

### 3.8 测试计划

- 掷骰：概率边界（mock 随机数）；昨日无消息 → 不生成；
- 生成：素材记忆 → content 引用元素；mood 快照；source_memory_ids 正确；
- 隔离：dream 不进 memories 检索结果、不被事实抽取；
- 梦痕：浮出条件（trust/closeness 阈值）；surfaced 单次；过期后仍可被用户问出；
- API：列表/详情/删除/404；
- 事件：dream_created 发布。

### 3.9 成本

每梦一次 LLM 调用（输入素材 ~500 token + 输出 ~300 token），每晚最多一次；
不掷中则为零。日均成本可忽略。

---

## 4. 实施顺序与里程碑

| Phase | 内容 | 依赖 | 预估 |
|---|---|---|---|
| A | 书架：迁移 0009（books/book_chunks/FTS）+ 上传解析 + 书架注入 + API + 测试 | services/retrieval collection 扩展 | 1 个迭代 |
| B | 共读：迁移 0010（sessions/notes）+ 读写 API + 2 个 contributor + 共读 UI | Phase A | 1 个迭代 |
| C | 梦境：迁移 0011（dreams）+ 惰性生成 + 隔离 + 梦痕注入 + 梦境分区 UI | 无（独立） | 1 个迭代 |

建议实施顺序：A → B → C（书架是共读地基；梦境独立，可穿插）。

---

## 5. 风险与开放问题

| 风险/问题 | 应对 |
|---|---|
| EPUB 解析依赖较重 | v1 先 TXT；EPUB 引入轻量解析库，失败降级提示 |
| LLM 预训练"剧透"名著 | 软约束（书架注入+指令）；对冷门/架空内容完全可靠；已知名著存在少量剧透风险，文档声明 |
| 梦痕浮出打扰用户 | 浮出条件绑定关系维度（trust/closeness）+ 浮出掷骰（0.7），避免每早都讲梦 |
| 关系维度低时梦长期不浮出 | 梦归本人——记录永久保留，用户随时可在梦境分区看到；她"做过但没说"是合理的 |
| 共读长文本 token 成本 | 按块推进（每块 ~1000 字）+ 感想 max_tokens 限制；全书检索仅在相关时触发 |
| 事件分类/生成与聊天共享 LLM 配置 | 复用 resolveEffectiveLlmSettings；未来可加"轻量模型"配置项 |
