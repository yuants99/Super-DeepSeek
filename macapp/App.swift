import AppKit
import WebKit

// MARK: - App
//
// 直接以 file:// 加载 App 包内的静态构建物，不启动任何本地服务、不监听端口。
// 存储由本 App 独占的 WKWebsiteDataStore 管理（~/Library/WebKit/local.deepseek.chat），
// 与 Safari/Chrome 完全隔离。

@MainActor
final class AppWebView: WKWebView {
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        // 不重排/不筛选标准编辑项，只删掉浏览器导航与检查器入口。
        // 这样输入框右键仍有剪切/复制/粘贴，消息正文仍有复制。
        let browserTitles: Set<String> = [
            "重新载入", "Reload", "重新载入页面", "Reload Page",
            "返回", "Back", "前进", "Forward", "检查元素", "Inspect Element",
        ]
        for item in menu.items {
            let title = item.title
            let action = item.action.map(NSStringFromSelector) ?? ""
            let lower = action.lowercased()
            if browserTitles.contains(title) ||
                lower.contains("reload") ||
                lower.contains("goback") ||
                lower.contains("goforward") ||
                lower.contains("stoploading") ||
                lower.contains("inspect") {
                menu.removeItem(item)
            }
        }
        while let first = menu.items.first, first.isSeparatorItem {
            menu.removeItem(first)
        }
        while let last = menu.items.last, last.isSeparatorItem {
            menu.removeItem(last)
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate,
    WKNavigationDelegate, WKDownloadDelegate
{
    private var window: NSWindow!
    private var webView: WKWebView!
    private var webRoot: URL!
    private var pendingDownloadURL: URL?
    private var menuController: NativeMenuController?
    private var isWiping = false

    private let selftest = CommandLine.arguments.contains("--selftest")
    private let selftestDownload = CommandLine.arguments.contains("--selftest-download")
    private let isTestProcess = CommandLine.arguments.contains { $0.hasPrefix("--selftest") }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // 同一 bundle 只保留一个实例，避免两个窗口同时写一份 IndexedDB。
        let bundleId = Bundle.main.bundleIdentifier ?? ""
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
            .filter { $0 != NSRunningApplication.current }
        if let running = others.first, !isTestProcess {
            running.activate(options: [.activateAllWindows])
            NSApp.terminate(nil)
            return
        }

        buildMenu()

        guard let root = Bundle.main.resourceURL?.appendingPathComponent("web"),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path)
        else {
            fail("应用包缺少 web 资源")
            return
        }
        webRoot = root.standardizedFileURL

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.mediaTypesRequiringUserActionForPlayback = []

        webView = AppWebView(frame: .zero, configuration: config)
        menuController = NativeMenuController(webView: webView)
        if let menuController = menuController {
            menuController.onWipeAllData = { [weak self] in
                DispatchQueue.main.async { self?.performFullWipe() }
            }
            config.userContentController.add(menuController, name: "nativeMenu")
        }
        webView.uiDelegate = self
        webView.navigationDelegate = self
        // 缩放只走“显示”菜单，禁用双指捏合与浏览器式后退手势。
        webView.allowsMagnification = false
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        if #available(macOS 13.3, *) {
            webView.isInspectable = false
        }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1120, height: 780),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Super DeepSeek"
        window.minSize = NSSize(width: 760, height: 540)
        menuController?.installMenus()
        window.contentView = webView
        window.setFrameAutosaveName("MainWindow")
        window.center()

        if isTestProcess {
            let micSelector = NSSelectorFromString(
                "webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:")
            let fileSelector = NSSelectorFromString(
                "webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:")
            print("SELFTEST micSelector=\(responds(to: micSelector))")
            print("SELFTEST filePickerSelector=\(responds(to: fileSelector))")
            scheduleSelftestTimeout()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                self.menuController?.selftestMenuCommand()
            }
        } else {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }

        webView.loadFileURL(webRoot.appendingPathComponent("index.html"),
                            allowingReadAccessTo: webRoot)

    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// 全量抹除：清空所有 WebKit 来源（含旧 127.0.0.1），退出后删除数据目录、缓存与偏好。
    private func performFullWipe() {
        guard !isWiping else {
            return
        }
        isWiping = true
        webView?.stopLoading()
        var completed = false
        let complete = { [weak self] in
            guard let self = self, !completed else {
                return
            }
            completed = true
            DispatchQueue.main.async {
                self.finishWipeWithNotice()
            }
        }
        WKWebsiteDataStore.default().removeData(
            ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
            modifiedSince: .distantPast,
            completionHandler: complete
        )
        // 极端情况下 completion 不回调时，仍然进入提示。
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { complete() }
    }

    /// 数据已清除后给出明确提示，用户确认后再删除残留目录并退出。
    private func finishWipeWithNotice() {
        UserDefaults.standard.removePersistentDomain(forName: "local.deepseek.chat")
        UserDefaults.standard.synchronize()
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "所有数据已清除"
        alert.informativeText = "App 将退出。请重新打开 Super DeepSeek，接下来会从全新状态开始。"
        alert.addButton(withTitle: "退出")
        alert.runModal()
        deleteResidualData()
        scheduleCleanupAfterExit()
        NSApp.terminate(nil)
    }

    private func residualPaths() -> [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return [
            "\(home)/Library/WebKit/local.deepseek.chat",
            "\(home)/Library/Caches/local.deepseek.chat",
            "\(home)/Library/HTTPStorages/local.deepseek.chat",
            "\(home)/Library/HTTPStorages/local.deepseek.chat.binarycookies",
            "\(home)/Library/Preferences/local.deepseek.chat.plist",
            "\(home)/Library/Saved Application State/local.deepseek.chat.savedState",
            "\(home)/Library/Application Support/local.deepseek.chat",
            "\(home)/Library/Containers/local.deepseek.chat",
        ]
    }

    private func deleteResidualData() {
        for path in residualPaths() {
            try? FileManager.default.removeItem(atPath: path)
        }
    }

    private func scheduleCleanupAfterExit() {
        let quoted = residualPaths().map { "\"\($0)\"" }.joined(separator: " ")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/nohup")
        process.arguments = [
            "/bin/sh", "-c",
            "sleep 5; rm -rf \(quoted); echo done >> /tmp/ds-wipe.log",
        ]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
    }

    // MARK: 导航

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 preferences: WKWebpagePreferences,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy, WKWebpagePreferences) -> Void)
    {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download, preferences)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow, preferences)
            return
        }
        if isAppURL(url) || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
            decisionHandler(.allow, preferences)
            return
        }
        // 外部链接交给系统默认浏览器，App 内始终停留在本地页面。
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel, preferences)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void)
    {
        if !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        menuController?.reset()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        menuController?.reset()
        webView.reload()
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // 页面里的 target=_blank / window.open 一律交给系统浏览器。
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView?
    {
        if let url = navigationAction.request.url, !isAppURL(url) {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    // MARK: 文件选择

    /// WKWebView 默认不会自己弹文件选择面板；不实现这个方法时，网页里的 <input type=file> 点击没有任何反应。
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor ([URL]?) -> Void)
    {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.canCreateDirectories = false
        panel.title = "选择文件"
        if panel.runModal() == .OK {
            completionHandler(panel.urls)
        } else {
            completionHandler(nil)
        }
    }

    // MARK: 麦克风

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void)
    {
        // 只对 App 自己的 file:// 页面放行；TCC 仍会以本 App 身份向用户申请麦克风权限。
        decisionHandler(origin.protocol == "file" ? .grant : .deny)
    }

    // MARK: 下载（“导出所有历史对话”）

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping @MainActor (URL?) -> Void)
    {
        // 自动化测试：直接写到指定目录，不弹面板。
        if let dir = ProcessInfo.processInfo.environment["DS_DOWNLOAD_DIR"] {
            let url = URL(fileURLWithPath: dir, isDirectory: true)
                .appendingPathComponent(suggestedFilename)
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                     withIntermediateDirectories: true)
            pendingDownloadURL = url
            completionHandler(url)
            return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        if panel.runModal() == .OK, let url = panel.url {
            pendingDownloadURL = url
            completionHandler(url)
        } else {
            completionHandler(nil)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        if selftestDownload {
            let url = pendingDownloadURL
            let size = url.flatMap { try? Data(contentsOf: $0) }?.count ?? -1
            print("SELFTEST-DOWNLOAD ok \(url?.path ?? "?") bytes=\(size)")
            exit(0)
        }
        NSSound(named: "Glass")?.play()
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if selftestDownload {
            print("SELFTEST-DOWNLOAD failed: \(error)")
            exit(4)
        }
        let alert = NSAlert()
        alert.messageText = "导出失败"
        alert.informativeText = error.localizedDescription
        alert.runModal()
    }

    // MARK: 辅助

    private func isAppURL(_ url: URL) -> Bool {
        guard url.isFileURL else { return false }
        let path = url.standardizedFileURL.path
        return path == webRoot.path || path.hasPrefix(webRoot.path + "/")
    }

    private func fail(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Super DeepSeek 无法启动"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }

    // MARK: 自检（--selftest，仅用于构建验证）

    private func scheduleSelftestTimeout() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
            print("SELFTEST timeout")
            exit(2)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if selftestDownload {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                let script = """
                const blob = new Blob([new Uint8Array(4096)], { type: 'application/zip' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'download-probe.zip';
                document.body.appendChild(a);
                a.click();
                a.remove();
                'clicked';
                """
                webView.evaluateJavaScript(script) { _, error in
                    if let error { print("SELFTEST-DOWNLOAD click failed: \(error)"); exit(5) }
                }
            }
            return
        }

        guard selftest else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            let script = """
            const out = {
              secure: window.isSecureContext,
              origin: String(location.origin),
              href: location.href,
              mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
              text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 120)
            };
            const openDB = () => new Promise((resolve, reject) => {
              const req = indexedDB.open('__selftest__', 1);
              req.onupgradeneeded = () => req.result.createObjectStore('kv');
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
              setTimeout(() => reject(new Error('timeout')), 3000);
            });
            try {
              const db = await openDB();
              const prev = await new Promise((resolve, reject) => {
                const get = db.transaction('kv', 'readonly').objectStore('kv').get('last');
                get.onsuccess = () => resolve(get.result ?? null);
                get.onerror = () => reject(get.error);
              });
              const now = String(Date.now());
              await new Promise((resolve, reject) => {
                const tx = db.transaction('kv', 'readwrite');
                tx.objectStore('kv').put(now, 'last');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
              });
              db.close();
              out.db = 'ok';
              out.prev = prev;
              out.now = now;
            } catch (error) {
              out.db = 'error: ' + (error && error.message ? error.message : error);
            }
            return JSON.stringify(out);
            """
            webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    print("SELFTEST \(value)")
                    exit(0)
                case .failure(let error):
                    print("SELFTEST failed: \(error)")
                    exit(3)
                }
            }
        }
    }

    // MARK: 菜单

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        appItem.title = "Super DeepSeek"
        main.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "关于 Super DeepSeek",
                        action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 Super DeepSeek", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 Super DeepSeek", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "编辑")
        editItem.submenu = edit
        edit.addItem(withTitle: "撤消", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let view = NSMenu(title: "显示")
        viewItem.submenu = view
        view.addItem(withTitle: "重新载入", action: #selector(reloadPage), keyEquivalent: "r").target = self
        view.addItem(.separator())
        view.addItem(withTitle: "实际大小", action: #selector(actualSize), keyEquivalent: "0").target = self
        view.addItem(withTitle: "放大", action: #selector(zoomIn), keyEquivalent: "+").target = self
        view.addItem(withTitle: "缩小", action: #selector(zoomOut), keyEquivalent: "-").target = self

        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "窗口")
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "关闭", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }

    @objc private func reloadPage() { webView.reload() }
    @objc private func actualSize() { webView.pageZoom = 1 }
    @objc private func zoomIn() { webView.pageZoom = min(3, webView.pageZoom + 0.1) }
    @objc private func zoomOut() { webView.pageZoom = max(0.5, webView.pageZoom - 0.1) }
}

// MARK: - 入口

@main
struct DeepSeekChatApp {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
