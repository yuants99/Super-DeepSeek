import AppKit
import WebKit

/// 原生菜单与 Web 的桥：接收 Web 推送的状态，向 Web 发送白名单命令。
/// 菜单拆为「对话 / 模型 / 配置式 / 设置」，Web 仍是唯一状态源。
final class NativeMenuController: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    var onWipeAllData: (() -> Void)?
    private var ready = false
    private var pending: [[String: Any]] = []
    private var state = BridgeState()

    private var chatTopItem: NSMenuItem?
    private var modelTopItem: NSMenuItem?
    private var profilesTopItem: NSMenuItem?
    private var settingsTopItem: NSMenuItem?

    private var promptMenu = NSMenu()
    private var promptSignature = ""
    private var profilesMenu = NSMenu()
    private var profilesSignature = ""

    private var newChatItem: NSMenuItem?
    private var searchItem: NSMenuItem?
    private var compressItem: NSMenuItem?
    private var thinkingItems: [String: NSMenuItem] = [:]
    private var modelItems: [String: NSMenuItem] = [:]
    private var safetyItems: [String: NSMenuItem] = [:]
    private var sectionItems: [String: NSMenuItem] = [:]
    private var presetItems: [String: NSMenuItem] = [:]
    private var profileItems: [String: NSMenuItem] = [:]
    private var promptDefaultItem: NSMenuItem?
    private var promptEditItem: NSMenuItem?

    private struct BridgeState {
        var locale = "zh-CN"
        var thinking = false
        var effort = "high"
        var search = false
        var model = "deepseek-flash"
        var safetyEnabled = false
        var safetyLevel = "high"
        var promptId = "default"
        var presets: [(id: String, name: String)] = []
        var profiles: [(id: String, name: String)] = []
        var activeProfileId = "default"
        var hasSession = false
        var hasKey = false
        var streaming = false
        var settingsOpen = false

        static func parse(_ raw: [String: Any]) -> BridgeState {
            var value = BridgeState()
            if let locale = raw["locale"] as? String { value.locale = locale }
            if let thinking = raw["thinking"] as? Bool { value.thinking = thinking }
            if let effort = raw["thinkingEffort"] as? String { value.effort = effort }
            if let search = raw["search"] as? Bool { value.search = search }
            if let model = raw["model"] as? String { value.model = model }
            if let safety = raw["safety"] as? [String: Any] {
                if let enabled = safety["enabled"] as? Bool { value.safetyEnabled = enabled }
                if let level = safety["level"] as? String { value.safetyLevel = level }
            }
            if let promptId = raw["promptId"] as? String { value.promptId = promptId }
            if let presets = raw["presets"] as? [[String: Any]] {
                value.presets = presets.compactMap { item in
                    guard let id = item["id"] as? String, let name = item["name"] as? String else {
                        return nil
                    }
                    return (id, name)
                }
            }
            if let profiles = raw["profiles"] as? [[String: Any]] {
                value.profiles = profiles.compactMap { item in
                    guard let id = item["id"] as? String, let name = item["name"] as? String else {
                        return nil
                    }
                    return (id, name)
                }
            }
            if let activeProfileId = raw["activeProfileId"] as? String {
                value.activeProfileId = activeProfileId
            }
            if let hasSession = raw["hasSession"] as? Bool { value.hasSession = hasSession }
            if let hasKey = raw["hasKey"] as? Bool { value.hasKey = hasKey }
            if let streaming = raw["streaming"] as? Bool { value.streaming = streaming }
            if let settingsOpen = raw["settingsOpen"] as? Bool { value.settingsOpen = settingsOpen }
            return value
        }
    }

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
    }

    private var isEnglish: Bool { state.locale.hasPrefix("en") }
    private func t(_ zh: String, _ en: String) -> String { isEnglish ? en : zh }

    // MARK: - 菜单

    func installMenus() {
        guard let main = NSApp.mainMenu else { return }
        for item in [chatTopItem, modelTopItem, profilesTopItem, settingsTopItem] {
            if let item = item, main.items.contains(item) {
                main.removeItem(item)
            }
        }
        promptSignature = ""
        profilesSignature = ""

        let chatItem = NSMenuItem()
        chatItem.title = t("对话", "Chat")
        let chatMenu = NSMenu(title: chatItem.title)
        chatItem.submenu = chatMenu
        buildChatMenu(chatMenu)

        let modelItem = NSMenuItem()
        modelItem.title = t("模型", "Model")
        let modelMenu = NSMenu(title: modelItem.title)
        modelItem.submenu = modelMenu
        buildModelMenu(modelMenu)

        let profilesItem = NSMenuItem()
        profilesItem.title = t("配置式", "Profiles")
        let profileMenu = NSMenu(title: profilesItem.title)
        profilesItem.submenu = profileMenu
        profilesMenu = profileMenu
        buildProfilesMenuBase(profileMenu)

        let settingsItem = NSMenuItem()
        settingsItem.title = t("设置", "Settings")
        let settingsMenu = NSMenu(title: settingsItem.title)
        settingsItem.submenu = settingsMenu
        buildSettingsMenu(settingsMenu)

        var index = min(1, main.items.count)
        for item in [chatItem, modelItem, profilesItem, settingsItem] {
            main.insertItem(item, at: index)
            index += 1
        }
        chatTopItem = chatItem
        modelTopItem = modelItem
        profilesTopItem = profilesItem
        settingsTopItem = settingsItem

        rebuildPromptMenuIfNeeded()
        rebuildProfilesMenuIfNeeded()
        updateState()
    }

    private func buildChatMenu(_ menu: NSMenu) {
        thinkingItems.removeAll()
        newChatItem = addItem(
            menu,
            title: t("新对话", "New chat"),
            command: ["type": "newChat"],
            key: "n",
            modifiers: [.command]
        )
        menu.addItem(.separator())

        let thinkingItem = NSMenuItem(title: t("思考", "Thinking"), action: nil, keyEquivalent: "")
        let thinkingMenu = NSMenu(title: thinkingItem.title)
        thinkingItem.submenu = thinkingMenu
        menu.addItem(thinkingItem)
        let rows: [(String, String, String)] = [
            ("off", t("关闭", "Off"), "1"),
            ("low", t("低", "Low"), "2"),
            ("high", t("高", "High"), "3"),
            ("max", t("最高", "Max"), "4"),
        ]
        for (key, title, shortcut) in rows {
            var command: [String: Any] = ["type": "setThinking", "enabled": key != "off"]
            if key != "off" { command["effort"] = key }
            thinkingItems[key] = addItem(
                thinkingMenu,
                title: title,
                command: command,
                key: shortcut,
                modifiers: [.command, .option]
            )
        }

        searchItem = addItem(
            menu,
            title: t("联网搜索", "Web search"),
            command: ["type": "toggleSearch"],
            key: "l",
            modifiers: [.command, .shift]
        )

        menu.addItem(.separator())
        compressItem = addItem(
            menu,
            title: t("压缩上下文", "Compress context"),
            command: ["type": "compress"],
            key: "k",
            modifiers: [.command, .shift]
        )
        addItem(
            menu,
            title: t("导入 / 导出…", "Import / Export…"),
            command: ["type": "openSettings", "section": "data"],
            key: "",
            modifiers: []
        )
    }

    private func buildModelMenu(_ menu: NSMenu) {
        modelItems.removeAll()
        safetyItems.removeAll()
        presetItems.removeAll()

        let modelItem = NSMenuItem(title: t("模型", "Model"), action: nil, keyEquivalent: "")
        let modelMenu = NSMenu(title: modelItem.title)
        modelItem.submenu = modelMenu
        menu.addItem(modelItem)
        for (id, title) in [("deepseek-flash", "deepseek-flash"), ("deepseek-v4-pro", "deepseek-v4-pro")] {
            modelItems[id] = addItem(
                modelMenu,
                title: title,
                command: ["type": "setModel", "model": id],
                key: "",
                modifiers: []
            )
        }

        let promptItem = NSMenuItem(title: t("系统提示词", "System prompt"), action: nil, keyEquivalent: "")
        promptMenu = NSMenu(title: promptItem.title)
        promptItem.submenu = promptMenu
        menu.addItem(promptItem)

        let safetyItem = NSMenuItem(title: t("安全审核", "Safety"), action: nil, keyEquivalent: "")
        let safetyMenu = NSMenu(title: safetyItem.title)
        safetyItem.submenu = safetyMenu
        menu.addItem(safetyItem)
        for (key, title) in [("off", t("关闭", "Off")), ("low", t("低", "Low")), ("high", t("高", "High"))] {
            var command: [String: Any] = ["type": "setSafety", "enabled": key != "off"]
            if key != "off" { command["level"] = key }
            safetyItems[key] = addItem(
                safetyMenu,
                title: title,
                command: command,
                key: "",
                modifiers: []
            )
        }
    }

    private func buildProfilesMenuBase(_ menu: NSMenu) {
        menu.removeAllItems()
        profileItems.removeAll()
    }

    private func buildSettingsMenu(_ menu: NSMenu) {
        addItem(
            menu,
            title: t("打开设置…", "Open Settings…"),
            command: ["type": "openSettings", "section": "general"],
            key: ",",
            modifiers: [.command]
        )
        menu.addItem(.separator())
        sectionItems.removeAll()
        let rows: [(String, String)] = [
            ("profiles", t("配置式", "Profiles")),
            ("general", t("通用", "General")),
            ("me", t("我的", "Me")),
            ("personalization", t("个性化", "Personalization")),
            ("model", t("模型", "Model")),
            ("billing", t("计费中心", "Billing")),
            ("keys", t("API Key", "API Key")),
            ("data", t("数据管理", "Data")),
            ("about", t("关于", "About")),
        ]
        for (section, title) in rows {
            sectionItems[section] = addItem(
                menu,
                title: title,
                command: ["type": "openSettings", "section": section],
                key: "",
                modifiers: []
            )
        }
    }

    @discardableResult
    private func addItem(
        _ menu: NSMenu,
        title: String,
        command: [String: Any],
        key: String,
        modifiers: NSEvent.ModifierFlags
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: #selector(menuAction(_:)), keyEquivalent: key)
        item.target = self
        item.representedObject = command
        if !key.isEmpty {
            item.keyEquivalentModifierMask = modifiers
        }
        menu.addItem(item)
        return item
    }

    @objc private func menuAction(_ sender: NSMenuItem) {
        guard var command = sender.representedObject as? [String: Any] else { return }
        if command["type"] as? String == "toggleSearch" {
            command = ["type": "setSearch", "enabled": !state.search]
        }
        send(command)
    }

    private func send(_ command: [String: Any]) {
        guard ready, let webView = webView else {
            pending.append(command)
            return
        }
        guard
            let data = try? JSONSerialization.data(withJSONObject: command),
            let json = String(data: data, encoding: .utf8)
        else {
            return
        }
        webView.evaluateJavaScript(
            "window.__nativeBridge && window.__nativeBridge.execute(\(json))"
        ) { _, error in
            if let error = error {
                NSLog("native menu bridge: %@", error.localizedDescription)
            }
        }
    }

    // MARK: - 状态

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "nativeMenu", let body = message.body as? [String: Any] else {
            return
        }
        let type = body["type"] as? String
        if type == "wipeAllData" {
            onWipeAllData?()
            return
        }
        if type == "clipboardWrite" {
            let text = body["text"] as? String ?? ""
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(text, forType: .string)
            return
        }
        if type == "clipboardRead" {
            let id = body["id"] as? String ?? ""
            let text = NSPasteboard.general.string(forType: .string) ?? ""
            let payload: [String: Any] = ["id": id, "text": text]
            if let data = try? JSONSerialization.data(withJSONObject: payload),
               let json = String(data: data, encoding: .utf8) {
                webView?.evaluateJavaScript(
                    "window.__nativeClipboard && window.__nativeClipboard(\(json))",
                    completionHandler: nil
                )
            }
            return
        }
        if type == "fetchStatus" {
            fetchStatusFeed()
            return
        }
        if type == "ready" {
            ready = true
            for command in pending {
                send(command)
            }
            pending.removeAll()
            if CommandLine.arguments.contains(where: { $0.hasPrefix("--selftest") }) {
                let count = NSApp.mainMenu?.items.count ?? 0
                print("SELFTEST nativeBridgeReady=true menuItems=\(count)")
            }
            updateState()
        } else if type == "state", let raw = body["state"] as? [String: Any] {
            let next = BridgeState.parse(raw)
            let localeChanged = next.locale != state.locale
            state = next
            if localeChanged {
                installMenus()
            } else {
                rebuildPromptMenuIfNeeded()
                rebuildProfilesMenuIfNeeded()
                updateState()
            }
        }
    }

    private func fetchStatusFeed() {
        guard let url = URL(string: "https://status.deepseek.com/feed.rss") else {
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("application/rss+xml", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            let payload: [String: Any]
            if let data = data, let text = String(data: data, encoding: .utf8), !text.isEmpty {
                payload = ["xml": text]
            } else {
                payload = ["error": error?.localizedDescription ?? "status unavailable"]
            }
            DispatchQueue.main.async {
                guard
                    let self = self,
                    let webView = self.webView,
                    let jsonData = try? JSONSerialization.data(withJSONObject: payload),
                    let json = String(data: jsonData, encoding: .utf8)
                else {
                    return
                }
                webView.evaluateJavaScript(
                    "window.__nativeBridge && window.__nativeBridge.receiveStatus(\(json))"
                )
            }
        }.resume()
    }

    func reset() {
        ready = false
        pending.removeAll()
        updateState()
    }

    func selftestMenuCommand() {
        guard let item = searchItem, let action = item.action else {
            print("SELFTEST menuCommand=missing")
            return
        }
        let before = state.search
        NSApp.sendAction(action, to: item.target, from: item)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            self?.webView?.evaluateJavaScript("localStorage.getItem('chat-demo:search')") { value, _ in
                print("SELFTEST menuSearchBefore=\(before) after=\(value ?? "nil")")
            }
        }
    }

    private func rebuildPromptMenuIfNeeded() {
        let signature =
            "\(isEnglish)|" + state.presets.map { "\($0.id):\($0.name)" }.joined(separator: ",")
        guard signature != promptSignature else { return }
        promptSignature = signature
        promptMenu.removeAllItems()
        presetItems.removeAll()
        promptDefaultItem = addItem(
            promptMenu,
            title: t("默认", "Default"),
            command: ["type": "setPrompt", "presetId": "default"],
            key: "",
            modifiers: []
        )
        for preset in state.presets {
            presetItems[preset.id] = addItem(
                promptMenu,
                title: preset.name,
                command: ["type": "setPrompt", "presetId": preset.id],
                key: "",
                modifiers: []
            )
        }
        if !state.presets.isEmpty {
            promptMenu.addItem(.separator())
        }
        promptEditItem = addItem(
            promptMenu,
            title: t("编辑…", "Edit…"),
            command: ["type": "openSettings", "section": "model"],
            key: "",
            modifiers: []
        )
        updateState()
    }

    private func rebuildProfilesMenuIfNeeded() {
        let signature =
            "\(isEnglish)|" + state.profiles.map { "\($0.id):\($0.name)" }.joined(separator: ",")
        guard signature != profilesSignature else { return }
        profilesSignature = signature
        profilesMenu.removeAllItems()
        profileItems.removeAll()
        for profile in state.profiles {
            profileItems[profile.id] = addItem(
                profilesMenu,
                title: profile.name,
                command: ["type": "switchProfile", "id": profile.id],
                key: "",
                modifiers: []
            )
        }
        profilesMenu.addItem(.separator())
        addItem(
            profilesMenu,
            title: t("管理配置式…", "Manage profiles…"),
            command: ["type": "openSettings", "section": "profiles"],
            key: "",
            modifiers: []
        )
        addItem(
            profilesMenu,
            title: t("导入 / 导出配置式…", "Import / export profile…"),
            command: ["type": "openSettings", "section": "profiles"],
            key: "",
            modifiers: []
        )
        updateState()
    }

    private func updateState() {
        newChatItem?.isEnabled = ready
        searchItem?.isEnabled = ready
        searchItem?.state = state.search ? .on : .off
        compressItem?.isEnabled = ready && state.hasSession && state.hasKey && !state.streaming
        for (key, item) in thinkingItems {
            let active = key == "off" ? !state.thinking : state.thinking && state.effort == key
            item.state = active ? .on : .off
            item.isEnabled = ready
        }
        for (key, item) in modelItems {
            item.state = state.model == key ? .on : .off
            item.isEnabled = ready
        }
        for (key, item) in safetyItems {
            let active = key == "off" ? !state.safetyEnabled : state.safetyEnabled && state.safetyLevel == key
            item.state = active ? .on : .off
            item.isEnabled = ready
        }
        promptDefaultItem?.state = state.promptId == "default" ? .on : .off
        promptDefaultItem?.isEnabled = ready
        promptEditItem?.isEnabled = ready
        for (id, item) in presetItems {
            item.state = state.promptId == id ? .on : .off
            item.isEnabled = ready
        }
        for (id, item) in profileItems {
            item.state = state.activeProfileId == id ? .on : .off
            item.isEnabled = ready
        }
        for (_, item) in sectionItems {
            item.isEnabled = ready
        }
    }
}
