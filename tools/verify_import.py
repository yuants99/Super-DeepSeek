#!/usr/bin/env python3
"""独立复核：模拟 DeepSeek chat-demo 的历史导入规则，检查 ZIP 是否可被导入。

与 Swift 审计器是两套独立实现，用于交叉验证。
用法: python3 verify_import.py <zip> [<zip> ...]
"""
import json
import sys
import zipfile
from collections import Counter, defaultdict

STATUS = {"WIP", "FINISHED", "CONTENT_FILTER", "FAILED", "INCOMPLETE",
          "CONTEXT_LENGTH_EXCEEDED", "TIMEOUT"}
DROP_TYPES = {"CONTENT_RISK", "TIP", "PARTIAL_FILE_READ", "TOOL_IMAGE_SEARCH"}


def is_web(url):
    return isinstance(url, str) and url.lower().startswith(("http://", "https://"))


def kept_fragments(frags):
    """返回 demo 导入后会保留的片段（模拟 toLocal.ts 的保留规则）。"""
    out = []
    for f in frags:
        t = f.get("type")
        if t in DROP_TYPES:
            continue
        if t == "TOOL_OPEN":
            if not is_web(f.get("url")):
                continue
        if t == "READ_LINK":
            rr = []
            for r in f.get("results") or []:
                u = r.get("url") if is_web(r.get("url")) else ""
                sig = (r.get("signature") or "").strip()
                if u or sig:
                    rr.append(r)
            if not rr:
                continue
            f = dict(f, results=rr)
        out.append(f)
    return out


def check(path):
    z = zipfile.ZipFile(path)
    names = z.namelist()
    problems = []
    info = Counter()

    if not names or names[0] != "manifest.json":
        problems.append("manifest 不是首个条目")
    try:
        mf = json.loads(z.read("manifest.json"))
        if mf.get("export_format_version") != 3:
            problems.append(f"版本 {mf.get('export_format_version')} != 3")
    except Exception as e:  # noqa: BLE001
        problems.append(f"manifest 解析失败: {e}")

    sessions, index, images = {}, None, {}
    for n in names[1:]:
        if n == "user.json":
            continue
        if n == "chat_session_index.json":
            index = json.loads(z.read(n))
            continue
        if n.startswith("chat_sessions/") and n.endswith(".json") and "_files/" not in n:
            sid = n[len("chat_sessions/"):-5]
            d = json.loads(z.read(n))
            if d.get("id") != sid:
                problems.append(f"{n}: id 与文件名不一致")
            sessions[sid] = d
            info["kept_fragments"] += len(kept_fragments(
                [f for m in d["messages"] for f in m["fragments"]]))
            continue
        if "_files/" in n:
            images[n] = z.getinfo(n).file_size
            continue
        problems.append(f"未知条目 {n}")

    # index 与会话一一对应
    ids = [e["id"] for e in index]
    if len(ids) != len(set(ids)):
        problems.append("index 有重复 id")
    if set(ids) != set(sessions):
        problems.append(f"index({len(ids)}) 与会话({len(sessions)}) 不一致")

    total_msgs = 0
    total_visible = 0
    dropped = Counter()
    for sid, d in sessions.items():
        msgs = sorted(d["messages"], key=lambda m: m["id"])
        by = {m["id"]: m for m in msgs}
        if len(by) != len(msgs):
            problems.append(f"{sid}: 重复消息 id")
        kids = defaultdict(list)
        roots = []
        for m in msgs:
            if m["status"] not in STATUS or m["role"] not in ("USER", "ASSISTANT"):
                problems.append(f"{sid}/{m['id']}: status/role 非法")
            p = m["parent_id"]
            if p is None:
                roots.append(m)
                if m["role"] != "USER":
                    problems.append(f"{sid}/{m['id']}: 根不是 USER")
            else:
                if p not in by or p >= m["id"]:
                    problems.append(f"{sid}/{m['id']}: 父节点非法")
                elif by[p]["role"] == m["role"]:
                    problems.append(f"{sid}/{m['id']}: 父子角色相同")
                kids[p].append(m["id"])
        if d["current_message_id"] not in by and msgs:
            problems.append(f"{sid}: current_message_id 不存在")
        total_msgs += len(msgs)

        # 当前分支可见条数
        cur = by.get(d["current_message_id"])
        seen = 0
        while cur is not None:
            seen += 1
            cur = by.get(cur["parent_id"]) if cur["parent_id"] is not None else None
        total_visible += seen

        for m in msgs:
            for f in m["fragments"]:
                t = f.get("type")
                if t in DROP_TYPES:
                    dropped[t] += 1
                elif t == "TOOL_OPEN" and not is_web(f.get("url")):
                    dropped["TOOL_OPEN(no-url)"] += 1
                elif t == "READ_LINK" and not kept_fragments([f]):
                    dropped["READ_LINK(empty)"] += 1

    # 图片引用核对
    missing = 0
    for sid, d in sessions.items():
        for m in d["messages"]:
            for f in m["fragments"]:
                if f.get("type") != "FILE":
                    continue
                for fe in f.get("files") or []:
                    p = fe.get("export_path")
                    if not p:
                        continue
                    if p not in images:
                        missing += 1
                    elif images[p] != fe.get("file_size"):
                        problems.append(f"{sid}/{m['id']}: 图片大小不符 {p}")

    info["sessions"] = len(sessions)
    info["messages"] = total_msgs
    info["visible_current_branch"] = total_visible
    info["images"] = len(images)
    info["missing_images"] = missing
    return info, dropped, problems


def main():
    for path in sys.argv[1:]:
        info, dropped, problems = check(path)
        print(f"== {path}")
        print(f"   会话 {info['sessions']} / 消息 {info['messages']} / 当前分支可见 {info['visible_current_branch']}"
              f" / 图片 {info['images']} / 缺失 {info['missing_images']}")
        print(f"   导入时会丢弃: {dict(dropped)}")
        if problems:
            print(f"   ❌ {len(problems)} 个问题:")
            for p in problems[:10]:
                print("      -", p)
        else:
            print("   ✅ 可被 chat-demo 导入")


if __name__ == "__main__":
    main()
