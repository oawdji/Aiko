# 拟人化聊天 Agent 需求文档

版本：v1.3（修订版）  
前端技术栈：React 18+ / TypeScript  
日期：2026-11-11

---

## 1. 产品定位

本产品是一个具有稳定人格、分层记忆、可感知状态，并能在受控范围内缓慢成长的拟人化聊天 Agent。

它不是“带聊天框的工具”，而是一个连续存在的对话角色。用户可以和她聊天，看到她的状态变化，理解这些变化的原因，查看并修正她记得的内容，并在明确确认后调整她的表达风格。

### 1.1 产品形态

本项目采用前后端架构：

- **React 前端**：负责聊天界面、状态面板、状态时间线、记忆查看器和人格编辑入口；在主动消息功能中负责页面存活期间的空闲计时与触发。
- **后端服务**：负责 LLM 调用、Prompt 组装、消息持久化、状态更新、记忆抽取与检索、人格治理，以及由前端页面触发的主动消息策略评估。
- **持久化存储**：当前版本固定使用本地 SQLite。PostgreSQL + pgvector 仅作为未来多用户或大规模部署的迁移方向。

> 重要：本产品不是纯浏览器离线应用。长期记忆、跨 session 恢复和人格演化依赖本地后端与 SQLite 持久化。主动消息当前仅发生在浏览器页面打开期间，不做浏览器关闭后的系统通知或离线推送。

### 1.2 目标用户与部署假设

当前版本的明确边界：

- 本地单用户应用；
- 暂不实现登录、注册、账号体系和权限系统；
- 本地服务建议仅监听 `127.0.0.1`，不默认暴露到局域网或公网；
- 所有业务数据保存在本机 SQLite；
- 当前先支持一个主要 Agent 角色；
- 数据模型和页面结构预留 `agent_id`，未来支持多 Agent / 多人格。

预留以下扩展能力：

- 多 Agent / 多人格管理；
- 云端部署；
- 多用户访问；
- PostgreSQL 存储。

如果后续切换为多用户线上服务，鉴权、数据隔离、隐私合规和访问控制将成为必须项。

---

## 2. 核心原则

### 2.1 React 是主前端框架

聊天 UI、状态面板、记忆查看器、人格编辑入口均以 React 组件形式组织。状态更新通过 React 的响应式模型驱动 UI。

但不在 React 中实现复杂业务规则。以下逻辑必须由后端负责：

- 状态更新；
- 记忆抽取；
- 记忆检索；
- 人格演化；
- Prompt 组装；
- 权限与治理。

### 2.2 状态必须可见、可解释、可追溯

用户看到的不是孤立数字，而是具有因果链的状态事件：

> 用户提到“今天很累” → 情绪抽取结果为负面 → 愉悦度从 +0.20 调整为 -0.05 → 面板展示变化原因。

每个状态变化都必须有：

- 旧值；
- 新值；
- 变化量；
- 触发来源；
- 证据文本；
- 时间戳；
- 唯一事件 ID。

### 2.3 人格骨架稳定，血肉受控演化

系统使用固定人格锚点保证长期一致性。人格锚点不可被 LLM 或普通聊天消息修改。

可演化片段只能通过：

1. 用户显式请求；
2. 后端生成结构化提案；
3. 前端展示 diff；
4. 用户明确确认；
5. 后端校验并写入版本化存储。

禁止自然语言直接覆盖 System Prompt。

### 2.4 记忆透明、可修正、可删除

Agent 记住的内容必须对用户可见。用户可以：

- 查看记忆；
- 修正记忆；
- 删除记忆；
- 导出数据；
- 了解记忆来源。

删除或修正记忆后，检索索引和相关 Prompt 组装结果必须同步失效或重建。

### 2.5 隐私与安全优先

本产品会持续收集用户情绪、偏好、生活事件和长期记忆，属于高敏感数据。系统必须提供明确的数据控制能力，并防止情绪状态被用于操纵用户。

---

## 3. 核心概念与数据边界

### 3.1 实体定义

| 概念 | 说明 |
|---|---|
| `user_id` | 用户身份。当前本地单用户且无登录系统，使用固定本地 ID；未来多用户部署时再替换为真实账号体系。 |
| `agent_id` | Agent / 人格实例 ID。当前版本只需一个默认 Agent，但所有消息、记忆、状态和人格数据都必须从 MVP 开始携带该字段，为未来多角色做准备。 |
| `conversation_id` | 一次连续对话。用于组织消息和近期上下文。 |
| `message_id` | 单条消息的唯一 ID。 |
| `state_event_id` | 单次状态变化事件的唯一 ID。 |
| `memory_id` | 单条长期记忆的唯一 ID。 |

### 3.2 长期记忆归属

长期记忆不应按浏览器 `session_id` 隔离，否则无法实现“第二天还记得昨天的话题”。

长期记忆归属定义为：

```text
owner_id = user_id + agent_id
```

即：

- 同一用户与同一 Agent 共享长期记忆；
- 不同用户之间严格隔离；
- 不同 Agent 或人格之间默认隔离；
- `conversation_id` 只用于近期上下文和消息组织，不作为长期记忆隔离边界。

### 3.3 会话恢复策略

浏览器刷新或关闭后：

- 最近对话从后端恢复；
- 当前状态从后端恢复；
- 长期记忆保持可用；
- 不依赖浏览器本地存储作为唯一数据源。

浏览器端缓存只作为体验优化，不作为事实来源。

---

## 4. 用户故事

| 编号 | 用户故事 | 对应能力 | 阶段 |
|---|---|---|---|
| US1 | 我能和她连续聊 20 轮，她不忘记刚才说过的话。 | 多轮上下文 | MVP |
| US2 | 当我说“今天好累”时，我能看到愉悦度变化，并看到解释原因。 | 状态更新与原因展示 | MVP |
| US3 | 我关闭网页第二天再打开，她记得昨天聊过的具体话题。 | 跨 session 记忆 | Level 1 |
| US4 | 我提到“上次那个朋友”，她能定位相关记忆。 | 语义检索 | Level 2 |
| US5 | 我要求“以后更简洁一点”，系统生成提案，我确认后生效。 | 受控人格演化 | Level 2 |
| US6 | 我能查看她记得关于我的哪些事实，并修正或删除。 | 记忆透明与编辑 | Level 1 |
| US7 | 我能查看状态历史曲线和每次变化原因。 | 状态时间线 | Level 1 |
| US8 | 我能关闭主动消息，或设置不同打扰模式。 | 主动行为控制 | Level 3 |
| US9 | 我能导出或删除全部数据。 | 数据控制 | Level 1 |
| US10 | 我能查看某轮回答使用了哪些记忆和状态。 | 调试与可观测性 | Level 1 |

---

## 5. 功能需求

## 5.1 React 前端架构

### F1. 聊天界面

**优先级：MVP 必须**

实现：

- 消息气泡；
- 用户与 Agent 消息区分；
- 输入框；
- 发送状态；
- 流式渲染；
- 停止生成；
- 加载与错误状态；
- 空状态；
- 消息时间戳。

技术方案：

- 使用 React 18+；
- 使用 TypeScript；
- MVP 采用 Vercel AI SDK `useChat` 或兼容其协议的自定义流式 Hook；
- 长期目标按结构化 parts 渲染，支持 text、reasoning、tool 等类型；MVP 仅实现纯文本消息渲染；
- 具体字段以当前选定版本的 Vercel AI SDK 类型定义为准。

### F2. 聊天技术方案唯一性

**优先级：MVP 必须**

MVP 只能选择一种聊天架构方案。

默认方案：

```text
Vite + React + TypeScript + Vercel AI SDK useChat + 自研聊天外壳
```

CopilotKit 和 assistant-ui 仅作为备选评估项，不在 MVP 中同时引入。

如果后续发现自研外壳成本过高，需经过技术评审后替换为其中一种，并同步修订：

- 消息状态边界；
- 流式协议；
- 工具调用展示；
- 会话恢复接口；
- 测试方案。

### F3. 前端状态管理

**优先级：MVP 必须**

聊天消息流、状态面板、记忆查看器和人格编辑器使用解耦的数据管理：

```text
ChatState（useChat / 自研 adapter）  管理消息流与输入状态
AgentStateStore  管理 Agent 当前状态与状态事件
MemoryStore      管理记忆列表与编辑状态
PersonaStore     管理人格版本与待审提案
```

要求：

- 状态面板更新不得触发完整消息列表重渲染；
- 消息流更新不得触发状态面板和记忆查看器的大范围重渲染；
- 使用 Zustand、Context 或 React Query 时必须明确模块边界；
- 不强制引入 Redux。

### F4. 长列表性能

**优先级：Level 1**

当单次页面渲染消息超过 200 条时，引入虚拟列表。

可选库：

- `@tanstack/react-virtual`。

MVP 不强制引入虚拟列表。

---

## 5.2 状态系统

### F5. 二维情感状态

**优先级：MVP 必须**

基础状态包含：

```ts
type AgentEmotionState = {
  valence: number; // 愉悦度，-1 到 1
  arousal: number; // 唤醒度，-1 到 1
};
```

MVP 状态更新规则：

1. 对用户消息进行情绪线索抽取；
2. 依据规则计算变化量；
3. MVP 仅累加变化量并 clamp 到 [-1, 1]；惯性与时间衰减延后至 Level 1；
4. 输出状态事件。

MVP 可使用关键词词典 + 规则实现，但接口设计必须允许后续替换为 LLM 结构化抽取。

### F6. 情绪抽取结果结构

**优先级：MVP 必须**

每轮输出结构化抽取结果：

```ts
type EmotionExtraction = {
  valenceDelta: number;
  arousalDelta: number;
  evidenceText: string;
  confidence: number;
  source:
    | "user_message"
    | "assistant_message"
    | "time_decay"
    | "manual";
};
```

要求：

- `valenceDelta` 与 `arousalDelta` 范围由后端统一限制；
- `confidence` 范围为 0 到 1；
- `evidenceText` 来自实际消息或系统规则；
- 低置信度事件可以记录，但不应产生大幅状态变化。

### F7. 状态事件

**优先级：MVP 必须**

每次状态变化生成不可变事件：

```ts
type AgentStateEvent = {
  id: string;
  agentId: string;
  conversationId: string;
  triggerMessageId: string | null;
  source: EmotionExtraction["source"];
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

状态事件必须满足：

- 幂等：同一 `triggerMessageId`、来源与规则版本不重复累计；
- 可追溯：能还原任意时刻状态；
- 可审计：前端和调试模式可查看；
- 可恢复：页面刷新后从后端读取最新状态。

### F8. 状态更新时机

**优先级：MVP 必须**

默认策略：

1. 用户发送消息后，系统先执行初步情绪抽取；
2. Agent 回复完成后，系统可依据回复内容生成辅助事件；
3. 流式失败或中断时，用户消息触发的事件可保留，但需标记异常；
4. 同一 `clientMessageId` 重复提交不得重复累计状态；用户以新 ID 重发同样内容属于新一轮状态更新。

状态更新不得依赖前端本地时间作为唯一依据。

### F9. 状态面板

**优先级：MVP 必须**

React 组件结构：

```tsx
<StatusPanel>
  <EmotionBars valence={state.valence} arousal={state.arousal} />
  <ReasonLine text={latestEvent.reason} />
  <EmotionTag tag={discreteTag} />
</StatusPanel>
```

要求：

- 横条从中点向两侧延伸；
- 每个值展示变化方向；
- 展示最近一次状态变化原因；
- 说明这是内部模拟状态，不是真实人类情绪。

### F10. 离散情感标签

**优先级：MVP 必须**

后端根据连续状态输出离散标签：

```ts
type EmotionTag =
  | "calm"
  | "curious"
  | "happy"
  | "low"
  | "tense"
  | "neutral";
```

前端通过映射表展示颜色、文案和 emoji，不依赖 Avatar 也能感知状态。

映射规则以技术设计文档 §10.7 的 `emotion-rules-v1` 为准。

### F11. 状态时间线

**优先级：Level 1**

展示最近 50 到 200 次状态事件：

- 折线图展示 valence 与 arousal；
- 横轴为时间；
- 点击数据点查看触发消息和证据文本；
- 支持跳转到对应消息。

默认使用 Recharts。

### F12. 状态推送方式

**优先级：MVP 必须**

MVP 不引入 WebSocket。

状态更新通过聊天流中的自定义数据 part `data-agent-state-event` 返回：

```ts
type AgentStateEventData = {
  event: AgentStateEvent;
};
```

Level 1 可增加 SSE 推送，用于后台状态变化或主动消息。

WebSocket 仅在需要双向实时通信时评估，不得与 HTTP 响应状态同时作为无版本控制的双通道事实来源。

---

## 5.3 记忆系统

### F13. 近期窗口记忆

**优先级：MVP 必须**

- 保留最近 10 到 15 轮原文；
- Prompt 组装时优先使用近期窗口；
- 超出窗口的消息保留在数据库中，供后续摘要和事实抽取使用。

MVP 不丢弃历史消息，只是不全部送入 Prompt。

### F14. 摘要记忆

**优先级：Level 1**

触发条件：

- 自上次摘要后新增消息达到 30 条；
- 或会话关闭超过一定时间；
- 或上下文长度接近预算。

摘要任务必须：

- 记录来源消息范围；
- 异步执行；
- 支持重试；
- 支持幂等；
- 不阻塞用户聊天；
- 可被用户删除或重建。

摘要结构：

```ts
type ConversationSummary = {
  id: string;
  conversationId: string;
  startMessageId: string;
  endMessageId: string;
  content: string;
  status: "pending" | "ready" | "failed" | "deleted";
  createdAt: string;
  updatedAt: string;
};
```

### F15. 事实记忆

**优先级：Level 1**

从对话中抽取原子事实，例如：

- 用户正在学做饭；
- 用户有一个朋友叫小明；
- 用户下周有考试；
- 用户偏好简短回答。

事实结构：

```ts
type MemoryFact = {
  id: string;
  ownerId: string;
  type: "fact" | "preference" | "goal" | "episode" | "relationship";
  content: string;
  sourceMessageId: string;
  confidence: number;
  status: "candidate" | "active" | "outdated" | "rejected" | "deleted";
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
};
```

要求：

- 每条事实必须有来源消息；
- 低置信度事实进入 candidate，不直接进入 Prompt；
- 用户可在记忆查看器中确认、修正、拒绝或删除；
- 重要事实可标记为核心记忆；
- 核心记忆不因遗忘曲线自动降权到不可用。

### F16. 记忆冲突处理

**优先级：Level 1**

当新事实与旧事实冲突时：

1. 生成候选替代事实；
2. 不直接覆盖旧事实；
3. 低风险记忆可自动标记旧事实为 outdated；
4. 高风险或低置信度冲突需用户确认；
5. Prompt 组装时不得同时注入两个矛盾的当前事实。

例如：

- 旧事实：用户住在上海；
- 新事实：用户搬到杭州；
- 处理结果：新事实 active，旧事实 outdated，并保留历史版本。

### F17. 记忆查看器

**优先级：Level 1**

提供独立页面或抽屉：

- 展示事实列表；
- 按类型、时间、状态筛选；
- 显示来源消息；
- 显示置信度；
- 显示最后访问时间；
- 支持编辑；
- 支持删除；
- 支持查看待确认记忆。

编辑与删除使用乐观更新，但必须以后端最终结果为准。

### F18. 记忆删除与修正的连带影响

**优先级：Level 1 必须；部分能力可到 Level 2 完善**

用户删除或修正记忆后，系统必须处理：

- 向量索引或全文索引；
- 摘要记忆；
- 后续 Prompt 组装；
- 记忆引用日志；
- 状态事件中的证据展示；
- 调试信息。

删除后：

- 不再进入 Prompt；
- 不再参与检索；
- 审计记录可保留，但必须脱敏或仅保留操作记录；
- 向量索引必须删除或失效。

### F19. 语义检索

**优先级：Level 2**

目标：

- 根据当前用户消息召回相关事实和摘要；
- 与近期窗口合并去重；
- 控制注入 Prompt 的记忆数量；
- 展示每条记忆被使用的理由。

Level 2 初期数据规模约 200 条事实，可先用简单方案：

- SQLite FTS5；
- 关键词检索；
- 内存 embedding 余弦相似度。

当记忆规模达到数千条以上，再引入：

- `sqlite-vec`；
- PostgreSQL + pgvector。

检索必须按 `owner_id` 过滤，禁止跨用户或跨 Agent 泄漏。

### F20. 遗忘曲线

**优先级：Level 3**

按记忆类型设置半衰期：

| 类型 | 半衰期 |
|---|---:|
| 工作记忆 | 0.5 小时 |
| 情景记忆 | 72 小时 |
| 语义记忆 | 720 小时 |
| 核心记忆 | 8760 小时或更长 |

遗忘只影响检索权重，不直接删除数据：

- 长期未访问的记忆降权；
- 用户确认的核心记忆保留较高权重；
- 已被替代的过时记忆标记为 outdated；
- 用户可手动恢复或固定某条记忆。

---

## 5.4 人格系统

### F21. 固定人格锚点

**优先级：MVP 必须**

`PERSONA_CORE` 是不可被普通对话修改的人格基础。

内容包括：

- 身份设定；
- 核心语气；
- 关系边界；
- 安全边界；
- 表达原则；
- 不假装人类的声明。

每次正式 Prompt 均注入人格锚点。

人格锚点必须版本化，并记录 hash，便于验证是否漂移。

### F22. 可演化人格片段

**优先级：Level 2**

可演化内容包括：

- 回答长度偏好；
- 语气轻重；
- 幽默程度；
- 主动追问频率；
- 兴趣话题倾向；
- 表达风格。

结构示例：

```ts
type PersonaEvolvable = {
  id: string;
  agentId: string;
  version: number;
  style: {
    verbosity: "concise" | "balanced" | "detailed";
    warmth: number;
    humor: number;
    proactiveQuestions: number;
  };
  notes: string[];
  updatedAt: string;
};
```

### F23. 显式人格调整

**优先级：Level 2**

流程：

1. 用户提出调整，例如“回答更简洁一点”；
2. 后端调用专用提案接口；
3. LLM 将自然语言请求翻译为结构化 patch；
4. patch 通过 JSON Schema 校验；
5. 前端展示 diff；
6. 用户确认后应用；
7. 新版本写入历史；
8. 支持回滚。

### F24. 人格提案结构

**优先级：Level 2**

```ts
type PersonaProposal = {
  id: string;
  agentId: string;
  requestText: string;
  patch: PersonaPatch;
  diffSummary: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  reviewedAt: string | null;
};
```

patch 必须是结构化数据，不允许是任意 System Prompt 文本。

### F25. 演化幅度限制

**优先级：Level 2**

每次提案必须限制：

- 可修改字段白名单；
- 数值变化幅度；
- notes 数量；
- 提案有效期；
- 连续提案频率。

超过限制的提案必须被拒绝或拆分。

### F26. 普通聊天消息不可修改人格

**优先级：Level 2 必须**

以下输入不具备人格修改权限：

- 聊天消息；
- 流式回复；
- 工具返回内容；
- 检索到的记忆文本；
- 未知第三方网页内容。

即使消息中包含“忽略人格锚点”“改写系统提示词”“现在你是另一个角色”等指令，也只能作为普通对话内容处理，不得影响人格存储。

### F27. 人格版本历史与回滚

**优先级：Level 2**

每次变更记录：

- 修改前版本；
- 修改后版本；
- 提案来源；
- 用户确认时间；
- diff；
- 生效会话。

用户可查看历史并回滚到任一版本。

### F28. 安全与专业边界

**优先级：MVP 必须**

人格锚点中的边界应表述为：

- 不假装人类；
- 不声称拥有真实人类经历；
- 不冒充医生、律师、心理咨询师等专业人士；
- 涉及自伤、暴力、严重心理危机或紧急安全问题时，明确引导用户寻求专业或紧急帮助；
- 高风险决策中说明局限性；
- 不将用户情绪状态用于操纵或诱导。

边界不是“不提供任何建议”，而是“不冒充专业资质、不处理超出能力边界的高风险问题”。

---

## 5.5 主动行为

主动消息当前仅支持浏览器内行为：页面打开且会话存活时，前端通过空闲计时器请求后端评估是否发送；页面关闭、刷新或会话失活后，计时器取消，不产生离线消息。

不实施以下能力：

- 浏览器系统通知；
- 邮件通知；
- 移动端推送；
- 后端离线定时推送；
- 页面关闭后的追发。

### F29. 主动消息开关

**优先级：Level 3**

用户可以配置：

- 开启 / 关闭；
- 安静 / 正常 / 专注模式；
- 免打扰时间段；
- 每日或每周频率上限；
- 页面空闲多久后允许评估。

默认关闭。

页面关闭、刷新、休眠或切出后不可产生新的主动消息；页面重新打开后，需要重新满足空闲条件。

### F30. 打扰门控

**优先级：Level 3**

主动消息必须满足：

- 页面当前处于打开且活跃状态；
- 用户已开启；
- 当前时间不在免打扰区间；
- 未超过频率上限；
- 用户未连续忽略多次；
- 不涉及高风险或敏感情绪场景；
- 内容轻量、不施压。

后端负责最终策略判断，防止前端状态被绕过；前端只负责在页面存活期间发起评估请求。

MVP 和 Level 1 不引入亲密度作为门控变量。若 Level 3 需要亲密度，必须先将其定义为可解释、可查看、可重置的状态维度。

### F31. 主动消息历史

**优先级：Level 3**

主动消息写入同一消息历史，但必须有标记：

```ts
type ProactiveMetadata = {
  trigger: "idle" | "memory" | "checkin" | "system";
  delivery: "in_app_only";
  policyVersion: string;
  suppressed: boolean;
};
```

用户可以看到主动消息发生的原因，并可一键关闭同类行为。

---

## 5.6 数据控制与隐私

### F32. 数据导出

**优先级：Level 1**

用户可导出：

- 消息；
- 状态事件；
- 记忆；
- 人格版本；
- 主动消息记录；
- 设置。

导出内容不得包含 LLM API Key；LLM 连接配置默认仅包含端点与模型名。

格式可为 JSON，后续支持 Markdown。

### F33. 数据删除

**优先级：Level 1**

用户可删除：

- 单条记忆；
- 某个会话；
- 状态历史；
- 全部对话；
- 全部数据。

删除必须处理数据库、索引、缓存和派生数据。

### F34. 敏感数据提示

**优先级：Level 1**

系统需向用户说明：

- 哪些数据会被保存；
- 哪些内容会发送给 LLM 服务；
- 记忆是否上传云端；
- 如何删除数据。

### F35. 本地数据默认

**优先级：MVP 建议**

本地单用户版本的数据固定存储在本机 SQLite，不自动上传到第三方云端保存。

调用外部 LLM API 时，必须在设置中说明对应数据会离开本机。

### F38. LLM 连接设置

**优先级：MVP 必须（T0.6 实现）**

用户可在前端设置面板查看并修改 LLM 连接：

- 查看当前 `baseUrl` 与 `model`；
- 修改 `baseUrl` 与 `model`，用于在 DeepSeek 与第三方中转站之间切换；
- 写入或替换 API Key；
- 测试当前连接是否可用。

安全规则：

- 配置优先级：数据库设置 > 环境变量 > 未配置；
- API Key 只写不读：任何接口不得返回完整 Key，只返回“已配置”状态与掩码提示；
- API Key 不进入日志、调试面板、Prompt 快照与数据导出；
- “删除全部数据”必须同时删除 API Key；
- 修改连接配置后 Provider 需热重建，无需重启服务。

---

## 5.7 调试与可观测性

### F36. Prompt 快照

**优先级：Level 1**

每轮对话记录：

- 使用的人格锚点版本；
- 可演化人格版本；
- 近期窗口消息范围；
- 注入的摘要；
- 注入的事实；
- 检索分数；
- 最终 Prompt 摘要或结构化记录。

默认不永久保存完整敏感原文，需提供脱敏选项。

### F37. 调试模式

**优先级：Level 1**

前端提供调试面板，展示：

- 当前 Prompt 组装结果；
- 记忆召回来源；
- 状态事件；
- 模型参数；
- token 预算；
- 失败与重试记录。

调试模式默认关闭。

---

## 6. 接口需求

### 6.1 聊天接口

```http
POST /api/chat
```

请求核心字段：

```ts
type ChatRequestBody = {
  agentId: string;
  conversationId: string;
  message: string;
  clientMessageId: string;
};
```

响应除流式内容外，还应包含：

- 消息 ID；
- 生成状态；
- 当前 Agent 状态；
- 最新状态事件；
- 离散情感标签。

要求：

- `clientMessageId` 用于幂等；
- 重复请求不得重复入库；
- 重复请求不得重复累计状态。

### 6.2 会话恢复接口

```http
GET /api/conversations/:id
```

返回：

- 会话基本信息；
- 最近消息；
- 当前状态；
- 状态事件游标；
- 人格版本。

### 6.3 状态接口

```http
GET /api/agents/:agentId/state
GET /api/agents/:agentId/state/events
```

支持：

- 分页；
- 时间范围过滤；
- 事件详情；
- 关联消息跳转。

### 6.4 主动消息评估接口

**优先级：Level 3**

```http
POST /api/proactive/evaluate
```

请求核心字段：

```ts
type ProactiveEvaluateRequest = {
  agentId: string;
  conversationId: string;
  idleDurationMs: number;
  clientRequestId: string;
};
```

响应：

- 是否发送；
- 抑制原因；
- 主动消息内容；
- 频率策略版本。

要求：

- 仅由打开中的前端页面调用；
- `client_request_id` 用于幂等；
- 页面关闭后的离线定时任务不得调用该接口；
- 后端仍需独立校验设置、频率和打扰门控。

### 6.5 记忆接口

```http
GET    /api/memories
PATCH  /api/memories/:id
DELETE /api/memories/:id
POST   /api/memories/:id/confirm
POST   /api/memories/:id/reject
```

支持：

- 状态筛选；
- 类型筛选；
- 来源消息查看；
- 乐观更新后的最终态回写。

### 6.6 人格接口

```http
POST   /api/persona/propose
GET    /api/persona/proposals
POST   /api/persona/proposals/:id/approve
POST   /api/persona/proposals/:id/reject
POST   /api/persona/versions/:version/rollback
```

要求：

- 所有应用动作必须显式确认；
- patch 必须通过 schema 校验；
- 历史版本不可物理覆盖。

### 6.7 数据控制接口

```http
GET   /api/export
DELETE /api/data
```

删除操作必须返回任务状态，并说明派生数据处理结果。

---

## 7. 技术架构

```text
┌──────────────────────────────────────────────┐
│ React 前端                                    │
│ ├─ ChatShell                                  │
│ ├─ MessageList / MessageBubble                │
│ ├─ StatusPanel                                │
│ ├─ ProactiveIdleTimer                         │
│ ├─ StatusTimeline                             │
│ ├─ MemoryViewer                               │
│ ├─ PersonaEditor / PersonaDiffViewer          │
│ └─ DebugPanel                                 │
└──────────────────────────────────────────────┘
                 │ REST / streaming
┌──────────────────────────────────────────────┐
│ API 层                                        │
│ ├─ /api/chat                                  │
│ ├─ /api/conversations                         │
│ ├─ /api/agents/:id/state                      │
│ ├─ /api/proactive/evaluate                    │
│ ├─ /api/memories                              │
│ ├─ /api/persona                               │
│ └─ /api/export                                │
└──────────────────────────────────────────────┘
                 │
┌──────────────────────────────────────────────┐
│ Agent 引擎                                    │
│ ├─ Prompt 组装器                              │
│ ├─ 情绪抽取与状态更新                         │
│ ├─ 记忆抽取、冲突处理与检索                   │
│ ├─ 人格治理与版本管理                         │
│ └─ 主动消息策略评估（仅由打开页面触发）       │
└──────────────────────────────────────────────┘
                 │
┌──────────────────────────────────────────────┐
│ 存储                                          │
│ ├─ messages                                   │
│ ├─ state_events                               │
│ ├─ memories                                   │
│ ├─ conversation_summaries                     │
│ ├─ persona_versions                           │
│ ├─ persona_proposals                          │
│ └─ prompt_snapshots                           │
└──────────────────────────────────────────────┘
```

---

## 8. 非功能需求

### 8.1 性能

- 首 token 延迟目标：小于 2 秒，实际值受 LLM 服务影响；
- 状态面板更新不得造成消息列表明显卡顿；
- 记忆查看器首屏目标小于 1 秒；
- Level 2 检索延迟目标：200 条事实规模下小于 1 秒；
- 超过 200 条渲染消息时启用虚拟列表。

### 8.2 可靠性

- 消息发送支持幂等；
- 流式中断可恢复或明确报错；
- 状态事件不可变；
- 记忆抽取失败不影响聊天主流程；
- 摘要任务失败可重试；
- 人格提案失败不影响现有人格。

### 8.3 可测试性

必须为核心模块编写自动化测试：

- 状态更新规则；
- 状态幂等；
- Prompt 组装；
- 记忆冲突处理；
- 记忆删除后的索引失效；
- 人格 patch 校验；
- Prompt 注入防护；
- 会话恢复；
- 主动消息策略评估，包括页面关闭后不产生离线消息。

### 8.4 安全性

- 普通聊天消息不可修改人格；
- 记忆检索必须按 owner 过滤；
- 删除接口必须确认影响范围；
- 当前无登录体系，因此后端默认只监听 `127.0.0.1`；
- 不允许在未增加认证和授权前把 API 暴露到局域网或公网；
- 调试日志需要脱敏策略；
- 危机话题必须触发安全提示策略；
- 如部署为多用户服务，必须增加认证与授权。

### 8.5 技术栈约束

- React 18+；
- TypeScript；
- Vite 或 Next.js；
- Zustand 或等价轻量状态管理；
- React Query 或 SWR 用于服务端状态；
- Recharts 用于状态时间线；
- Tailwind + shadcn/ui 可选；
- SQLite 作为当前版本的本地存储；
- PostgreSQL + pgvector 仅在多用户或大规模部署时引入。

---

## 9. 分阶段实施计划

## Phase 0：技术验证

目标：验证基础链路，不追求产品完整性。

范围：

- 创建 React + TypeScript 项目；
- 连接 LLM API；
- 实现基础聊天 UI；
- 实现流式响应；
- 维护最近消息窗口；
- 验证消息状态管理方案。

验收：

- 可以连续发送多条消息；
- 流式输出正常；
- 最近上下文能进入 Prompt；
- 前端不会因局部更新造成明显卡顿。

## Phase 1：MVP

目标：形成可持续使用和可恢复的核心体验。

范围：

- 消息持久化；
- 会话恢复；
- 二维状态模型；
- 状态事件；
- 状态原因展示；
- 当前状态面板；
- 基础人格锚点；
- 安全边界；
- 消息幂等。

验收动作：

1. 连续聊天 20 轮；
2. 刷新页面；
3. 最近消息与当前状态恢复；
4. 状态变化原因与触发消息对应；
5. 同一 `clientMessageId` 重复提交只入库一次，状态只累计一次。

明确不做：

- 长期事实记忆；
- 摘要；
- 向量检索；
- 人格演化；
- 主动消息；
- 状态时间线；
- WebSocket。

## Phase 2：长期记忆与透明性

目标：让用户感知 Agent 真的记得，并能够控制这些记忆。

范围：

- 事实抽取；
- 候选事实确认；
- 记忆查看器；
- 记忆编辑与删除；
- 摘要记忆；
- 记忆来源追踪；
- 记忆冲突处理；
- 状态时间线；
- 调试模式；
- 数据导出与删除。

验收动作：

1. 第一天告诉 Agent“我在学做饭”；
2. 第二天新会话询问“你还记得我昨天在做什么吗”；
3. Agent 能自然带出相关记忆；
4. 记忆查看器能看到来源消息；
5. 删除该记忆后不再进入 Prompt。

## Phase 3：检索与受控人格演化

目标：让记忆可联想、让人格可安全成长。

范围：

- 语义检索；
- 检索结果与近期窗口合并去重；
- 显式人格调整；
- persona diff 确认；
- patch schema 校验；
- 演化幅度限制；
- 版本历史与回滚；
- Prompt 注入防护测试。

验收动作：

1. 准备 10 个需要联想的问题；
2. 至少 7 个能在 3 轮内定位相关记忆；
3. 用户要求“更简洁”后系统生成提案；
4. 用户确认前后风格可感知变化；
5. 未确认提案不会生效；
6. Prompt 注入样本无法修改人格。

## Phase 4：主动行为与遗忘

目标：在不打扰的前提下增强连续存在感。

范围：

- 浏览器内主动消息开关；
- 页面空闲计时；
- 免打扰设置；
- 频率限制；
- 主动消息历史；
- 遗忘曲线；
- 过时信息降权。

明确不做：

- 浏览器系统通知；
- 邮件、移动端或第三方推送；
- 后端离线主动消息调度。

验收动作：

1. 连续使用 14 天；
2. 人格锚点 hash 不变；
3. 仍记得第 3 天的核心事件；
4. 主动消息不超过设定上限；
5. 用户关闭主动消息后发送数为 0；
6. 页面关闭或刷新后不产生新的主动消息；
7. 重新打开页面后不会立即补发被抑制的消息；
8. 旧地址等过时信息被降权而非误召回。

---

## 10. 主要风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 聊天框架选型摇摆 | 架构返工 | Phase 0 固定一种方案，替换需评审 |
| MVP 范围过大 | 延期 | 严格按 Phase 交付，先完成恢复与状态闭环 |
| session 与长期记忆边界混乱 | 第二天不记得 | 使用 owner_id，不按浏览器 session 隔离长期记忆 |
| 情绪规则过于简单 | 状态变化不可信 | 抽取层可替换，状态事件保留证据与置信度 |
| 记忆抽取错误 | Agent 记住假事实 | candidate 队列、置信度、来源追踪、用户确认 |
| 记忆冲突 | 回答自相矛盾 | active / outdated 状态与冲突处理流程 |
| 删除不彻底 | 隐私风险 | 数据库、索引、摘要、缓存、派生数据统一失效 |
| 人格漂移 | 角色不一致 | 固定锚点、版本化、diff 确认、hash 校验 |
| Prompt 注入 | 人格或权限被篡改 | 普通消息无修改权限，patch 必须过 schema |
| 主动消息打扰 | 用户流失 | 默认关闭、仅浏览器内发送、频率上限、免打扰、忽略降频 |
| 页面关闭后的离线推送误解 | 功能范围失控 | 明确不做系统通知和后端离线定时推送 |
| 多 Agent 数据串扰 | 记忆和人格混乱 | 从 MVP 开始按 owner_id = user_id + agent_id 隔离 |
| 多用户数据泄漏 | 严重安全问题 | 当前仅监听本机；未来线上部署必须增加认证、授权和 owner 过滤 |

---

## 11. 暂不实施事项

以下内容不进入当前版本：

- 多用户账号系统；
- 多 Agent 管理界面（数据模型已预留 agent_id，未来支持多角色）；
- 语音输入输出；
- 3D Avatar；
- 移动端原生应用；
- 群聊；
- 自动付费或订阅；
- 复杂插件生态；
- 自主修改人格；
- 无需确认的长期记忆写入。

---

## 12. 建议的技术决策

### 12.1 MVP 推荐方案

```text
前端：Vite + React + TypeScript + Tailwind
聊天：Vercel AI SDK useChat 或兼容流式协议的自研 Hook
状态：Zustand
服务端状态：React Query
图表：Recharts，Level 1 引入
后端：Node.js 或 Python 均可，以团队熟悉度为准
数据库：SQLite（本地单用户、无登录）
```

### 12.2 不建议 MVP 同时引入

- CopilotKit；
- assistant-ui；
- WebSocket；
- pgvector；
- 专用向量数据库；
- 后端离线主动消息调度器；
- 多用户账号系统。

### 12.3 需要尽早固定的接口

即使后端尚未完整实现，也应先定义：

```ts
type AgentEmotionState;
type EmotionExtraction;
type AgentStateEvent;
type AgentStateEventData;
type MemoryFact;
type ConversationSummary;
type PersonaProposal;
```

以上类型字段统一使用 camelCase；Phase 2 及以后的类型示例同样遵循该约定。

这些类型是前后端协作与后续测试的核心边界。


