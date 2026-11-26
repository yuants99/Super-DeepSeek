import CryptoKit
import Foundation

// MARK: - 问题记录

struct Issue {
    var level: String // fatal | warn | info
    var code: String
    var session: String?
    var message: Int?
    var detail: String
}

final class IssueLog {
    private(set) var items: [Issue] = []
    private(set) var counts: [String: Int] = [:]
    private(set) var overflow = 0
    let cap: Int
    init(cap: Int = 200) { self.cap = cap }

    func add(_ level: String, _ code: String, session: String? = nil, message: Int? = nil, _ detail: String) {
        counts[level + "|" + code, default: 0] += 1
        if items.count < cap {
            items.append(Issue(level: level, code: code, session: session, message: message, detail: detail))
        } else {
            overflow += 1
        }
    }

    func add(_ level: String, _ code: String, _ detail: String) {
        add(level, code, session: nil, message: nil, detail)
    }

    func add(_ level: String, _ code: String, _ session: String, _ detail: String) {
        add(level, code, session: session, message: nil, detail)
    }

    func count(_ level: String, _ code: String? = nil) -> Int {
        if let code { return counts[level + "|" + code] ?? 0 }
        return counts.reduce(0) { $1.key.hasPrefix(level + "|") ? $0 + $1.value : $0 }
    }

    var hasFatal: Bool { count("fatal") > 0 }
    var summary: [(String, Int)] { counts.sorted { $0.value > $1.value }.map { ($0.key, $0.value) } }
}

// MARK: - JSON 类型读取（与 chat-demo schema.ts 一致）

@inline(__always) func asRecord(_ v: Any?) -> [String: Any]? { v as? [String: Any] }
@inline(__always) func asString(_ v: Any?) -> String? { v as? String }

@inline(__always) func asBool(_ v: Any?) -> Bool? {
    guard let n = v as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
    return n.boolValue
}

/// 非负安全整数
@inline(__always) func asCount(_ v: Any?) -> Int? {
    guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
    let d = n.doubleValue
    guard d.isFinite, d >= 0, d.rounded(.towardZero) == d, d <= 9_007_199_254_740_991 else { return nil }
    return Int(d)
}

@inline(__always) func asNumber(_ v: Any?) -> Double? {
    guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
    let d = n.doubleValue
    return d.isFinite ? d : nil
}

func isNull(_ v: Any?) -> Bool { v is NSNull }

/// 校验 RFC3339 UTC（Z 结尾、可选小数秒），并按日历校验日期真实存在。
func validTime(_ v: Any?) -> String? {
    guard let s = v as? String else { return nil }
    let u = Array(s.utf8)
    guard u.count >= 20 else { return nil }
    @inline(__always) func dig(_ i: Int) -> Int? {
        guard i < u.count, u[i] >= 48, u[i] <= 57 else { return nil }
        return Int(u[i] - 48)
    }
    @inline(__always) func num(_ start: Int, _ len: Int) -> Int? {
        var v = 0
        for k in 0..<len { guard let d = dig(start + k) else { return nil }; v = v * 10 + d }
        return v
    }
    guard u[4] == 45, u[7] == 45, u[10] == 84, u[13] == 58, u[16] == 58 else { return nil }
    guard let y = num(0, 4), let mo = num(5, 2), let dd = num(8, 2),
          let h = num(11, 2), let mi = num(14, 2), let se = num(17, 2) else { return nil }
    guard mo >= 1, mo <= 12, h <= 23, mi <= 59, se <= 59 else { return nil }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
    let dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
    guard dd >= 1, dd <= dim else { return nil }
    var i = 19
    if i < u.count, u[i] == 46 {
        i += 1
        var digits = 0
        while i < u.count, u[i] >= 48, u[i] <= 57 { i += 1; digits += 1 }
        guard digits > 0 else { return nil }
    }
    guard i < u.count, u[i] == 90, i + 1 == u.count else { return nil }
    return s
}

/// 把合法时间规范到毫秒精度，用于跨归档比较（2026-...T00:00:00Z == .000Z）。
func canonicalTime(_ s: String) -> String {
    guard validTime(s) != nil else { return s }
    let u = Array(s.utf8)
    var out = String(decoding: u[0..<19], as: UTF8.self)
    var frac = ""
    if u.count > 20 {
        frac = String(decoding: u[20..<(u.count - 1)], as: UTF8.self)
    }
    frac = String((frac + "000").prefix(3))
    out += "." + frac + "Z"
    return out
}

func isWebURL(_ s: String) -> Bool {
    guard let u = URL(string: s), let scheme = u.scheme?.lowercased() else { return false }
    return scheme == "http" || scheme == "https"
}

// MARK: - 片段规范化

struct FragResult {
    var type: String
    /// demo 导入后会保留的规范化内容；nil 表示会被丢弃。
    var core: String?
    /// 完整原文的规范化内容（含会被丢弃的部分）；nil 表示片段本身非法。
    var full: String?
    /// demo 主动丢弃的原因（格式合法）。
    var drop: String?
    /// 校验失败原因（demo 也会丢弃，但属于数据问题）。
    var invalid: String?
}

@inline(__always) private func enc(_ s: String) -> String { "\(s.utf8.count)#\(s)" }
@inline(__always) private func enc(_ n: Int) -> String { "i\(n)" }
@inline(__always) private func enc(_ n: Double) -> String { "f\(n)" }
private let encNull = "N"

private func kept(_ type: String, _ s: String) -> FragResult {
    FragResult(type: type, core: s, full: s, drop: nil, invalid: nil)
}

private func dropped(_ type: String, _ reason: String, _ full: String) -> FragResult {
    FragResult(type: type, core: nil, full: full, drop: reason, invalid: nil)
}

private func bad(_ type: String, _ reason: String) -> FragResult {
    FragResult(type: type, core: nil, full: nil, drop: nil, invalid: reason)
}

/// 严格按 chat-demo 的 schema.ts 校验，并按 toLocal.ts 的保留规则判定片段是否会被保留。
func canonicalFragment(_ value: Any) -> FragResult {
    guard let item = asRecord(value), let type = asString(item["type"]) else {
        return bad("?", "片段不是对象或缺 type")
    }
    switch type {
    case "REQUEST", "RESPONSE", "TEMPLATE_RESPONSE":
        guard let content = asString(item["content"]) else { return bad(type, "content 非字符串") }
        return kept(type, "T:\(type)|" + enc(content))

    case "TIP", "CONTENT_RISK":
        guard let content = asString(item["content"]) else { return bad(type, "content 非字符串") }
        guard let style = asString(item["style"]), ["INFO", "WARNING", "CAUTION"].contains(style) else {
            return bad(type, "style 非法")
        }
        let c = "T:\(type)|" + enc(content) + "|" + enc(style)
        return dropped(type, type + "(无对应展示)", c)

    case "THINK":
        guard let content = asString(item["content"]) else { return bad(type, "content 非字符串") }
        let elapsed: String
        if !item.keys.contains("elapsed_secs") { return bad(type, "缺 elapsed_secs") }
        if isNull(item["elapsed_secs"]) { elapsed = encNull }
        else if let n = asNumber(item["elapsed_secs"]) { elapsed = enc(n) }
        else { return bad(type, "elapsed_secs 非法") }
        return kept(type, "T:THINK|" + enc(content) + "|" + elapsed)

    case "PARTIAL_FILE_READ":
        guard let r = asNumber(item["ratio"]), r >= 0, r <= 100 else { return bad(type, "ratio 非法") }
        return dropped(type, "PARTIAL_FILE_READ(无对应展示)", "T:PARTIAL_FILE_READ|" + enc(r))

    case "TOOL_SEARCH":
        guard let queries = item["queries"] as? [Any] else { return bad(type, "queries 非数组") }
        var qs = [String]()
        for q in queries {
            guard let s = asString(q) else { return bad(type, "query 非字符串") }
            qs.append(s)
        }
        guard let results = item["results"] as? [Any] else { return bad(type, "results 非数组") }
        var keptR = [String]()
        var allR = [String]()
        for r in results {
            guard let d = asRecord(r) else { return bad(type, "result 非对象") }
            guard let url = asString(d["url"]), let title = asString(d["title"]),
                  let snippet = asString(d["snippet"]) else { return bad(type, "result 字段非法") }
            guard let pub = nullableTime(d, "published_at") else { return bad(type, "published_at 非法") }
            guard let site = nullableString(d, "site_name") else { return bad(type, "site_name 非法") }
            var icon: String? = nil
            if d.keys.contains("site_icon") {
                guard let ic = nullableString(d, "site_icon") else { return bad(type, "site_icon 非法") }
                icon = ic
            }
            let pubN = pub.map { enc(canonicalTime($0)) } ?? encNull
            let base = enc(url) + "|" + enc(title) + "|" + enc(snippet) + "|" + pubN
                + "|" + (site.map(enc) ?? encNull)
            allR.append(base + "|" + (icon.map(enc) ?? encNull))
            if isWebURL(url) {
                let iconKept = (icon != nil && isWebURL(icon!)) ? enc(icon!) : encNull
                keptR.append(base + "|" + iconKept)
            }
        }
        var status = encNull
        if item.keys.contains("status") {
            guard let s = asString(item["status"]), ["WIP", "FINISHED", "FAILED"].contains(s) else {
                return bad(type, "status 非法")
            }
            status = enc(s)
        }
        guard let m = metadataEnc(item) else { return bad(type, "stage/group 非法") }
        let headCore = "T:TOOL_SEARCH|" + enc(qs.joined(separator: "\u{1}")) + "|" + status
        let headFull = headCore + "|" + m
        return FragResult(type: type,
                          core: headCore + "|" + keptR.joined(separator: "\u{2}"),
                          full: headFull + "|" + allR.joined(separator: "\u{2}"),
                          drop: nil, invalid: nil)

    case "TOOL_OPEN":
        guard let status = asString(item["status"]), ["WIP", "FINISHED", "FAILED"].contains(status) else {
            return bad(type, "status 非法")
        }
        guard let url = nullableString(item, "url"), let title = nullableString(item, "title") else {
            return bad(type, "url/title 非法")
        }
        guard let pub = nullableTime(item, "published_at") else { return bad(type, "published_at 非法") }
        var extra = ""
        if item.keys.contains("snippet") {
            guard let s = nullableString(item, "snippet") else { return bad(type, "snippet 非法") }
            extra += "|" + (s.map(enc) ?? encNull)
        }
        if item.keys.contains("site_name") {
            guard let s = nullableString(item, "site_name") else { return bad(type, "site_name 非法") }
            extra += "|" + (s.map(enc) ?? encNull)
        }
        guard let m = metadataEnc(item) else { return bad(type, "stage/group 非法") }
        let titleN = (title ?? "").isEmpty ? enc("") : enc(title!)
        let base = "T:TOOL_OPEN|" + enc(status) + "|" + (url.map(enc) ?? encNull) + "|"
            + titleN + "|" + ((pub.map { canonicalTime($0) }).map(enc) ?? encNull)
        let full = base + extra + "|" + m
        if let u = url, isWebURL(u) {
            return FragResult(type: type, core: base, full: full, drop: nil, invalid: nil)
        }
        return dropped(type, "TOOL_OPEN(无有效链接)", full)

    case "TOOL_FIND":
        guard let status = asString(item["status"]), ["WIP", "FINISHED", "NO_RESULT", "FAILED"].contains(status) else {
            return bad(type, "status 非法")
        }
        var pattern = ""
        if item.keys.contains("pattern") {
            guard let p = asString(item["pattern"]) else { return bad(type, "pattern 非法") }
            pattern = enc(p)
        }
        guard let m = metadataEnc(item) else { return bad(type, "stage/group 非法") }
        return FragResult(type: type, core: "T:TOOL_FIND|" + enc(status) + "|" + pattern,
                          full: "T:TOOL_FIND|" + enc(status) + "|" + pattern + "|" + m,
                          drop: nil, invalid: nil)

    case "READ_LINK":
        guard let results = item["results"] as? [Any] else { return bad(type, "results 非数组") }
        var keptR = [String]()
        var allR = [String]()
        for r in results {
            guard let d = asRecord(r) else { return bad(type, "result 非对象") }
            guard let sig = asString(d["signature"]) else { return bad(type, "signature 非法") }
            var url = ""
            if d.keys.contains("url") {
                guard let u = asString(d["url"]) else { return bad(type, "url 非法") }
                url = u
            }
            var title = encNull
            if d.keys.contains("title") {
                guard let t = nullableString(d, "title") else { return bad(type, "title 非法") }
                title = t.map(enc) ?? encNull
            }
            allR.append(enc(sig) + "|" + enc(url) + "|" + title)
            let web = isWebURL(url) ? url : ""
            let sigBlank = sig.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            if web.isEmpty && sigBlank { continue }
            // signature 由服务端按次签发，两次导出必然不同，不参与内容比较。
            keptR.append(enc(web) + "|" + title)
        }
        let full = "T:READ_LINK|" + allR.joined(separator: "\u{2}")
        if keptR.isEmpty { return dropped(type, "READ_LINK(空结果)", full) }
        return FragResult(type: type, core: "T:READ_LINK|" + keptR.joined(separator: "\u{2}"),
                          full: full, drop: nil, invalid: nil)

    case "FILE":
        guard let files = item["files"] as? [Any] else { return bad(type, "files 非数组") }
        var coreA = [String]()
        var fullA = [String]()
        for f in files {
            guard let d = asRecord(f) else { return bad(type, "file 非对象") }
            guard let id = asString(d["id"]), let name = asString(d["file_name"]),
                  let size = asCount(d["file_size"]), let isImage = asBool(d["is_image"]) else {
                return bad(type, "file 字段非法")
            }
            guard let token = nullableCount(d, "token_usage") else { return bad(type, "token_usage 非法") }
            guard let ins = validTime(d["inserted_at"]) else { return bad(type, "inserted_at 非法") }
            guard let path = nullableString(d, "export_path") else { return bad(type, "export_path 非法") }
            guard let w = nullableCount(d, "width"), let h = nullableCount(d, "height") else {
                return bad(type, "width/height 非法")
            }
            let head = enc(id) + "|" + enc(name) + "|" + enc(size) + "|" + (isImage ? "1" : "0")
            coreA.append(head)
            fullA.append(head + "|" + (token.map(enc) ?? encNull) + "|" + enc(canonicalTime(ins)) + "|"
                         + (path.map(enc) ?? encNull) + "|" + (w.map(enc) ?? encNull) + "|" + (h.map(enc) ?? encNull))
        }
        return FragResult(type: type, core: "T:FILE|" + coreA.joined(separator: "\u{2}"),
                          full: "T:FILE|" + fullA.joined(separator: "\u{2}"), drop: nil, invalid: nil)

    case "TOOL_IMAGE_SEARCH":
        guard let status = asString(item["status"]), ["WIP", "FINISHED", "FAILED"].contains(status) else {
            return bad(type, "status 非法")
        }
        guard let results = item["results"] as? [Any] else { return bad(type, "results 非数组") }
        var idx = ""
        if item.keys.contains("image_indexes") {
            guard let arr = item["image_indexes"] as? [Any] else { return bad(type, "image_indexes 非法") }
            var nums = [Int]()
            for n in arr {
                guard let c = asCount(n) else { return bad(type, "image_indexes 非法") }
                nums.append(c)
            }
            idx = enc(nums.map(String.init).joined(separator: ","))
        }
        var rs = [String]()
        for r in results {
            guard let d = asRecord(r), let title = asString(d["title"]),
                  let src = asString(d["source_page_url"]), let snippet = asString(d["snippet"]) else {
                return bad(type, "result 字段非法")
            }
            guard let site = nullableString(d, "site_name") else { return bad(type, "site_name 非法") }
            guard let pub = nullableTime(d, "published_at") else { return bad(type, "published_at 非法") }
            rs.append(enc(title) + "|" + enc(src) + "|" + enc(snippet) + "|"
                      + (site.map(enc) ?? encNull) + "|" + ((pub.map { canonicalTime($0) }).map(enc) ?? encNull))
        }
        guard let m = metadataEnc(item) else { return bad(type, "stage/group 非法") }
        return dropped(type, "TOOL_IMAGE_SEARCH(无对应展示)",
                       "T:TOOL_IMAGE_SEARCH|" + enc(status) + "|" + idx + "|" + m + "|"
                       + rs.joined(separator: "\u{2}"))

    default:
        return bad(type, "未知片段类型")
    }
}

// MARK: - 可空字段（格式要求显式 null，缺省即非法）

func nullableString(_ d: [String: Any], _ key: String) -> String?? {
    guard d.keys.contains(key) else { return nil }
    if isNull(d[key]) { return .some(nil) }
    return asString(d[key]).map { .some($0) }
}

func nullableCount(_ d: [String: Any], _ key: String) -> Int?? {
    guard d.keys.contains(key) else { return nil }
    if isNull(d[key]) { return .some(nil) }
    return asCount(d[key]).map { .some($0) }
}

func nullableTime(_ d: [String: Any], _ key: String) -> String?? {
    guard d.keys.contains(key) else { return nil }
    if isNull(d[key]) { return .some(nil) }
    return validTime(d[key]).map { .some($0) }
}

func metadataEnc(_ item: [String: Any]) -> String? {
    var parts = [String]()
    if item.keys.contains("stage_id") {
        guard let n = asCount(item["stage_id"]) else { return nil }
        parts.append("s" + enc(n))
    }
    if item.keys.contains("group_id") {
        guard let n = asCount(item["group_id"]) else { return nil }
        parts.append("g" + enc(n))
    }
    return parts.joined(separator: ",")
}
