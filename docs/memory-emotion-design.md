# 长期记忆与透明性 技术设计（Phase 2 + 情感记忆增强）

版本：v1.0
日期：2026-11-13
状态：已评审待实施
关联文档：[requirements.md](./requirements.md) Phase 2 / F13-F20、[database-schema.md](./database-schema.md) §14、[api-contract.md](./api-contract.md) §6.5、[technical-design.md](./technical-design.md)

---

## 1. 目标与范围

本设计覆盖需求文档 Phase 2「长期记忆与透明性」全部范围，并整合情感记忆增强方案（PAD 一致性检索、唤醒度门控半衰期、幂律遗忘与再巩固）。

核心原则：

1. **复用已有 PAD/OU 信号，不建第二个情感状态机**——检索的情感查询直接用 OU 过程维护的当前 PAD 快照；记忆写入的 PAD 来自当次 `state_events`。
2. **每阶段只引入一个需要调参的新维度**，按「检索 → 写入 → 生命周期」递进，动态图结构明确列为 backlog。
3. **记忆透明、可修正、可删除**贯穿所有阶段，删除后必须同步退出 Prompt 与检索。

验收对照（requirements.md Phase 2）：

1. 第一天告诉 Agent「我在学做饭」，第二天新会话询问时能自然带出；
2. 记忆查看器能看到来源消息、置信度、最后访问时间；
3. 删除记忆后不再进入 Prompt，不再参与检索。

---

## 2. 现有地基（不新增，直接复用）

| 能力 | 现有实现 |
|---|---|
| 当前 PAD 状态（检索情感查询） | `emotion-decay.ts` OU 基线回归 → `agents` 状态快照 |
| 写入时 PAD 坐标 | 聊天管线每次状态更新写 `state_events`（before/after/delta） |
| Arousal 信号 | PAD 第二维 `a`，emotion-rules-v2 已输出 |
| 衰减参数治理模式 | `resolveDecayConfig`（角色参数驱动衰减），半衰期参数照搬此模式 |
| 幂等与占位 | `clientMessageId` 幂等、failed 占位 |

---

## 3. 数据模型

### 3.1 `memories` 表（新增迁移）

在 database-schema.md §14.1 要点基础上，增加情感字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `TEXT PK` | memory_id |
| `user_id` / `agent_id` | `TEXT` | 组合索引实现 `owner_id`，禁止跨 owner 检索 |
| `type` | `TEXT` | `fact` / `preference` / `goal` / `episode` / `relationship` |
| `content` | `TEXT` | 原子事实文本 |
| `source_message_id` | `TEXT FK→messages` | 来源消息，必填 |
| `confidence` | `REAL` | 0-1，抽取置信度 |
| `status` | `TEXT` | `candidate` / `active` / `outdated` / `rejected` / `deleted` |
| `memory_pad` | `TEXT(JSON)` | `{v,a,d}`，写入时的 PAD 快照 [-1,1] |
| `arousal` | `REAL` | 写入时唤醒度增量，0-1 |
| `half_life_hours` | `REAL` | 由 arousal 门控计算，见 §5 |
| `strength` | `REAL` | 当前保留强度，由遗忘曲线更新 |
| `last_accessed_at` | `TEXT NULL` | 最近一次被检索/注入 Prompt |
| `created_at` / `updated_at` | `TEXT` | 通用约定 |

索引：`(user_id, agent_id, status)`、`(user_id, agent_id, type)`、`source_message_id`。

### 3.2 `conversation_summaries` 表（新增迁移）

按 database-schema.md §14.2：`id, conversation_id, agent_id, start_message_id, end_message_id, content, status(pending/ready/failed/deleted), created_at, updated_at`。

### 3.3 `memory_edges` 表（backlog，本期不建）

REMT 动态图的最小形态：`from_id, to_id, weight, updated_at` 邻接表 + 有界 BFS 激活扩散。等记忆规模达数千级再启动；Node 生态无 NetworkX，直接用 SQLite 邻接表实现。

---

## 4. 写入层：抽取与编码（先做，因为字段要一开始就落库）

### 4.1 事实抽取

- 聊天管线在用户消息入库后触发抽取（LLM structured output，要求输出原子事实数组 + type + confidence）；
- `confidence >= 0.7` → 直接 `active`；`< 0.7` → `candidate`，进记忆查看器待确认；
- 抽取失败不阻塞聊天，记 warning，下条消息重试窗口内可补抽。

### 4.2 情感编码

写入时从当次 `state_events` 取 `after` PAD：

- `memory_pad = after 的 {v,a,d}`；
- `arousal = 写入时刻的唤醒度`（无状态事件时取 0，即纯事实类）。

### 4.3 唤醒度显著性门控（自适应半衰期）

```
half_life_hours = base_half_life × (1 + arousal)
```

`arousal` 标定参考：认知转折 0.9 / 顿悟 0.8 / 模式识别 0.7 / 里程碑 0.6 / 待跟进 0.4 / 问候确认 ≈0。

### 4.4 丰富编码

`arousal >= 0.6` 的事件写入时附加实体与用户原话片段字段（JSON），低唤醒只存 `content` 精简文本。

### 4.5 冲突处理（F16）

新事实与旧事实同 owner + 同 type 且语义冲突时：

1. 新事实按置信度走 active/candidate；
2. 低风险（高置信度 + type 属于 fact/goal）→ 自动将旧事实标 `outdated`；
3. 高风险或低置信度 → 两者保持各自状态，待用户在查看器确认；
4. Prompt 组装时同 type 只注入最高 `strength × confidence` 的一条，禁止矛盾事实并存。

---

## 5. 检索层：情感一致性评分

### 5.1 评分公式

```
score(m) = α·sim_sem(q,m) + β·sim_aff(P_current, m.memory_pad) + γ·recency(t_m)
```

- `sim_sem`：**本期用 SQLite FTS5 关键词相似度**（DeepSeek 无 embedding 接口；embedding 作为可插拔项后补，接口签名预留）。
- `sim_aff`：PAD 三维一致性加权和，等权起步：`w_v·cons_v + w_a·cons_a + w_d·cons_d`，其中 `cons = 1 - |Δ|/2`。
- `recency`：`e^(-λ·Δt_hours)` 过渡，λ = ln2 / half_life_hours（与半衰期联动，见 §6）。
- 系数起点：`α=0.6, β=0.3, γ=0.1`，硬约束 `β < α`，建议 `β/α ≈ 0.5`。

预期：`sim_aff` 对 episode/relationship 类记忆区分度最高；fact 类 PAD 多接近基线，主要靠语义 + recency 排序，属正常现象。

### 5.2 检索流程

1. 候选集：owner 过滤 + `status = active`；
2. FTS5 召回 Top-N 语义候选；
3. 全量评分排序，取 Top-K（建议 K=5）；
4. 与近期窗口合并去重后注入 Prompt；
5. 命中记忆更新 `last_accessed_at`（再巩固入口，见 §6.2）。

---

## 6. 生命周期：遗忘与再巩固

### 6.1 幂律遗忘（保留强度）

```
strength(t) = (1 + Δt/half_life)^(-β_power)，β_power 起点建议 0.5
```

- 遗忘只影响检索权重（`strength` 进入 score 或作为门槛），**不删除数据**；
- 惰性更新：读取时按公式现算，另用定期任务批量落库；
- 被用户标记核心的记忆不衰减到不可用（strength 下限 0.2）。

### 6.2 再巩固（检索即强化）

```
arousal_m ← arousal_m + η·1[retrieved]，η = 0.05，上限 0.95
更新 arousal 后重算 half_life_hours
```

后期可选预测误差门控：`|P_current - memory_pad|` 超阈值才允许改写情感标注，防止记忆被过度美化。

### 6.3 摘要压缩

`strength` 低于阈值（建议 0.15）的 episode 不删除，触发摘要压缩：内容并入相邻高显著记忆的摘要条目（写 `conversation_summaries`），原条目标 `outdated` 归档。

摘要任务（F14）：每 30 条新消息异步触发，记录来源消息范围，幂等、可重试、不阻塞聊天、可被用户删除重建。

---

## 7. 透明性：API 与 UI

### 7.1 记忆 API（api-contract §6.5）

```
GET    /api/memories          # status/type 筛选、分页、含来源消息引用
PATCH  /api/memories/:id      # 修正 content/type
DELETE /api/memories/:id      # 软删 → status=deleted
POST   /api/memories/:id/confirm
POST   /api/memories/:id/reject
```

删除/修正的连带影响（F18）：立即退出候选集与 Prompt、FTS 索引同步失效、审计仅保留操作记录不保留内容。

### 7.2 前端

- **记忆查看器**（抽屉）：列表、type/status 筛选、来源消息跳转、置信度、strength/半衰期可视化、编辑/删除/确认（乐观更新 + 最终态回写）；
- **状态时间线**：基于 `state_events` 分页（api-contract 已有 StateEventPageResponse），展示 before→after 与原因；
- **调试模式**：Prompt 快照（`prompt_snapshots` 表按 database-schema §14.4）。

### 7.3 数据控制

`GET /api/export`（JSON 全量导出）、`DELETE /api/data`（返回任务状态与派生数据处理结果）。

---

## 8. 参数治理

所有可调参数进 `app_settings`，沿用 decay config 模式：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `memory.retrieval.alpha` | 0.6 | 语义权重 |
| `memory.retrieval.beta` | 0.3 | 情感一致性权重（须 < alpha） |
| `memory.retrieval.gamma` | 0.1 | 时间邻近权重 |
| `memory.half_life.base_hours` | 72 | 中等唤醒记忆半衰期 |
| `memory.forgetting.beta_power` | 0.5 | 幂律指数 |
| `memory.reconsolidation.eta` | 0.05 | 检索强化步长 |
| `memory.prompt.top_k` | 5 | 注入 Prompt 的记忆上限 |

---

## 9. 实施步骤（每步独立提交 + 测试）

| # | 步骤 | 内容 | 对应章节 |
|---|---|---|---|
| S1 | 数据层 | `memories` + `conversation_summaries` schema、迁移、Drizzle 映射、schema 测试 | §3 |
| S2 | 记忆 API | CRUD + confirm/reject + 冲突处理服务层 + 测试 | §4.5 / §7.1 |
| S3 | 写入管线 | 事实抽取 + memory_pad/arousal 编码 + 半衰期门控 + Prompt 注入（FTS5 评分） | §4 / §5 |
| S4 | 生命周期 | 幂律遗忘 + 检索强化 + 摘要触发 | §6 |
| S5 | 透明性 UI | 记忆查看器 + 状态时间线 | §7.2 |
| S6 | 数据控制 | export/delete + 调试 Prompt 快照 | §7.3 |

依赖关系：S1 → S2 → S3 → S4/S5（可并行）→ S6。

---

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| DeepSeek 无 embedding 接口 | FTS5 起步，sim_sem 接口抽象可替换为向量实现 |
| 情感一致性压过语义相关性 | 硬约束 beta < alpha + A/B 人工评估召回记忆的情感合理性 |
| 高/低唤醒保留率差异不达标 | 用参考值（约 10.7pp @365 天）校准 beta_power |
| 记忆被检索强化过度 | arousal 上限 0.95 + 预测误差门控（后期） |
| 多 Agent 数据串扰 | 所有查询强制 owner 过滤，服务层单测覆盖 |
| 删除记忆后仍进 Prompt | status 流转集中在服务层，禁止 route 直写，集成测试覆盖 |

---

## 11. backlog（本期明确不做）

- REMT 动态图（memory_edges + 激活扩散）：记忆规模数千级后启动；
- 向量检索（sqlite-vec / pgvector）：FTS5 召回质量不足时升级；
- 遗忘曲线的 per-type 半衰期细分（F20 Level 3 完整版）；
- 人格演化（Phase 3 范围）。
