"""切片策略(T4)。

职责边界:只负责把对话/长文本切成适合检索的记忆片段;
不涉及向量(T2/T3)、不感知上层业务(T5)。纯函数模块,零第三方依赖。

策略(先只实现一种,后续按需扩展):
- 按对话轮切:一轮 = 一条用户消息 + 紧随其后的助手回复,合并为一条记忆;
- 单轮超过 max_chars 时,按句子二次切(句子边界:。!?;…\n),块间带 overlap_sentences 重叠;
- 每个切片输出部分 metadata(turn 序号),timestamp/source 由调用方(T5/T7)组装。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Sequence

DEFAULT_MAX_CHARS = 500
DEFAULT_OVERLAP_SENTENCES = 1

# 中英混合的句子边界。保留分隔符本身。
_SENTENCE_SPLIT = re.compile(r"(?<=[。!?;…\n])|(?<=[.!?;]\s)")

# 消息角色约定与现有 chat schema 保持一致:用户 "user",助手 "assistant"。
_ROLE_USER = "user"
_ROLE_ASSISTANT = "assistant"


@dataclass
class DialogueChunk:
    """一个待检索的记忆片段。metadata 只含切片层能确定的部分。"""

    text: str
    turn: int
    tags: list[str] = field(default_factory=list)


def split_by_sentences(text: str) -> list[str]:
    """按句子边界切分,保留分隔符,过滤纯空白句。"""
    parts = [p.strip() for p in _SENTENCE_SPLIT.split(text) if p and p.strip()]
    return parts or ([text.strip()] if text.strip() else [])


def _split_long_text(text: str, max_chars: int, overlap_sentences: int) -> list[str]:
    """超长文本按句子聚合成不超过 max_chars 的块,块间保留重叠句。"""
    sentences = split_by_sentences(text)
    if not sentences:
        return []
    # 单句就超限时按字符硬切,保证任何块都不超过 max_chars。
    hard: list[str] = []
    for s in sentences:
        while len(s) > max_chars:
            hard.append(s[:max_chars])
            s = s[max_chars:]
        if s:
            hard.append(s)

    blocks: list[str] = []
    current: list[str] = []
    current_len = 0
    for s in hard:
        extra = len(s) + (1 if current else 0)  # 拼接时的空格/换行开销
        if current and current_len + extra > max_chars:
            blocks.append(" ".join(current))
            current = current[-overlap_sentences:] if overlap_sentences > 0 else []
            current_len = sum(len(x) for x in current) + max(0, len(current) - 1)
        current.append(s)
        current_len += len(s) + (1 if len(current) > 1 else 0)
    if current:
        blocks.append(" ".join(current))
    return blocks


def chunk_dialogue(
    messages: Sequence[dict],
    max_chars: int = DEFAULT_MAX_CHARS,
    overlap_sentences: int = DEFAULT_OVERLAP_SENTENCES,
) -> list[DialogueChunk]:
    """把消息列表切成记忆片段。

    messages 元素形如 {"role": "user"|"assistant", "content": str}。
    一轮 = user 消息 + 紧随的 assistant 回复(没有回复则只有 user 消息);
    连续多条 user 消息合并进同一轮;assistant 先于任何 user 出现的消息被忽略。
    每个切片带轮次序号 turn(从 1 开始)。
    """
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")
    if overlap_sentences < 0:
        raise ValueError("overlap_sentences must be non-negative")

    chunks: list[DialogueChunk] = []
    turn = 0
    pending_user: list[str] = []

    def flush_turn(reply: str | None) -> None:
        nonlocal turn, pending_user
        if not pending_user:
            return
        turn += 1
        user_text = " ".join(pending_user)
        combined = f"用户: {user_text}"
        if reply:
            combined += f"\n助手: {reply}"
        for block in _split_long_text(combined, max_chars, overlap_sentences):
            chunks.append(DialogueChunk(text=block, turn=turn))
        pending_user = []

    for msg in messages:
        role = msg.get("role")
        content = (msg.get("content") or "").strip()
        if not content:
            continue
        if role == _ROLE_USER:
            pending_user.append(content)
        elif role == _ROLE_ASSISTANT:
            flush_turn(content)
        # 其他角色(如 system)不属于记忆,忽略
    flush_turn(None)  # 收尾:最后一轮可能没有助手回复
    return chunks


if __name__ == "__main__":
    # 冒烟脚本(T4 完成标准):多轮对话 + 一条超长消息,验证轮次与切分。
    long_text = "这是一句测试。" * 80  # 600 字,超过默认 500
    messages = [
        {"role": "user", "content": "今天天气怎么样?"},
        {"role": "assistant", "content": "晴天,适合出门。"},
        {"role": "user", "content": long_text},
        {"role": "assistant", "content": "收到。"},
        {"role": "user", "content": "晚安"},
    ]
    result = chunk_dialogue(messages)
    turns = [c.turn for c in result]
    assert turns[0] == 1 and "天气" in result[0].text
    assert all(len(c.text) <= DEFAULT_MAX_CHARS for c in result), [len(c.text) for c in result]
    assert max(turns) == 3 and "晚安" in [c.text for c in result if c.turn == 3][0]
    print("chunks:", len(result))
    print("turns:", turns)
    print("smoke OK")
