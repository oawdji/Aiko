# Aiko

> 本地单用户拟人化聊天 Agent —— 具有稳定人格、分层记忆与可感知的情绪状态。

## 项目简介

Aiko 是一个运行在本地的拟人化聊天 Agent。她不是“带聊天框的工具”，而是一个连续存在的对话角色：

- **稳定人格**：人格锚点（PERSONA_CORE）版本化管理，不可被聊天内容或 Prompt 注入篡改；
- **可感知状态**：PAD 三维情绪模型（愉悦度 valence / 唤醒度 arousal / 支配度 dominance），每轮先向角色气质基线回归（OU 时间衰减），再叠加事件增量；每次变化都有原因、证据与事件记录；
- **长期记忆**（规划中）：事实记忆、摘要与语义检索，全部对用户透明、可修正、可删除；
- **受控演化**（规划中）：人格调整必须经过“提案 → diff → 用户确认”流程；
- **本地优先**：数据保存在本机 SQLite，不做云端同步，暂不实现登录与多用户。

## 当前状态

**M1（数据库）/ M2（Bootstrap 与会话恢复）/ M3（真实聊天链路）已全部完成，DeepSeek 真实端点六项冒烟实测全部通过。** 当前支持：真实 LLM 流式对话、消息持久化与幂等、情绪状态引擎（可开关）、会话恢复与分页、页面内 LLM 设置面板（热生效）。

| 阶段 | 内容 | 状态 |
|---|---|---|
| 文档设计 | 需求 / 技术设计 / API 契约 / 数据库 / React 架构 / 人格锚点 / LLM 连接设置 | ✅ 完成 |
| Phase 0 | 项目骨架、LLM 层、流式协议、恢复注入、上下文窗口 | ✅ 完成（DeepSeek 已实测确认） |
| Phase 1（MVP） | 消息持久化、会话恢复、状态引擎 | ✅ M1 / M2 / M3 完成，六项冒烟全过 |
| M4 | PAD 三维情绪、OU 时间衰减引擎、角色级衰减参数、prompt 情绪注入 | ✅ 后端完成；情绪面板打磨（T7）进行中 |
| Phase 2 | 长期记忆与透明性 | ⬜ 未开始 |
| Phase 3 | 语义检索与受控人格演化 | ⬜ 未开始 |
| Phase 4 | 主动行为与遗忘 | ⬜ 未开始 |

## 功能一览

- **真实流式对话**：OpenAI 兼容端点（默认 DeepSeek），UIMessage Stream 协议；
- **情绪引擎**：PAD 三维词典规则（`emotion-rules-v2`，15 条线索），否定跳过、±0.3 截断、7 分区离散标签；OU 基线回归让情绪随时间回归角色气质基线（角色级半衰期参数，全局默认 6 小时）；每个状态变化落库为带版本号的事件，证据与原因可追溯；当前情绪会注入 system prompt；环境变量 `EMOTION_ENGINE=off` 可整体关闭；
- **会话恢复**：刷新后自动恢复最近会话与最近 30 条消息，消息顺序严格按插入序（同毫秒 `rowid` 兜底）；
- **幂等提交**：`clientMessageId` 唯一约束，重复提交返回 409 并自动刷新会话；
- **LLM 设置面板**：页面右上角 ⚙ 打开，Base URL / 模型 / API Key 页面内填写，保存后热生效无需重启；Key 只写不读，任何响应仅回显掩码后四位；
- **连接测试**：设置面板一键真实连通性测试（含延迟）。

## 技术栈

```text
前端：React 18 + TypeScript + Vite + Tailwind CSS v4
后端：Node.js 20+ + TypeScript + Hono
数据库：SQLite（better-sqlite3）+ Drizzle ORM
聊天协议：Vercel AI SDK v7（UIMessage Stream，已锁定 ai@7.0.166 / @ai-sdk/react@4.0.170）
状态管理：自研轻量 store（createStore + useSyncExternalStore，无外部状态库）
工程：pnpm workspace monorepo
测试：Vitest 5.1（workspace 统一版本，当前 165 个用例全绿）
```

## 文档导航

| 文档 | 说明 |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 需求文档：产品定位、功能需求、分阶段实施计划 |
| [docs/technical-design.md](docs/technical-design.md) | 技术设计：架构、状态引擎、情感标签映射、里程碑 |
| [docs/api-contract.md](docs/api-contract.md) | API 契约：接口定义、错误码、流式协议、幂等策略、实测记录 |
| [docs/database-schema.md](docs/database-schema.md) | 数据库设计：SQLite 表结构、约束、迁移与事务 |
| [docs/react-architecture.md](docs/react-architecture.md) | React 架构：组件设计、状态边界、渲染隔离 |
| [docs/persona-core-v1.md](docs/persona-core-v1.md) | 人格锚点 v1：PERSONA_CORE 正文与初始 evolvable 配置 |

## 项目结构

```text
.
├─ apps/
│  ├─ web/                     # React 前端
│  │  └─ src/
│  │     ├─ app/               # App 启动状态机 / ChatView / Bootstrap
│  │     ├─ chat/              # useChat、transport 契约映射、消息组件
│  │     ├─ settings/          # LLM 设置弹窗
│  │     ├─ status/            # 情绪状态面板
│  │     └─ shared/            # API 领域函数（唯一 fetch 点）/ store / 组件
│  └─ server/                  # Hono 后端（仅监听 127.0.0.1:8787）
│     ├─ drizzle/              # SQL 迁移（启动时自动执行，幂等）
│     └─ src/
│        ├─ api/               # /api/health、/api/dev/mock-chat（仅开发环境）
│        ├─ bootstrap/         # 会话恢复服务
│        ├─ chat/              # 聊天编排 / 情绪词典与规则 / OU 衰减引擎 / prompt 情绪注入 / 引擎开关
│        ├─ conversations/     # 会话详情与分页
│        ├─ settings/          # LLM 设置服务与路由（DB 优先，热生效）
│        ├─ llm/               # OpenAI 兼容 Provider（按配置键缓存）
│        ├─ db/                # 连接层 / 六表 schema / 迁移 / 幂等 seed
│        └─ config/            # 服务 / LLM / 数据目录环境变量校验
├─ packages/
│  └─ shared/                  # Zod schema（单一事实来源）与共享类型
├─ data/                       # 本地 SQLite 数据（不入库）
└─ docs/                       # 设计文档
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

pnpm test          # 全部测试（165 个）
pnpm lint          # ESLint
pnpm gen:persona   # 从 docs/persona-core-v1.md 重新生成锚点模块
```

启动后打开 http://127.0.0.1:5173，**点右上角 ⚙ 设置**填入 API Key（默认已指向 DeepSeek：`https://api.deepseek.com` + `deepseek-chat`），点「测试连接」确认后即可对话。**不需要改任何配置文件。**

如偏好环境变量：复制 `apps/server/.env.example` 为 `apps/server/.env` 填入 `LLM_API_KEY`。配置优先级为：设置面板（`app_settings` 表）> 环境变量 > DeepSeek 默认值；切换第三方中转站只需在设置面板修改 Base URL 与模型。

## 安全与隐私

- 本地单用户应用，后端仅监听 `127.0.0.1`，不暴露到局域网或公网；
- 所有业务数据保存在本机 SQLite（`data/`），不自动上传云端；
- LLM API Key 支持环境变量或本地设置面板写入（存于本机 SQLite，明文保存——本地单用户应用常规做法），任何接口不回显完整 Key、不写日志；
- 调用外部 LLM 时会携带近期对话内容，这一数据流向会在 UI 中明确告知。

## License

待定。