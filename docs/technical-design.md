# 技术设计文档

项目：本地单用户拟人化聊天 Agent  
关联文档：[requirements.md](./requirements.md)  
版本：v1.2  
日期：2026-11-11

---

## 1. 设计范围

本文档覆盖 Phase 0 与 Phase 1 / MVP 的技术方案，目标是把以下问题固定下来：

- 项目结构和前后端边界；
- 本地运行方式；
- SQLite 数据模型；
- 聊天流式协议；
- 状态事件的生成与传输；
- React 组件与状态管理边界；
- 幂等、恢复、失败处理；
- 测试与验收方式。

本文档不覆盖以下详细设计：

- 长期事实记忆抽取；
- 摘要记忆；
- 语义检索；
- 人格演化；
- 主动消息；
- 遗忘曲线。

这些能力在 Phase 2 及以后设计，但当前数据模型会预留 `agent_id`，避免未来多 Agent 时重构核心表。

---

## 2. 已确认的产品边界

| 项目 | 当前决策 |
|---|---|
| 产品形态 | 本地单用户应用 |
| 登录系统 | 暂不实现 |
| 数据存储 | 本地 SQLite |
| 服务暴露范围 | 默认仅监听 `127.0.0.1` |
| Agent 数量 | 当前一个默认 Agent，数据模型支持未来多 Agent |
| 主动消息 | 仅浏览器页面打开期间，不做离线推送 |
| MVP 记忆 | 只做近期对话窗口和消息持久化 |
| MVP 状态 | PAD 三维情感状态 + OU 基线回归 + 状态事件 + 原因展示 |
| MVP 人格 | 固定 `PERSONA_CORE`，不做演化 |

---

## 3. 技术选型

## 3.1 推荐技术栈

```text
前端：React 18 + TypeScript + Vite
后端：Node.js 20+ + TypeScript + Hono
数据库：SQLite + Drizzle ORM
聊天协议：Vercel AI SDK UIMessage Stream
共享类型：pnpm workspace + packages/shared
测试：Vitest + Testing Library
接口测试：Hono app 级测试
端到端测试：Playwright，可延后到 MVP 后期
```

## 3.2 选型理由

### React + Vite

- 本产品重点是自定义聊天界面、状态面板和后续记忆查看器；
- 不需要 Next.js 的服务端渲染能力；
- Vite 启动快、结构清晰，适合本地单用户前端。

### Hono

- 轻量、类型友好；
- 中间件模型简单；
- 适合本地 API 服务；
- 后续如果迁移部署方式，改造成本低。

### Drizzle ORM + SQLite

- SQLite 是当前明确的数据存储；
- Drizzle 迁移和 TypeScript 类型能力适合本地项目；
- 相比重型 ORM，更容易检查最终 SQL 和索引；
- 数据库文件便于备份、导出和删除。

### Vercel AI SDK

- 前端 `useChat` 与后端 UIMessage Stream 协议匹配；
- 支持流式文本、消息 parts 和后续扩展；
- 需要在 Phase 0 锁定具体版本，避免跨大版本 API 差异导致返工。

### pnpm workspace

当前建议采用轻量 monorepo：

```text
apps/web
apps/server
packages/shared
```

这样可以让前后端共享同一组 TypeScript 类型，例如：

- `AgentEmotionState`
- `AgentStateEvent`
- `ChatRequestBody`
- `EmotionTag`

---

## 4. 系统架构

## 4.1 总体结构

```text
┌──────────────────────────────────────────────┐
│ React 前端                                    │
│ ├─ ChatShell                                  │
│ ├─ MessageList                                │
│ ├─ MessageComposer                            │
│ ├─ StatusPanel                                │
│ ├─ AgentStateStore                            │
│ └─ ConversationStore                          │
└──────────────────────────────────────────────┘
                 │
                 │ HTTP / streaming
                 ▼
┌──────────────────────────────────────────────┐
│ 本地 Node.js API 服务                         │
│ ├─ /api/chat                                  │
│ ├─ /api/bootstrap                             │
│ ├─ /api/conversations                         │
│ ├─ /api/agents/:agentId/state                 │
│ └─ /api/settings                              │
└──────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│ Agent 引擎                                    │
│ ├─ ChatService                                │
│ ├─ PromptBuilder                              │
│ ├─ EmotionExtractionEngine                    │
│ ├─ StateEngine                                │
│ ├─ ConversationRepository                     │
│ └─ PersonaRepository                           │
└──────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│ SQLite                                        │
│ ├─ agents                                     │
│ ├─ conversations                              │
│ ├─ messages                                   │
│ ├─ state_events                               │
│ ├─ persona_versions                           │
│ └─ app_settings                               │
└──────────────────────────────────────────────┘
```

## 4.2 运行边界

后端默认监听：

```text
http://127.0.0.1:8787
```

前端开发服务器默认：

```text
http://127.0.0.1:5173
```

限制：

- 后端不监听 `0.0.0.0`；
- 不默认提供公网访问；
- CORS 仅允许本地前端来源；
- 未实现认证前，不允许暴露到局域网或公网。

## 4.3 数据目录

默认数据目录：

```text
data/
```

SQLite 文件：

```text
data/agent.sqlite
```

要求：

- `data/` 不提交到 Git；
- 提供数据库初始化和迁移命令；
- 支持通过环境变量覆盖数据目录；
- 数据导出和删除功能必须覆盖该数据库及派生文件。

## 4.4 LLM 连接配置

LLM 连接配置支持两个来源，优先级为：

```text
app_settings 数据库设置 > 环境变量 > 未配置
```

环境变量仍作为兜底默认值：

```text
LLM_API_KEY=...
LLM_BASE_URL=...
LLM_MODEL=...
```

要求：

- 前端设置面板可查看并修改 `baseUrl` 与 `model`，并写入 API Key（T0.6，见 F38）；
- Key 可保存在本地 SQLite（`app_settings.llm_api_key`），但必须满足：
  - 任何 API 响应不得返回完整 Key，只返回掩码提示；
  - Key 不写入日志、调试面板与 Prompt 快照；
  - Key 不包含在数据导出中；
  - “删除全部数据”必须删除 Key；
- `.env*` 文件默认加入 `.gitignore`；
- 前端永远不直接使用 API Key 发起模型请求，所有模型请求由后端代理；
- 设置变更后 Provider 单例需失效重建，无需重启服务。

---

## 5. 项目结构

推荐目录结构如下：

```text
.
├─ apps/
│  ├─ web/
│  │  ├─ src/
│  │  │  ├─ app/
│  │  │  ├─ chat/
│  │  │  ├─ status/
│  │  │  ├─ shared/
│  │  │  ├─ stores/
│  │  │  └─ main.tsx
│  │  └─ index.html
│  │
│  └─ server/
│     ├─ src/
│     │  ├─ api/
│     │  ├─ db/
│     │  ├─ engine/
│     │  ├─ llm/
│     │  ├─ config/
│     │  └─ index.ts
│     ├─ drizzle/
│     └─ .env.example
│
├─ packages/
│  └─ shared/
│     └─ src/
│        ├─ types/
│        ├─ constants/
│        └─ schemas/
│
├─ data/
├─ docs/
├─ package.json
├─ pnpm-workspace.yaml
└─ README.md
```

模块边界要求：

- `apps/web` 不直接访问 SQLite；
- `apps/server` 不导入 React；
- `packages/shared` 不包含前后端任一侧的运行时实现；
- 状态规则、Prompt 组装、记忆规则全部在服务端；
- 前端只负责展示、交互和本地 UI 状态。

---

## 6. 核心数据模型

## 6.1 设计原则

1. 消息永远持久化，不因超出 Prompt 窗口而删除。
2. 状态事件不可变，可追溯。
3. `agent_id` 从第一版开始进入所有 Agent 相关表。
4. 当前状态允许保存在 `agents` 表作为快照，但事实链路以 `state_events` 为准。
5. 人格锚点版本化，不做物理覆盖。
6. 本地单用户使用固定 `user_id`。

```text
LOCAL_USER_ID = "local-user"
```

---

## 6.2 agents

表示一个 Agent / 人格实例。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | text PK | Agent ID |
| `slug` | text unique | 稳定标识，如 `default` |
| `display_name` | text | 展示名 |
| `description` | text | Agent 简介，可空 |
| `current_valence` | real | 当前愉悦度快照 |
| `current_arousal` | real | 当前唤醒度快照 |
| `current_tag` | text | 当前离散情感标签 |
| `state_updated_at` | text | 状态更新时间 |
| `active_persona_version` | integer | 当前人格版本 |
| `created_at` | text | 创建时间 |
| `updated_at` | text | 更新时间 |

当前默认 Agent：

```text
id: agent-default
slug: default
```

状态快照用于快速恢复 UI；真实历史来自 `state_events`。

---

## 6.3 conversations

表示一次连续对话。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | text PK | 会话 ID |
| `user_id` | text | 固定为本地用户 ID |
| `agent_id` | text FK | 所属 Agent |
| `title` | text | 会话标题，MVP 可自动生成或为空 |
| `last_message_at` | text | 最近消息时间 |
| `is_archived` | integer | 是否归档 |
| `created_at` | text | 创建时间 |
| `updated_at` | text | 更新时间 |

约束：

```text
index(agent_id, last_message_at)
```

MVP 可以自动复用最近活跃会话；Phase 2 再增加会话列表和多会话切换。

---

## 6.4 messages

表示用户、Assistant 或系统产生的消息。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | text PK | 消息 ID |
| `conversation_id` | text FK | 所属会话 |
| `agent_id` | text FK | 所属 Agent |
| `user_id` | text | 所属本地用户 |
| `role` | text | `user` / `assistant` / `system` |
| `content` | text | 纯文本内容 |
| `status` | text | `complete` / `streaming` / `failed` |
| `client_message_id` | text nullable | 前端幂等 ID |
| `error_code` | text nullable | 失败码 |
| `metadata_json` | text nullable | 扩展元数据 |
| `created_at` | text | 创建时间 |
| `updated_at` | text | 更新时间 |

约束：

```text
unique(conversation_id, client_message_id)
index(conversation_id, created_at)
index(agent_id, created_at)
```

MVP 只存储纯文本。未来如需 reasoning、tool call 或图片，可新增 `parts_json`，不改变现有表结构。

---

## 6.5 state_events

表示一次不可变状态变化。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | text PK | 状态事件 ID |
| `agent_id` | text FK | 所属 Agent |
| `conversation_id` | text FK | 发生时的会话 |
| `trigger_message_id` | text nullable | 触发消息 |
| `source` | text | `user_message` / `assistant_message` / `time_decay` / `manual` |
| `rule_version` | text | 状态规则版本 |
| `before_valence` | real | 变化前愉悦度 |
| `before_arousal` | real | 变化前唤醒度 |
| `before_dominance` | real | 变化前支配度 |
| `delta_valence` | real | 愉悦度变化 |
| `delta_arousal` | real | 唤醒度变化 |
| `delta_dominance` | real | 支配度变化 |
| `after_valence` | real | 变化后愉悦度 |
| `after_arousal` | real | 变化后唤醒度 |
| `after_dominance` | real | 变化后支配度 |
| `discrete_tag` | text | 离散标签 |
| `reason` | text | 面板展示原因 |
| `evidence_text` | text | 触发证据 |
| `confidence` | real | 置信度 |
| `created_at` | text | 创建时间 |

约束：

```text
unique(trigger_message_id, source, rule_version)
index(agent_id, created_at)
index(conversation_id, created_at)
```

该唯一约束用于防止同一条消息重复累计状态。

MVP 只实现 `user_message` 来源。`assistant_message` 和 `time_decay` 保留字段与枚举，不提前实现。

时间衰减（基线回归）不产生 `time_decay` 事件：回归量折叠进下一条事件的 `before`，避免事件流噪声（见 §10.11）。`time_decay` 仅在未来需要定时批量落库时启用。

---

## 6.6 persona_versions

表示人格版本。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | text PK | 版本记录 ID |
| `agent_id` | text FK | 所属 Agent |
| `version` | integer | 版本号 |
| `persona_core_md` | text | 不可变人格锚点 |
| `persona_core_hash` | text | 锚点 hash |
| `evolvable_json` | text | 可演化片段，MVP 为初始 JSON |
| `is_active` | integer | 是否当前版本 |
| `created_at` | text | 创建时间 |
| `activated_at` | text | 生效时间 |

约束：

```text
unique(agent_id, version)
```

MVP 只初始化 version 1，不做修改接口。

初始化内容的唯一来源是 [persona-core-v1.md](./persona-core-v1.md)：`persona_core_md` 使用该文件标记区内的正文，`evolvable_json` 使用其中定义的初始 JSON。

`persona_core_hash` 用于后续验证人格锚点没有漂移。

---

## 6.7 app_settings

键值型本地设置表。

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | text PK | 设置键 |
| `value_json` | text | JSON 值 |
| `updated_at` | text | 更新时间 |

MVP 建议只包含：

```text
default_agent_id
recent_window_rounds
max_context_messages
theme
```

---

## 6.8 时间与 ID 规则

### 时间

- 数据库统一保存 ISO 8601 UTC 字符串；
- 前端展示时转换为本地时区；
- 不使用只有前端知道的本地时间作为业务事实。

### ID

推荐：

```text
message_id    = msg_<uuid>
conversation  = conv_<uuid>
state_event   = state_<uuid>
persona       = persona_<uuid>
```

ID 可以由服务端生成。`client_message_id` 由前端生成，仅用于幂等。

---

## 7. 核心类型设计

以下类型放在 `packages/shared`，由前后端共同使用。

## 7.1 情感状态

```ts
export type AgentEmotionState = {
  valence: number;
  arousal: number;
};
```

范围：

```text
-1 <= valence <= 1
-1 <= arousal <= 1
```

所有写入前必须 clamp。

---

## 7.2 离散情感标签

```ts
export type EmotionTag =
  | "calm"
  | "curious"
  | "happy"
  | "low"
  | "tense"
  | "neutral";
```

前端不得自行从数值计算标签，必须使用后端返回结果，保证前后端展示一致。

---

## 7.3 状态事件

```ts
export type AgentStateEvent = {
  id: string;
  agentId: string;
  conversationId: string;
  triggerMessageId: string | null;
  source: "user_message" | "assistant_message" | "time_decay" | "manual";
  ruleVersion: string;
  before: AgentEmotionState;
  delta: AgentEmotionState;
  after: AgentEmotionState;
  discreteTag: EmotionTag;
  reason: string;
  evidenceText: string;
  confidence: number;
  createdAt: string;
};
```

---

## 7.4 聊天请求

```ts
export type ChatRequestBody = {
  agentId: string;
  conversationId: string;
  message: string;
  clientMessageId: string;
};
```

约束：

```text
agentId: 必须存在
conversationId: 必须属于该 agent
message: 非空，长度上限建议 8000 字符
clientMessageId: 前端生成的 UUID
```

---

## 7.5 启动数据

页面首次加载或刷新时使用：

```ts
export type BootstrapResponse = {
  user: {
    id: string;
  };
  agent: AgentDTO;
  conversation: {
    id: string;
    title: string | null;
    lastMessageAt: string | null;
  };
  messages: ChatMessageDTO[];
  latestStateEvent: AgentStateEvent | null;
  settings: AppSettings;
};
```

`agent` 使用 `AgentDTO`，字段与 [api-contract.md](./api-contract.md) §4.6 保持一致（含 `slug` 与 `description`）。

---

## 8. API 设计

## 8.1 `POST /api/chat`

用途：发送用户消息并返回 Assistant 流式回复。

请求：

```json
{
  "agentId": "agent-default",
  "conversationId": "conv_xxx",
  "message": "今天好累",
  "clientMessageId": "client_xxx"
}
```

处理流程：

1. 校验请求参数；
2. 校验 Agent 和会话存在；
3. 以 `client_message_id` 做幂等检查；
4. 写入用户消息；
5. 生成状态事件；
6. 更新 Agent 状态快照；
7. 组装 Prompt；
8. 调用 LLM；
9. 流式返回 Assistant 文本；
10. 流结束后写入 Assistant 消息；
11. 更新会话 `last_message_at`。

### 状态事件传输

状态事件作为自定义数据 part 写入同一条 UIMessage Stream：

```text
data-agent-state-event
```

数据内容：

```ts
export type AgentStateEventData = {
  event: AgentStateEvent;
};
```

前端收到后写入 `AgentStateStore`。

> 实施约束：Phase 0 必须锁定 Vercel AI SDK 具体版本，并用一个小型集成测试验证自定义 data part 的实际协议行为。如果当前版本协议不满足设计，需要在实现前修订此节，不允许在前端硬编码临时协议。

### 幂等策略

数据库约束：

```text
unique(conversation_id, client_message_id)
```

第一次请求：正常处理。  
重复请求：返回 `409 Conflict`，错误码为 `DUPLICATE_CLIENT_MESSAGE`。

前端责任：

- 每次点击生成新的 `clientMessageId`；
- 请求进行中禁用重复提交；
- 收到 409 时刷新会话，不重复追加消息。

选择 409 而不是自动重放流，是为了避免同一次点击造成重复 UI 消息，并保持流式协议简单。

### 失败策略

LLM 调用失败时：

- 用户消息保留；
- 用户消息触发的状态事件保留；
- 写入一条 `failed` 状态的 Assistant 占位消息；
- 流返回错误；
- 前端显示可重试错误。

失败消息不进入后续 Prompt。

---

## 8.2 `GET /api/bootstrap`

用途：页面启动或刷新后的恢复入口。

```http
GET /api/bootstrap?agent=agent-default
```

返回：

- 当前 Agent；
- 当前状态快照；
- 最近活跃会话；
- 最近消息；
- 最新状态事件；
- 本地设置。

如果没有会话：

- 创建新会话；
- 返回空消息列表；
- 初始状态为 0 / 0。

---

## 8.3 `GET /api/conversations/:id`

用途：恢复指定会话。

查询参数：

```text
limit=30
beforeId=...
```

返回：

- 会话信息；
- 消息分页列表；
- 当前 Agent 状态；
- 最新状态事件。

MVP 默认返回最近 30 条消息，即约 15 轮。

---

## 8.4 `GET /api/agents/:agentId/state`

返回当前状态快照：

```ts
export type AgentStateResponse = {
  agentId: string;
  state: AgentEmotionState;
  discreteTag: EmotionTag;
  stateUpdatedAt: string | null;
};
```

---

## 8.5 `GET /api/agents/:agentId/state/events`

返回状态事件分页列表。

查询参数：

```text
limit=50
beforeId=...
from=ISO8601
to=ISO8601
```

MVP 可以只实现 `limit` 和 `beforeId`。

---

## 8.6 `GET /api/settings`

返回本地设置。

## 8.7 `PATCH /api/settings`

更新本地设置。

MVP 只允许更新：

```text
theme
recent_window_rounds
max_context_messages
```

`recent_window_rounds` 建议范围：

```text
10 <= recent_window_rounds <= 15
```

---

## 8.8 错误响应格式

统一错误体：

```ts
export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};
```

首批错误码：

| HTTP | code | 场景 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 参数校验失败 |
| 404 | `AGENT_NOT_FOUND` | Agent 不存在 |
| 404 | `CONVERSATION_NOT_FOUND` | 会话不存在 |
| 409 | `DUPLICATE_CLIENT_MESSAGE` | 幂等冲突 |
| 500 | `LLM_REQUEST_FAILED` | 模型调用失败 |
| 500 | `INTERNAL_ERROR` | 未分类错误 |

错误信息不得包含 API Key、完整 Prompt 或数据库路径。

---

## 9. 聊天与 Prompt 组装

## 9.1 MVP Prompt 结构

```text
System:
  PERSONA_CORE version 1
  安全边界
  当前 Agent 状态摘要

Context:
  最近 10–15 轮消息

User:
  当前用户消息
```

MVP 不注入：

- 摘要；
- 事实记忆；
- 检索结果；
- 可演化人格片段。

---

## 9.2 PromptBuilder

`PromptBuilder` 输入：

```ts
type PromptBuilderInput = {
  personaCore: string;
  currentState: AgentEmotionState;
  discreteTag: EmotionTag;
  recentMessages: PromptMessage[];
};
```

输出：

```ts
type BuiltPrompt = {
  system: string;
  messages: PromptMessage[];
  meta: {
    recentMessageIds: string[];
    personaVersion: number;
  };
};
```

要求：

- 纯函数；
- 不访问数据库；
- 不直接调用 LLM；
- 可单元测试；
- 输出长度必须有上限。

---

## 9.3 近期窗口规则

默认：

```text
最近 15 轮 = 最近 30 条 user/assistant 消息
```

规则：

- 只取状态为 `complete` 的消息；
- 不取 `failed`；
- 不取 `system`；
- 不取超出 token 预算的过旧消息；
- 当前用户消息始终保留。

MVP 可以先用消息条数控制，Phase 2 再引入 token 预算器。

---

## 10. 状态引擎设计

## 10.1 目标

MVP 状态系统不追求复杂智能，而要求：

- 确定；
- 可测试；
- 可解释；
- 可追溯；
- 不会重复累计。

---

## 10.2 处理流程

```text
用户消息
  ↓
EmotionExtractionEngine
  ↓ EmotionExtraction
StateEngine
  ↓ AgentStateEvent
SQLite state_events
  ↓
agents 快照更新
  ↓
UIMessage Stream data part
  ↓
React AgentStateStore
```

---

## 10.3 抽取规则

初始版本使用规则词典。

示例：

| 线索 | valence delta | arousal delta | confidence |
|---|---:|---:|---:|
| 开心 | +0.12 | +0.08 | 0.70 |
| 高兴 | +0.12 | +0.08 | 0.70 |
| 喜欢 | +0.08 | 0 | 0.60 |
| 有趣 | +0.10 | +0.06 | 0.60 |
| 累 | -0.10 | -0.04 | 0.70 |
| 难过 | -0.14 | -0.06 | 0.75 |
| 烦 | -0.10 | +0.06 | 0.65 |
| 焦虑 | -0.08 | +0.12 | 0.70 |
| 激动 | +0.04 | +0.14 | 0.65 |
| 紧张 | -0.06 | +0.12 | 0.70 |
| 平静 | +0.04 | -0.08 | 0.60 |

规则版本：

```text
emotion-rules-v1
```

emotion-rules-v2 将扩展为 PAD 三维词典（新增 `dDominance` 线索），见 §10.5 与 §10.11。历史事件保持 v1 结果，不重算。

---

## 10.4 否定处理

MVP 只处理简单否定：

- `不累`
- `不难过`
- `不烦`

如果情感词前 2 个字符内出现否定词，则：

- 不反转情感；
- 直接跳过该线索；
- 降低整体置信度。

原因：MVP 规则能力有限，宁可不更新，也不要更新错方向。

反讽、复杂从句、多语言混杂不做识别。

---

## 10.5 状态更新公式

emotion-rules-v2 起状态为 PAD 三维向量（valence/arousal/dominance，各维 [-1, 1]）。
处理新消息前先做基线回归（OU 精确离散解，见 §10.11），再累加 delta：

```text
reverted = μ + (old − μ) · e^(−θ·Δt)        各维独立；|reverted − μ| < ε 时吸附到 μ
new_x = clamp(reverted_x + delta_x, -1, 1)  x ∈ {valence, arousal, dominance}
```

限制：

```text
单条用户消息 abs(delta_valence) <= 0.30
单条用户消息 abs(delta_arousal) <= 0.30
单条用户消息 abs(delta_dominance) <= 0.30
```

如果规则计算结果超过限制，则截断。

事件中的 `before` 存回归后的值（reverted），保证事件链可复现（before + delta = after）。

---

## 10.6 无情感线索

当没有识别到线索时：

```text
delta = 0 / 0
confidence = 0
```

处理策略：

- MVP 不生成状态事件；
- Agent 状态保持不变；
- 前端不显示新的变化原因。

这比生成“无明显变化”的事件更干净，也能避免状态历史被大量噪声污染。

---

## 10.7 离散标签映射规则

离散标签由状态事件的 `after` 状态计算，属于 `emotion-rules-v1` 的一部分。

阈值：

```text
TAG_THRESHOLD = 0.05
```

分区表：

| valence \ arousal | arousal ≤ -0.05 | -0.05 < arousal ≤ 0.05 | arousal > 0.05 |
|---|---|---|---|
| valence ≤ -0.05 | `low` | `low` | `tense` |
| -0.05 < valence < 0.05 | `neutral` | `neutral` | `curious` |
| valence ≥ 0.05 | `calm` | `calm` | `happy` |

语义说明：

- `low`：愉悦度为负、唤醒度不高，对应难过、低落、疲惫；
- `tense`：愉悦度为负、唤醒度升高，对应烦躁、焦虑、紧张；
- `curious`：愉悦度接近中性但唤醒度明显升高，对应好奇、投入；
- `happy`：愉悦度为正、唤醒度升高，对应开心、兴奋；
- `calm`：愉悦度为正、唤醒度不高，对应满足、放松；
- `neutral`：两个维度都接近中心，无明显倾向。

实现要求：

1. 先将 valence / arousal clamp 到 `[-1, 1]`，再计算标签；
2. 使用固定阈值 `0.05`，不做浮点容差，保证结果确定；
3. 分类实现为纯函数：输入 `AgentEmotionState`，输出 `EmotionTag`；
4. 该映射同时用于 `state_events.discrete_tag` 与 `agents.current_tag`；
5. 修改阈值或分区即产生新的 `rule_version`，历史事件中的标签不重算；
6. dominance 维度不参与标签分区，仅用于展示与 prompt 注入。

示例：

| after 状态 | 标签 |
|---|---|
| `(-0.10, -0.04)` | `low` |
| `(-0.08, 0.12)` | `tense` |
| `(0.04, 0.14)` | `curious` |
| `(0.12, 0.08)` | `happy` |
| `(0.08, -0.06)` | `calm` |
| `(0.03, 0.03)` | `neutral` |

---

## 10.8 reason 文案

示例：

```text
你提到“累”，她的愉悦度略有下降。
你提到“开心”，她的愉悦度上升。
```

要求：

- 引用实际 evidence text；
- 不声称拥有真实人类情绪；
- 不使用绝对化描述；
- 文案由后端生成，前端只展示。

---

## 10.9 幂等

写入前检查：

```text
trigger_message_id + source + rule_version
```

数据库唯一约束兜底。

同一用户消息重复请求、重试或页面刷新都不得重复累计状态。

---

## 10.10 状态恢复

页面刷新时：

1. 调用 `/api/bootstrap`；
2. 读取 `agents` 快照（valence/arousal/dominance）与角色衰减参数；
3. 读取最新 `state_events`；
4. 初始化 `AgentStateStore`；
5. 渲染状态面板（快照先经 §10.11 读时回归，不写库）。

不依赖 localStorage 保存状态。

---

## 10.11 基线回归（时间衰减引擎）

### 目标

情绪状态不永久保持：随时间向角色气质基线 μ 回归（OU 过程精确离散解），回归速率 θ 为角色级参数。

### 公式

```text
x' = μ + (x − μ) · e^(−θ·Δt)
```

- θ 由 `agents.decay_half_life_hours`（半程时间，t½ = ln2 / θ）派生；该列为 NULL 时使用全局默认（环境变量 `EMOTION_DECAY_HALF_LIFE_HOURS`，缺省 6 小时）；
- Δt = 处理时刻 − `agents.state_updated_at`（UTC，小时）；
- ε = 0.001：|x − μ| < ε 时吸附到 μ，截断长尾；
- 三维独立计算，公式一致。

### 参数（角色级）

| 参数 | 存储 | 说明 |
|---|---|---|
| 基线 μ | `agents.baseline_valence` / `baseline_arousal` / `baseline_dominance` | 角色气质偏移，创建 Agent 时设定 |
| 半程时间 | `agents.decay_half_life_hours`（可空） | 到基线的半程时间；NULL = 使用全局默认 |
| 吸附阈值 ε | 代码常量 | 0.001 |

### 计算时机

- 新状态事件处理前：先回归再叠加 delta（§10.5），`before` 存回归后的值；
- bootstrap / state 读取时：对快照做读时回归用于展示，不写库；
- 不生成 `time_decay` 事件；枚举保留给未来定时批量落库方案。

### 确定性与幂等

- 核心实现为纯函数，`now` 显式注入（禁止直接读系统时钟），可复现、可测试；
- 回归量折叠进下一条事件，事件链满足 before + delta = after，幂等约束不变；
- emotion-rules-v1 历史事件的 `after` 值不重算。

---

## 11. React 前端设计

## 11.1 页面结构

MVP 首页：

```tsx
<App>
  <ChatPage>
    <ChatLayout>
      <ChatShell>
        <MessageList />
        <MessageComposer />
      </ChatShell>

      <StatusPanel>
        <EmotionBars />
        <ReasonLine />
        <EmotionTag />
      </StatusPanel>
    </ChatLayout>
  </ChatPage>
</App>
```

---

## 11.2 ChatShell

职责：

- 调用 `useChat` 或自定义 transport adapter；
- 管理输入和发送；
- 展示发送中、失败、重试状态；
- 接收 `data-agent-state-event`;
- 把状态事件交给 `AgentStateStore`。

不得负责：

- 状态计算；
- 记忆检索；
- 人格规则；
- 数据库读取。

---

## 11.3 MessageList

职责：

- 渲染用户和 Assistant 消息；
- 渲染流式中的最后一条 Assistant 消息；
- 渲染失败占位；
- 自动滚动。

MVP 不使用虚拟列表。消息超过 200 条后再引入 `@tanstack/react-virtual`。

---

## 11.4 StatusPanel

职责：

- 展示 valence 与 arousal；
- 展示离散情感标签；
- 展示最新状态变化原因；
- 说明这是模拟状态。

不得从消息列表 store 中读取派生状态。

---

## 11.5 状态管理

### ChatStore / useChat

聊天消息流使用 Vercel AI SDK 的 `useChat` 状态，或等价自定义 adapter。

### AgentStateStore

```ts
type AgentStateStoreValue = {
  agentId: string | null;
  state: AgentEmotionState;
  discreteTag: EmotionTag;
  stateUpdatedAt: string | null;
  latestEvent: AgentStateEvent | null;

  bootstrap: (data: BootstrapResponse) => void;
  applyStateEvent: (event: AgentStateEvent) => void;
};
```

### ConversationStore

```ts
type ConversationStoreValue = {
  conversationId: string | null;
  isBootstrapLoading: boolean;
  bootstrapError: string | null;

  loadBootstrap: () => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
};
```

### SettingsStore

MVP 可以先用轻量 store 或 React Query，重点是不要与聊天状态混合。

---

## 11.6 渲染隔离

要求：

- 状态面板更新不触发消息列表全量重渲染；
- 消息流更新不触发记忆或人格面板重渲染；
- `MessageList` 内消息组件使用 memo；
- `StatusPanel` 只订阅 `AgentStateStore`;
- 不把状态事件塞进全局聊天消息数组作为唯一来源。

---

## 12. 初始化流程

## 12.1 服务端首次启动

1. 读取配置；
2. 连接 SQLite；
3. 执行迁移；
4. 如无默认 Agent，创建：
   - `agent-default`;
   - `persona_versions` version 1；
   - 初始状态 0 / 0；
5. 如无活跃会话，等待前端调用 `/api/bootstrap` 创建。

---

## 12.2 前端首次加载

```text
App mount
  ↓
GET /api/bootstrap
  ↓
初始化 ConversationStore
初始化 AgentStateStore
恢复最近消息
恢复当前状态
  ↓
渲染 ChatShell + StatusPanel
```

---

## 12.3 发送一条消息

```text
用户点击发送
  ↓
生成 clientMessageId
  ↓
POST /api/chat
  ↓
服务端写入用户消息
  ↓
生成状态事件
  ↓
流式返回 data-agent-state-event
  ↓
前端更新 StatusPanel
  ↓
服务端流式返回 Assistant 文本
  ↓
前端更新 MessageList
  ↓
服务端保存 Assistant 消息
```

---

## 13. 非功能设计

## 13.1 性能目标

| 指标 | 目标 |
|---|---:|
| 首次页面可交互 | < 1s 本地环境 |
| Bootstrap 接口 | < 200ms 常规本地数据 |
| 状态面板更新 | 用户不可感知延迟 |
| 首 token | < 2s，受外部 LLM 影响 |
| 本地 SQLite 查询 | 避免全表扫描，使用索引 |

---

## 13.2 可靠性

- 用户消息写入后再调用 LLM，避免模型失败导致用户输入丢失；
- Assistant 消息只在流完成后写入；
- 状态事件写入与状态快照更新放在同一事务；
- 支持客户端 AbortController 停止生成；
- 数据库迁移必须可回滚或可重建；
- 外部 LLM 失败不影响本地会话继续使用。

---

## 13.3 可观测性

服务端日志字段：

```text
request_id
route
agent_id
conversation_id
message_id
client_message_id
duration_ms
status
error_code
```

禁止记录：

- API Key；
- 完整用户消息；
- 完整 Assistant 回复；
- 完整 Prompt。

调试模式在 Phase 2 再展示更详细 Prompt 快照。

---

## 13.4 安全与隐私

- 后端只监听本机；
- API Key 只存在本地环境变量；
- 前端不接触 API Key；
- 外部 LLM 请求会携带近期对话内容，需在 UI 中说明；
- SQLite 数据不自动上传；
- 日志默认脱敏；
- CORS 仅允许本地前端地址。

---

## 14. 测试策略

## 14.1 共享类型与 schema 测试

验证：

- 情感状态范围；
- 聊天请求字段；
- API 错误结构；
- 设置范围。

建议使用 Zod 定义 schema 并导出类型。

---

## 14.2 状态引擎单元测试

必须覆盖：

- 正面情感词；
- 负面情感词；
- 唤醒度变化；
- 简单否定；
- 多线索叠加；
- 单轮变化上限；
- clamp 到 -1 / 1；
- 无线索时不生成事件；
- 六个离散标签分区正确；
- ±0.05 阈值边界归属；
- clamp 后再进行标签分类；
- 同一 trigger message 幂等。

---

## 14.3 PromptBuilder 测试

必须覆盖：

- 注入人格锚点；
- 只取最近窗口；
- 排除 failed 消息；
- 排除 system 消息；
- 当前消息始终存在；
- 不同 Agent 状态生成对应摘要。

---

## 14.4 API 测试

必须覆盖：

- Bootstrap 无初始化数据；
- Bootstrap 有历史数据；
- 首次 chat 写入用户消息；
- 重复 client_message_id 返回 409；
- 状态事件只写一次；
- LLM 失败时写入 failed Assistant 占位；
- 会话恢复最近消息；
- 404 与 400 错误结构。

---

## 14.5 前端测试

必须覆盖：

- 消息列表渲染；
- 流式更新时的消息占位；
- 状态面板展示当前值；
- 状态原因展示；
- 无状态事件时的空状态；
- 重复提交禁用；
- Bootstrap 失败提示。

---

## 14.6 Phase 0 冒烟验收

1. 启动前端和本地后端；
2. 页面打开后自动创建会话；
3. 发送消息收到流式回复；
4. 关闭页面后重新打开；
5. 最近消息恢复；
6. 数据库中能看到用户和 Assistant 消息。

---

## 14.7 MVP 验收

1. 连续聊 20 轮；
2. 刷新页面；
3. 最近消息恢复；
4. 当前状态恢复；
5. 提到“今天好累”时，愉悦度下降；
6. 状态面板展示原因；
7. 同一 `clientMessageId` 不重复入库；
8. 同一 `clientMessageId` 对应的消息不重复累计状态；
9. 状态面板更新不造成消息列表明显卡顿。

---

## 15. 实施里程碑

## M0. 项目骨架

任务：

- 建立 pnpm workspace；
- 创建 `apps/web`;
- 创建 `apps/server`;
- 创建 `packages/shared`;
- 配置 TypeScript；
- 配置 ESLint / Prettier；
- 配置 Vitest；
- 配置环境变量模板。

完成标准：

- 前后端能分别启动；
- 共享类型能被两边导入；
- 测试命令可运行。

---

## M1. 数据库与初始化

任务：

- 创建 SQLite 迁移；
- 创建 `agents`;
- 创建 `conversations`;
- 创建 `messages`;
- 创建 `state_events`;
- 创建 `persona_versions`;
- 按 [persona-core-v1.md](./persona-core-v1.md) 初始化锚点与 evolvable JSON;
- 创建 `app_settings`;
- 实现默认 Agent 初始化。

完成标准：

- 首次启动自动建库；
- 默认 Agent 存在；
- 人格 version 1 存在；
- 数据文件在 `data/agent.sqlite`。

---

## M2. Bootstrap 与会话恢复

任务：

- 实现 `/api/bootstrap`;
- 实现 `/api/conversations/:id`;
- 实现前端启动加载；
- 实现空状态和错误状态。

完成标准：

- 刷新后能恢复最近消息；
- 无会话时自动创建；
- 接口错误有统一结构。

---

## M3. 流式聊天与消息持久化

任务：

- 实现 `/api/chat`;
- 接入 LLM Provider;
- 实现 PromptBuilder;
- 实现流式响应；
- 保存用户和 Assistant 消息；
- 实现失败占位；
- 实现 client message 幂等。

完成标准：

- 可连续多轮聊天；
- 消息写入 SQLite;
- 重复请求返回 409；
- 失败后可重新发送。

---

## M4. 状态引擎

任务：

- 实现情感词典（PAD 三维，emotion-rules-v2）；
- 实现否定处理；
- 实现状态更新；
- 实现基线回归（时间衰减），衰减速率与基线为角色参数；
- 写入 `state_events`;
- 更新 Agent 快照；
- 在流中返回状态事件。

完成标准：

- 状态变化方向符合规则；
- 原因可展示；
- 隔夜后状态向角色基线回归；
- 同一消息不重复累计；
- 状态刷新后可恢复。

---

## M5. React 聊天与状态 UI

任务：

- 实现 ChatShell;
- 实现 MessageList;
- 实现 MessageComposer;
- 实现 StatusPanel;
- 实现 AgentStateStore;
- 实现状态事件订阅；
- 实现基础样式。

完成标准：

- MVP 验收全部通过；
- 状态面板和消息列表更新互不造成明显重渲染问题。

---

## M6. LLM 连接设置

任务：

- 扩展 `app_settings` 键与校验；
- 扩展 settings API：读取掩码状态、写入连接配置；
- 实现连接测试接口；
- Provider 在设置变更后热重建；
- 实现 SettingsPanel 的 LLM 连接区块。

完成标准：

- 前端可查看端点与模型；
- 可修改端点与模型并立即生效；
- 可写入 Key，且任何响应不回显完整 Key；
- 测试连接返回明确成功或失败原因。

---

## 16. 关键技术风险

| 风险 | 影响 | 应对 |
|---|---|---|
| Vercel AI SDK 版本协议变化 | 流式接口返工 | Phase 0 锁版本并写协议集成测试 |
| 自定义 data part 行为不确定 | 状态无法随流更新 | 先做小型验证；失败则改为流结束后读取状态 |
| SQLite 并发写入 | 数据不一致 | 本地单用户仍使用串行写事务 |
| LLM 响应失败 | 用户认为消息丢失 | 用户消息先入库，Assistant 写 failed 占位 |
| 状态规则误判 | 用户不信任状态 | evidence + confidence + rule_version 可追踪 |
| 前端消息与状态耦合 | 性能和复杂度问题 | 拆分 store，禁止状态面板依赖消息数组 |
| 未来多 Agent 数据串扰 | 记忆和人格混乱 | 所有表从 MVP 开始携带 agent_id |
| 数据库路径误提交 | 隐私泄漏 | data/ 加入 gitignore，提供清理命令 |

---

## 17. 当前明确不做

Phase 0 / MVP 不实现：

- 登录；
- 云端同步；
- PostgreSQL;
- 长期事实记忆；
- 摘要；
- 向量检索；
- 人格演化接口；
- 主动消息；
- 状态时间线；
- 虚拟列表；
- 移动端适配；
- 多 Agent 管理界面。

---

## 18. 后续文档

完成本文档评审后，建议继续编写：

```text
docs/database-schema.md
docs/api-contract.md
docs/react-architecture.md
```

如果 Phase 0 采用本文档的推荐结构，`database-schema.md` 可以先聚焦完整 SQL、索引和迁移顺序；`api-contract.md` 聚焦请求、响应、错误码和流式 data part 示例。
