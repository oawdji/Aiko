"""语义检索 CLI(T7 粘合层):供 TS 侧子进程调用。

协议:stdin 一行 JSON,stdout 一行 JSON。
- {"op": "index", "messages": [{"role", "content", "timestamp"?}, ...]} → {"ok": true, "indexed": n}
- {"op": "search", "query": str, "top_k": int} → {"ok": true, "hits": [str, ...]}
任何失败输出 {"ok": false, "error": str} 并以退出码 1 结束(TS 侧据此降级)。
"""

from __future__ import annotations

import json
import os
import sys

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from services.retrieval.local_retriever import LocalMemoryRetriever


def main() -> int:
    try:
        request = json.loads(sys.stdin.readline())
        retriever = LocalMemoryRetriever()
        if request.get("op") == "index":
            indexed = retriever.index_dialogue(request.get("messages", []))
            print(json.dumps({"ok": True, "indexed": indexed}, ensure_ascii=False))
        elif request.get("op") == "search":
            hits = retriever.search(request.get("query", ""), top_k=int(request.get("top_k", 5)))
            print(json.dumps({"ok": True, "hits": [h["text"] for h in hits]}, ensure_ascii=False))
        else:
            print(json.dumps({"ok": False, "error": f"unknown op: {request.get('op')}"}, ensure_ascii=False))
            return 1
        return 0
    except Exception as exc:  # noqa: BLE001  降级约定:错误传给调用方,不崩溃宿主
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())

