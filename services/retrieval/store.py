"""向量存储层(T3)。

职责边界:只负责向量+元数据的持久化与相似度计算;
不调用 embedding 模型(T2)、不决定切片策略(T4)、不感知上层业务(T5)。

存储方案:SQLite 单文件,WAL 模式。数据量 < 10 万条时全量 numpy 余弦检索即可,
毫秒级返回;超过规模再换 FAISS,本文件是唯一需要替换的模块(T1 接口不变)。
"""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import closing
from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np

DEFAULT_DB_PATH = os.environ.get("MEMORY_DB_PATH", os.path.join("data", "memory-vectors.db"))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL,
    turn INTEGER,
    tags TEXT,
    vector BLOB NOT NULL
);
"""


@dataclass
class StoredMemory:
    """一条已入库的记忆(检索结果载体)。"""

    text: str
    score: float
    timestamp: str
    source: str
    turn: Optional[int] = None
    tags: list[str] = field(default_factory=list)


class VectorStore:
    """SQLite 向量存储。每次操作独立开关连接,进程重启后数据仍在。"""

    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or DEFAULT_DB_PATH
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        with self._connect() as conn, conn:
            conn.executescript(_SCHEMA)

    def _connect(self):
        # 显式 closing:sqlite3 的上下文管理器只管事务不关连接,
        # Windows 下 WAL 文件被占用会导致目录无法删除。
        return closing(sqlite3.connect(self.db_path))

    def upsert(
        self,
        texts: Sequence[str],
        metadatas: Sequence[dict],
        vectors: np.ndarray,
    ) -> None:
        """写入记忆。texts / metadatas / vectors 必须等长(vectors 形状 (n, d))。"""
        if not (len(texts) == len(metadatas) == vectors.shape[0]):
            raise ValueError("texts, metadatas and vectors must have the same length")
        rows = [
            (
                text,
                metadatas[i]["timestamp"],
                metadatas[i]["source"],
                metadatas[i].get("turn"),
                json.dumps(metadatas[i].get("tags", []), ensure_ascii=False),
                np.asarray(vectors[i], dtype=np.float32).tobytes(),
            )
            for i, text in enumerate(texts)
        ]
        with self._connect() as conn, conn:
            conn.executemany(
                "INSERT INTO memories (text, timestamp, source, turn, tags, vector) VALUES (?, ?, ?, ?, ?, ?)",
                rows,
            )

    def count(self) -> int:
        with self._connect() as conn:
            return int(conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0])

    def _load_all(self) -> tuple[list[tuple], np.ndarray]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT text, timestamp, source, turn, tags, vector FROM memories"
            ).fetchall()
        if not rows:
            return [], np.empty((0, 0), dtype=np.float32)
        matrix = np.frombuffer(
            b"".join(r[5] for r in rows), dtype=np.float32
        ).reshape(len(rows), -1)
        return rows, matrix

    def search(self, query_vector: np.ndarray, top_k: int = 5) -> list[StoredMemory]:
        """全量余弦检索。query_vector 需已归一化(T2 的 embed 输出满足)。

        库为空返回空列表,不抛错(降级约定)。
        """
        rows, matrix = self._load_all()
        if not rows or top_k <= 0:
            return []
        query = np.asarray(query_vector, dtype=np.float32).reshape(1, -1)
        scores = (matrix @ query.T).reshape(-1)  # 归一化向量:内积即余弦
        order = np.argsort(-scores)[:top_k]
        results: list[StoredMemory] = []
        for idx in order:
            r = rows[int(idx)]
            results.append(
                StoredMemory(
                    text=r[0],
                    score=float(scores[int(idx)]),
                    timestamp=r[1],
                    source=r[2],
                    turn=r[3],
                    tags=json.loads(r[4]) if r[4] else [],
                )
            )
        return results


if __name__ == "__main__":
    # 冒烟脚本(T3 完成标准):存 3 条向量 → 重新打开 → 全部读回并可检索。
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        db = os.path.join(tmp, "t3.db")
        store = VectorStore(db)
        vecs = np.eye(3, dtype=np.float32)  # 三条互相正交的向量
        store.upsert(
            ["关于猫的记忆", "关于狗的记忆", "关于鱼的记忆"],
            [
                {"timestamp": "2026-11-13T00:00:00Z", "source": "chat-turn", "turn": 1},
                {"timestamp": "2026-11-13T00:01:00Z", "source": "chat-turn", "turn": 2},
                {"timestamp": "2026-11-13T00:02:00Z", "source": "reflection"},
            ],
            vecs,
        )
        reopened = VectorStore(db)  # 模拟进程重启
        assert reopened.count() == 3, reopened.count()
        hits = reopened.search(vecs[0], top_k=2)
        assert hits[0].text == "关于猫的记忆" and hits[0].score > 0.99
        print("count:", reopened.count())
        print("top1:", hits[0].text, "score:", round(hits[0].score, 4))
        print("smoke OK")
