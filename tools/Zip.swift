import Compression
import Foundation

// MARK: - CRC32

private let crcTable: [UInt32] = (0..<256).map { i in
    var c = UInt32(i)
    for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
    return c
}

func crc32(_ buf: UnsafeBufferPointer<UInt8>) -> UInt32 {
    var c: UInt32 = 0xFFFF_FFFF
    for b in buf { c = crcTable[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
    return c ^ 0xFFFF_FFFF
}

func crc32(_ bytes: [UInt8]) -> UInt32 { bytes.withUnsafeBufferPointer { crc32($0) } }

// MARK: - ZIP

struct ZipIssue {
    var level: String // fatal | warn
    var code: String
    var entry: String?
    var detail: String
}

struct ZipEntry {
    var path: String
    var flags: Int
    var method: Int
    var crc: UInt32
    var compSize: Int
    var size: Int
    var localOffset: Int
    var dataOffset: Int = 0
}

/// 单卷 ZIP32 读取器：仅支持 STORE / DEFLATE，不支持 ZIP64、加密、分卷。
/// 条目根目录、顺序、重名、路径安全均按 chat-demo 的 zipReader 规则校验。
final class ZipArchive {
    let url: URL
    let fileSize: Int
    private let bytes: [UInt8]
    private(set) var entries: [ZipEntry] = []
    private(set) var byPath: [String: ZipEntry] = [:]
    private(set) var issues: [ZipIssue] = []
    private(set) var comment: String = ""

    init(url: URL) throws {
        self.url = url
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        self.bytes = [UInt8](data)
        self.fileSize = bytes.count
        try parse()
    }

    private func u16(_ o: Int) -> Int { Int(bytes[o]) | (Int(bytes[o + 1]) << 8) }
    private func u32(_ o: Int) -> Int {
        Int(bytes[o]) | (Int(bytes[o + 1]) << 8) | (Int(bytes[o + 2]) << 16) | (Int(bytes[o + 3]) << 24)
    }
    private func sig(_ o: Int, _ v: UInt32) -> Bool {
        bytes[o] == UInt8(v & 0xFF) && bytes[o + 1] == UInt8((v >> 8) & 0xFF)
            && bytes[o + 2] == UInt8((v >> 16) & 0xFF) && bytes[o + 3] == UInt8((v >> 24) & 0xFF)
    }

    private func parse() throws {
        guard fileSize >= 22 else { throw AuditError("ZIP 文件过小") }
        // 从尾部向前找 EOCD，注释长度必须正好补齐到文件末尾。
        var eocd = -1
        let tailStart = max(0, fileSize - 22 - 0xFFFF)
        var i = fileSize - 22
        while i >= tailStart {
            if sig(i, 0x0605_4B50), i + 22 + u16(i + 20) == fileSize { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { throw AuditError("找不到 EOCD，ZIP 不完整") }
        let diskNo = u16(eocd + 4), cdDisk = u16(eocd + 6)
        let onDisk = u16(eocd + 8), total = u16(eocd + 10)
        let cdSize = u32(eocd + 12), cdOffset = u32(eocd + 16)
        let commentLen = u16(eocd + 20)
        if commentLen > 0, let s = String(bytes: bytes[(eocd + 22)..<(eocd + 22 + commentLen)], encoding: .utf8) {
            comment = s
        }
        if diskNo != 0 || cdDisk != 0 || onDisk != total {
            issues.append(ZipIssue(level: "fatal", code: "zipMultiDisk", entry: nil, detail: "分卷 ZIP 不支持"))
        }
        if total == 0xFFFF || cdSize == 0xFFFF_FFFF || cdOffset == 0xFFFF_FFFF {
            issues.append(ZipIssue(level: "fatal", code: "zip64", entry: nil, detail: "ZIP64 不支持"))
        }
        if cdOffset + cdSize != eocd {
            issues.append(ZipIssue(level: "warn", code: "zipCdRange", entry: nil,
                                   detail: "中央目录区间 \(cdOffset)+\(cdSize) != EOCD \(eocd)"))
        }
        var p = cdOffset
        var seen = Set<String>()
        for _ in 0..<total {
            guard p + 46 <= fileSize, sig(p, 0x0201_4B50) else {
                issues.append(ZipIssue(level: "fatal", code: "zipCdEntry", entry: nil, detail: "中央目录条目损坏 @\(p)"))
                break
            }
            let flags = u16(p + 8)
            let method = u16(p + 10)
            let crc = UInt32(u32(p + 16))
            let compSize = u32(p + 20)
            let size = u32(p + 24)
            let nameLen = u16(p + 28)
            let extraLen = u16(p + 30)
            let commentLen2 = u16(p + 32)
            let localOffset = u32(p + 42)
            let nameStart = p + 46
            guard nameStart + nameLen <= fileSize else { break }
            let nameBytes = Array(bytes[nameStart..<(nameStart + nameLen)])
            var path = String(decoding: nameBytes, as: UTF8.self)
            if flags & 0x800 == 0, nameBytes.contains(where: { $0 > 0x7F }) {
                issues.append(ZipIssue(level: "warn", code: "zipNameEncoding", entry: path,
                                       detail: "非 UTF-8 标志位含非 ASCII 文件名"))
            }
            path = path.precomposedStringWithCanonicalMapping // NFC
            var entry = ZipEntry(path: path, flags: flags, method: method, crc: crc,
                                 compSize: compSize, size: size, localOffset: localOffset)
            if flags & 0x1 != 0 {
                issues.append(ZipIssue(level: "fatal", code: "zipEncrypted", entry: path, detail: "条目加密"))
            }
            if method != 0 && method != 8 {
                issues.append(ZipIssue(level: "fatal", code: "zipMethod", entry: path, detail: "不支持的压缩方法 \(method)"))
            }
            if path.isEmpty || path.contains("\\") || path.contains("\0")
                || path.hasPrefix("/") || (path.count > 1 && path[path.index(path.startIndex, offsetBy: 1)] == ":")
            {
                issues.append(ZipIssue(level: "fatal", code: "zipUnsafePath", entry: path, detail: "非法条目名"))
            }
            let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            if parts.contains("..") || parts.contains(where: { $0.isEmpty && path != "/" && !path.hasSuffix("/") }) {
                issues.append(ZipIssue(level: "fatal", code: "zipUnsafePath", entry: path, detail: "路径穿越或空段"))
            }
            let identity = path.hasSuffix("/") ? String(path.dropLast()) : path
            if seen.contains(identity) {
                issues.append(ZipIssue(level: "fatal", code: "zipDuplicate", entry: path, detail: "重复条目"))
            }
            seen.insert(identity)
            if path.hasSuffix("/") && size != 0 {
                issues.append(ZipIssue(level: "warn", code: "zipDirSize", entry: path, detail: "目录条目大小非 0"))
            }
            // 定位本地头，计算数据偏移。
            guard localOffset + 30 <= fileSize, sig(localOffset, 0x0403_4B50) else {
                issues.append(ZipIssue(level: "fatal", code: "zipLocalHeader", entry: path, detail: "缺本地头"))
                p = nameStart + nameLen + extraLen + commentLen2
                continue
            }
            let lNameLen = u16(localOffset + 26)
            let lExtraLen = u16(localOffset + 28)
            entry.dataOffset = localOffset + 30 + lNameLen + lExtraLen
            if entry.dataOffset + compSize > fileSize {
                issues.append(ZipIssue(level: "fatal", code: "zipTruncated", entry: path, detail: "数据越界"))
            }
            entries.append(entry)
            byPath[entry.path] = entry
            p = nameStart + nameLen + extraLen + commentLen2
        }
        if entries.count != total {
            issues.append(ZipIssue(level: "fatal", code: "zipCount", entry: nil,
                                   detail: "条目数 \(entries.count) != 声明 \(total)"))
        }
    }

    /// 读取条目原始字节（含 CRC 校验）。目录条目返回空。
    func content(_ e: ZipEntry, verifyCRC: Bool = true) -> [UInt8]? {
        if e.path.hasSuffix("/") { return [] }
        guard e.dataOffset + e.compSize <= bytes.count else { return nil }
        let raw = Array(bytes[e.dataOffset..<(e.dataOffset + e.compSize)])
        var out: [UInt8]
        if e.method == 0 {
            out = raw
        } else {
            guard e.size >= 0, e.size < 512 * 1024 * 1024 else { return nil }
            if e.size == 0 { out = [] } else {
                var dst = [UInt8](repeating: 0, count: e.size)
                let n = dst.withUnsafeMutableBufferPointer { d in
                    raw.withUnsafeBufferPointer { s in
                        compression_decode_buffer(d.baseAddress!, e.size, s.baseAddress!, raw.count,
                                                  nil, COMPRESSION_ZLIB)
                    }
                }
                guard n == e.size else { return nil }
                out = dst
            }
        }
        if verifyCRC {
            let actual = out.withUnsafeBufferPointer { crc32($0) }
            if actual != e.crc { return nil }
        }
        return out
    }
}

// MARK: - 写 ZIP（STORE，按给定顺序）

func writeZip(to url: URL, entries: [(path: String, data: [UInt8])]) throws {
    var out = [UInt8]()
    out.reserveCapacity(entries.reduce(0) { $0 + $1.data.count + 200 })
    var central = [UInt8]()
    var count = 0
    for e in entries {
        let name = Array(e.path.utf8)
        let crc = e.data.withUnsafeBufferPointer { crc32($0) }
        let offset = out.count
        // 本地文件头：30 字节
        appendU32(&out, 0x0403_4B50)
        appendU16(&out, 20)      // version needed
        appendU16(&out, 0x0800)  // UTF-8 文件名
        appendU16(&out, 0)       // method = store
        appendU16(&out, 0)       // mod time
        appendU16(&out, 0x21)    // mod date = 1980-01-01
        appendU32(&out, crc)
        appendU32(&out, UInt32(e.data.count))
        appendU32(&out, UInt32(e.data.count))
        appendU16(&out, UInt16(name.count))
        appendU16(&out, 0)
        out.append(contentsOf: name)
        out.append(contentsOf: e.data)
        // 中央目录：46 字节
        appendU32(&central, 0x0201_4B50)
        appendU16(&central, 20)     // version made by
        appendU16(&central, 20)     // version needed
        appendU16(&central, 0x0800) // UTF-8
        appendU16(&central, 0)
        appendU16(&central, 0)
        appendU16(&central, 0x21)
        appendU32(&central, crc)
        appendU32(&central, UInt32(e.data.count))
        appendU32(&central, UInt32(e.data.count))
        appendU16(&central, UInt16(name.count))
        appendU16(&central, 0)
        appendU16(&central, 0)
        appendU16(&central, 0)
        appendU16(&central, 0)
        appendU32(&central, 0)
        appendU32(&central, UInt32(offset))
        central.append(contentsOf: name)
        count += 1
    }
    let cdOffset = out.count
    out.append(contentsOf: central)
    appendU32(&out, 0x0605_4B50)
    appendU16(&out, 0)
    appendU16(&out, 0)
    appendU16(&out, UInt16(count))
    appendU16(&out, UInt16(count))
    appendU32(&out, UInt32(central.count))
    appendU32(&out, UInt32(cdOffset))
    appendU16(&out, 0)
    try Data(out).write(to: url, options: .atomic)
}

private func appendU16(_ a: inout [UInt8], _ v: UInt16) {
    a.append(UInt8(v & 0xFF)); a.append(UInt8((v >> 8) & 0xFF))
}
private func appendU32(_ a: inout [UInt8], _ v: UInt32) {
    a.append(UInt8(v & 0xFF)); a.append(UInt8((v >> 8) & 0xFF))
    a.append(UInt8((v >> 16) & 0xFF)); a.append(UInt8((v >> 24) & 0xFF))
}

struct AuditError: Error, CustomStringConvertible {
    let message: String
    init(_ m: String) { message = m }
    var description: String { message }
}
