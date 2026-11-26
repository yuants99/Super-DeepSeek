import Foundation

struct MsgChange {
    var path: [UInt16]
    var localId: Int?
    var onlineId: Int?
    var kind: String // content | meta | lossy | added | removed
    var detail: String
}

struct SessionDiff {
    var id: String
    var title: String
    var status: String // identical | updated | added | metadataDiff
    var common = 0
    var localOnly = 0
    var onlineOnly = 0
    var contentChanged = 0
    var metaChanged = 0
    var localOnlyIds: [Int] = []
    var lostFrags: [String: Int] = [:]
    var changed: [MsgChange] = []
    var updatedAtLocal = ""
    var updatedAtOnline = ""
    var currentPathLocal = ""
    var currentPathOnline = ""
}

struct CrossDiff {
    var onlyLocal: [String] = []
    var onlyOnline: [String] = []
    var diffs: [SessionDiff] = []
    var identicalCount = 0
    var totalLocalOnly = 0
    var totalOnlineOnly = 0
    var totalContentChanged = 0
    var lostTotals: [String: Int] = [:]
    var addedFragTotals: [String: Int] = [:]
    var tokenDiffMsgs = 0
    var flagDiffMsgs = 0
    var timeDiffMsgs = 0
    var statusMapMsgs = 0
    var titleDiff = 0
    var sharedImages = 0
    var imageHashMismatch: [String] = []
    var localOnlyImages: [String] = []
    var onlineOnlyImages: [String] = []
    var localOnlyMsgIdsBySession: [String: [Int]] = [:]
}

func pathKey(_ p: [UInt16]) -> String { p.map(String.init).joined(separator: ".") }

func compareArchives(local: ArchiveAnalysis, online: ArchiveAnalysis) -> CrossDiff {
    var c = CrossDiff()
    let lset = Set(local.sessions.keys), oset = Set(online.sessions.keys)
    c.onlyLocal = lset.subtracting(oset).sorted()
    c.onlyOnline = oset.subtracting(lset).sorted()

    for sid in lset.intersection(oset).sorted() {
        guard let l = local.sessions[sid], let o = online.sessions[sid] else { continue }
        var d = SessionDiff(id: sid, title: l.title ?? o.title ?? "",
                            status: "identical", updatedAtLocal: l.updatedAt, updatedAtOnline: o.updatedAt)
        d.currentPathLocal = pathKey(l.pathById[l.currentMessageId] ?? [])
        d.currentPathOnline = pathKey(o.pathById[o.currentMessageId] ?? [])
        let lp = Set(l.byPath.keys), op = Set(o.byPath.keys)
        d.common = lp.intersection(op).count
        c.totalLocalOnly += lp.subtracting(op).count
        c.totalOnlineOnly += op.subtracting(lp).count
        d.localOnly = lp.subtracting(op).count
        d.onlineOnly = op.subtracting(lp).count

        if (l.title ?? nil) != (o.title ?? nil) { c.titleDiff += 1 }

        for p in lp.intersection(op) {
            guard let lid = l.byPath[p], let oid = o.byPath[p],
                  let lm = l.messages.first(where: { $0.id == lid }),
                  let om = o.messages.first(where: { $0.id == oid }) else { continue }
            if lm.coreHash != om.coreHash {
                d.contentChanged += 1
                c.totalContentChanged += 1
                if d.changed.count < 20 {
                    var detail = "core hash 不一致"
                    for i in 0..<min(lm.fragSig.count, om.fragSig.count)
                    where lm.fragSig[i] != om.fragSig[i] {
                        detail = "片段[\(i)] local=\(lm.fragSig[i]) online=\(om.fragSig[i])"
                        break
                    }
                    if lm.fragSig.count != om.fragSig.count, detail == "core hash 不一致" {
                        detail = "保留片段数 local=\(lm.fragSig.count) online=\(om.fragSig.count)"
                    }
                    d.changed.append(MsgChange(path: p, localId: lid, onlineId: oid, kind: "content", detail: detail))
                }
                continue
            }
            if lm.fullHash == om.fullHash { continue }
            d.metaChanged += 1
            var kinds = [String]()
            if lm.status != om.status { c.statusMapMsgs += 1; kinds.append("status:\(om.status)->\(lm.status)") }
            if lm.think != om.think || lm.search != om.search { c.flagDiffMsgs += 1; kinds.append("开关") }
            if lm.tokens != om.tokens { c.tokenDiffMsgs += 1 }
            if lm.insertedAt != om.insertedAt { c.timeDiffMsgs += 1 }
            for (t, n) in om.fragCounts {
                let ln = lm.fragCounts[t] ?? 0
                if n > ln {
                    d.lostFrags[t, default: 0] += n - ln
                    c.lostTotals[t, default: 0] += n - ln
                }
            }
            for (t, n) in lm.fragCounts {
                let on = om.fragCounts[t] ?? 0
                if n > on {
                    c.addedFragTotals[t, default: 0] += n - on
                }
            }
            if d.changed.count < 20, !kinds.isEmpty {
                d.changed.append(MsgChange(path: p, localId: lid, onlineId: oid, kind: "lossy",
                                           detail: kinds.joined(separator: ",")))
            }
        }
        for p in lp.subtracting(op) {
            if let lid = l.byPath[p] {
                d.localOnlyIds.append(lid)
            }
        }
        c.localOnlyMsgIdsBySession[sid] = d.localOnlyIds
        // 会话状态
        if d.contentChanged > 0 {
            d.status = "contentDiff"
        } else if d.metaChanged > 0 {
            d.status = "metadataDiff"
        } else if d.localOnly > 0 {
            d.status = "updated"
        }
        if d.localOnly == 0, d.onlineOnly == 0, d.contentChanged == 0, d.metaChanged == 0 {
            c.identicalCount += 1
        } else {
            c.diffs.append(d)
        }
    }

    // 附件对比
    let li = Set(local.imageByPath.keys), oi = Set(online.imageByPath.keys)
    c.localOnlyImages = li.subtracting(oi).sorted()
    c.onlineOnlyImages = oi.subtracting(li).sorted()
    c.sharedImages = li.intersection(oi).count
    for p in li.intersection(oi) {
        if local.imageByPath[p]!.sha256 != online.imageByPath[p]!.sha256 {
            c.imageHashMismatch.append(p)
        }
    }
    return c
}
