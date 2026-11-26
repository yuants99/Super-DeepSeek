import Foundation

struct MergeStats {
    var sessions = 0
    var messages = 0
    var images = 0
    var imageBytes = 0
    var appendedMessages = 0
    var appendedSessions = 0
    var rebuiltSessions = 0
    var conflicts: [String] = []
    var bytes = 0
}

private enum Payload {
    case raw([UInt8])
    case obj([String: Any])
}

private func jsonObject(_ bytes: [UInt8]) -> [String: Any]? {
    (try? JSONSerialization.jsonObject(with: Data(bytes))) as? [String: Any]
}

func buildMergedArchive(local: ArchiveAnalysis, online: ArchiveAnalysis,
                        localZip: ZipArchive, onlineZip: ZipArchive,
                        outURL: URL, log: IssueLog) throws -> MergeStats
{
    var stats = MergeStats()
    var order = [String]()
    var payloads = [String: Payload]()
    var metas = [String: (title: Any, inserted: String, updated: String, count: Int)]()

    var ids = online.sessionOrder
    for sid in local.sessionOrder where online.sessions[sid] == nil { ids.append(sid) }

    for sid in ids {
        guard let base = online.sessions[sid] ?? local.sessions[sid] else { continue }
        let inOnline = online.sessions[sid] != nil
        let inLocal = local.sessions[sid] != nil
        let srcZip = inOnline ? onlineZip : localZip
        guard let srcEntry = srcZip.byPath["chat_sessions/\(sid).json"],
              let srcRaw = srcZip.content(srcEntry) else {
            stats.conflicts.append("\(sid): 缺少会话文件")
            continue
        }

        // local 独有的树位置（按本地 id 顺序，父节点优先）
        var localOnly: [[UInt16]] = []
        if inOnline, inLocal, let l = local.sessions[sid] {
            let onlinePaths = Set(base.byPath.keys)
            localOnly = Set(l.byPath.keys).subtracting(onlinePaths)
                .sorted { $0.lexicographicallyPrecedes($1) }
        }

        order.append(sid)
        stats.sessions += 1

        if !inLocal || localOnly.isEmpty {
            // 原样复制，保证未改动会话逐字节不变。
            payloads[sid] = .raw(srcRaw)
            metas[sid] = (base.title.map { $0 as Any } ?? NSNull(), base.insertedAt, base.updatedAt, base.messageCount)
            stats.messages += base.messageCount
            if !inOnline { stats.appendedSessions += 1 }
            continue
        }

        guard var obj = jsonObject(srcRaw),
              var msgs = obj["messages"] as? [[String: Any]],
              let l = local.sessions[sid],
              let le = localZip.byPath["chat_sessions/\(sid).json"],
              let lraw = localZip.content(le),
              let lobj = jsonObject(lraw),
              let lmsgs = lobj["messages"] as? [[String: Any]]
        else {
            stats.conflicts.append("\(sid): 重建失败（原始 JSON 缺失）")
            payloads[sid] = .raw(srcRaw)
            metas[sid] = (base.title.map { $0 as Any } ?? NSNull(), base.insertedAt, base.updatedAt, base.messageCount)
            stats.messages += base.messageCount
            continue
        }

        let onlineIdByPath = Dictionary(uniqueKeysWithValues: base.pathById.map { ($0.value, $0.key) })
        var maxId = msgs.compactMap { asCount($0["id"]) }.max() ?? 0
        var newIdByLocalId = [Int: Int]()
        let localById = Dictionary(uniqueKeysWithValues: l.messages.map { ($0.id, $0) })
        let localMsgById = Dictionary(uniqueKeysWithValues: lmsgs.compactMap { m -> (Int, [String: Any])? in
            guard let id = asCount(m["id"]) else { return nil }
            return (id, m)
        })
        var appended = 0
        for path in localOnly {
            guard let lid = l.byPath[path], let lm = localById[lid], let rawM = localMsgById[lid] else {
                stats.conflicts.append("\(sid): 局部消息 \(pathKey(path)) 缺失")
                continue
            }
            var newParent: Int? = nil
            if let p = lm.parentId {
                if let onlineId = onlineIdByPath[l.pathById[p] ?? []] {
                    newParent = onlineId
                } else if let mapped = newIdByLocalId[p] {
                    newParent = mapped
                } else {
                    stats.conflicts.append("\(sid): 新消息 \(lid) 的父节点无法映射")
                    continue
                }
            }
            maxId += 1
            var copy = rawM
            copy["id"] = maxId
            copy["parent_id"] = newParent ?? NSNull()
            msgs.append(copy)
            newIdByLocalId[lid] = maxId
            appended += 1
        }
        guard appended == localOnly.count else {
            stats.conflicts.append("\(sid): 追加 \(appended)/\(localOnly.count)")
            payloads[sid] = .raw(srcRaw)
            metas[sid] = (base.title.map { $0 as Any } ?? NSNull(), base.insertedAt, base.updatedAt, base.messageCount)
            stats.messages += base.messageCount
            continue
        }
        obj["messages"] = msgs
        let curPath = l.pathById[l.currentMessageId] ?? []
        if let oid = onlineIdByPath[curPath] {
            obj["current_message_id"] = oid
        } else if let lid = l.byPath[curPath], let nid = newIdByLocalId[lid] {
            obj["current_message_id"] = nid
        } else {
            obj["current_message_id"] = maxId
        }
        obj["updated_at"] = max(l.updatedAt, base.updatedAt)
        if (obj["title"] == nil || obj["title"] is NSNull), let t = l.title { obj["title"] = t }
        payloads[sid] = .obj(obj)
        metas[sid] = (obj["title"] ?? NSNull(), asString(obj["inserted_at"]) ?? base.insertedAt,
                      asString(obj["updated_at"]) ?? base.updatedAt, msgs.count)
        stats.messages += msgs.count
        stats.appendedMessages += appended
        stats.rebuiltSessions += 1
    }

    // 索引：按 updated_at 倒序
    order.sort { (metas[$0]?.updated ?? "") > (metas[$1]?.updated ?? "") }
    var index = [[String: Any]]()
    for sid in order {
        guard let m = metas[sid] else { continue }
        index.append([
            "id": sid, "title": m.title, "pinned": false,
            "message_count": m.count, "inserted_at": m.inserted, "updated_at": m.updated,
        ])
    }

    // 图片：取两包中该会话引用过的全部图片（并集）
    func refs(_ a: ArchiveAnalysis) -> [String: [(String, Bool)]] {
        var out = [String: [(String, Bool)]]()
        for r in a.fileRefs {
            guard let p = r.exportPath else { continue }
            out[r.sessionId, default: []].append((p.precomposedStringWithCanonicalMapping, r.isImage))
        }
        return out
    }
    let lRefs = refs(local), oRefs = refs(online)

    var out: [(String, [UInt8])] = []
    out.append(("manifest.json", Array("{\"export_format_version\":3}".utf8)))
    for sid in order {
        guard let payload = payloads[sid] else { continue }
        switch payload {
        case .raw(let bytes):
            out.append(("chat_sessions/\(sid).json", bytes))
        case .obj(let obj):
            let data = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data()
            out.append(("chat_sessions/\(sid).json", [UInt8](data)))
        }
    }
    let indexData = (try? JSONSerialization.data(withJSONObject: index, options: [.sortedKeys])) ?? Data()
    out.append(("chat_session_index.json", [UInt8](indexData)))

    var seenImages = Set<String>()
    var imageEntries: [(String, [UInt8])] = []
    for sid in order {
        var paths = [String]()
        for (p, isImg) in (oRefs[sid] ?? []) where isImg { paths.append(p) }
        for (p, isImg) in (lRefs[sid] ?? []) where isImg { paths.append(p) }
        for p in paths {
            let norm = p
            if seenImages.contains(norm) { continue }
            seenImages.insert(norm)
            if let e = onlineZip.byPath[norm], let bytes = onlineZip.content(e) {
                imageEntries.append((norm, bytes))
            } else if let e = localZip.byPath[norm], let bytes = localZip.content(e) {
                imageEntries.append((norm, bytes))
            } else {
                log.add("warn", "mergedImageMissing", sid, norm)
            }
        }
    }
    out.append(contentsOf: imageEntries)

    try writeZip(to: outURL, entries: out)
    stats.images = imageEntries.count
    stats.imageBytes = imageEntries.reduce(0) { $0 + $1.1.count }
    stats.bytes = (try? FileManager.default.attributesOfItem(atPath: outURL.path)[.size] as? Int) ?? 0
    return stats
}
