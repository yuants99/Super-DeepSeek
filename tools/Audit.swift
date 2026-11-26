import CryptoKit
import Foundation
import ImageIO

struct FileRef {
    var sessionId: String
    var messageId: Int
    var fileId: String
    var fileName: String
    var size: Int
    var isImage: Bool
    var exportPath: String?
    var width: Int?
    var height: Int?
    var tokenUsage: Int?
}

struct MessageInfo {
    var id: Int
    var parentId: Int?
    var role: String
    var status: String
    var think: Bool
    var search: Bool
    var tokens: Int
    var insertedAt: String
    var coreHash: String
    var fullHash: String
    var contentChars: Int
    var fragCounts: [String: Int]
    var dropCounts: [String: Int]
    var fragSig: [String]
}

struct SessionInfo {
    var id: String
    var title: String?
    var pinnedRaw: Any?
    var currentMessageId: Int
    var insertedAt: String
    var updatedAt: String
    var rawBytes: Int
    var messages: [MessageInfo]
    var byPath: [[UInt16]: Int] = [:]
    var pathById: [Int: [UInt16]] = [:]
    var fragTotals: [String: Int] = [:]
    var dropTotals: [String: Int] = [:]
    var tokenSum: Int = 0
    var invalidFragments: Int = 0

    var messageCount: Int { messages.count }
}

struct ImageInfo {
    var path: String
    var session: String
    var fileId: String
    var fileName: String
    var actualSize: Int
    var crc: UInt32
    var sha256: String
    var mime: String
    var width: Int?
    var height: Int?
    var entryIndex: Int
}

struct ArchiveAnalysis {
    let name: String
    let url: URL
    var fileSize = 0
    var entryCount = 0
    var compressedBytes = 0
    var uncompressedBytes = 0
    var methods: [Int: Int] = [:]
    var manifestVersion: Int?
    var manifestFirst = false
    var hasUserJson = false
    var indexCount = 0
    var indexOrder: [String] = []
    var sessions: [String: SessionInfo] = [:]
    var sessionOrder: [String] = []
    var images: [ImageInfo] = []
    var imageByPath: [String: ImageInfo] = [:]
    var fileRefs: [FileRef] = []
    var zipComment = ""
    var log = IssueLog()

    var totalMessages: Int { sessions.values.reduce(0) { $0 + $1.messages.count } }
    var totalUsers: Int { sessions.values.reduce(0) { $0 + $1.messages.filter { $0.role == "USER" }.count } }
    var totalTokens: Int { sessions.values.reduce(0) { $0 + $1.tokenSum } }
    var totalContentChars: Int { sessions.values.reduce(0) { $0 + $1.messages.reduce(0) { $0 + $1.contentChars } } }
    var imageBytes: Int { images.reduce(0) { $0 + $1.actualSize } }
    var refsWithPath: Int { fileRefs.filter { $0.exportPath != nil }.count }
    var imageRefCount: Int { fileRefs.filter { $0.isImage }.count }
}

func magicMime(_ b: [UInt8]) -> String {
    func starts(_ p: [UInt8]) -> Bool { b.count >= p.count && Array(b[0..<p.count]) == p }
    if starts([0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
    if starts([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) { return "image/png" }
    let head = String(decoding: b.prefix(12), as: UTF8.self)
    if head.hasPrefix("GIF87a") || head.hasPrefix("GIF89a") { return "image/gif" }
    if head.hasPrefix("RIFF"), b.count >= 12, String(decoding: b[8..<12], as: UTF8.self) == "WEBP" { return "image/webp" }
    if starts([0x42, 0x4D]) { return "image/bmp" }
    if starts([0x49, 0x49, 0x2A, 0x00]) || starts([0x4D, 0x4D, 0x00, 0x2A]) { return "image/tiff" }
    if b.count >= 12, String(decoding: b[4..<8], as: UTF8.self) == "ftyp" {
        let brand = String(decoding: b[8..<12], as: UTF8.self)
        if brand == "avif" || brand == "avis" { return "image/avif" }
    }
    return ""
}

func imagePixelSize(_ bytes: [UInt8]) -> (Int, Int)? {
    guard let src = CGImageSourceCreateWithData(Data(bytes) as CFData, nil),
          let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
    else { return nil }
    guard let w = (props[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
          let h = (props[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue else { return nil }
    return (w, h)
}

func sessionIdValid(_ s: String) -> Bool {
    !s.isEmpty && !s.contains("/") && !s.contains("\\") && s != "." && s != ".."
}

private let statusMap: [String: String] = [
    "TIMEOUT": "FAILED",
    "CONTEXT_LENGTH_EXCEEDED": "FAILED",
    "WIP": "INCOMPLETE",
]

func sha256Hex(_ s: String) -> String {
    SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
}

// MARK: - 会话解析

func parseSession(json: Any, expectedId: String, rawBytes: Int, log: IssueLog) -> (SessionInfo, [FileRef])? {
    guard let item = asRecord(json) else {
        log.add("fatal", "sessionNotObject", session: expectedId, "会话 JSON 不是对象")
        return nil
    }
    guard let sid = asString(item["id"]), sessionIdValid(sid) else {
        log.add("fatal", "sessionId", session: expectedId, "id 缺失或非法")
        return nil
    }
    if sid != expectedId {
        log.add("fatal", "sessionIdMismatch", session: expectedId, "id=\(sid) 与文件名不一致")
    }
    guard let titleBox = nullableString(item, "title") else {
        log.add("fatal", "sessionTitle", session: sid, "title 缺失或非 string/null")
        return nil
    }
    guard let current = asCount(item["current_message_id"]) else {
        log.add("fatal", "sessionCurrent", session: sid, "current_message_id 非法")
        return nil
    }
    guard let inserted = validTime(item["inserted_at"]) else {
        log.add("fatal", "sessionInsertedAt", session: sid, "inserted_at 非法")
        return nil
    }
    guard let updated = validTime(item["updated_at"]) else {
        log.add("fatal", "sessionUpdatedAt", session: sid, "updated_at 非法")
        return nil
    }
    guard let rawMessages = item["messages"] as? [Any] else {
        log.add("fatal", "sessionMessages", session: sid, "messages 非数组")
        return nil
    }

    var msgs = [MessageInfo]()
    msgs.reserveCapacity(rawMessages.count)
    var seenIds = Set<Int>()
    var fragTotals = [String: Int]()
    var dropTotals = [String: Int]()
    var fileRefs = [FileRef]()
    var invalidFrags = 0
    var tokenSum = 0

    for raw in rawMessages {
        guard let m = asRecord(raw) else {
            log.add("fatal", "messageNotObject", session: sid, "消息不是对象")
            continue
        }
        guard let mid = asCount(m["id"]) else {
            log.add("fatal", "messageId", session: sid, "消息 id 非法")
            continue
        }
        if !seenIds.insert(mid).inserted {
            log.add("fatal", "messageDuplicateId", session: sid, message: mid, "重复消息 id")
            continue
        }
        var parent: Int? = nil
        if m.keys.contains("parent_id") {
            if isNull(m["parent_id"]) { parent = nil }
            else if let p = asCount(m["parent_id"]) { parent = p }
            else { log.add("fatal", "messageParent", session: sid, message: mid, "parent_id 非法"); continue }
        } else {
            log.add("fatal", "messageParent", session: sid, message: mid, "缺 parent_id")
            continue
        }
        guard let role = asString(m["role"]), role == "USER" || role == "ASSISTANT" else {
            log.add("fatal", "messageRole", session: sid, message: mid, "role 非法"); continue
        }
        let statuses = ["WIP", "FINISHED", "CONTENT_FILTER", "FAILED", "INCOMPLETE",
                        "CONTEXT_LENGTH_EXCEEDED", "TIMEOUT"]
        guard let status = asString(m["status"]), statuses.contains(status) else {
            log.add("fatal", "messageStatus", session: sid, message: mid, "status 非法"); continue
        }
        guard let think = asBool(m["thinking_enabled"]) else {
            log.add("fatal", "messageThink", session: sid, message: mid, "thinking_enabled 非法"); continue
        }
        guard let search = asBool(m["search_enabled"]) else {
            log.add("fatal", "messageSearch", session: sid, message: mid, "search_enabled 非法"); continue
        }
        guard let tokens = asCount(m["accumulated_token_usage"]) else {
            log.add("fatal", "messageTokens", session: sid, message: mid, "accumulated_token_usage 非法"); continue
        }
        guard let ins = validTime(m["inserted_at"]) else {
            log.add("fatal", "messageInsertedAt", session: sid, message: mid, "inserted_at 非法"); continue
        }
        guard let frags = m["fragments"] as? [Any] else {
            log.add("fatal", "messageFragments", session: sid, message: mid, "fragments 非数组"); continue
        }

        var coreParts = [String]()
        coreParts.reserveCapacity(frags.count + 2)
        coreParts.append(role)
        coreParts.append(statusMap[status] ?? status)
        var fullParts = [String]()
        fullParts.append(role)
        fullParts.append(status)
        fullParts.append("t\(think ? 1 : 0)s\(search ? 1 : 0)")
        fullParts.append("tok\(tokens)")
        fullParts.append(canonicalTime(ins))

        var contentChars = 0
        var msgFragCounts = [String: Int]()
        var msgDropCounts = [String: Int]()
        var msgFragSig = [String]()
        for f in frags {
            let r = canonicalFragment(f)
            fragTotals[r.type, default: 0] += 1
            msgFragCounts[r.type, default: 0] += 1
            if let inv = r.invalid {
                invalidFrags += 1
                dropTotals["invalid:" + r.type, default: 0] += 1
                log.add("warn", "fragmentInvalid", session: sid, message: mid, "\(r.type): \(inv)")
                continue
            }
            if let full = r.full { fullParts.append(full) }
            if let c = r.core {
                // 空 REQUEST 是官方导出与 demo 导出的已知差异，不计入内容比较。
                if !(r.type == "REQUEST" && c == "T:REQUEST|0#") {
                    coreParts.append(c)
                    msgFragSig.append(r.type + "#" + String(sha256Hex(c).prefix(8)))
                    contentChars += c.utf8.count
                }
            } else if let d = r.drop {
                dropTotals[d, default: 0] += 1
                msgDropCounts[d, default: 0] += 1
            }
            if r.type == "FILE", r.invalid == nil, let d = asRecord(f) {
                for rawFile in (d["files"] as? [Any] ?? []) {
                    guard let fd = asRecord(rawFile),
                          let id = asString(fd["id"]), let name = asString(fd["file_name"]),
                          let size = asCount(fd["file_size"]), let isImage = asBool(fd["is_image"])
                    else { continue }
                    fileRefs.append(FileRef(
                        sessionId: sid, messageId: mid, fileId: id, fileName: name, size: size,
                        isImage: isImage,
                        exportPath: (nullableString(fd, "export_path") ?? nil).map { $0.precomposedStringWithCanonicalMapping },
                        width: (nullableCount(fd, "width") ?? nil),
                        height: (nullableCount(fd, "height") ?? nil),
                        tokenUsage: (nullableCount(fd, "token_usage") ?? nil)))
                }
            }
        }
        tokenSum += tokens
        msgs.append(MessageInfo(id: mid, parentId: parent, role: role, status: status,
                                think: think, search: search, tokens: tokens, insertedAt: ins,
                                coreHash: sha256Hex(coreParts.joined(separator: "\u{1}")),
                                fullHash: sha256Hex(fullParts.joined(separator: "\u{1}")),
                                contentChars: contentChars,
                                fragCounts: msgFragCounts, dropCounts: msgDropCounts,
                                fragSig: msgFragSig))
    }

    msgs.sort { $0.id < $1.id }
    var byId = [Int: Int]()
    for (i, m) in msgs.enumerated() { byId[m.id] = i }
    var children = [Int: [Int]]()
    var roots = [Int]()
    var treeBroken = false
    for m in msgs {
        if let p = m.parentId {
            guard let pi = byId[p], msgs[pi].id < m.id else {
                log.add("fatal", "treeParent", session: sid, message: m.id, "父消息不存在或 id 更大")
                treeBroken = true
                continue
            }
            if msgs[pi].role == m.role {
                log.add("fatal", "treeRole", session: sid, message: m.id, "父子角色相同")
                treeBroken = true
            }
            children[p, default: []].append(m.id)
        } else {
            roots.append(m.id)
            if m.role != "USER" {
                log.add("fatal", "treeRootRole", session: sid, message: m.id, "根消息不是 USER")
                treeBroken = true
            }
        }
    }
    if !msgs.isEmpty {
        if roots.count != 1 {
            log.add("warn", "treeMultiRoot", session: sid, "根消息数量 \(roots.count)（chat-demo 允许，但只有 current 所在根可见）")
        }
        if byId[current] == nil {
            log.add("fatal", "treeCurrent", session: sid, "current_message_id=\(current) 不存在")
            treeBroken = true
        }
    }
    for k in children.keys { children[k]?.sort() }

    var byPath = [[UInt16]: Int]()
    var pathById = [Int: [UInt16]]()
    if !treeBroken {
        var stack: [([UInt16], Int)] = []
        let orderedRoots = roots.sorted()
        for i in orderedRoots.indices.reversed() { stack.append(([UInt16(i)], orderedRoots[i])) }
        while let (p, id) = stack.popLast() {
            pathById[id] = p
            byPath[p] = id
            for (i, c) in (children[id] ?? []).enumerated().reversed() {
                var cp = p
                cp.append(UInt16(i))
                stack.append((cp, c))
            }
        }
        if pathById.count != msgs.count {
            log.add("fatal", "treeDisconnected", session: sid, "有 \(msgs.count - pathById.count) 条消息不在树上")
            treeBroken = true
        }
    }
    if treeBroken {
        byPath = [:]
        pathById = [:]
    }
    return (SessionInfo(id: sid, title: titleBox ?? nil, pinnedRaw: item["pinned"], currentMessageId: current,
                       insertedAt: inserted, updatedAt: updated, rawBytes: rawBytes,
                       messages: msgs, byPath: byPath, pathById: pathById,
                       fragTotals: fragTotals, dropTotals: dropTotals, tokenSum: tokenSum,
                       invalidFragments: invalidFrags), fileRefs)
}

// MARK: - 归档解析

func analyzeArchive(name: String, url: URL) throws -> ArchiveAnalysis {
    var a = ArchiveAnalysis(name: name, url: url)
    let zip = try ZipArchive(url: url)
    a.fileSize = zip.fileSize
    a.entryCount = zip.entries.count
    a.zipComment = zip.comment
    for e in zip.entries {
        a.compressedBytes += e.compSize
        a.uncompressedBytes += e.size
        a.methods[e.method, default: 0] += 1
    }
    for i in zip.issues { a.log.add(i.level, i.code, "\(i.entry ?? "-"): \(i.detail)") }
    guard let first = zip.entries.first else { return a }

    a.manifestFirst = first.path == "manifest.json"
    if !a.manifestFirst {
        a.log.add("fatal", "manifestNotFirst", "首个条目是 \(first.path)，导入会直接失败")
    }
    var indexSeenAt = -1
    var imagePaths = Set<String>()

    for (idx, e) in zip.entries.enumerated() {
        let path = e.path
        if path.hasSuffix("/") { continue }
        if path == "manifest.json" {
            if idx != 0 { a.log.add("fatal", "manifestPosition", "manifest 不在首位") }
            guard let bytes = zip.content(e) else { a.log.add("fatal", "entryCorrupt", path, "CRC/解压失败"); continue }
            guard let obj = (try? JSONSerialization.jsonObject(with: Data(bytes))) as? [String: Any],
                  let v = asCount(obj["export_format_version"])
            else { a.log.add("fatal", "manifestJson", "manifest 无法解析"); continue }
            a.manifestVersion = v
            if v != 3 { a.log.add("fatal", "manifestVersion", "版本 \(v) != 3") }
            continue
        }
        if path == "user.json" {
            a.hasUserJson = true
            _ = zip.content(e)
            continue
        }
        if path == "chat_session_index.json" {
            if indexSeenAt >= 0 { a.log.add("fatal", "indexDuplicate", "重复 index") }
            indexSeenAt = idx
            guard let bytes = zip.content(e) else { a.log.add("fatal", "entryCorrupt", path, "CRC/解压失败"); continue }
            guard let arr = (try? JSONSerialization.jsonObject(with: Data(bytes))) as? [Any] else {
                a.log.add("fatal", "indexJson", "index 无法解析"); continue
            }
            a.indexCount = arr.count
            var seen = Set<String>()
            for (i, raw) in arr.enumerated() {
                guard let d = asRecord(raw) else { a.log.add("fatal", "indexEntry", "第 \(i) 项不是对象"); continue }
                guard let id = asString(d["id"]), sessionIdValid(id) else {
                    a.log.add("fatal", "indexId", "第 \(i) 项 id 非法"); continue
                }
                if !seen.insert(id).inserted { a.log.add("fatal", "indexDuplicateId", id, "重复 id") }
                a.indexOrder.append(id)
                guard let titleBox = nullableString(d, "title") else {
                    a.log.add("fatal", "indexTitle", id, "title 非法"); continue
                }
                guard let count = asCount(d["message_count"]) else {
                    a.log.add("fatal", "indexCount", id, "message_count 非法"); continue
                }
                guard validTime(d["inserted_at"]) != nil, let upd = validTime(d["updated_at"]) else {
                    a.log.add("fatal", "indexTime", id, "时间非法"); continue
                }
                if let s = a.sessions[id] {
                    if s.messageCount != count { a.log.add("warn", "indexCountMismatch", id, "index=\(count) 实际=\(s.messageCount)") }
                    if (s.title ?? nil) != (titleBox ?? nil) { a.log.add("warn", "indexTitleMismatch", id, "标题不一致") }
                    if s.updatedAt != upd { a.log.add("info", "indexUpdatedAt", id, "updated_at 不一致") }
                }
            }
            continue
        }
        if path.hasPrefix("chat_sessions/"), path.hasSuffix(".json"), !path.contains("_files/") {
            if indexSeenAt >= 0 { a.log.add("fatal", "sessionAfterIndex", path, "会话在 index 之后，导入会失败") }
            let sid = String(path.dropFirst("chat_sessions/".count).dropLast(5))
            if !sessionIdValid(sid) { a.log.add("fatal", "sessionFileName", path, "会话 id 非法") }
            if a.sessions[sid] != nil { a.log.add("fatal", "sessionDuplicate", sid, "重复会话") }
            guard let bytes = zip.content(e) else { a.log.add("fatal", "entryCorrupt", path, "CRC/解压失败"); continue }
            guard let json = try? JSONSerialization.jsonObject(with: Data(bytes)) else {
                a.log.add("fatal", "sessionJson", sid, "JSON 解析失败"); continue
            }
            if let (s, refs) = parseSession(json: json, expectedId: sid, rawBytes: bytes.count, log: a.log) {
                a.sessions[sid] = s
                a.sessionOrder.append(sid)
                a.fileRefs.append(contentsOf: refs)
            }
            continue
        }
        if path.hasPrefix("chat_sessions/"), path.contains("_files/") {
            let comps = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            let dirName = comps.count > 1 ? comps[1] : ""
            let sid = dirName.hasSuffix("_files") ? String(dirName.dropLast(6)) : dirName
            if a.sessions[sid] == nil, indexSeenAt < 0, idx < zip.entries.count {
                a.log.add("warn", "imageBeforeIndex", path, "图片早于 index")
            }
            guard imagePaths.insert(path).inserted else {
                a.log.add("fatal", "entryDuplicate", path, "重复图片条目"); continue
            }
            guard let bytes = zip.content(e) else { a.log.add("fatal", "entryCorrupt", path, "CRC/解压失败"); continue }
            let fname = comps.last ?? ""
            let fileId = String(fname.split(separator: "_", maxSplits: 1, omittingEmptySubsequences: false).first ?? "")
            let mime = magicMime(bytes)
            if mime.isEmpty { a.log.add("warn", "imageMagic", path, "无法识别的图片头") }
            let pix = imagePixelSize(bytes)
            let sha = SHA256.hash(data: Data(bytes)).map { String(format: "%02x", $0) }.joined()
            let info = ImageInfo(path: path, session: sid, fileId: fileId, fileName: fname,
                                 actualSize: bytes.count, crc: e.crc, sha256: sha, mime: mime,
                                 width: pix?.0, height: pix?.1, entryIndex: idx)
            a.images.append(info)
            a.imageByPath[path] = info
            continue
        }
        a.log.add("fatal", "unexpectedEntry", path, "不属于任何已知条目")
    }

    if indexSeenAt < 0 {
        a.log.add("fatal", "indexMissing", "缺少 chat_session_index.json")
    } else {
        let listed = Set(a.indexOrder)
        let files = Set(a.sessions.keys)
        for s in files.subtracting(listed) { a.log.add("fatal", "sessionUnlisted", s, "会话未列入 index") }
        for s in listed.subtracting(files) { a.log.add("fatal", "listedMissing", s, "index 列出的会话缺失") }
    }

    validateAttachments(&a)
    return a
}

// MARK: - 附件核对

private func safeName(_ s: String) -> String {
    var r = s.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "\\", with: "_")
    if r.isEmpty || r == "." || r == ".." { r = "unnamed" }
    return r
}

func validateAttachments(_ a: inout ArchiveAnalysis) {
    var pathOwner = [String: String]() // export_path -> fileId
    var referenced = Set<String>()
    for ref in a.fileRefs {
        guard let p = ref.exportPath else {
            if ref.isImage { a.log.add("warn", "imageNoPath", ref.sessionId, "图片无 export_path（导入后仅有文件名）") }
            continue
        }
        let expectedPrefix = "chat_sessions/\(ref.sessionId)_files/"
        if !p.hasPrefix(expectedPrefix) {
            a.log.add("fatal", "filePathScope", ref.sessionId, "\(p) 不在本会话目录下")
        }
        if let owner = pathOwner[p], owner != ref.fileId {
            a.log.add("fatal", "filePathConflict", ref.sessionId, "\(p) 对应多个文件 id")
        }
        pathOwner[p] = ref.fileId
        referenced.insert(p)
        guard let img = a.imageByPath[p] else {
            a.log.add("warn", "imageMissing", ref.sessionId, "\(p) 在 ZIP 中不存在")
            continue
        }
        if !ref.isImage {
            a.log.add("warn", "nonImageExported", ref.sessionId, "非图片附件却导出了原件")
        }
        if img.fileId != ref.fileId {
            a.log.add("warn", "fileNameMismatch", ref.sessionId, "条目 \(img.fileName) 前缀 id \(img.fileId) != \(ref.fileId)")
        }
        let expectName = "\(safeName(ref.fileId))_\(safeName(ref.fileName))"
        if img.fileName != expectName.precomposedStringWithCanonicalMapping {
            a.log.add("warn", "fileNaming", ref.sessionId, "文件名 \(img.fileName) 不是 \(expectName)")
        }
        if img.actualSize != ref.size {
            a.log.add("warn", "fileSizeMismatch", ref.sessionId, "声明 \(ref.size) 实际 \(img.actualSize)")
        }
        if let w = ref.width, let h = ref.height, let aw = img.width, let ah = img.height, (w, h) != (aw, ah) {
            a.log.add("warn", "imageDims", ref.sessionId, "声明 \(w)x\(h) 实际 \(aw)x\(ah)")
        }
    }
    for img in a.images where !referenced.contains(img.path) {
        a.log.add("warn", "imageOrphan", img.session, "\(img.path) 未被任何消息引用")
    }
}
