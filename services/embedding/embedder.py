"""Embedding 封装(T2)。

本模块是整个检索链路中唯一允许出现 embedding 模型名的地方。
职责边界:只负责加载模型和把文本编码为向量;
不知道向量存哪(T3)、不知道切片策略(T4)、不知道谁调用它(T5)。

模型与设备从构造参数传入,默认值在此定义为配置默认值。
惰性加载:第一次调用 embed() 时才加载模型,避免 import 即占内存。
"""

from __future__ import annotations

import os
from typing import Sequence

import numpy as np

# 配置默认值:模型名只允许出现在这里和配置层。
DEFAULT_MODEL_NAME = "BAAI/bge-base-zh-v1.5"
DEFAULT_DEVICE = "cpu"

# 输出维度,用于调用方校验与存储层预留空间(仅作元信息,不做硬校验)。
EXPECTED_DIM = 768


class BgeBaseEmbedder:
    """bge-base-zh-v1.5 的惰性加载封装。"""

    def __init__(
        self,
        model_name: str | None = None,
        device: str | None = None,
    ) -> None:
        self.model_name = model_name or os.environ.get("EMBEDDING_MODEL_NAME", DEFAULT_MODEL_NAME)
        self.device = device or os.environ.get("EMBEDDING_DEVICE", DEFAULT_DEVICE)
        self._model = None  # type: ignore[annotation-unchecked]

    def _ensure_loaded(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer  # 延迟导入,保持模块可导入性

            self._model = SentenceTransformer(self.model_name, device=self.device)
        return self._model

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        """把一批文本编码为 (n, 768) 的 float32 向量矩阵。

        空列表直接返回空矩阵,不触发模型加载。
        输入含空字符串时抛 ValueError,由调用方(T5)决定降级行为。
        """
        if len(texts) == 0:
            return np.empty((0, EXPECTED_DIM), dtype=np.float32)
        if any(not isinstance(t, str) or t.strip() == "" for t in texts):
            raise ValueError("texts must be non-empty strings")
        model = self._ensure_loaded()
        vectors = model.encode(
            list(texts),
            batch_size=32,
            normalize_embeddings=True,  # 归一化后内积即余弦相似度,T3 直接用
            show_progress_bar=False,
        )
        return np.asarray(vectors, dtype=np.float32)


if __name__ == "__main__":
    # 冒烟脚本(T2 完成标准):输出向量维度应为 768。
    emb = BgeBaseEmbedder()
    vecs = emb.embed(["今天心情不错", "我有点难过"])
    print("model:", emb.model_name)
    print("shape:", vecs.shape)  # 期望 (2, 768)
