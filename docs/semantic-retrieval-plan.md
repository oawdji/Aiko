# 语义检索模块接入任务拆分(Embedding: bge-base-zh-v1.5,本地推理)

> 状态:规划中,未开始实现。本文档只做任务拆分与边界定义,不含实现代码。

## 总体原则

- 检索模块对上层只暴露一个接口("给文本,返回相关记忆"),embedding 模型、向量存储、切片策略全部藏在接口后面,后续换模型/换存储不动上层。
- 每个任务产出物 ≤ 200 行;超过就继续拆。
- 本任务**不包含**人格演化管道,只提供"记忆检索"能力,演化管道作为消费方另行接入。
- 与受控人格演化的关系:检索为演化提供"证据链"(人格为什么变成这样的历史事件),接口保持通用,不感知人格分层。

## 前置准备(本地开发机,不占任务编号)

- `pip install sentence-transformers`(会带 torch,CPU 版即可)
- 模型首次运行时自动从 HuggingFace 下载 `BAAI/bge-base-zh-v1.5`(~400MB),或提前手动下载后放本地路径
- 国内网络建议设置 HF 镜像:`HF_ENDPOINT=https://hf-mirror.com`

## 任务列表

### T1: 定义检索接口层(纯接口,无实现)

- **目标**: 确立模块边界,这是解耦的锚点。
- **新增文件**: `memory/retrieval/base.ts`(占位,按 monorepo 实际包结构调整)
- **内容边界**:
  - 定义 `MemoryRetriever` 抽象接口,方法只有两个:
    - `index(texts, metadatas)` — 写入/更新记忆
    - `search(query, topK): MemoryHit[]` — 检索
  - 定义 `MemoryHit` 数据结构:`text / score / metadata`(metadata 放时间戳、来源轮次等,字段在本任务定稿)
- **明确不做**: 任何 embedding、存储、具体类实现。
- **完成标准**: 接口文件可被 import,不含运行时第三方依赖。
- **预计规模**: ~50 行。

### T2: Embedding 封装(唯一允许出现模型名的地方)

- **目标**: 把 bge-base-zh 的加载和编码封装成独立模块。
- **新增文件**: `memory/retrieval/embedder.ts`(Python 侧为 `embedder.py`,视推理进程语言而定)
- **内容边界**:
  - 暴露 `embed(texts: string[]): Promise<Float32Array[]>`
  - 模型名/模型路径从配置传入,**硬编码只允许出现在配置默认值**
  - 惰性加载(第一次调用才加载模型,避免进程启动即占内存)
- **明确不做**: 不知道向量存哪、不知道谁调用它。
- **完成标准**: 单独跑一个小脚本,对两句文本输出向量维度 768。
- **预计规模**: ~60 行。

### T3: 向量存储层(SQLite + 全量余弦,先不引向量库)

- **目标**: 本地持久化向量与元数据。
- **新增文件**: `memory/retrieval/store.ts`(占位)
- **内容边界**:
  - SQLite 存元数据(text、timestamp、source),向量以 blob 存同表或旁表
  - 方法:`upsert / loadAll / count`
  - 相似度计算在本模块内做(数据量 < 10 万条时,numpy/typed-array 全量余弦完全够,毫秒级)
- **明确不做**: 不调 embedding 模型,不决定切片策略。
- **解耦点**: 将来换 FAISS/Chroma/pgvector,只替换本文件,T1 接口不变。
- **完成标准**: 存 3 条向量 → 重启进程 → 能全部读回。
- **预计规模**: ~120 行。

### T4: 切片策略(独立纯函数模块)

- **目标**: 把长对话/长文本切成适合检索的片段。
- **新增文件**: `memory/retrieval/chunker.ts`(占位)
- **内容边界**:
  - 先只实现一种:按对话轮切(每轮 = 用户消息+回复为一条记忆,超长再按句子二次切)
  - 切片大小、重叠度作为参数,默认值写配置
- **明确不做**: 不涉及向量、不涉及存储。
- **完成标准**: 给一段 50 轮的模拟对话,输出切片列表符合预期。
- **预计规模**: ~80 行。

### T5: 具体实现类,组装 T2+T3+T4

- **目标**: 实现 T1 的接口,把三个组件串起来。
- **新增文件**: `memory/retrieval/local-retriever.ts`(占位)
- **内容边界**:
  - `LocalMemoryRetriever implements MemoryRetriever`,构造时注入 embedder + store + chunker
  - `index()` = chunk → embed → store
  - `search()` = embed(query) → store 相似度 → topK
  - 查询支持按 metadata 简单过滤(时间范围/来源,可选)
- **明确不做**: 不注入 prompt、不关心人格分层。
- **完成标准**: 端到端小脚本:存 10 条记忆 → 语义查询("我上次难过的原因")能召回措辞不同但语义相近的条目。
- **预计规模**: ~100 行。

### T6: 配置与依赖声明

- **修改文件**: 项目配置文件(如 `config` / `.env` / settings)+ `package.json` / `requirements.txt`(按实际依赖管理方式)
- **内容边界**:
  - 新增配置项:`embedding.modelName`(默认 `BAAI/bge-base-zh-v1.5`)、`embedding.device`(默认 `cpu`)、`memory.dbPath`、`memory.chunkSize`、`memory.topK`
  - 依赖声明增加 sentence-transformers 相关条目
- **明确不做**: 不修改任何现有配置项。

### T7: 接入现有记忆/对话管道(改造点,唯一动旧代码的任务)

- **修改文件**: 现有对话主循环或记忆管理模块(具体文件名待按 monorepo 结构确认)
- **内容边界**:
  - 每轮对话结束后调用 `index()` 写入记忆(一次调用 + 一个组装 metadata 的小函数)
  - 构造 prompt 时调用 `search()` 取 topK 注入上下文
  - **失败降级**: 模型加载失败/异常时,检索返回空列表并打日志,对话流程不中断
- **明确不做**: 不改人格演化相关逻辑;不重构旧代码,只加调用点。
- **预计规模**: 改动 < 60 行。

### T8: 验证与文档

- **新增文件**: `memory/retrieval/README.md`(占位)
- **内容边界**:
  - 模型下载方式(HF 镜像命令)、首次运行注意事项
  - 各组件职责说明
  - 已知限制(全量余弦的规模上限 ~10 万条,超过再换 FAISS)
- **完成标准**: 开发机按 README 从零跑通端到端脚本。

## 依赖关系与实施顺序

```
T1(接口) ──► T2 / T3 / T4(三个独立组件,可并行)
                    │
                    ▼
                T5(组装) ──► T6(配置) ──► T7(接入) ──► T8(文档)
```

- T2 / T3 / T4 互相零依赖,是天然的解耦切分点;任何一块将来重写(换 FAISS、换模型)都不会波及其他块。
- T7 是唯一修改既有代码的任务,必须在 T1–T6 全部完成并通过端到端脚本后进行。

## 待确认事项

1. 具体文件路径按 monorepo 实际包结构落位(`apps/` 下哪个应用承载对话管道、`packages/` 下是否新建 `memory` 包)。
2. ~~推理进程语言~~ 已定:Python(sentence-transformers)独立模块(services/embedding/),TS 主应用后续经本地 HTTP 调用,保持 T2 边界。

