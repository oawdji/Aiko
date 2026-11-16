# 真模型语义验证:同义不同词是否召回(T5 遗留验证项)
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from services.retrieval.local_retriever import LocalMemoryRetriever

with tempfile.TemporaryDirectory() as tmp:
    r = LocalMemoryRetriever(db_path=os.path.join(tmp, "t.db"))
    r.index_dialogue([
        {"role": "user", "content": "昨天工作被批评了,有点难过", "timestamp": "2026-11-13T10:00:00Z"},
        {"role": "assistant", "content": "辛苦了,抱抱。"},
        {"role": "user", "content": "周末去爬山了,风景特别好"},
        {"role": "assistant", "content": "听起来很开心!"},
    ])
    hits = r.search("心情不好", top_k=2)
    assert hits, "no hits"
    top = hits[0]["text"]
    print("query: 心情不好")
    print("top1:", top.replace(chr(10), " "))
    assert "难过" in top, f"semantic recall failed, got: {top}"
    print("semantic recall OK")

