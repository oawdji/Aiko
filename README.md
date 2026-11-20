# Aiko

> 本地单用户拟人化聊天 Agent —— 稳定人格、分层记忆、可感知的情绪状态。

Aiko 是一个运行在本地的对话角色。她不是"带聊天框的工具"，而是一个连续存在的角色：有稳定的人格锚点，有随对话缓慢变化、可解释可追溯的情绪，有跨会话的长期记忆。所有数据保存在本机，对用户完全透明、可修正、可删除。

项目状态：**规划功能已全部完成**（对话 / 情绪 / 记忆 / 人格 / 主动行为），441 个测试全绿，可日常使用。

## 功能特性

### 对话

- **真实流式对话**：OpenAI 兼容端点（默认 DeepSeek），UIMessage Stream 协议；
- **分层上下文**：最近 30 条消息进入窗口，滑出窗口的内容由会话摘要自动回顾注入 system prompt，长对话不丢语境；
- **会话恢复**：刷新后自动恢复最近会话与消息，顺序严格按插入序（同毫秒 `rowid` 兜底）；
- **幂等提交**：`clientMessageId` 唯一约束，重复提交返回 409 并自动刷新会话；
- **对话管理**：侧边栏一键新建会话、多会话切换、删除单个会话与一键清空全部（两步确认）；`n- **重新生成 / 重试**：最后一条回复支持一键重新生成（LLM 失败的占位消息同样走该入口重试），不重复计入情绪与记忆；删除会话会移除消息、状态事件、摘要与 Prompt 快照，长期记忆保留（来源链接自动解除）。

### 情绪状态

- **PAD 三维情绪模型**（愉悦度 / 唤醒度 / 支配度）：每轮聊天前由小 LLM 独立抽取情绪（max_tokens≈50，失败降级为无事件，不阻断聊天），服务端换算为 PAD 增量（±0.3 截断），6 分区离散标签；
- **OU 时间衰减**：情绪随时间向角色气质基线回归（角色级半衰期参数，全局默认 6 小时）；状态面板支持**手动重置回基线**（写入 manual 事件，可追溯）；`n- **多元关系（成长体验）**：关系不是线性阶段，而是 7 个独立维度——信任/熟悉/亲密/乐趣/依赖 + 负面维度 紧张/心结。**LLM 只判事件（深入分享/冲突/道歉/有趣互动等），数值由确定性规则表应用**（防模型自刷分），单日变化上限防刷；冲突后会真的有隔阂，需要道歉修复。事件识别支持"质重于量"——聊 10 轮交心胜过 100 轮闲聊。状态面板展示各维度与她的自省理由；
- **日记**：惰性生成——bootstrap 时自动补写昨天的日记（基于当日对话与情绪记录的第一人称回顾，LLM 失败静默重试，一天一篇幂等）；日记 API 已就绪（GET/DELETE /api/diary），独立面板展示即将到来；
- **可解释可追溯**：每次状态变化落库为带版本号的事件，原因、证据、置信度全部可见；状态面板与时间线实时展示因果链；
- **Prompt 注入**：当前情绪注入 system prompt 影响语气；环境变量 `EMOTION_ENGINE=off` 可整体关闭。

### 长期记忆

- **事实抽取**：用户消息经 LLM 结构化抽取为原子事实（置信度 < 0.7 进入待确认），写入时记录当次 PAD 坐标与唤醒度；
- **情感化检索**：按 `语义 + 情感一致性 + 时间邻近` 加权排序（0.6 / 0.3 / 0.1），Top-5 注入 system prompt；
- **记忆生命周期**：幂律遗忘只降权不删除（半衰期 = 基础值 × (1 + 唤醒度)），被检索的记忆获得再巩固强化；
- **会话摘要**：每 30 条消息异步生成（幂等可重试），并自动注入后续对话（见"分层上下文"）；
- **记忆透明**：🧠 记忆查看器支持状态/类型筛选、关键词搜索、来源消息定位、置信度与保留强度展示，以及确认 / 拒绝 / 编辑 / 删除 / 清空全部；删除后不再进入 Prompt 与检索；「会话摘要」分区让阶段性回顾可见可删（删除后不再注入对话）。

### 人格

- **锚点版本化**：人格锚点（PERSONA_CORE）不可被聊天内容或 Prompt 注入篡改；用户可在人格面板手动编辑锚点正文，新版本生效、可回滚，启动时校验正文与 hash 自洽；
- **受控演化**：表达风格调整经过"提案 → diff → 用户确认"流程，版本化生效；
- **完全自定义**：初始人格只是种子（[docs/persona-core.md](docs/persona-core.md)），运行后在面板中改成任何你喜欢的角色。

### 主动行为（默认关闭）

- 空闲 ≥ 阈值时她可能主动发来一条消息，策略按优先级选择：**情绪关怀**（上次负面情绪 ≥24h 未跟进）→ **记忆回想**（≥7 天未访问的旧记忆）→ **好奇提问**；
- 治理：滚动 24h 上限、最小间隔、免打扰时段，全部可调；
- 仅页面打开期间触发，被抑制不补发。

### 设置与数据

- **LLM 设置面板**：页面右上角 ⚙ 打开，Base URL / 模型 / API Key 页面内填写、保存热生效；Key 只写不读，任何响应仅回显掩码后四位；一键真实连通性测试（含延迟）；
- **调试模式**：`app_settings.debug_mode` 开启后记录每次聊天的 Prompt 快照（system、命中记忆、窗口条数）；
- **数据控制**：`GET /api/export` 全量导出（已删除记忆仅保留审计不含内容）、`DELETE /api/data` 单事务清空用户数据并重置情绪状态（人格锚点与设置保留）。

## 技术栈

```text
前端：React 18 + TypeScript + Vite + Tailwind CSS v4
后端：Node.js 20+ + TypeScript + Hono
数据库：SQLite（better-sqlite3）+ Drizzle ORM
聊天协议：Vercel AI SDK v7（UIMessage Stream，已锁定 ai@7.0.166 / @ai-sdk/react@4.0.170）
状态管理：自研轻量 store（createStore + useSyncExternalStore，无外部状态库）
工程：pnpm workspace monorepo
测试：Vitest（workspace 统一版本，441 个用例全绿）
```

## 快速启动

环境要求：Node.js 20+（开发验证于 v24）、pnpm 11（`corepack enable` 即可自动获取）。

```bash
pnpm install

# 同时启动前后端（后端 127.0.0.1:8787 / 前端 5173）
pnpm dev

# 或分开启动
pnpm dev:server
pnpm dev:web

pnpm test          # 全部测试（441 个）
pnpm lint          # ESLint
pnpm gen:persona   # 从 docs/persona-core.md 重新生成新库初始锚点（已有数据库请在面板中编辑）
```

启动后打开 http://127.0.0.1:5173，**点右上角 ⚙ 设置**填入 API Key（默认已指向 DeepSeek：`https://api.deepseek.com` + `deepseek-chat`），点「测试连接」确认后即可对话。**不需要改任何配置文件。**

如偏好环境变量：复制 `apps/server/.env.example` 为 `apps/server/.env` 填入 `LLM_API_KEY`。配置优先级为：设置面板（`app_settings` 表）> 环境变量 > DeepSeek 默认值；切换第三方中转站只需在设置面板修改 Base URL 与模型。

## 可选：语义检索增强（Python）

默认的记忆"语义项"由 SQLite FTS5 实现，开箱即用。安装可选的 Python 服务后升级为 bge-base-zh 向量语义召回；未安装时聊天完全不受影响（自动降级）。**当前检索模式在设置面板「记忆检索」区块实时可见**——语义可用、降级原因（含错误信息）、未验证状态都会明确展示，不再静默降级。

| 文件 | 职责 |
|---|---|
| `services/embedding/embedder.py` | bge-base-zh-v1.5 封装（惰性加载，归一化 768 维输出；全链路唯一出现模型名的地方） |
| `services/retrieval/store.py` | SQLite 向量持久化 + 全量余弦检索 |
| `services/retrieval/chunker.py` | 对话按轮切片，超长句子二次切分 |
| `services/retrieval/local_retriever.py` | 组装以上三者，实现 MemoryRetriever 契约 |
| `services/retrieval/cli.py` | JSON stdin/stdout 粘合层 |
| `apps/server/src/chat/memory-client.ts` | TS 子进程客户端，首次失败进程内禁用 |

**开发机首次运行**（本模块需要 Python 3.10+）：

```bash
python -m venv .venv
.venv\Scripts\pip install -r services/embedding/requirements.txt

# TS 侧对接：PYTHON_EXECUTABLE 指向 venv 解释器
# PowerShell: $env:PYTHON_EXECUTABLE = "D:\code\ai\.venv\Scripts\python.exe"
# 或直接使用已下载的本地模型：EMBEDDING_MODEL_NAME 指向模型目录（如 data/models/bge-base-zh-v1.5），无需联网
# 在线下载则建议先设置 HF 镜像（模型约 400MB）
$env:HF_ENDPOINT = "https://hf-mirror.com"   # PowerShell
.venv\Scripts\python services/embedding/embedder.py        # 冒烟：期望 shape (2, 768)
.venv\Scripts\python services/retrieval/local_retriever.py # 冒烟：期望 smoke OK（无需模型）
.venv\Scripts\python services/retrieval/semantic_check.py  # 真语义召回验证（需先设 EMBEDDING_MODEL_NAME）
```

配置项（`EMBEDDING_MODEL_NAME` / `EMBEDDING_DEVICE` / `MEMORY_DB_PATH` / `MEMORY_TOP_K` 等）见 `apps/server/.env.example`。

已知限制：全量余弦检索约 10 万条内毫秒级，超过需把 `store.py` 换成 FAISS（只换一个文件）；每轮入库为同步子进程调用，若成瓶颈可将 CLI 升级为常驻 HTTP 服务（只改 `memory-client.ts`）。

## 项目结构

```text
.
├─ apps/
│  ├─ web/                     # React 前端
│  │  └─ src/
│  │     ├─ app/               # App 启动状态机 / ChatView / Bootstrap
│  │     ├─ chat/              # useChat、transport 契约映射、消息组件
│  │     ├─ persona/           # 人格面板（锚点编辑 / 提案 diff / 版本历史）
│  │     ├─ proactive/         # 主动消息前端（空闲计时 / 设置 / 历史）
│  │     ├─ settings/          # LLM 设置弹窗
│  │     ├─ status/            # 情绪状态面板与状态时间线
│  │     ├─ memories/          # 记忆查看器抽屉
│  │     └─ shared/            # API 领域函数（唯一 fetch 点）/ store / 组件
│  └─ server/                  # Hono 后端（仅监听 127.0.0.1:8787）
│     ├─ drizzle/              # SQL 迁移（启动时自动执行，幂等）
│     └─ src/
│        ├─ api/               # /api/health、/api/dev/mock-chat（仅开发环境）
│        ├─ plugins/            # 插件挂载点（上下文注入/情绪抽取/记忆检索/主动策略）+ 类型化注册表
│        ├─ bootstrap/         # 会话恢复服务
│        ├─ chat/              # 聊天编排 / 情绪抽取与 OU 衰减 / 分层上下文（窗口+摘要）/ 语义记忆接入
│        ├─ persona/           # 人格演化（提案/diff/确认/回滚）与锚点编辑
│        ├─ proactive/         # 主动消息（策略 / 时机治理 / API）
│        ├─ conversations/     # 会话列表、详情分页与删除
│        ├─ memories/          # 记忆 repository / 情感化检索 / 生命周期（遗忘·再巩固·摘要）
│        ├─ extraction/        # 事实抽取器（LLM 容错解析，可注入测试）
│        ├─ state-timeline/    # 状态事件分页接口
│        ├─ data-control/      # 数据导出与删除
│        ├─ settings/          # LLM 设置服务与路由（DB 优先，热生效）
│        ├─ llm/               # OpenAI 兼容 Provider（按配置键缓存）
│        ├─ db/                # 连接层 / 全部表 schema / 迁移 / 幂等 seed
│        └─ config/            # 服务 / LLM / 数据目录环境变量校验
├─ packages/
│  └─ shared/                  # Zod schema（单一事实来源）与共享类型
├─ services/
│  ├─ embedding/               # bge-base-zh embedding 封装（惰性加载，CPU 即可）
│  └─ retrieval/               # SQLite 向量存储 / 对话切片 / 检索组装 / JSON CLI
├─ plugins/                    # 外部插件目录（plugin.json 清单，AIKO_PLUGINS_DIR 可覆盖）
├─ data/                       # 本地 SQLite 数据（不入库）
└─ docs/                       # 活文档（API 契约 / 数据库 / 人格种子）；历史设计文档在 docs/archive/

## 插件架构（Phase 1）

服务端已提供四个类型化插件挂载点（pps/server/src/plugins/），内置实现以 uiltin.* 插件身份注册，第三方可用同一 egister API 扩展：

| 挂载点 | 接口 | 内置插件 |
|---|---|---|
| 上下文注入 | ContextContributor（按 order 排序，失败降级跳过） | 情绪行 / 长期记忆 / 语义记忆 / 会话摘要 |
| 主动消息策略 | ProactiveStrategyPlugin（按 priority 依次尝试） | 情绪关怀 / 记忆回想 / 好奇提问 |
| 情绪抽取 | EmotionExtractorPlugin | emotion-llm-v2 |
| 记忆检索后端 | MemoryRetrieverPlugin | semantic-python / noop |

设计边界：人格内核（锚点 + 风格）、消息持久化、数据导出/删除**不开放插件化**——这是安全底线；插件注入的内容随 debug_mode 进入 Prompt 快照，可审计。`n`n**Phase 2 已完成**：插件支持启用/禁用（`PATCH /api/plugins/:id`，持久化于 `app_settings`，设置面板可视化开关，即时生效）；事件总线（`message_created` / `state_changed` / `summary_ready` / `response_completed`，handler 抛错自动隔离不阻断聊天）。**Phase 3 已完成**：插件目录发现（默认 `plugins/`，`AIKO_PLUGINS_DIR` 可覆盖）+ `plugin.json` 清单——支持声明式上下文模板（`{{today}}` 插值）、工具链接前端插槽（侧栏「插件链接」）、以及 ESM 代码入口 `install(api)`（可访问全部注册表与事件订阅）。清单非法或入口失败只跳过该插件，绝不阻断启动。
```

## 文档导航

| 文档 | 说明 |
|---|---|
| [docs/api-contract.md](docs/api-contract.md) | API 契约：接口定义、错误码、流式协议、幂等策略、实测记录 |
| [docs/database-schema.md](docs/database-schema.md) | 数据库设计：SQLite 表结构、约束、迁移与事务 |
| [docs/persona-core.md](docs/persona-core.md) | 人格锚点初始种子 v5（古灵精怪、会做梦会无聊会害怕；关系从陌生开始随相处成长；可在面板自定义编辑） |

> 历史设计文档（需求、技术设计、React 架构、记忆/情绪设计等）已归档至 [docs/archive/](docs/archive/)，仅供查阅，不再随功能更新维护。

## 安全与隐私

- 本地单用户应用，后端仅监听 `127.0.0.1`，不暴露到局域网或公网；
- 所有业务数据保存在本机 SQLite（`data/`），不自动上传云端；
- LLM API Key 支持环境变量或本地设置面板写入（存于本机 SQLite，明文保存——本地单用户应用常规做法），任何接口不回显完整 Key、不写日志；
- 调用外部 LLM 时会携带近期对话内容，这一数据流向会在 UI 中明确告知。

## License

待定。