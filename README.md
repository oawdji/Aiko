# Aiko

> 本地单用户拟人化聊天 Agent —— 具有稳定人格、分层记忆与可感知的情绪状态。

## 项目简介

Aiko 是一个运行在本地的拟人化聊天 Agent。她不是“带聊天框的工具”，而是一个连续存在的对话角色：

- **稳定人格**：人格锚点（PERSONA_CORE）版本化管理，不可被聊天内容或 Prompt 注入篡改；
- **可感知状态**：二维情绪模型（愉悦度 valence / 唤醒度 arousal），每次变化都有原因、证据与事件记录；
- **长期记忆**（规划中）：事实记忆、摘要与语义检索，全部对用户透明、可修正、可删除；
- **受控演化**（规划中）：人格调整必须经过“提案 → diff → 用户确认”流程；
- **本地优先**：数据保存在本机 SQLite，不做云端同步，暂不实现登录与多用户。

## 当前状态

**Phase 0 进行中：工程骨架（M0/T0.1）已搭建并通过验收，业务功能尚未实现。**

| 阶段 | 内容 | 状态 |
|---|---|---|
| 文档设计 | 需求 / 技术设计 / API 契约 / 数据库 / React 架构 / 人格锚点 | ✅ 完成 |
| Phase 0 | 项目骨架、流式聊天链路验证 | 🚧 骨架完成，链路验证中 |
| Phase 1（MVP） | 消息持久化、会话恢复、状态引擎 | ⬜ 未开始 |
| Phase 2 | 长期记忆与透明性 | ⬜ 未开始 |
| Phase 3 | 语义检索与受控人格演化 | ⬜ 未开始 |
| Phase 4 | 主动行为与遗忘 | ⬜ 未开始 |

## 技术栈（已确定）

```text
前端：React 18 + TypeScript + Vite
后端：Node.js 20+ + TypeScript + Hono
数据库：SQLite + Drizzle ORM
聊天协议：Vercel AI SDK（UIMessage Stream）
状态管理：Zustand + React Query
工程：pnpm workspace monorepo
测试：Vitest + Testing Library，Playwright 后期引入
```

## 文档导航

| 文档 | 说明 |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 需求文档：产品定位、功能需求、分阶段实施计划 |
| [docs/technical-design.md](docs/technical-design.md) | 技术设计：架构、状态引擎、情感标签映射、里程碑 |
| [docs/api-contract.md](docs/api-contract.md) | API 契约：接口定义、错误码、流式协议、幂等策略 |
| [docs/database-schema.md](docs/database-schema.md) | 数据库设计：SQLite 表结构、约束、迁移与事务 |
| [docs/react-architecture.md](docs/react-architecture.md) | React 架构：组件设计、状态边界、渲染隔离 |
| [docs/persona-core-v1.md](docs/persona-core-v1.md) | 人格锚点 v1：PERSONA_CORE 正文与初始 evolvable 配置 |

## 项目结构

```text
.
├─ apps/
│  ├─ web/          # React 前端（Vite + React 18 + Tailwind）
│  └─ server/       # Hono 后端服务（当前提供 /api/health）
├─ packages/
│  └─ shared/       # 前后端共享类型与 Zod schema
├─ data/            # 本地 SQLite 数据（未来，不入库）
└─ docs/            # 设计文档
```

## 快速启动

环境要求：Node.js 20+（开发验证于 v24）、pnpm 10+。

```bash
pnpm install

# 方式一：同时启动前后端
pnpm dev

# 方式二：分开启动
pnpm dev:server    # 后端 http://127.0.0.1:8787
pnpm dev:web       # 前端 http://127.0.0.1:5173

pnpm test          # 运行全部测试
pnpm lint          # ESLint
pnpm format        # Prettier
```

LLM 配置：复制 `apps/server/.env.example` 为 `apps/server/.env`，填入 OpenAI 兼容端点的 Key。当前默认指向 DeepSeek（`https://api.deepseek.com` + `deepseek-chat`）；使用第三方中转站时只需修改 `LLM_BASE_URL` 与 `LLM_MODEL`。

## 安全与隐私

- 本地单用户应用，后端仅监听 `127.0.0.1`，不暴露到局域网或公网；
- 所有业务数据保存在本机 SQLite（`data/`），不自动上传云端；
- LLM API Key 只从本地环境变量读取，不入库、不写日志，前端不接触；
- 调用外部 LLM 时会携带近期对话内容，这一数据流向会在 UI 中明确告知。

## License

待定。