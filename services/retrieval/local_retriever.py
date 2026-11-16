"""检索实现层(T5):组装 T2 embedder + T3 store + T4 chunker。

职责边界:实现 packages/shared/src/types/retrieval.ts 定义的 MemoryRetriever 契约;
不注入 prompt、不感知人格分层(T7 及人格管道才是消费方)。

依赖注入:embedder / store / 切片参数均可从构造函数覆盖,
默认组装真实组件;测试时注入假 embedder 即可脱离模型验证。

失败降级(契约约定):
- search():任何异常(模型不可用、库损坏等)返回空列表并打日志,不抛错;
- index():参数问题抛错由调用方(T7)降级,本层只透传。
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone
from typing import Optional, Sequence

import numpy as np

# 让本模块可以从仓库任意位置直接运行(仓库根加入 sys.path,支持命名空间包导入)。
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

logger = logging.getLogger(__name__)


class LocalMemoryRetriever:
    """MemoryRetriever 的本地实现:对话入库 + 语义检索。"""

    def __init__(
        self,
        embedder=None,
        store=None,
        max_chars: int = 500,
        overlap_sentences: int = 1,
        default_top_k: int = 5,
        db_path: Optional[str] = None,
    ) -> None:
        # 延迟导入,保证不装 sentence-transformers 时仍可注入假 embedder 使用本模块。
        from services.retrieval.chunker import (
            DEFAULT_MAX_CHARS,
            DEFAULT_OVERLAP_SENTENCES,
            chunk_dialogue,
        )
        from services.retrieval.store import VectorStore

        self._chunk_dialogue = chunk_dialogue
        self._max_chars = max_chars if max_chars else DEFAULT_MAX_CHARS
        self._overlap = overlap_sentences if overlap_sentences is not None else DEFAULT_OVERLAP_SENTENCES
        self._embedder = embedder  # None 时首次调用 index/search 才加载真实模型
        self._store = store or VectorStore(db_path)
        self.default_top_k = default_top_k

    # ---- 组件管理 -------------------------------------------------------

    def _ensure_embedder(self):
        if self._embedder is None:
            from services.embedding.embedder import BgeBaseEmbedder

            self._embedder = BgeBaseEmbedder()
        return self._embedder

    # ---- 入库 -----------------------------------------------------------

    def index(self, texts: Sequence[str], metadatas: Sequence[dict]) -> None:
        """契约方法:已切片的文本直接入库(不做二次切片)。"""
        if len(texts) != len(metadatas):
            raise ValueError("texts and metadatas must have the same length")
        embedder = self._ensure_embedder()
        vectors = embedder.embed(list(texts))
        self._store.upsert(list(texts), list(metadatas), vectors)

    def index_dialogue(self, messages: Sequence[dict]) -> int:
        """便捷方法:对话消息 → 切片 → 向量化 → 入库。

        messages 元素可含 "timestamp"(ISO 字符串);缺省时用当前 UTC 时间。
        返回入库的片段数。
        """
        chunks = self._chunk_dialogue(
            list(messages), max_chars=self._max_chars, overlap_sentences=self._overlap
        )
        if not chunks:
            return 0
        now = datetime.now(timezone.utc).isoformat()
        metadatas = [
            {
                "timestamp": self._pick_timestamp(messages) or now,
                "source": "chat-turn",
                "turn": c.turn,
                "tags": c.tags,
            }
            for c in chunks
        ]
        self.index([c.text for c in chunks], metadatas)
        return len(chunks)

    @staticmethod
    def _pick_timestamp(messages: Sequence[dict]) -> Optional[str]:
        for msg in reversed(list(messages)):
            ts = msg.get("timestamp")
            if ts:
                return ts
        return None

    # ---- 检索 -----------------------------------------------------------

    def search(
        self,
        query: str,
        top_k: Optional[int] = None,
        source: Optional[str] = None,
    ) -> list[dict]:
        """契约方法:语义检索。失败一律返回空列表(降级约定)。

        source 传入时做可选的元数据过滤。
        """
        k = top_k or self.default_top_k
        try:
            if not query or not query.strip():
                return []
            embedder = self._ensure_embedder()
            query_vec = embedder.embed([query.strip()])
            hits = self._store.search(query_vec[0], top_k=k * 3)  # 先多取,过滤后截断
            if source:
                hits = [h for h in hits if h.source == source]
            return [
                {
                    "text": h.text,
                    "score": float(h.score),
                    "metadata": {
                        "timestamp": h.timestamp,
                        "source": h.source,
                        "turn": h.turn,
                        "tags": h.tags,
                    },
                }
                for h in hits[:k]
            ]
        except Exception:  # noqa: BLE001  降级约定:检索失败不阻断对话
            logger.exception("memory search failed, degrading to empty result")
            return []


if __name__ == "__main__":
    # 冒烟脚本(T5 完成标准):注入确定性假 embedder,脱离模型跑通端到端。
    import tempfile

    class FakeEmbedder:
        """确定性假 embedder:按关键词给向量,足以验证管道。"""

        KEYWORDS = ["猫", "狗", "鱼", "难过", "开心"]  # 最后一维留给无关键词兜底

        def embed(self, texts: Sequence[str]) -> np.ndarray:
            out = np.zeros((len(texts), len(self.KEYWORDS)), dtype=np.float32)
            for i, t in enumerate(texts):
                for j, kw in enumerate(self.KEYWORDS):
                    if kw in t:
                        out[i, j] = 1.0
                if not out[i].any():
                    out[i, 0] = 0.1
                out[i] /= np.linalg.norm(out[i])
            return out

    logging.basicConfig(level=logging.INFO)
    with tempfile.TemporaryDirectory() as tmp:
        from services.retrieval.store import VectorStore

        retr = LocalMemoryRetriever(
            embedder=FakeEmbedder(),
            store=VectorStore(os.path.join(tmp, "t5.db")),
        )
        retr.index_dialogue([
            {"role": "user", "content": "我养了一只猫,它很粘人", "timestamp": "2026-11-13T10:00:00Z"},
            {"role": "assistant", "content": "听起来很温馨。"},
            {"role": "user", "content": "昨天工作被批评了,有点难过"},
            {"role": "assistant", "content": "辛苦了。"},
        ])
        hits = retr.search("宠物", top_k=2)
        assert hits and "猫" in hits[0]["text"], hits
        assert hits[0]["metadata"]["turn"] == 1
        sad = retr.search("难过", top_k=2)  # 假 embedder 只能按关键词;真实语义召回由真模型在开发机验证
        assert sad and "难过" in sad[0]["text"], sad
        empty = LocalMemoryRetriever(embedder=FakeEmbedder(), store=VectorStore(os.path.join(tmp, "empty.db")))
        assert empty.search("猫") == []
        print("hits:", len(hits), "| top1 turn:", hits[0]["metadata"]["turn"])
        print("sad top1 turn:", sad[0]["metadata"]["turn"])
        print("smoke OK")

