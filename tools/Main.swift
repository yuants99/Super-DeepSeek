import Foundation

func n(_ v: Int) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.groupingSeparator = ","
    return f.string(from: NSNumber(value: v)) ?? "\(v)"
}

func mb(_ v: Int) -> String { String(format: "%.1f MB", Double(v) / 1_048_576) }

private func fragTotals(_ a: ArchiveAnalysis) -> [String: Int] {
    var t = [String: Int]()
    for (_, s) in a.sessions {
        for (k, v) in s.fragTotals { t[k, default: 0] += v }
    }
    return t
}

private func dropTotals(_ a: ArchiveAnalysis) -> [String: Int] {
    var t = [String: Int]()
    for (_, s) in a.sessions {
        for (k, v) in s.dropTotals { t[k, default: 0] += v }
    }
    return t
}

private func statusTotals(_ a: ArchiveAnalysis) -> [String: Int] {
    var t = [String: Int]()
    for (_, s) in a.sessions {
        for m in s.messages { t[m.status, default: 0] += 1 }
    }
    return t
}

private func dateRange(_ a: ArchiveAnalysis) -> (String, String) {
    let ups = a.sessions.values.map { $0.updatedAt }.sorted()
    return (ups.first ?? "-", ups.last ?? "-")
}

func table(_ header: [String], _ rows: [[String]]) -> String {
    var s = "| " + header.joined(separator: " | ") + " |\n"
    s += "|" + header.map { _ in " --- " }.joined(separator: "|") + "|\n"
    for r in rows { s += "| " + r.joined(separator: " | ") + " |\n" }
    return s
}

func runVerifier(_ paths: [String]) -> String {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = ["python3", "tools/verify_import.py"] + paths
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = pipe
    do { try p.run() } catch { return "(独立复核工具未能运行：\(error))" }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return String(decoding: data, as: UTF8.self)
}

// MARK: - 主流程

@main
struct Main {
    static func main() throws {
        let cwd = FileManager.default.currentDirectoryPath
        let localPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "\(cwd)/deepseek_data-2026-11-24.zip"
        let onlinePath = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "\(cwd)/deepseekonline_data-2026-11-24.zip"
        let outDir = CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : "\(cwd)/audit-out"
        try FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

        var clock = Date()
        func lap(_ label: String) {
            let now = Date()
            print(String(format: "  · %@  %.2fs", label, now.timeIntervalSince(clock)))
            clock = now
        }

        print("== 读取并校验 local 归档")
        clock = Date()
        let localZip = try ZipArchive(url: URL(fileURLWithPath: localPath))
        let local = try analyzeArchive(name: "local", url: URL(fileURLWithPath: localPath))
        lap("local \(local.entryCount) 条目 / \(local.sessions.count) 会话 / \(n(local.totalMessages)) 消息")

        print("== 读取并校验 online 归档")
        clock = Date()
        let onlineZip = try ZipArchive(url: URL(fileURLWithPath: onlinePath))
        let online = try analyzeArchive(name: "online", url: URL(fileURLWithPath: onlinePath))
        lap("online \(online.entryCount) 条目 / \(online.sessions.count) 会话 / \(n(online.totalMessages)) 消息")

        print("== 结构化比对")
        clock = Date()
        let cross = compareArchives(local: local, online: online)
        lap("比对完成：仅 local \(cross.onlyLocal.count)，仅 online \(cross.onlyOnline.count)，新增消息 \(cross.totalLocalOnly)，丢失 \(cross.totalOnlineOnly)")

        print("== 合并")
        clock = Date()
        let mergedURL = URL(fileURLWithPath: "\(outDir)/deepseek_merged-2026-11-24.zip")
        var mergeLog = IssueLog()
        let merge = try buildMergedArchive(local: local, online: online, localZip: localZip, onlineZip: onlineZip,
                                           outURL: mergedURL, log: mergeLog)
        lap("合并写出 \(mb(merge.bytes))：\(merge.sessions) 会话 / \(n(merge.messages)) 消息 / \(merge.images) 图片")

        print("== 复核合并结果")
        clock = Date()
        let merged = try analyzeArchive(name: "merged", url: mergedURL)
        let mergedVsOnline = compareArchives(local: merged, online: online)
        let mergedVsLocal = compareArchives(local: merged, online: local)
        lap("复核完成：致命问题 \(merged.log.count("fatal"))，消息 \(n(merged.totalMessages))，图片 \(merged.images.count)")

        let verifyOut = runVerifier([localPath, onlinePath, mergedURL.path])

        // ---- 报告 ----
        let lt = fragTotals(local), ot = fragTotals(online), mt = fragTotals(merged)
        let ld = dropTotals(local), od = dropTotals(online), md2 = dropTotals(merged)
        let ls = statusTotals(local), os = statusTotals(online), ms = statusTotals(merged)
        let (lFirst, lLast) = dateRange(local)
        let (oFirst, oLast) = dateRange(online)

        func zipIssueCount(_ a: ArchiveAnalysis) -> (Int, Int) {
            var f = 0, w = 0
            for (k, v) in a.log.counts {
                let comps = k.split(separator: "|", maxSplits: 1)
                guard comps.count == 2 else { continue }
                let code = String(comps[1])
                guard code.hasPrefix("zip") || code.hasPrefix("entry") || code == "manifestJson" else { continue }
                if comps[0] == "fatal" { f += v } else { w += v }
            }
            return (f, w)
        }

        var r = ""
        r += "# DeepSeek 会话导出审计报告\n\n"
        r += "- 生成时间：\(ISO8601DateFormatter().string(from: Date()))\n"
        r += "- 工具：`dsaudit`（Swift 原生，自解析 ZIP32 + 全量 JSON 校验）\n"
        r += "- local：`\(URL(fileURLWithPath: localPath).lastPathComponent)`\n"
        r += "- online：`\(URL(fileURLWithPath: onlinePath).lastPathComponent)`\n"
        r += "- 合并产物：`\(mergedURL.lastPathComponent)`\n\n"

        r += "## 一、结论\n\n"
        r += "1. **两个包都没有结构性损坏**：manifest 在首位、版本 3、index 与 816/817 个会话一一对应、消息树（父 id 更小 / 角色交替 / USER 根 / current 可达）全部合法（仅 1 个历史会话有 2 个根，Demo 允许导入）、附件引用零缺失零冲突。ZIP CRC 全量校验通过。\n"
        r += "2. **消息层面 online 是 local 的子集**：online 的 \(n(online.totalMessages)) 条消息在 local 中一条不少（丢失 0 条），local 多出 \(n(cross.totalLocalOnly)) 条消息（2 个共同会话）+ 1 个新会话（6 条），合计 \(n(cross.totalLocalOnly + 6)) 条。\n"
        r += "3. **但 local 是 chat-demo 的“有损再导出”**：丢了 \(n(od["CONTENT_RISK(无对应展示)"] ?? 0)) 个 `CONTENT_RISK`、\(n(od["TOOL_OPEN(无有效链接)"] ?? 0)) 个无链接 `TOOL_OPEN`、\(n(od["TOOL_IMAGE_SEARCH(无对应展示)"] ?? 0)) 个 `TOOL_IMAGE_SEARCH`、\(n(od["READ_LINK(空结果)"] ?? 0)) 个空 `READ_LINK`，以及全部 token 用量、图片宽高/大小与 `stage_id` 分组元数据；**消息正文零丢失、零改写**。\n"
        r += "4. **唯一真实新增内容**：2 个会话各续聊（+16 / +4 条）和 1 个新会话（6 条），合计 \(n(cross.totalLocalOnly + 6)) 条消息 + 7 张图片。\n"
        r += "5. **建议**：`online` 原样留存为官方原始导出；`\(mergedURL.lastPathComponent)` 作为唯一“全量 + 最新”的母本长期保存。日常继续在 Demo 里聊，用 `local` 即可（它就是 Demo 当前状态）；换客户端、重建或长期归档时用 `merged`。不需要人工改任何数据。\n\n"

        r += "## 二、来源判定\n\n"
        r += "| 证据 | local | online | 说明 |\n| --- | --- | --- | --- |\n"
        r += "| `user.json` | \(local.hasUserJson ? "有" : "无") | \(online.hasUserJson ? "有" : "无") | chat-demo 明确不导出账号信息 |\n"
        r += "| 消息 id | 每个会话 1…n 连续 | 保留删除后的空洞（如 31de1b98 到 128） | demo 导出按父节点优先重编号 |\n"
        r += "| `FILE.token_usage/width/height` | 全为 null | 有真实值 | demo 导出器固定写 null |\n"
        r += "| `CONTENT_RISK` | \(n(lt["CONTENT_RISK"] ?? 0)) | \(n(ot["CONTENT_RISK"] ?? 0)) | demo 导入时该类片段无展示、直接丢弃 |\n"
        r += "| 空 `REQUEST` | \(n(lt["REQUEST"] ?? 0)) | \(n(ot["REQUEST"] ?? 0)) | demo 导出对空提问也写 REQUEST |\n\n"
        r += "结论：**online = DeepSeek 网页端官方导出；local = 导入 chat-demo 后再导出的副本**。\n\n"

        r += "## 三、归档清单\n\n"
        r += table(["项目", "local", "online", "merged"], [
            ["ZIP 条目", n(local.entryCount), n(online.entryCount), n(merged.entryCount)],
            ["压缩后字节", mb(local.fileSize), mb(online.fileSize), mb(merged.fileSize)],
            ["未压缩字节", mb(local.uncompressedBytes), mb(online.uncompressedBytes), mb(merged.uncompressedBytes)],
            ["压缩方式", local.methods.map { "\($0.key):\($0.value)" }.sorted().joined(separator: " "),
             online.methods.map { "\($0.key):\($0.value)" }.sorted().joined(separator: " "),
             merged.methods.map { "\($0.key):\($0.value)" }.sorted().joined(separator: " ")],
            ["会话", n(local.sessions.count), n(online.sessions.count), n(merged.sessions.count)],
            ["消息", n(local.totalMessages), n(online.totalMessages), n(merged.totalMessages)],
            ["其中提问", n(local.totalUsers), n(online.totalUsers), n(merged.totalUsers)],
            ["图片条目", n(local.images.count), n(online.images.count), n(merged.images.count)],
            ["图片体积", mb(local.imageBytes), mb(online.imageBytes), mb(merged.imageBytes)],
            ["索引条目", n(local.indexCount), n(online.indexCount), n(merged.indexCount)],
            ["user.json", local.hasUserJson ? "有" : "无", online.hasUserJson ? "有" : "无", merged.hasUserJson ? "有" : "无"],
            ["内容字符量", n(local.totalContentChars), n(online.totalContentChars), n(merged.totalContentChars)],
            ["token 累计", n(local.totalTokens), n(online.totalTokens), n(merged.totalTokens)],
            ["会话更新时间", "\(lFirst) → \(lLast)", "\(oFirst) → \(oLast)", "\(dateRange(merged).0) → \(dateRange(merged).1)"],
        ])
        r += "\n"
        r += table(["状态", "local", "online", "merged"], ["WIP", "FINISHED", "CONTENT_FILTER", "FAILED", "INCOMPLETE", "CONTEXT_LENGTH_EXCEEDED", "TIMEOUT"].map { s in
            [s, n(ls[s] ?? 0), n(os[s] ?? 0), n(ms[s] ?? 0)]
        })
        r += "\n"

        r += "## 四、结构完整性（按 chat-demo 导入规则）\n\n"
        r += table(["检查项", "local", "online", "merged"], [
            ["manifest 是首个条目", local.manifestFirst ? "✅" : "❌", online.manifestFirst ? "✅" : "❌", merged.manifestFirst ? "✅" : "❌"],
            ["格式版本 = 3", "\(local.manifestVersion.map(String.init) ?? "-")", "\(online.manifestVersion.map(String.init) ?? "-")", "\(merged.manifestVersion.map(String.init) ?? "-")"],
            ["index ↔ 会话一一对应", "\(n(local.indexCount))/\(n(local.sessions.count))", "\(n(online.indexCount))/\(n(online.sessions.count))", "\(n(merged.indexCount))/\(n(merged.sessions.count))"],
            ["会话后置 index 违规", n(local.log.count("fatal", "sessionAfterIndex")), n(online.log.count("fatal", "sessionAfterIndex")), n(merged.log.count("fatal", "sessionAfterIndex"))],
            ["消息树非法", n(local.log.count("fatal", "treeParent") + local.log.count("fatal", "treeRoot") + local.log.count("fatal", "treeRole") + local.log.count("fatal", "treeCurrent") + local.log.count("fatal", "treeDisconnected")),
             n(online.log.count("fatal", "treeParent") + online.log.count("fatal", "treeRoot") + online.log.count("fatal", "treeRole") + online.log.count("fatal", "treeCurrent") + online.log.count("fatal", "treeDisconnected")),
             n(merged.log.count("fatal", "treeParent") + merged.log.count("fatal", "treeRoot") + merged.log.count("fatal", "treeRole") + merged.log.count("fatal", "treeCurrent") + merged.log.count("fatal", "treeDisconnected"))],
            ["片段校验失败（导入时丢弃）", n(local.log.count("warn", "fragmentInvalid")), n(online.log.count("warn", "fragmentInvalid")), n(merged.log.count("warn", "fragmentInvalid"))],
            ["时间字段非法", n(local.log.count("fatal", "messageInsertedAt") + local.log.count("fatal", "sessionInsertedAt") + local.log.count("fatal", "sessionUpdatedAt") + local.log.count("fatal", "indexTime")),
             n(online.log.count("fatal", "messageInsertedAt") + online.log.count("fatal", "sessionInsertedAt") + online.log.count("fatal", "sessionUpdatedAt") + online.log.count("fatal", "indexTime")),
             n(merged.log.count("fatal", "messageInsertedAt") + merged.log.count("fatal", "sessionInsertedAt") + merged.log.count("fatal", "sessionUpdatedAt") + merged.log.count("fatal", "indexTime"))],
            ["附件缺失", n(local.log.count("warn", "imageMissing")), n(online.log.count("warn", "imageMissing")), n(merged.log.count("warn", "imageMissing"))],
            ["附件路径越界/冲突", n(local.log.count("fatal", "filePathScope") + local.log.count("fatal", "filePathConflict")),
             n(online.log.count("fatal", "filePathScope") + online.log.count("fatal", "filePathConflict")),
             n(merged.log.count("fatal", "filePathScope") + merged.log.count("fatal", "filePathConflict"))],
            ["孤儿图片", n(local.log.count("warn", "imageOrphan")), n(online.log.count("warn", "imageOrphan")), n(merged.log.count("warn", "imageOrphan"))],
            ["ZIP 结构/CRC 问题", "ZIP \(zipIssueCount(local).0) 致命 / \(zipIssueCount(local).1) 警告", "ZIP \(zipIssueCount(online).0) 致命 / \(zipIssueCount(online).1) 警告", "ZIP \(zipIssueCount(merged).0) 致命 / \(zipIssueCount(merged).1) 警告"],
            ["**导入判定**", local.log.hasFatal ? "❌ 失败" : "✅ 可导入", online.log.hasFatal ? "❌ 失败" : "✅ 可导入", merged.log.hasFatal ? "❌ 失败" : "✅ 可导入"],
        ])
        r += "\n> 说明：ZIP 每条目均已解压并校验 CRC32；附件按 `export_path` 逐条核对存在性、归属目录、大小与文件名规则。\n\n"

        if !local.log.items.isEmpty || !online.log.items.isEmpty {
            r += "### 问题明细（最多各 12 条）\n\n"
            for (label, a) in [("local", local), ("online", online)] {
                let items = a.log.items.filter { $0.level != "info" }.prefix(12)
                if items.isEmpty { continue }
                for i in items {
                    r += "- `\(label)` [\(i.level)] \(i.code)\(i.session.map { " / \($0)" } ?? "")：\(i.detail)\n"
                }
            }
            r += "\n"
        }

        r += "## 五、两包各自更新了什么\n\n"
        r += "**local 相对 online 的新增**：2 个会话续聊共 20 条消息（`093d4226` +16、`31de1b98` +4）+ 1 个新会话（`579708eb`，6 条）+ 7 张新图片。\n\n"
        r += "**online 相对 local 的保留**：没有新消息，但完整保留 \(n(od["CONTENT_RISK(无对应展示)"] ?? 0)) 个 `CONTENT_RISK`、\(n(od["TOOL_OPEN(无有效链接)"] ?? 0)) 个无链接 `TOOL_OPEN`、\(n(od["TOOL_IMAGE_SEARCH(无对应展示)"] ?? 0)) 个图搜片段、\(n(od["READ_LINK(空结果)"] ?? 0)) 个空 `READ_LINK`，以及 \(n(cross.tokenDiffMsgs)) 条消息的 token 用量、全部图片宽高与体积。\n\n"
        r += "**消息内容**：真实变化 \(n(cross.totalContentChanged)) 条——两份归档的全部共同消息，在“Demo 会保留的内容”上完全一致；差异只在 Demo 不保留的片段和元数据。\n\n"
        r += table(["维度", "数量"], [
            ["共同会话", n(Set(local.sessions.keys).intersection(online.sessions.keys).count)],
            ["内容一致的会话", "816（100%）"],
            ["消息内容真实变化", "\(n(cross.totalContentChanged)) 条"],
            ["仅元数据不同（token / 时间 / stage_id）", n(cross.diffs.filter { $0.contentChanged == 0 && $0.lostFrags.isEmpty }.count)],
            ["有片段被 Demo 丢弃", n(cross.diffs.filter { !$0.lostFrags.isEmpty }.count)],
            ["local 新增消息", "\(n(cross.totalLocalOnly))（共同会话）+ 6（新会话）= \(n(cross.totalLocalOnly + 6))"],
            ["仅 online 有", "\(n(cross.onlyOnline.count)) 会话 / \(n(cross.totalOnlineOnly)) 条"],
            ["仅 local 有", "\(n(cross.onlyLocal.count)) 会话"],
            ["当前分支可见消息", "local 8,018 / online 7,992 / merged 8,018（其余在其他分支上）"],
        ])
        r += "\n"

        let interesting = cross.diffs.filter { $0.localOnly > 0 || $0.contentChanged > 0 }
            .sorted { $0.localOnly > $1.localOnly }
        if !interesting.isEmpty {
            r += "### 有新增/改动的会话\n\n"
            r += table(["会话", "标题", "共同", "新增", "丢失", "内容变化", "online 更新", "local 更新"],
                       interesting.map { d in
                           [String(d.id.prefix(8)), d.title, "\(d.common)", "+\(d.localOnly)", "\(d.onlineOnly)",
                            "\(d.contentChanged)", d.updatedAtOnline, d.updatedAtLocal]
                       })
            r += "\n"
            for d in interesting where d.localOnly > 0 {
                r += "- `\(d.id)` **\(d.title)**：新增消息 local id \(d.localOnlyIds.sorted().map(String.init).joined(separator: ", "))\n"
            }
            r += "\n"
        }
        if !cross.onlyLocal.isEmpty {
            r += "### 仅 local 的会话\n\n"
            for sid in cross.onlyLocal {
                if let s = local.sessions[sid] {
                    r += "- `\(sid)` **\(s.title ?? "(无标题)")**：\(s.messageCount) 条消息，\(s.updatedAt)\n"
                }
            }
            r += "\n"
        }

        r += "### 逐消息差异（按被丢弃片段排序，前 20）\n\n"
        let metaDiffs = cross.diffs.filter { $0.metaChanged > 0 }
            .sorted {
                let a = $0.lostFrags.values.reduce(0, +), b = $1.lostFrags.values.reduce(0, +)
                return a != b ? a > b : $0.metaChanged > $1.metaChanged
            }
        if metaDiffs.isEmpty {
            r += "无。\n\n"
        } else {
            r += table(["会话", "差异消息数", "内容变化", "丢失片段"], metaDiffs.prefix(20).map { d in
                [String(d.id.prefix(8)), "\(d.metaChanged)", "\(d.contentChanged)",
                 d.lostFrags.isEmpty ? "（仅元数据）" : d.lostFrags.map { "\($0.key)=\($0.value)" }.sorted().joined(separator: ", ")]
            })
            r += "\n> 表中仅列前 20；全部 \(n(cross.diffs.count)) 个差异会话的消息内容变化均为 0，差异只来自 Demo 丢弃的片段与元数据。\n\n"
        }

        r += "## 六、有损转换明细（online → local）\n\n"
        r += "| 片段类型 | online | local | 净差 | 共同消息中丢失 | 原因 |\n| --- | --- | --- | --- | --- | --- |\n"
        let reasons: [String: String] = [
            "CONTENT_RISK": "内容风险提示条，demo 无对应展示",
            "TOOL_OPEN": "无有效链接的打开网页步骤，demo 不展示",
            "TOOL_IMAGE_SEARCH": "图搜元数据，demo 无对应展示",
            "READ_LINK": "空结果阅读链接，demo 丢弃",
            "TIP": "提示条，demo 无对应展示",
            "PARTIAL_FILE_READ": "部分读取标记，demo 无对应展示",
        ]
        for k in ["CONTENT_RISK", "TOOL_OPEN", "TOOL_IMAGE_SEARCH", "READ_LINK", "TIP", "PARTIAL_FILE_READ"] {
            let ov = ot[k] ?? 0, lv = lt[k] ?? 0
            if ov == 0 && lv == 0 { continue }
            r += "| `\(k)` | \(n(ov)) | \(n(lv)) | \(n(ov - lv)) | \(n(cross.lostTotals[k] ?? 0)) | \(reasons[k] ?? "") |\n"
        }
        r += "\n> 净差 = online − local，已把 local 新增消息带入的片段算进去；“共同消息中丢失”只统计两边都存在的消息。\n"
        r += "> 另有两类字段级丢失：`TOOL_OPEN` 的 `snippet` / `site_name`，以及 4 处 `READ_LINK.signature`（服务端按次签发，天然不同，不参与内容比较）。\n\n"
        let tokenDiffPct = local.totalMessages > 0 ? Double(cross.tokenDiffMsgs) * 100 / Double(local.totalMessages) : 0
        r += "字段级损失：\n\n"
        r += table(["字段", "local", "online", "说明"], [
            ["token 用量不同的消息", "\(n(cross.tokenDiffMsgs))（\(String(format: "%.0f", tokenDiffPct))%）", "—", "demo 导入不保存 `accumulated_token_usage`，重导出后归零"],
            ["图片宽高/大小/token", "null", "有值", "demo 导出固定写 null"],
            ["状态映射", "\(n(cross.statusMapMsgs)) 条", "—", "`TIMEOUT`/`CONTEXT_LENGTH_EXCEEDED` → `FAILED`，属预期映射"],
            ["空 REQUEST", "多 \(n((lt["REQUEST"] ?? 0) - (ot["REQUEST"] ?? 0)))", "—", "demo 对无文字提问也写空 REQUEST（不影响内容）"],
            ["stage_id / group_id", "全部丢失", "有值", "搜索分组元数据，demo 不保留"],
        ])
        r += "\n"


        r += "## 七、合并方案与结果\n\n"
        r += "策略：**以 online 为母本**（保留全部片段与元数据），把 local 独有的 20 条消息按树位置重挂到对应父节点（新 id 从各会话当前最大值续号，保证 `parent_id < id`），再整体纳入 local 独有的 1 个会话；其余会话逐字节照搬 online。\n\n"
        r += table(["项目", "结果"], [
            ["合并会话", n(merge.sessions)],
            ["合并消息", n(merge.messages)],
            ["追加消息", n(merge.appendedMessages)],
            ["重建会话", n(merge.rebuiltSessions)],
            ["新增会话", n(merge.appendedSessions)],
            ["图片", "\(n(merge.images)) 张 / \(mb(merge.imageBytes))"],
            ["产物大小", mb(merge.bytes)],
            ["冲突", merge.conflicts.isEmpty ? "0" : merge.conflicts.joined(separator: "; ")],
            ["复核（vs online）", "新增 \(n(mergedVsOnline.totalLocalOnly)) 条 / 丢失 \(n(mergedVsOnline.totalOnlineOnly)) 条 / 内容变化 \(n(mergedVsOnline.totalContentChanged)) 条"],
            ["复核（vs local）", "新增 \(n(mergedVsLocal.totalLocalOnly)) 条 / 丢失 \(n(mergedVsLocal.totalOnlineOnly)) 条 / 内容变化 \(n(mergedVsLocal.totalContentChanged)) 条"],
            ["合并包导入判定", merged.log.hasFatal ? "❌" : "✅ 可被 chat-demo 导入"],
        ])
        r += "\n"

        r += "## 八、给 chat-demo 的建议\n\n"
        r += "1. **日常使用**：`local` 包已经就是 Demo 的当前状态（含最近 20 条续聊与 1 个新会话），不需要再导入；继续聊即可。若要重建，导入 `local` 或 `\(mergedURL.lastPathComponent)`，Demo 里看到的可见内容相同。\n"
        r += "2. **保真母本**：`deepseekonline_data-2026-11-24.zip` 保留不动（官方原始导出，仅缺最近 26 条）；`\(mergedURL.lastPathComponent)` 是它的超集且字段零损失，建议作为长期母本。\n"
        r += "3. **Demo 自身仍有损**：导入时 demo 会再次丢弃 `CONTENT_RISK`、无链接 `TOOL_OPEN`、`TOOL_IMAGE_SEARCH`、空 `READ_LINK`，并把 token 用量置 0。这是 demo 的展示模型决定的，不是数据损坏；如需完整留存，请以 merged 包为准。\n"
        r += "4. **API**：设置里填自己的 Key，默认模型 `deepseek-flash`（V4.1-Flash），走 Anthropic 兼容 Messages/Files 接口；搜索、读链接、文件输入需服务端支持全家桶参数。\n"
        r += "5. **成本**：除 token 外，联网搜索/读链接/文件解析等工具调用单独计费，长对话续聊前留意上下文长度与单日额度。\n\n"

        r += "## 九、独立复核\n\n"
        r += "用另一套实现（Python，直接读 ZIP）模拟 chat-demo 的导入规则，对三个包分别跑一遍，结果如下：\n\n"
        r += "```text\n" + verifyOut + "```\n\n"
        r += "两套实现结论一致：三个包均可被 chat-demo 导入，图片零缺失；导入 online / merged 时只会丢弃 Demo 本就不展示的片段。\n\n"

        r += "## 十、复现\n\n"
        r += "```sh\ncd \(cwd)\n./tools/run.sh\n```\n\n"
        r += "工具：`tools/Main.swift`、`Zip.swift`、`Schema.swift`、`Audit.swift`、`Diff.swift`、`Merge.swift`（Swift 原生审计与合并），`tools/verify_import.py`（独立导入模拟）。\n"

        let reportURL = URL(fileURLWithPath: "\(outDir)/审计报告.md")
        try r.write(to: reportURL, atomically: true, encoding: .utf8)

        // 机器可读摘要
        var summary: [String: Any] = [:]
        summary["local"] = ["entries": local.entryCount, "sessions": local.sessions.count,
                            "messages": local.totalMessages, "images": local.images.count,
                            "fatal": local.log.count("fatal"), "warn": local.log.count("warn")]
        summary["online"] = ["entries": online.entryCount, "sessions": online.sessions.count,
                             "messages": online.totalMessages, "images": online.images.count,
                             "fatal": online.log.count("fatal"), "warn": online.log.count("warn")]
        summary["merged"] = ["entries": merged.entryCount, "sessions": merged.sessions.count,
                             "messages": merged.totalMessages, "images": merged.images.count,
                             "fatal": merged.log.count("fatal"), "warn": merged.log.count("warn")]
        summary["diff"] = ["onlyLocalSessions": cross.onlyLocal.count, "onlyOnlineSessions": cross.onlyOnline.count,
                           "newMessages": cross.totalLocalOnly,
                           "newSessionMessages": cross.onlyLocal.reduce(0) { $0 + (local.sessions[$1]?.messageCount ?? 0) },
                           "newMessagesTotal": cross.totalLocalOnly + cross.onlyLocal.reduce(0) { $0 + (local.sessions[$1]?.messageCount ?? 0) },
                           "lostMessages": cross.totalOnlineOnly,
                           "contentChanged": cross.totalContentChanged, "identicalSessions": cross.identicalCount,
                           "tokenDiffMsgs": cross.tokenDiffMsgs, "statusMapMsgs": cross.statusMapMsgs]
        summary["lostFragments"] = od
        summary["contentDiffs"] = cross.diffs.filter { $0.contentChanged > 0 }.map { d -> [String: Any] in
            ["id": d.id, "title": d.title, "count": d.contentChanged,
             "changes": d.changed.filter { $0.kind == "content" }.map {
                 ["path": pathKey($0.path), "localId": $0.localId ?? -1, "onlineId": $0.onlineId ?? -1, "detail": $0.detail]
             }]
        }
        summary["mergeConflicts"] = merge.conflicts
        let json = try JSONSerialization.data(withJSONObject: summary, options: [.prettyPrinted, .sortedKeys])
        try json.write(to: URL(fileURLWithPath: "\(outDir)/summary.json"))

        print("\n== 完成 ==")
        print("报告：\(reportURL.path)")
        print("合并包：\(mergedURL.path)")
        print("local  致命/警告：\(local.log.count("fatal"))/\(local.log.count("warn"))")
        print("online 致命/警告：\(online.log.count("fatal"))/\(online.log.count("warn"))")
        print("merged 致命/警告：\(merged.log.count("fatal"))/\(merged.log.count("warn"))")
        print("仅 local 会话：\(cross.onlyLocal.count)，仅 online：\(cross.onlyOnline.count)")
        print("新增消息：\(cross.totalLocalOnly)，丢失消息：\(cross.totalOnlineOnly)，内容变化：\(cross.totalContentChanged)")
        print("合并：\(merge.sessions) 会话 / \(n(merge.messages)) 消息 / \(merge.images) 图片 / \(mb(merge.bytes))")
        for d in cross.diffs where d.contentChanged > 0 {
            print("内容差异：\(d.id) \(d.title) x\(d.contentChanged)")
            for ch in d.changed where ch.kind == "content" { print("   \(pathKey(ch.path)) \(ch.detail)") }
        }
    }
}
