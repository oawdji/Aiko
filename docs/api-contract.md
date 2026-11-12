# API 契约文档

项目：本地单用户拟人化聊天 Agent  
关联文档：[requirements.md](./requirements.md)、[technical-design.md](./technical-design.md)、[database-schema.md](./database-schema.md)  
后端框架：Hono  
传输协议：HTTP / Streaming  
版本：v1.3  
日期：2026-11-11

---

## 1. 文档范围

本文档定义 Phase 0 / MVP 阶段前后端之间的 API 契约，包括：

- Base URL；
- 请求与响应格式；
- 认证与本地访问边界；
- 错误结构；
- 分页规则；
- 启动恢复接口；
- 聊天流式接口；
- 状态事件传输；
- 设置接口；
- 幂等策略；
- 生命周期与失败处理。

Phase 2 及以后的记忆、人格演化、主动消息、导出删除接口不在本文档的 MVP 范围内，只保留未来扩展说明。

---

## 2. 总体约定

## 2.1 Base URL

本地开发环境：

```text
http://127.0.0.1:8787
```

前端访问 API 时统一使用：

```text
/api
```

示例：

```http
GET http://127.0.0.1:8787/api/bootstrap?agent=agent-default
```

## 2.2 服务暴露边界

当前为本地单用户应用：

- 后端默认只监听 `127.0.0.1`;
- 不提供公网访问；
- 不实现登录、Token、Session 或权限系统；
- 未增加认证前，不允许暴露到局域网或公网。

如果未来部署为多用户服务，必须先补充：

- 认证；
- 授权；
- CSRF 防护；
- 租户 / 用户隔离；
- 速率限制；
- 安全日志策略。

---

## 2.3 Content-Type

普通 JSON 请求：

```http
Content-Type: application/json
```

普通 JSON 响应：

```http
Content-Type: application/json; charset=utf-8
```

聊天流式响应使用 Vercel AI SDK UIMessage Stream，媒体类型为 `text/event-stream`（Phase 0 实测确认）。

---

## 2.4 字段命名

HTTP JSON 字段统一使用 camelCase。

数据库字段使用 snake_case，仅在服务端内部出现，不直接泄漏给前端。

示例：

```text
数据库：trigger_message_id
API：triggerMessageId
```

---

## 2.5 时间格式

所有时间字段使用 ISO 8601 UTC 字符串：

```text
2026-11-11T08:30:00.000Z
```

要求：

- 服务端生成；
- 前端展示时转换为本地时区；
- 前端传入的时间参数必须为 ISO 8601 字符串；
- 不接受相对时间字符串。

---

## 2.6 空值

统一使用 JSON `null` 表示空值。

避免使用：

```json
""
```

表示数据库或业务意义上的 null。

空字符串只允许出现在确实表示“内容为空字符串”的场景，例如调试输入。消息内容在 MVP 中不允许为空字符串。

---

## 2.7 请求 ID

每个请求可以携带：

```http
X-Request-Id: <uuid>
```

如果客户端未携带，服务端生成。

响应返回：

```http
X-Request-Id: <request-id>
```

服务端日志使用该 ID 关联一次请求。

---

## 3. 认证与安全

MVP 不实现认证，但必须遵守以下安全规则。

## 3.1 CORS

开发环境仅允许：

```text
http://127.0.0.1:5173
http://localhost:5173
```

不允许：

```text
*
```

## 3.2 请求体大小

建议限制：

```text
普通 JSON 请求体 <= 64 KB
聊天请求体 <= 128 KB
```

聊天消息文本单独限制见 `POST /api/chat`。

## 3.3 敏感信息

响应和错误信息中禁止出现：

- LLM API Key;
- 数据库文件绝对路径；
- 服务器操作系统细节；
- 完整堆栈信息；
- 未脱敏 Prompt。

---

## 4. 通用数据结构

以下类型建议放在：

```text
packages/shared/src/types
```

由前后端共同引用。

## 4.1 `AgentEmotionState`

```ts
export type AgentEmotionState = {
  valence: number;
  arousal: number;
  dominance: number;
};
```

约束：

```text
-1 <= valence <= 1
-1 <= arousal <= 1
-1 <= dominance <= 1
```

---

## 4.2 `EmotionTag`

```ts
export type EmotionTag =
  | "calm"
  | "curious"
  | "happy"
  | "low"
  | "tense"
  | "neutral";
```

---

## 4.3 `AgentStateEvent`

```ts
export type AgentStateEvent = {
  id: string;
  agentId: string;
  conversationId: string;
  triggerMessageId: string | null;
  source:
    | "user_message"
    | "assistant_message"
    | "time_decay"
    | "manual";
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

约束：

```text
0 <= confidence <= 1
source 为 user_message 或 assistant_message 时 triggerMessageId 必须非空
```

---

## 4.4 `ChatMessageDTO`

```ts
export type ChatMessageStatus =
  | "streaming"
  | "complete"
  | "failed";

export type ChatMessageRole =
  | "user"
  | "assistant"
  | "system";

export type ChatMessageDTO = {
  id: string;
  conversationId: string;
  agentId: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  errorCode: string | null;
  createdAt: string;
};
```

MVP 返回给前端的消息只包含纯文本内容，不暴露 `clientMessageId` 和内部 metadata。

---

## 4.5 `ConversationDTO`

```ts
export type ConversationDTO = {
  id: string;
  agentId: string;
  title: string | null;
  lastMessageAt: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};
```

---

## 4.6 `AgentDTO`

```ts
export type AgentDTO = {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  currentState: AgentEmotionState;
  currentTag: EmotionTag;
  stateUpdatedAt: string | null;
  /** 角色气质基线 μ（只读，衰减回归目标） */
  emotionBaseline: AgentEmotionState;
  /** 基线回归半程时间（小时，只读；null = 使用全局默认） */
  decayHalfLifeHours: number | null;
  personaVersion: number;
};
```

---

## 4.7 `AppSettings`

```ts
export type AppTheme = "light" | "dark" | "system";

export type AppSettings = {
  defaultAgentId: string;
  recentWindowRounds: number;
  maxContextMessages: number;
  theme: AppTheme;
};
```

约束：

```text
10 <= recentWindowRounds <= 15
20 <= maxContextMessages <= 30
maxContextMessages = recentWindowRounds * 2
```

---

## 4.8 `ApiError`

所有非流式错误响应使用统一结构：

```ts
export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};
```

示例：

```json
{
  "code": "INVALID_REQUEST",
  "message": "message must not be empty"
}
```

`details` 仅用于确定性、可展示的校验信息，不得包含敏感内部数据。

---

## 4.9 `LlmConnectionInfo`

```ts
export type LlmConnectionInfo = {
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeyHint: string | null;
};
```

约束：

- `apiKeyHint` 为掩码提示（如 `sk-***x3f`），不得包含完整 Key；
- `apiKeyConfigured` 为 `false` 时 `apiKeyHint` 必须为 `null`；
- 连接配置优先级：数据库设置 > 环境变量 > 未配置。

---

## 5. 错误码

## 5.1 MVP 错误码表

| HTTP 状态码 | code | 场景 | 前端处理 |
|---|---|---|---|
| 400 | `INVALID_REQUEST` | 参数校验失败 | 展示表单或请求错误 |
| 404 | `AGENT_NOT_FOUND` | Agent 不存在 | 提示初始化失败或 Agent 配置错误 |
| 404 | `CONVERSATION_NOT_FOUND` | 会话不存在 | 尝试重新 bootstrap 或新建会话 |
| 409 | `DUPLICATE_CLIENT_MESSAGE` | 同一 `clientMessageId` 重复提交 | 刷新会话，不重复追加消息 |
| 409 | `CONFLICT` | 未来通用冲突 | 展示冲突信息 |
| 413 | `MESSAGE_TOO_LONG` | 消息超过长度限制 | 提示缩短消息 |
| 422 | `RULE_VERSION_MISMATCH` | 预留 | MVP 通常不出现 |
| 429 | `RATE_LIMITED` | 预留 | 提示稍后重试 |
| — | `CLIENT_ABORTED` | 客户端主动中断生成；仅作为消息 `errorCode` 持久化，不作为 HTTP 错误响应返回 | 停止渲染；刷新后按失败气泡展示，可重新发送新消息 |
| 500 | `LLM_REQUEST_FAILED` | 外部模型调用失败 | 保留用户消息，展示重试 |
| 500 | `INTERNAL_ERROR` | 未分类服务端错误 | 展示通用错误 |

## 5.2 错误码稳定性

错误码属于前端契约，不能随意修改大小写或命名。

HTTP status 可以补充，但已有 code 的语义不能改变。

新增错误场景时优先：

1. 复用现有 code;
2. 必要时新增 code;
3. 不使用 `INTERNAL_ERROR` 表达业务错误。

---

## 6. 分页规则

MVP 主要使用倒序 limit + 游标分页。

## 6.1 请求参数

```text
limit: number
beforeId: string
```

示例：

```http
GET /api/agents/agent-default/state/events?limit=50&beforeId=state_xxx
```

## 6.2 响应结构

```ts
export type PageDTO<T> = {
  items: T[];
  nextPage: {
    limit: number;
    beforeId: string;
  } | null;
};
```

规则：

- 服务端按时间倒序返回；
- 如果还有更旧数据，返回 `nextPage`;
- 如果没有更多数据，`nextPage = null`;
- 客户端不自行猜测是否有下一页。

---

## 7. `GET /api/bootstrap`

## 7.1 用途

前端首次加载和页面刷新后的统一恢复入口。

职责：

- 读取或创建最近活跃会话；
- 恢复最近消息；
- 恢复当前 Agent 状态；
- 恢复最新状态事件；
- 返回本地设置。

## 7.2 请求

```http
GET /api/bootstrap?agent=agent-default
```

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `agent` | string | 否 | Agent slug 或 ID，默认 `default` |

MVP 建议支持：

```text
agent=default
agent=agent-default
```

如果两者同时存在且指向不同 Agent，返回 `400 INVALID_REQUEST`。

## 7.3 成功响应

```http
200 OK
```

```ts
export type BootstrapResponse = {
  user: {
    id: string;
  };
  agent: AgentDTO;
  conversation: ConversationDTO;
  messages: ChatMessageDTO[];
  latestStateEvent: AgentStateEvent | null;
  settings: AppSettings;
};
```

## 7.4 响应示例

```json
{
  "user": {
    "id": "local-user"
  },
  "agent": {
    "id": "agent-default",
    "slug": "default",
    "displayName": "Aiko",
    "description": null,
    "currentState": {
      "valence": -0.1,
      "arousal": -0.04,
      "dominance": -0.02
    },
    "currentTag": "low",
    "stateUpdatedAt": "2026-11-11T08:30:00.000Z",
    "emotionBaseline": {
      "valence": 0.05,
      "arousal": -0.02,
      "dominance": 0
    },
    "decayHalfLifeHours": 6,
    "personaVersion": 1
  },
  "conversation": {
    "id": "conv_018f6d2e-8fb4-7a1e-9f0f-4c1f7a9d0002",
    "agentId": "agent-default",
    "title": null,
    "lastMessageAt": "2026-11-11T08:30:00.000Z",
    "isArchived": false,
    "createdAt": "2026-11-11T08:00:00.000Z",
    "updatedAt": "2026-11-11T08:30:00.000Z"
  },
  "messages": [
    {
      "id": "msg_018f6d2e-8fb4-7a1e-9f0f-4c1f7a9d0001",
      "conversationId": "conv_018f6d2e-8fb4-7a1e-9f0f-4c1f7a9d0002",
      "agentId": "agent-default",
      "role": "user",
      "content": "今天好累",
      "status": "complete",
      "errorCode": null,
      "createdAt": "2026-11-11T08:29:59.000Z"
    }
  ],
  "latestStateEvent": {
    "id": "state_018f6d2e-8fb4-7a1e-9f0f-4c1f7a9d0003",
    "agentId": "agent-default",
    "conversationId": "conv_018f6d2e-8fb4-7a1e-9f0f-4c1f7a9d0002",
    "triggerMessageId": "msg_018f6d2e-8fb4-7a1e-9f0f-4c1f7a9d0001",
    "source": "user_message",
    "ruleVersion": "emotion-rules-v2",
    "before": {
      "valence": 0.03,
      "arousal": 0.01,
      "dominance": 0
    },
    "delta": {
      "valence": -0.1,
      "arousal": -0.04,
      "dominance": 0
    },
    "after": {
      "valence": -0.07,
      "arousal": -0.03,
      "dominance": 0
    },
    "discreteTag": "low",
    "reason": "你提到“累”，她的愉悦度略有下降。",
    "evidenceText": "累",
    "confidence": 0.7,
    "createdAt": "2026-11-11T08:30:00.000Z"
  },
  "settings": {
    "defaultAgentId": "agent-default",
    "recentWindowRounds": 15,
    "maxContextMessages": 30,
    "theme": "system"
  }
}
```

## 7.5 行为规则

1. 如果 Agent 不存在，返回 `404 AGENT_NOT_FOUND`;
2. 如果存在活跃会话，返回最近活跃会话；
3. 如果没有活跃会话，创建新会话并返回空 `messages`;
4. 消息按时间升序返回；
5. 默认最多返回 30 条消息；
6. `latestStateEvent` 为空时，前端使用 `agent.currentState` 初始化状态面板。

---

## 8. `GET /api/conversations/:id`

## 8.1 用途

恢复指定会话的消息和状态。

## 8.2 请求

```http
GET /api/conversations/:id?limit=30
```

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 会话 ID |

Query 参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---:|---|
| `limit` | number | 否 | 30 | 返回消息数量 |
| `beforeId` | string | 否 | null | 向更旧消息分页 |

限制：

```text
1 <= limit <= 100
```

## 8.3 成功响应

```http
200 OK
```

```ts
export type ConversationDetailResponse = {
  conversation: ConversationDTO;
  agent: AgentDTO;
  messages: ChatMessageDTO[];
  latestStateEvent: AgentStateEvent | null;
  nextPage: {
    limit: number;
    beforeId: string;
  } | null;
};
```

## 8.4 行为规则

- 会话不存在返回 `404 CONVERSATION_NOT_FOUND`;
- 消息按时间倒序查询，返回给前端前反转为升序；
- `nextPage.beforeId` 使用当前返回结果中最旧一条消息的 ID;
- 最新状态事件仍按 Agent 查询，不限制在当前会话内，以保持状态连续性。

---

## 9. `GET /api/agents/:agentId/state`

## 9.1 用途

读取 Agent 当前状态快照。

## 9.2 请求

```http
GET /api/agents/:agentId/state
```

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `agentId` | string | 是 | Agent ID 或 slug |

## 9.3 成功响应

```http
200 OK
```

```ts
export type AgentStateResponse = {
  agentId: string;
  state: AgentEmotionState;
  discreteTag: EmotionTag;
  stateUpdatedAt: string | null;
};
```

## 9.4 响应示例

```json
{
  "agentId": "agent-default",
  "state": {
    "valence": 0.12,
    "arousal": 0.08,
    "dominance": 0.1
  },
  "discreteTag": "happy",
  "stateUpdatedAt": "2026-11-11T08:30:00.000Z"
}
```

---

## 10. `GET /api/agents/:agentId/state/events`

## 10.1 用途

分页读取状态历史事件。

## 10.2 请求

```http
GET /api/agents/:agentId/state/events?limit=50&beforeId=state_xxx
```

Query 参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---:|---|
| `limit` | number | 否 | 50 | 每页数量 |
| `beforeId` | string | 否 | null | 游标事件 ID |

限制：

```text
1 <= limit <= 200
```

## 10.3 成功响应

```http
200 OK
```

```ts
export type StateEventPageResponse = {
  items: AgentStateEvent[];
  nextPage: {
    limit: number;
    beforeId: string;
  } | null;
};
```

## 10.4 行为规则

- 按 `createdAt` 倒序返回；
- 同一毫秒内可能存在多条事件时，服务端必须追加稳定排序键；
- `nextPage.beforeId` 使用当前页最后一条事件 ID;
- MVP 只按 Agent 查询，不强制按会话过滤；
- Phase 2 增加时间范围过滤时，需保证与游标分页兼容。

---

## 11. `GET /api/settings`

## 11.1 请求

```http
GET /api/settings
```

## 11.2 成功响应

```http
200 OK
```

```ts
export type SettingsResponse = {
  settings: AppSettings;
  llm: LlmConnectionInfo;
};
```

---

## 12. `PATCH /api/settings`

## 12.1 请求

```http
PATCH /api/settings
Content-Type: application/json
```

```ts
export type UpdateSettingsRequestBody = {
  theme?: AppTheme;
  recentWindowRounds?: number;
  maxContextMessages?: number;
  llmBaseUrl?: string;
  llmModel?: string;
  llmApiKey?: string | null;
};
```

## 12.2 请求示例

```json
{
  "theme": "dark",
  "recentWindowRounds": 12,
  "maxContextMessages": 24
}
```

## 12.3 成功响应

```http
200 OK
```

```ts
export type SettingsResponse = {
  settings: AppSettings;
  llm: LlmConnectionInfo;
};
```

## 12.4 校验规则

| 字段 | 规则 |
|---|---|
| `theme` | `light` / `dark` / `system` |
| `recentWindowRounds` | 10 到 15 的整数 |
| `maxContextMessages` | 20 到 30 的整数 |
| `maxContextMessages` | 必须等于 `recentWindowRounds * 2` |
| `llmBaseUrl` | 合法 http(s) URL |
| `llmModel` | 非空字符串 |
| `llmApiKey` | 非空字符串或 `null`；`null` 表示清除已保存的 Key |

如果请求同时传两个字段但不满足关系，返回：

```text
400 INVALID_REQUEST
```

如果只传 `recentWindowRounds`，服务端可自动推导 `maxContextMessages` 并返回最终设置。

如果只传 `maxContextMessages`，必须能整除 2，且推导出的轮数在 10 到 15 之间；否则返回 400。

## 12.5 禁止修改字段

MVP 不允许通过该接口修改：

```text
defaultAgentId
```

原因是当前只有一个默认 Agent，切换逻辑未实现。

## 12.6 `POST /api/settings/llm/test`

用途：使用当前生效的 LLM 连接配置发起一次最小模型请求，验证可用性。

请求：无请求体。

响应：

```ts
export type LlmConnectionTestResponse = {
  ok: boolean;
  latencyMs: number;
  errorCode: string | null;
};
```

规则：

- 该接口会产生一次真实 LLM 调用；
- 测试结果不改变现有配置；
- `llmApiKey` 只写不读，任何响应均不得回显完整 Key；
- 失败时 `errorCode` 使用现有错误码（如 `LLM_REQUEST_FAILED`），不暴露 Key 或完整 Prompt。

---

## 13. `POST /api/chat`

## 13.1 用途

发送用户消息，返回 Assistant 流式回复，并在同一条流中携带状态事件。

## 13.2 请求

```http
POST /api/chat
Content-Type: application/json
```

```ts
export type ChatRequestBody = {
  agentId: string;
  conversationId: string;
  message: string;
  clientMessageId: string;
};
```

## 13.3 请求示例

```json
{
  "agentId": "agent-default",
  "conversationId": "conv_018f6d2e-8fb4-7a1e-9f0f-4c1f7a9d0002",
  "message": "今天好累",
  "clientMessageId": "client_018f6d2e-8fb4-7a1e-9f0f-4c1f7a9d0100"
}
```

## 13.4 字段规则

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `agentId` | string | 是 | Agent ID 或 slug，默认建议直接使用 ID |
| `conversationId` | string | 是 | 必须存在且属于该 Agent |
| `message` | string | 是 | trim 后非空，长度 1 到 8000 |
| `clientMessageId` | string | 是 | 前端生成，建议 UUID，同一会话内唯一 |

前端生成 `clientMessageId` 的时机：

```text
用户成功触发一次发送时生成
```

不得在输入框每次变化时生成，也不得在同一输入重复提交时重复生成新 ID 规避幂等。

## 13.5 处理流程

```text
1. 校验请求
2. 校验 Agent
3. 校验 conversation 属于 Agent
4. 检查 clientMessageId 幂等
5. 事务写入用户消息
6. 执行情绪抽取
7. 如状态变化，写入 state_event 并更新 agents 快照
8. 构建近期上下文 Prompt
9. 调用 LLM
10. 返回 UIMessage Stream
11. Assistant 文本流式传给前端
12. 流完成后保存 Assistant 消息
```

## 13.6 成功响应

返回 Vercel AI SDK UIMessage Stream。

MVP 至少包含：

1. Assistant 文本增量；
2. 一个 `data-agent-state-event` 数据 part，如果本条用户消息触发了状态事件。

## 13.7 自定义 data part

逻辑结构：

```ts
export type AgentStateEventData = {
  event: AgentStateEvent;
};
```

概念示例：

```json
{
  "type": "data-agent-state-event",
  "data": {
    "event": {
      "id": "state_018f6d2e-8fb4-7a1e-9f0f-4c1f7a9d0003",
      "agentId": "agent-default",
      "conversationId": "conv_018f6d2e-8fb4-7a1e-9f0f-4c1f7a9d0002",
      "triggerMessageId": "msg_018f6d2e-8fb4-7a1e-9f0f-4c1f7a9d0001",
      "source": "user_message",
      "ruleVersion": "emotion-rules-v2",
      "before": {
        "valence": 0.03,
        "arousal": 0.01,
        "dominance": 0
      },
      "delta": {
        "valence": -0.1,
        "arousal": -0.04,
        "dominance": 0
      },
      "after": {
        "valence": -0.07,
        "arousal": -0.03,
        "dominance": 0
      },
      "discreteTag": "low",
      "reason": "你提到“累”，她的愉悦度略有下降。",
      "evidenceText": "累",
      "confidence": 0.7,
      "createdAt": "2026-11-11T08:30:00.000Z"
    }
  }
}
```

> **Phase 0 实测记录**（2026-11-11，锁定版本：`ai@7.0.166` + `@ai-sdk/react@4.0.170`，package.json 已固定精确版本）：
>
> 1. 传输格式为 SSE（`Content-Type: text/event-stream`），每帧形如 `data: {...}`；
> 2. 自定义数据 part 实际线格式：`{"type":"data-agent-state-event","data":{...},"id":"state_xxx"}`；
> 3. 文本增量 part 使用 `delta` 字段：`{"type":"text-delta","id":"...","delta":"..."}`（v5 为 `text`，v7 已改名）；
> 4. 写入顺序可控：先写 data part 再写 text-delta，前端按相同顺序接收；
> 5. 服务端 `createUIMessageStream` 返回 `ReadableStream`，需用 `createUIMessageStreamResponse({ stream })` 构造响应；
> 6. 前端通过 `useChat` 的 `message.parts` 读取数据 part（`type === 'data-agent-state-event'`），`stop()` 中断流可用；
> 7. 以上结论经 mock 端点、单元测试与浏览器验证；DeepSeek 真实端点行为已于 2026-11-12 经 M3 冒烟实测补充确认（见下）。
>
> 前端不得解析底层 chunk，只能通过 SDK 暴露的 message parts 或官方 adapter 读取。
> **M3 真实链路实测记录**（2026-11-12，DeepSeek `https://api.deepseek.com` + `deepseek-chat`，Key 经设置面板写入 `app_settings`）：
>
> 1. **流式输出**：200 + `text/event-stream`，文本增量经 `DefaultChatTransport` 正常接收。期间发现并修复：AI SDK 标准 payload（`{id, messages, trigger, messageId}`）与 §13.1 扁平契约体不一致，需在 `prepareSendMessagesRequest` 中映射（`clientMessageId` 取 AI SDK 消息 id，天然满足 §14 幂等语义）；
> 2. **刷新恢复顺序**：发现并修复同毫秒消息乱序——一轮对话 user/assistant 曾共用同一 `createdAt` 且 tie-break 为随机 UUID id；现 assistant 落库使用完成时刻时间戳，bootstrap/会话分页 tie-break 改为 `rowid`（插入序），并有回归测试锁定；
> 3. **情绪状态事件**：含情绪词消息触发 data part 先于文本到达，状态面板同步更新；`EMOTION_ENGINE=off` 可整体关闭（不产生事件、不更新快照）；
> 4. **多轮上下文**：追问可正确引用前文（DB 近期窗口 30 条）；
> 5. **停止生成**：中断可用，失败占位按 §15 落库；
> 6. **幂等（§14）**：同一 `clientMessageId` 二次提交实测返回 `409 DUPLICATE_CLIENT_MESSAGE` + `details.existingMessageId`，库内仅一条 user 消息；409 后前端经 `GET /api/conversations/:id` 刷新，不重试同一 id；
> 7. **LLM 设置接口（§11/§12/§12.6）**：GET 掩码回显（`****后四位`，任何响应不回显完整 Key）、PATCH 热生效（无需重启）、`llm/test` 真实连通性测试均实测通过。

## 13.8 无状态变化时

如果用户消息没有触发情绪线索：

```text
不发送 data-agent-state-event
```

前端保持当前状态面板不变，不显示新的原因。

---

## 14. 聊天幂等契约

## 14.1 数据库约束

```text
UNIQUE (conversation_id, client_message_id)
```

## 14.2 首次请求

```text
201 / streaming response
```

实际 HTTP 状态由流式协议决定，但业务语义为“已接受并开始生成”。

## 14.3 重复请求

如果同一 `conversationId + clientMessageId` 再次提交，返回：

```http
409 Conflict
```

```json
{
  "code": "DUPLICATE_CLIENT_MESSAGE",
  "message": "This message has already been submitted."
}
```

可选 `details`：

```json
{
  "existingMessageId": "msg_018f6d2e-8fb4-7a1e-9f0f-4c1f7a9d0001"
}
```

是否暴露 `existingMessageId` 可以在实现时决定；一旦写入契约，就必须稳定保留。

## 14.4 前端处理规则

收到 `409 DUPLICATE_CLIENT_MESSAGE` 后：

1. 不追加新的用户消息；
2. 不重试同一 `clientMessageId`;
3. 调用 bootstrap 或会话接口刷新；
4. 恢复服务端真实消息列表；
5. 如仍在输入框中，保留未发送内容。

---

## 15. 聊天失败契约

## 15.1 用户消息写入失败

返回普通 JSON 错误：

```http
400 / 404 / 409 / 500
```

此时前端可以保留输入内容并允许用户重新发送。

如果失败原因是 `409`，不得允许用户用同一个 `clientMessageId` 重发。

## 15.2 用户消息已入库，LLM 调用失败

服务端行为：

1. 保留用户消息；
2. 保留已生成的状态事件；
3. 写入 Assistant 失败占位消息：

```text
status = failed
errorCode = LLM_REQUEST_FAILED
```

4. 向前端返回可识别错误。

前端行为：

1. 用户消息保持显示；
2. 显示失败占位或错误提示；
3. 提供重新生成 / 重新发送操作；
4. 不自动无限重试。

MVP 可以先实现“重新发送一条新消息”，不强制实现“重新生成上一条”。

## 15.3 客户端主动中断

前端调用 AbortController 停止生成时：

```text
服务端应停止继续向客户端传输
```

是否保存部分 Assistant 内容由实现统一决定。MVP 建议策略：

- 未完成流的 Assistant 内容不保存为 complete;
- 可保存为 failed，`errorCode = CLIENT_ABORTED`;
- 已完成部分文本可存入 content，便于调试，但 Prompt 组装时排除 failed 消息。

错误码 `CLIENT_ABORTED` 属于 Phase 0 契约，但它只作为消息 `errorCode` 持久化和前端失败气泡展示使用，不作为 HTTP 错误响应码返回。

前端中断后的行为：

1. 本地立即停止渲染；
2. 刷新或重启后，该轮以 `failed + CLIENT_ABORTED` 消息展示；
3. 用户可重新发送新消息，生成新的 `clientMessageId`；
4. MVP 不支持基于原消息重新生成上一轮回复。

---

## 16. 聊天时序契约

## 16.1 成功流程

```text
Frontend                   Server                       SQLite

POST /api/chat
  │
  ├────────────────────────►
  │                         validate
  │                         insert user message
  │                         create state event
  │                         ─────────────────────────────►
  │                         build prompt
  │                         call LLM
  │
  │ ◄────────────────────── stream state data part
  │
  │ ◄────────────────────── stream text delta
  │ ◄────────────────────── stream text delta
  │
  │                         insert assistant complete
  │                         ─────────────────────────────►
```

## 16.2 前端更新顺序

前端收到状态事件后应立即更新：

```text
AgentStateStore
StatusPanel
```

文本增量继续更新：

```text
useChat message stream
MessageList
```

两者不要求强同步顺序，但状态事件的 `triggerMessageId` 必须能对应到已发送的用户消息。

---

## 17. 请求校验

## 17.1 校验库

建议使用：

```text
Zod
```

schema 放在：

```text
packages/shared/src/schemas
```

并导出静态类型。

## 17.2 校验失败响应

```http
400 Bad Request
```

```json
{
  "code": "INVALID_REQUEST",
  "message": "Validation failed",
  "details": [
    {
      "path": ["message"],
      "message": "message must not be empty"
    }
  ]
}
```

`details` 格式可在实现时细化，但必须保持稳定。

## 17.3 消息长度

```text
trim(message).length >= 1
message.length <= 8000
```

长度按 JavaScript UTF-16 字符串长度统计，避免前端和服务端因 Unicode 字节数产生不一致。

---

## 18. 响应状态码使用规则

| 状态码 | 使用场景 |
|---|---|
| 200 | 读取、更新成功 |
| 201 | 创建资源成功；聊天流式响应以协议实际约定为准 |
| 400 | 请求参数错误 |
| 401 | MVP 不使用 |
| 403 | MVP 不使用 |
| 404 | 资源不存在 |
| 409 | 幂等冲突或资源冲突 |
| 413 | 请求体或消息过长 |
| 422 | 语义校验失败，预留 |
| 429 | 限流，预留 |
| 500 | 服务端或外部 LLM 失败 |

---

## 19. OpenAPI 与类型同步策略

MVP 可以暂缓提供完整 OpenAPI 文件，但必须满足：

1. 请求 / 响应 TypeScript 类型放在 `packages/shared`;
2. Zod schema 与类型一起维护；
3. API 路由 handler 引用共享类型；
4. 前端 API client 不手写不一致的第二套类型；
5. 集成测试断言实际响应 shape。

Phase 2 前建议生成或手写：

```text
docs/openapi.yaml
```

用于后续记忆、人格和设置接口扩展。

---

## 20. 前端 API Client 建议

建议创建：

```text
apps/web/src/shared/api/client.ts
```

统一处理：

- Base URL;
- JSON 解析；
- ApiError 归一化；
- Request ID;
- AbortController;
- 超时；
- 日志。

禁止在组件中直接调用：

```ts
fetch(...)
```

组件只能调用领域函数，例如：

```ts
fetchBootstrap()
fetchConversation(id)
fetchAgentState(agentId)
updateSettings(patch)
```

---

## 21. 测试要求

## 21.1 API Contract 测试

必须覆盖：

- Bootstrap 空数据库；
- Bootstrap 已有会话；
- Bootstrap 消息升序；
- Conversation 404;
- State 快照返回；
- State events 分页；
- Settings 校验；
- Chat 请求校验；
- Chat 重复 clientMessageId 返回 409;
- Chat 状态事件只写一次；
- Chat LLM 失败返回错误码；
- 错误响应统一结构。

## 21.2 流式协议测试

Phase 0 必须验证：

- 文本 delta 可以被前端 SDK 接收；
- 自定义 data part 可以被 SDK 暴露；
- data part 与文本 delta 的接收顺序符合设计；
- 流中断时前端能收到错误或 abort 状态；
- 服务端能在流结束后写入 Assistant complete 消息。

## 21.3 幂等测试

同一请求体重复提交：

```text
第一次：接受
第二次：409 DUPLICATE_CLIENT_MESSAGE
```

数据库验证：

```text
messages 只新增一条
state_events 只新增一条
agents 状态快照只变化一次
```

---

## 22. 未来扩展接口预留

以下接口不在 MVP 中实现，仅预留命名方向。

## 22.1 记忆接口

```http
GET    /api/memories
PATCH  /api/memories/:id
DELETE /api/memories/:id
POST   /api/memories/:id/confirm
POST   /api/memories/:id/reject
```

## 22.2 人格接口

```http
POST /api/persona/propose
GET  /api/persona/proposals
POST /api/persona/proposals/:id/approve
POST /api/persona/proposals/:id/reject
POST /api/persona/versions/:version/rollback
```

## 22.3 主动消息接口

```http
POST /api/proactive/evaluate
```

只在浏览器页面打开期间由前端调用，不作为后端离线调度入口。

## 22.4 数据控制接口

```http
GET    /api/export
DELETE /api/data
```

实现前必须先设计删除范围、索引失效和派生数据处理。

---

## 23. 契约变更规则

1. 新增可选字段不视为破坏性变更；
2. 删除字段、修改字段类型、修改枚举值、修改错误码语义均视为破坏性变更；
3. 破坏性变更必须同步更新：
   - `packages/shared` 类型；
   - Zod schema;
   - 前端 API client;
   - 集成测试；
   - 本文档；
4. 涉及流式协议的变更必须先做小型验证；
5. 所有 API 契约变更需记录版本和日期。

当前版本：

```text
API contract v1.3
```
