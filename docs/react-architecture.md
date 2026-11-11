# React 架构设计文档

项目：本地单用户拟人化聊天 Agent  
关联文档：[requirements.md](./requirements.md)、[technical-design.md](./technical-design.md)、[api-contract.md](./api-contract.md)  
前端技术栈：React 18 + TypeScript + Vite  
状态管理：Vercel AI SDK `useChat` + Zustand + React Query  
版本：v1.1  
日期：2026-11-11

---

## 1. 文档范围

本文档定义 Phase 0 / MVP 阶段 React 前端的架构设计，包括：

- 页面与组件结构；
- 目录组织；
- 组件职责边界；
- 状态管理边界；
- 启动与恢复流程；
- 聊天流式数据流；
- 状态事件数据流；
- 渲染隔离策略；
- 错误与空状态；
- 样式方案；
- 测试策略；
- 后续扩展方式。

本文档不实现代码，也不定义后端内部结构。

---

## 2. 架构目标

## 2.1 核心目标

1. **聊天是聊天，状态是状态**  
   消息流和 Agent 状态必须解耦，状态面板更新不得触发消息列表全量重渲染。

2. **刷新后可恢复**  
   消息、当前状态、状态原因都以后端为事实来源。

3. **组件职责单一**  
   组件不直接访问数据库概念，不手写 API 调用，不实现状态规则。

4. **边界清晰，可测试**  
   API client、store、hook、组件分别可测试。

5. **为后续能力预留结构**  
   记忆查看器、人格编辑器、状态时间线可以在后续作为独立模块加入，不侵入聊天核心。

---

## 3. 技术决策

## 3.1 已选技术栈

```text
框架：React 18
语言：TypeScript
构建：Vite
样式：Tailwind CSS，可选 shadcn/ui
聊天：Vercel AI SDK useChat 或等价 adapter
客户端状态：Zustand
服务端状态：React Query
测试：Vitest + Testing Library
路由：暂缓
```

## 3.2 为什么不用 Next.js

当前是本地单用户应用，前端只需要静态 SPA 和本地 API 服务：

- 不需要 SSR / ISR;
- 不需要服务端组件；
- 不需要基于 Next.js Route Handler 的部署形态；
- Vite 更简单，启动更快。

因此采用：

```text
Vite React SPA + local Node.js API
```

---

## 3.3 为什么聊天状态不放入 Zustand

聊天消息流由 Vercel AI SDK `useChat` 或自定义 transport adapter 管理，因为 SDK 已经负责：

- 流式增量；
- 消息状态；
- 停止生成；
- 错误状态；
- transport 协议。

如果把消息再复制到 Zustand，会出现：

- 双事实来源；
- 流式更新顺序不确定；
- 刷新恢复逻辑复杂；
- 重渲染优化失效。

因此规则是：

```text
useChat 只负责聊天消息流
Zustand 只负责 Agent 状态、会话元信息和 UI 状态
React Query 只负责非聊天服务端状态
```

---

## 3.4 为什么仍需要 Zustand

Agent 状态事件来自同一条聊天流，但属于另一个领域。它需要被 `StatusPanel` 独立消费，而不是混入消息列表。

因此使用独立 store：

```text
AgentStateStore
```

负责：

- 当前 valence;
- 当前 arousal;
- 离散情感标签；
- 最新状态原因；
- 最新状态事件 ID。

---

## 4. 目录结构

推荐结构：

```text
apps/web/src/
├─ api/
│  ├─ client.ts
│  ├─ bootstrap.ts
│  ├─ conversation.ts
│  ├─ state.ts
│  └─ settings.ts
│
├─ app/
│  ├─ App.tsx
│  ├─ AppShell.tsx
│  └─ providers.tsx
│
├─ chat/
│  ├─ components/
│  │  ├─ ChatShell.tsx
│  │  ├─ MessageList.tsx
│  │  ├─ MessageItem.tsx
│  │  ├─ UserMessageBubble.tsx
│  │  ├─ AssistantMessageBubble.tsx
│  │  ├─ FailedMessageBubble.tsx
│  │  ├─ MessageComposer.tsx
│  │  └─ ChatEmptyState.tsx
│  ├─ hooks/
│  │  ├─ useAgentChat.ts
│  │  └─ useAutoScroll.ts
│  └─ types.ts
│
├─ status/
│  ├─ components/
│  │  ├─ StatusPanel.tsx
│  │  ├─ EmotionBars.tsx
│  │  ├─ EmotionBar.tsx
│  │  ├─ ReasonLine.tsx
│  │  ├─ EmotionTag.tsx
│  │  └─ StateEmptyState.tsx
│  └─ utils/
│     └─ emotion-display.ts
│
├─ conversation/
│  ├─ components/
│  │  └─ ConversationErrorState.tsx
│  └─ store/
│     └─ conversation-store.ts
│
├─ settings/
│  ├─ store/
│  │  └─ settings-store.ts
│  └─ types.ts
│
├─ shared/
│  ├─ components/
│  │  ├─ ErrorNotice.tsx
│  │  ├─ LoadingIndicator.tsx
│  │  └─ RetryButton.tsx
│  ├─ hooks/
│  │  └─ useIsomorphicLayoutEffect.ts
│  └─ utils/
│     ├─ date.ts
│     └─ id.ts
│
├─ stores/
│  └─ agent-state-store.ts
│
├─ styles/
│  ├─ global.css
│  └─ tokens.css
│
└─ main.tsx
```

---

## 5. 模块依赖规则

## 5.1 允许的依赖方向

```text
app
  ↓
chat / status / conversation / settings
  ↓
shared
  ↓
packages/shared
```

## 5.2 禁止的依赖

禁止以下情况：

1. `status` 依赖 `chat`;
2. `chat` 依赖 `status`;
3. 组件直接调用 `fetch`;
4. 组件直接读取 SQLite 概念；
5. store 之间互相保存对方可派生的数据；
6. `status` 从消息列表计算情绪；
7. `chat` 直接写 `AgentStateStore` 以外的状态规则；
8. API client 依赖 React;
9. UI 组件依赖后端 ORM 类型。

`useAgentChat` 是唯一允许同时接触聊天流和状态事件的适配层。

---

## 6. 页面结构

MVP 不引入路由，只有一个主页面。

```tsx
<App>
  <AppProviders>
    <AppShell>
      <ChatPageLayout>
        <ChatRegion>
          <ChatHeader />
          <ChatShell />
        </ChatRegion>

        <StatusRegion>
          <StatusPanel />
        </StatusRegion>
      </ChatPageLayout>
    </AppShell>
  </AppProviders>
</App>
```

概念结构：

```text
AppShell
├─ ChatRegion
│  ├─ ChatHeader
│  └─ ChatShell
│     ├─ MessageList
│     │  ├─ UserMessageBubble
│     │  ├─ AssistantMessageBubble
│     │  ├─ FailedMessageBubble
│     │  └─ ChatEmptyState
│     └─ MessageComposer
│
└─ StatusRegion
   └─ StatusPanel
      ├─ EmotionTag
      ├─ EmotionBars
      │  ├─ EmotionBar valence
      │  └─ EmotionBar arousal
      ├─ ReasonLine
      └─ StateEmptyState
```

---

## 7. Provider 设计

`AppProviders` 包含：

```tsx
<QueryClientProvider client={queryClient}>
  <ErrorBoundary>
    {children}
  </ErrorBoundary>
</QueryClientProvider>
```

MVP 不引入：

- Redux Provider;
- ThemeProvider，除非实现主题切换；
- Router Provider;
- 全局 Context 保存聊天消息。

`ErrorBoundary` 只处理渲染级异常，不替代 API 错误处理。

---

## 8. 状态管理设计

## 8.1 状态分类

| 类型 | 归属 | 示例 |
|---|---|---|
| 聊天消息流 | `useChat` | 用户消息、Assistant 流式消息 |
| Agent 情绪状态 | `AgentStateStore` | valence、arousal、tag |
| 会话元信息 | `ConversationStore` | conversationId、加载状态 |
| 服务端设置 | React Query / SettingsStore | theme、上下文窗口 |
| 输入框草稿 | `MessageComposer` 本地 state | 尚未发送的文字 |
| UI 局部状态 | 组件本地 state | 是否显示错误、是否自动滚动 |

原则：

> 能放在组件局部的状态不放入全局 store；能由后端恢复的状态不长期保存在前端。

---

## 8.2 `ConversationStore`

职责：

- 保存当前会话 ID;
- 保存 bootstrap 状态；
- 保存 bootstrap 错误；
- 控制是否允许聊天。

不保存：

- 消息列表；
- Agent 状态；
- 设置。

概念定义：

```ts
type ConversationStoreValue = {
  conversationId: string | null;
  agentId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  errorCode: string | null;

  setBootstrapData: (data: BootstrapResponse) => void;
  setLoading: () => void;
  setError: (errorCode: string) => void;
  reset: () => void;
};
```

`status` 生命周期：

```text
idle → loading → ready
idle → loading → error
```

---

## 8.3 `AgentStateStore`

职责：

- 保存当前状态；
- 保存离散标签；
- 保存最新状态事件；
- 提供统一的状态更新入口。

概念定义：

```ts
type AgentStateStoreValue = {
  agentId: string | null;
  state: AgentEmotionState;
  discreteTag: EmotionTag;
  stateUpdatedAt: string | null;
  latestEvent: AgentStateEvent | null;

  initFromBootstrap: (data: BootstrapResponse) => void;
  applyStateEvent: (event: AgentStateEvent) => void;
  reset: () => void;
};
```

初始化：

```text
agent.currentState
agent.currentTag
agent.stateUpdatedAt
latestStateEvent
```

流式更新：

```text
data-agent-state-event
  ↓
applyStateEvent(event)
```

规则：

- 前端不重新计算 valence / arousal;
- 前端不根据文本自行推断情绪；
- 前端只信任后端状态事件；
- `latestEvent` 不需要保留全部历史。

---

## 8.4 Settings 管理

MVP 推荐使用 React Query：

```ts
["settings"]
```

负责：

- 读取设置；
- 更新设置；
- 缓存失效。

如果 UI 需要非服务端派生的本地偏好，可再引入 SettingsStore。

禁止把设置放进入 `ConversationStore` 或 `AgentStateStore`。

---

## 9. API 层设计

## 9.1 API Client

所有请求经过：

```text
src/api/client.ts
```

统一处理：

- Base URL;
- Headers;
- JSON 解析;
- `ApiError` 归一化；
- AbortSignal;
- 请求超时；
- Request ID。

禁止组件直接调用：

```ts
fetch()
```

---

## 9.2 领域 API 函数

```text
fetchBootstrap()
fetchConversation(id, options)
fetchAgentState(agentId)
fetchStateEvents(agentId, page)
fetchSettings()
updateSettings(patch)
```

返回类型全部来自：

```text
packages/shared
```

---

## 9.3 错误归一化

网络错误和 HTTP 错误统一转换为：

```ts
type NormalizedApiError = {
  code: string;
  message: string;
  details?: unknown;
  kind: "network" | "http" | "parse" | "unknown";
};
```

组件只处理稳定错误码，不解析错误 message。

---

## 10. Bootstrap 流程

## 10.1 启动时序

```text
App mount
  ↓
ConversationStore status = loading
  ↓
GET /api/bootstrap
  ↓
成功：
  ├─ ConversationStore 写入 conversationId / ready
  ├─ AgentStateStore 初始化
  ├─ useChat 初始化初始消息
  └─ React Query 写入 settings
失败：
  └─ ConversationStore status = error
```

## 10.2 初始化 useChat

Vercel AI SDK 的具体 API 需要以 Phase 0 锁定版本为准。概念上是：

```text
bootstrap 完成后，将服务端恢复的 messages 传入聊天 hook 的初始状态
```

如果当前版本不支持直接初始化，需要实现一个薄 adapter：

```text
RestoredChatStateAdapter
```

职责：

- 在首次渲染或 bootstrap 完成后注入恢复消息；
- 不复制后续流式消息到第二套 store。

## 10.3 Bootstrap 失败

显示全页错误状态：

- 重试按钮；
- 错误码；
- 不渲染可输入的聊天框。

原因：

- 没有会话 ID 时无法安全发送消息；
- 不应在未恢复 Agent 状态时开始聊天。

---

## 11. 聊天模块设计

## 11.1 `ChatShell`

职责：

- 组合 `MessageList` 和 `MessageComposer`;
- 调用 `useAgentChat`;
- 传递发送、停止、重试能力；
- 管理聊天区域整体布局。

不负责：

- 情绪规则；
- API 细节；
- 状态面板渲染。

---

## 11.2 `useAgentChat`

这是聊天模块的核心 hook，也是唯一跨领域适配点。

输入：

```ts
type UseAgentChatInput = {
  agentId: string | null;
  conversationId: string | null;
  enabled: boolean;
  initialMessages?: ChatMessageDTO[];
};
```

返回：

```ts
type UseAgentChatResult = {
  messages: UiMessage[];
  input: string;
  setInput: (value: string) => void;
  isSending: boolean;
  isStreaming: boolean;
  error: NormalizedApiError | null;

  send: () => Promise<void>;
  stop: () => void;
  retry: () => void;
};
```

职责：

1. 封装 `useChat`;
2. 生成 `clientMessageId`;
3. 发送 `/api/chat`;
4. 解析 `data-agent-state-event`;
5. 把状态事件交给 `AgentStateStore`;
6. 归一化聊天错误；
7. 处理停止生成。

不得职责：

- 保存长期记忆；
- 修改人格；
- 计算情绪；
- 直接写数据库式字段。

`retry()` 的 MVP 语义固定为“以原输入内容重新发送一条新消息”：

- 生成新的 `clientMessageId`，作为一条新的用户消息提交；
- 不重新生成上一轮 Assistant 回复；
- 收到 `409 DUPLICATE_CLIENT_MESSAGE` 后不可调用 `retry()`，必须先刷新会话；
- `LLM_REQUEST_FAILED` 与 `CLIENT_ABORTED` 的失败气泡可触发 `retry()`。

---

## 11.3 Transport Adapter

为了隔离 Vercel AI SDK 版本差异，必须建立薄适配层：

```text
chat/hooks/useAgentChat.ts
chat/adapters/chat-transport.ts
```

adapter 只处理：

- 请求体字段映射；
- 响应 data part 映射；
- 错误结构映射；
- SDK 类型转换。

禁止把 SDK 内部 chunk 结构扩散到组件。

如果 SDK 版本变化，只修改 adapter，不改 UI 组件。

---

## 11.4 `MessageComposer`

职责：

- 输入框内容；
- Enter 发送 / Shift+Enter 换行；
- 发送中禁用；
- 空内容禁用；
- 超长内容提示；
- 停止生成按钮；
- 保留未发送草稿。

发送前校验：

```text
trim(message).length >= 1
message.length <= 8000
conversationId 存在
当前没有正在进行的请求
```

每次成功触发发送时生成新的：

```text
clientMessageId
```

---

## 11.5 `MessageList`

职责：

- 渲染消息；
- 处理空状态；
- 处理自动滚动；
- 处理用户手动上滚时暂停自动滚动。

不负责：

- 状态面板；
- API 调用；
- 情绪计算。

MVP 不使用虚拟列表。消息超过 200 条后再引入：

```text
@tanstack/react-virtual
```

---

## 11.6 `MessageItem`

根据 role 和 status 分发：

```text
user + complete → UserMessageBubble
assistant + streaming → AssistantMessageBubble
assistant + complete → AssistantMessageBubble
assistant + failed → FailedMessageBubble
```

异常组合显示通用错误气泡，不静默隐藏。

---

## 11.7 `AssistantMessageBubble`

职责：

- 渲染文本；
- 显示光标或生成中状态；
- 保留换行和基础排版；
- 显示时间戳。

MVP 不渲染 Markdown。原因：

- 降低 XSS 风险；
- 避免流式 Markdown 未闭合导致布局跳动；
- 当前核心是状态和记忆体验，不是富文本。

Phase 2 可评估安全的受限 Markdown 渲染。

---

## 11.8 `FailedMessageBubble`

显示：

- 失败提示；
- 稳定错误码；
- 可选重试按钮。

MVP 可以只支持“重新发送新消息”，不实现“重新生成上一轮”。

---

## 12. 状态面板模块设计

## 12.1 `StatusPanel`

职责：

- 展示 Agent 名称；
- 展示当前状态；
- 展示最新变化原因；
- 声明这是模拟状态，不是真实人类情绪。

不订阅：

- 聊天消息数组；
- 输入框内容；
- 会话加载状态，除非面板自身需要空状态。

---

## 12.2 `EmotionBars`

渲染两个维度：

```text
valence
arousal
```

每条 bar：

- 中点为 0;
- 正值向右；
- 负值向左；
- 数值保留两位小数；
- 变化方向可视觉提示。

数值展示使用后端返回值，不四舍五入后再计算样式。

---

## 12.3 `ReasonLine`

显示：

```text
latestEvent.reason
```

无事件时显示空状态：

```text
还没有明显的变化。和她聊聊后，这里会显示原因。
```

不得编造前端推断原因。

---

## 12.4 `EmotionTag`

标签来自后端：

```text
calm / curious / happy / low / tense / neutral
```

前端只做展示映射：

| tag | 中文文案 | emoji |
|---|---|---|
| `calm` | 平静 | 🌿 |
| `curious` | 好奇 | ✨ |
| `happy` | 愉悦 | ☀️ |
| `low` | 低落 | 🌧️ |
| `tense` | 紧绷 | ⚡ |
| `neutral` | 如常 | ◦ |

未知 tag 显示为：

```text
未知状态
```

不抛出渲染异常。

---

## 13. 渲染隔离设计

## 13.1 问题

聊天流式期间，文本消息会高频更新。如果状态和消息共享同一个全局 state，会导致：

- `StatusPanel` 反复重渲染；
- `MessageList` 全列表重渲染；
- 输入框失焦或卡顿；
- 后续记忆面板被无关更新影响。

---

## 13.2 隔离策略

1. `MessageList` 只接收聊天消息；
2. `StatusPanel` 只订阅 `AgentStateStore`;
3. `MessageItem` 使用 `React.memo`;
4. `EmotionBars` 使用 `React.memo`;
5. `ReasonLine` 只依赖 event reason;
6. `MessageComposer` 独立管理草稿；
7. Zustand 使用 selector 订阅最小字段；
8. 不把状态事件写入消息数组；
9. 不把消息写入 Zustand。

---

## 13.3 Zustand selector 规则

推荐：

```ts
const valence = useAgentStateStore((s) => s.state.valence);
const reason = useAgentStateStore((s) => s.latestEvent?.reason ?? null);
```

避免：

```ts
const state = useAgentStateStore();
```

后者会订阅整个 store，破坏隔离。

---

## 13.4 流式更新优化

Assistant 流式更新期间：

- 只更新当前 Assistant 消息；
- 消息项 memo 后历史消息不重渲染；
- 不更新状态面板，除非收到状态事件；
- 不重新请求 bootstrap。

---

## 14. 错误处理设计

## 14.1 错误分层

| 层级 | 处理者 | 展示方式 |
|---|---|---|
| Bootstrap 失败 | `ConversationStore` | 全页错误 + 重试 |
| 聊天请求失败 | `useAgentChat` | 输入区错误 + 保留内容 |
| LLM 失败 | `FailedMessageBubble` | 失败气泡 |
| 状态事件解析失败 | adapter | 忽略无效事件 + 控制台警告 |
| 渲染异常 | ErrorBoundary | 全页错误 |
| 设置读取失败 | React Query | 设置区域错误，不阻断聊天 |

---

## 14.2 `DUPLICATE_CLIENT_MESSAGE`

处理规则：

1. 不追加用户消息；
2. 不重复发送；
3. 触发一次 bootstrap 或会话刷新；
4. 显示“消息可能已提交，正在同步”；
5. 不自动生成新 `clientMessageId` 重试同一内容。

---

## 14.3 网络中断

处理规则：

- 保留输入内容；
- 显示网络错误；
- 停止流式状态；
- 允许用户重新发送新请求。

是否恢复未完成 Assistant 消息，以服务端持久化结果为准。

---

## 15. 输入与可访问性

## 15.1 输入框

- 使用 `textarea`;
- 支持多行；
- 最大长度 8000;
- 发送按钮必须有 `disabled` 原因提示；
- 流式过程中提供停止按钮。

键盘：

```text
Enter: 发送
Shift + Enter: 换行
Escape: 不强制处理
```

输入法组合输入时，Enter 不应误触发发送，需要处理 `isComposing`。

---

## 15.2 消息列表可访问性

- 消息区域可滚动；
- 使用语义化列表；
- 用户和 Assistant 消息有可读标识；
- 时间戳可被读屏识别；
- 流式消息声明 `aria-live="polite"`。

注意：如果每 token 更新都触发读屏播报，会造成噪声。可采用汇总策略：

- 容器 `aria-live="polite"`;
- 不对每个字符 span 单独设置 live;
- 生成结束时更新完整消息描述。

---

## 15.3 状态面板可访问性

- 条形图提供文本数值；
- 不只用颜色表达状态；
- emoji 有 `aria-hidden`;
- 原因文本直接可读。

---

## 16. 样式设计

## 16.1 布局

桌面优先：

```text
┌────────────────────────────┬──────────────┐
│ Chat Region                │ Status Panel │
│ ┌────────────────────────┐ │              │
│ │ Message List           │ │ Emotion Tag  │
│ │                        │ │ Emotion Bars │
│ └────────────────────────┘ │ Reason Line  │
│ ┌────────────────────────┐ │              │
│ │ Composer               │ │              │
│ └────────────────────────┘ │              │
└────────────────────────────┴──────────────┘
```

小屏策略：

```text
StatusPanel 折叠到顶部或底部
```

MVP 不做深度移动端优化，但不能布局崩坏。

---

## 16.2 Tailwind 使用规则

允许：

- 布局工具类;
- spacing;
- typography;
- color;
- border;
- 简单状态样式。

不建议：

- 在组件中堆叠大量重复样式；
- 用任意值替代设计 token;
- 直接写与主题不一致的颜色。

共享样式可以抽成组件或 class。

---

## 16.3 设计 token

至少定义：

```text
color.surface
color.surface-muted
color.border
color.text.primary
color.text.secondary
color.user-message
color.assistant-message
color.positive
color.negative
radius.message
shadow.panel
```

便于后续主题切换。

---

## 17. 数据流总览

## 17.1 Bootstrap 数据流

```text
App
  ↓ fetchBootstrap
API client
  ↓ BootstrapResponse
ConversationStore
  ↓ conversationId / ready
useAgentChat
  ↓ initialMessages
MessageList

AgentStateStore
  ↓ current state / latest event
StatusPanel
```

## 17.2 用户发送数据流

```text
MessageComposer
  ↓ send()
useAgentChat
  ↓ clientMessageId + message
chat transport
  ↓ POST /api/chat
server stream
  ├─ text delta → useChat → MessageList
  └─ data-agent-state-event → AgentStateStore → StatusPanel
```

## 17.3 刷新恢复数据流

```text
page refresh
  ↓
GET /api/bootstrap
  ↓
restore conversationId
restore messages
restore agent state
restore latest reason
  ↓
render
```

---

## 18. 关键边界规则

## 18.1 前端不做状态计算

禁止：

```text
根据用户文本在 React 中重新计算 valence / arousal
```

原因：

- 后端是状态事实来源；
- 前后端重复规则容易不一致；
- 状态事件必须可审计。

---

## 18.2 前端不保存长期业务事实

禁止把以下数据作为唯一来源保存在浏览器：

- 消息；
- 状态；
- 状态原因；
- 人格版本；
- 设置。

浏览器只做 UI 状态和缓存。

---

## 18.3 不提前做记忆 UI

Phase 2 新增：

```text
MemoryViewer
```

必须作为独立模块加入：

```text
src/memory/
```

不得为了提前展示记忆而污染聊天 store。

---

## 18.4 不提前做人格 UI

Phase 2 新增：

```text
PersonaEditor
PersonaDiffViewer
```

必须作为独立模块加入：

```text
src/persona/
```

不得修改 `PERSONA_CORE` 展示逻辑到聊天核心组件中。

---

## 19. 测试策略

## 19.1 Store 测试

`AgentStateStore`:

- bootstrap 初始化；
- applyStateEvent 更新；
- reset;
- 空事件不影响状态；
- event 的 agentId 与当前 Agent 不一致时忽略。

`ConversationStore`:

- idle → loading → ready;
- idle → loading → error;
- reset 后不残留 conversationId。

---

## 19.2 Adapter 测试

`chat transport adapter`:

- 请求体字段映射；
- `clientMessageId` 注入；
- data part 识别；
- 未知 data part 忽略；
- HTTP 409 归一化；
- LLM 错误归一化。

---

## 19.3 Hook 测试

`useAgentChat`:

- bootstrap 未完成时不可发送；
- 空消息不发送；
- 超长消息不发送；
- 发送时生成 clientMessageId;
- 流式文本更新；
- 状态事件写入 AgentStateStore;
- 409 后不重复追加消息。

---

## 19.4 组件测试

`MessageComposer`:

- 空内容禁用；
- 长内容提示；
- Enter 发送；
- Shift+Enter 换行；
- 输入法 composing 不发送；
- 发送中禁用；
- 停止按钮显示。

`MessageList`:

- 用户消息渲染；
- Assistant 消息渲染；
- failed 消息渲染；
- 空状态渲染；
- 流式消息渲染。

`StatusPanel`:

- 当前数值展示；
- 正负方向展示；
- 原因展示；
- 无事件空状态；
- 未知 tag 降级展示。

---

## 19.5 渲染隔离测试

使用 React Profiler 或测试观察更新次数：

- 状态事件更新不触发历史 `MessageItem` 重渲染；
- 文本流式更新不触发 `StatusPanel` 重渲染；
- 输入框变化不触发 `MessageList` 全量重渲染。

---

## 19.6 端到端冒烟测试

MVP 后期可用 Playwright：

1. 打开页面；
2. bootstrap 成功；
3. 发送消息；
4. 看到流式回复；
5. 提到“今天好累”；
6. 状态面板显示愉悦度下降和原因；
7. 刷新页面；
8. 消息和状态恢复。

---

## 20. 性能预算

| 场景 | 目标 |
|---|---|
| 首次可交互 | 本地环境 < 1s |
| Bootstrap 后首屏渲染 | < 200ms |
| 状态事件到面板更新 | 用户不可感知 |
| 单条历史消息重渲染 | 流式期间为 0 |
| 200 条消息内 | 不要求虚拟列表 |
| 超过 200 条 | 引入虚拟列表 |

---

## 21. Phase 0 验证项

Phase 0 必须先验证：

1. `useChat` 能否接收 bootstrap 恢复消息；
2. 自定义 transport 请求体是否可控；
3. `data-agent-state-event` 能否从 SDK message parts 暴露；
4. 流式文本更新能否只影响当前消息；
5. Zustand selector 能否隔离状态面板更新；
6. 409 错误能否被 transport 归一化；
7. AbortController 停止生成是否可用。

如果第 3 项不成立，切换为备选方案：

```text
聊天流只处理文本
流结束后 GET /api/agents/:id/state
```

不得把不可靠底层协议假设硬编码进组件。

---

## 22. 里程碑拆分

## R0. 前端骨架

- Vite + React;
- TypeScript;
- Tailwind;
- providers;
- API client;
- shared types;
- 基础布局。

完成标准：

- 页面可启动；
- 类型可引用；
- API 错误可归一化。

---

## R1. Bootstrap 与状态恢复

- ConversationStore;
- AgentStateStore;
- bootstrap 页面流程；
- 错误与重试；
- 恢复消息。

完成标准：

- 刷新后消息和状态恢复。

---

## R2. 聊天 UI

- ChatShell;
- MessageList;
- MessageComposer;
- message bubbles;
- 空状态；
- 发送与停止。

完成标准：

- 能发送消息并展示流式回复。

---

## R3. 状态事件接入

- transport adapter;
- data part 解析；
- AgentStateStore 更新；
- StatusPanel 展示原因。

完成标准：

- 状态面板随状态事件独立更新。

---

## R4. 测试与渲染隔离

- store 测试；
- adapter 测试；
- hook 测试；
- 组件测试；
- Profiler 验证。

完成标准：

- MVP 验收通过；
- 状态和消息更新互不造成明显重渲染问题。

---

## 23. 明确不做

MVP 前端不实现：

- 登录页；
- 多会话列表；
- 记忆查看器；
- 人格编辑器；
- 状态时间线；
- Markdown 渲染；
- 图片上传；
- 语音输入；
- 3D Avatar;
- 移动端深度优化；
- 虚拟列表；
- 离线模式。

这些能力后续按独立模块添加。
