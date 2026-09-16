import Cocoa
import WebKit
import CryptoKit

// The native shell owns only the process it starts. It never stops a reused service.
final class MemoryStation: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, WKDownloadDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var statusItem: NSStatusItem!
    var inboxItem: NSMenuItem!
    var inboxTimer: Timer?
    var checkingInbox = false
    var lastInboxCount: Int?
    var inboxRequested = false
    var child: Process?
    var poll: Timer?
    var startupPolicy = StartupPolicy(began: Date())
    var connectionGeneration = 0
    var startupStage = ""
    var startupBuffer = Data()
    var startupPipe: Pipe?
    var shownSlow = false
    var preparingAccess = false
    var accessAttempt = 0
    var connected = false
    var starting = false
    var quitting = false
    var resources: URL!
    var station: URL!
    var data: URL!
    var existingDataRequired = false
    var port = 4180
    var base: URL { URL(string: "http://127.0.0.1:\(port)")! }
    var smoke = ProcessInfo.processInfo.arguments.contains("--smoke-test")
    var savedClipboard: [(NSPasteboard.PasteboardType, Data)] = []
    var smokeFile: String? { ProcessInfo.processInfo.environment["MEMORY_DESKTOP_SMOKE_RESULT"] }

    func applicationDidFinishLaunching(_ notification: Notification) {
        resources = Bundle.main.resourceURL!
        do {
            let fm = FileManager.default
            let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Project Memory")
            let settingsURL = support.appendingPathComponent("desktop.json")
            var settings: [String: String] = [:]
            if fm.fileExists(atPath: settingsURL.path) {
                let bytes = try Data(contentsOf: settingsURL)
                guard bytes.count < 16384, let parsed = try JSONSerialization.jsonObject(with: bytes) as? [String: String] else { throw CocoaError(.fileReadCorruptFile) }
                settings = parsed
            }
            station = settings["stationRoot"].map { URL(fileURLWithPath: $0) } ?? resources.appendingPathComponent("project-memory/station")
            existingDataRequired = settings["dataDirectory"] != nil
            data = settings["dataDirectory"].map { URL(fileURLWithPath: $0) } ?? support.appendingPathComponent("data")
            // Test overrides are accepted only in the explicitly selected smoke mode.
            if smoke {
                let env = ProcessInfo.processInfo.environment
                guard let dir = env["MEMORY_DESKTOP_TEST_DATA"], let testPort = Int(env["MEMORY_DESKTOP_TEST_PORT"] ?? ""), testPort > 1024 && testPort < 65536 else { throw CocoaError(.fileReadCorruptFile) }
                existingDataRequired = false
                data = URL(fileURLWithPath: dir)
                port = testPort
                station = resources.appendingPathComponent("project-memory/station")
                savedClipboard = (NSPasteboard.general.types ?? []).compactMap { type in NSPasteboard.general.data(forType: type).map { (type, $0) } }
                DispatchQueue.main.asyncAfter(deadline: .now() + 40) { if !self.quitting { self.finishSmoke(["ok": false, "error": "timeout"]) } }
            }
            guard fm.fileExists(atPath: station.appendingPathComponent("server/index.mjs").path) else { throw CocoaError(.fileNoSuchFile) }
            configureWindow()
            configureMenus()
            showWindow()
            prepareFileAccess()
        } catch {
            let alert = NSAlert()
            alert.messageText = "暂时无法打开记忆站"
            alert.informativeText = "应用组件或本机数据目录无法读取。原有文件未被修改，请检查安装位置和本机配置。"
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    func configureWindow() {
        let config = WKWebViewConfiguration()
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "memoryClipboard")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "memoryFolder")
        let clipboard = """
        (() => {
          const writeText = text => window.webkit.messageHandlers.memoryClipboard.postMessage(String(text));
          try { Object.defineProperty(navigator, 'clipboard', {value: Object.freeze({writeText}), configurable: false}); } catch (_) {}
        })();
        """
        config.userContentController.addUserScript(WKUserScript(source: clipboard, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "记忆站 · Project Memory"
        window.minSize = NSSize(width: 760, height: 560)
        window.contentView = web
        window.isReleasedWhenClosed = false
        window.center()
        window.setFrameAutosaveName("MemoryStationMain")
    }

    func configureMenus() {
        let main = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(item("关于记忆站", #selector(about), ""))
        appMenu.addItem(.separator())
        appMenu.addItem(item("退出记忆站…", #selector(quit), "q"))
        let appRoot = NSMenuItem(); appRoot.submenu = appMenu; main.addItem(appRoot)
        let edit = NSMenu(title: "编辑")
        for (title, action, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edit.addItem(NSMenuItem(title: title, action: Selector(action), keyEquivalent: key))
        }
        let editRoot = NSMenuItem(title: "编辑", action: nil, keyEquivalent: ""); editRoot.submenu = edit; main.addItem(editRoot)
        let view = NSMenu(title: "窗口")
        view.addItem(item("打开记忆站", #selector(showWindow), "0"))
        view.addItem(item("重新连接", #selector(reconnect), "r"))
        view.addItem(item("在浏览器中打开", #selector(openBrowser), ""))
        view.addItem(item("打开记忆文件夹", #selector(openData), ""))
        view.addItem(item("重新选择记忆文件夹以授权…", #selector(authorizeData), ""))
        view.addItem(item("关闭窗口，继续后台运行", #selector(hideWindow), "w"))
        let viewRoot = NSMenuItem(title: "窗口", action: nil, keyEquivalent: ""); viewRoot.submenu = view; main.addItem(viewRoot)
        NSApp.mainMenu = main
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "square.stack.3d.up", accessibilityDescription: "记忆站")
        statusItem.button?.toolTip = "记忆站 · 点击打开或管理后台服务"
        let menu = NSMenu()
        menu.addItem(item("打开记忆站", #selector(showWindow), ""))
        inboxItem = item("查看新记录", #selector(openInbox), "")
        menu.addItem(inboxItem)
        menu.addItem(item("重新连接", #selector(reconnect), ""))
        menu.addItem(item("打开记忆文件夹", #selector(openData), ""))
        menu.addItem(.separator())
        let hint = NSMenuItem(title: "关窗口后仍会接收项目记录", action: nil, keyEquivalent: ""); hint.isEnabled = false; menu.addItem(hint)
        menu.addItem(item("退出记忆站…", #selector(quit), ""))
        statusItem.menu = menu
        inboxTimer = Timer(timeInterval: 5, repeats: true) { [weak self] _ in self?.checkInbox() }
        RunLoop.main.add(inboxTimer!, forMode: .common)
    }
    func item(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let result = NSMenuItem(title: title, action: action, keyEquivalent: key); result.target = self; return result
    }
    @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc func openInbox() {
        showWindow()
        if local(web.url) { web.evaluateJavaScript("window.dispatchEvent(new Event('memory-station:open-inbox'))") }
        else { inboxRequested = true; reconnect() }
    }
    func checkInbox() {
        guard !checkingInbox, !quitting, connected else { return }
        checkingInbox = true
        var request = URLRequest(url: base.appendingPathComponent("api/overview")); request.timeoutInterval = 3
        URLSession.shared.dataTask(with: request) { [weak self] bytes, response, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.checkingInbox = false
                let object = bytes.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                if (response as? HTTPURLResponse)?.statusCode == 200, let count = object?["pendingCount"] as? Int, count >= 0 {
                    self.lastInboxCount = count
                    self.statusItem.button?.title = count > 0 ? " \(count > 99 ? "99+" : String(count))" : ""
                    self.inboxItem.title = count > 0 ? "查看 \(count) 条新记录" : "查看新记录 · 暂无新增"
                    self.statusItem.button?.toolTip = count > 0 ? "记忆站 · \(count) 条新记录待检查" : "记忆站 · 没有待检查的新记录"
                } else {
                    self.lastInboxCount = nil
                    self.statusItem.button?.title = " !"
                    self.inboxItem.title = "新记录暂时无法读取 · 点击重试"
                    self.statusItem.button?.toolTip = "记忆站 · 连接暂时不可用，请重新连接"
                }
            }
        }.resume()
    }
    @objc func hideWindow() { window.orderOut(nil) }
    @objc func openBrowser() { NSWorkspace.shared.open(base) }
    @objc func openData() { NSWorkspace.shared.open(data) }
    @objc func about() {
        let alert = NSAlert(); alert.messageText = "记忆站 0.39 · Mac 本机版"
        alert.informativeText = "在不同 AI 之间接续项目记忆。\n工作继续在原来的 AI 工具里。\n\n关窗口后继续后台运行；退出后，本应用启动的服务会停止。记忆文件保留在本机。"
        alert.runModal()
    }
    @objc func reconnect() { guard !starting, !preparingAccess else { return }; prepareFileAccess() }
    @objc func authorizeData() {
        guard !preparingAccess else { showWindow(); return }
        let panel = NSOpenPanel()
        panel.title = "允许访问现有记忆文件夹"
        panel.message = "请选择当前记忆文件夹。这里只恢复对原位置的访问，不移动资料，也不创建新的资料库。"
        panel.directoryURL = data
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.prompt = "允许使用这个文件夹"
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let selected = panel.url else { return }
            guard selected.standardizedFileURL.path == self.data.standardizedFileURL.path else {
                self.status("请选择原来的记忆文件夹", "刚才选择的位置与当前资料库不同，原资料没有移动。请重新选择记忆文件夹。")
                return
            }
            self.reconnect()
        }
    }
    func prepareFileAccess() {
        guard !preparingAccess, !quitting else { return }
        preparingAccess = true; connected = false
        accessAttempt += 1
        let attempt = accessAttempt
        status("正在检查记忆文件夹访问", "若 Mac 询问是否允许记忆站访问文件，请点击允许。你可以稍后处理，允许后会自动继续，无需重新连接。系统是否已弹窗无法由应用直接确认。")
        statusItem.button?.title = " …"
        inboxItem.title = "正在等待文件夹可读，允许后自动继续"
        let directory = data!
        let mustExist = existingDataRequired
        // Native read happens off the main thread: an unanswered OS prompt must not freeze the window.
        // Inspect only the existing directory/config, never conversations or private originals.
        DispatchQueue.global(qos: .userInitiated).async {
            let outcome = Result<Void, Error> {
                if !mustExist { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
                let entries = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
                if let config = entries.first(where: { $0.lastPathComponent == "local-tools.json" }) {
                    let handle = try FileHandle(forReadingFrom: config)
                    defer { try? handle.close() }
                    _ = try handle.read(upToCount: 1)
                }
            }
            DispatchQueue.main.async {
                guard !self.quitting, attempt == self.accessAttempt else { return }
                self.preparingAccess = false
                switch outcome {
                case .success: self.start()
                case .failure(let error):
                    let e = error as NSError
                    if e.code == NSFileReadNoPermissionError || e.code == NSFileWriteNoPermissionError || (e.domain == NSPOSIXErrorDomain && [Int(EACCES), Int(EPERM)].contains(e.code)) {
                        self.fail("需要文件夹访问权限", "文件访问被拒绝。请允许 Mac 的访问请求，或点击下方重新选择原记忆文件夹。资料位置保持不变。")
                    } else {
                        self.fail("记忆文件夹暂时无法读取", "请确认原文件夹仍可用，再重新连接。不会改用空资料库或移动记录。")
                    }
                }
            }
        }
    }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); return true }

    func status(_ title: String, _ detail: String) {
        // Text is static product copy, never server output or user content.
        web.loadHTMLString("<html lang='zh'><meta charset='utf-8'><body style='font:18px -apple-system;background:#f6f8f3;color:#263f30;padding:80px'><h1>\(title)</h1><p>\(detail)</p><p><a href='memory-station://retry' style='display:inline-block;padding:12px 20px;background:#29492e;color:white;border-radius:10px;text-decoration:none'>重新连接</a></p><p><a href='memory-station://authorize'>重新选择记忆文件夹以授权</a></p><p style='font-size:14px'>只访问已选择的记忆文件夹，不需要完整磁盘访问权限。</p></body></html>", baseURL: nil)
    }
    func start() {
        starting = true; connected = false; shownSlow = false
        connectionGeneration += 1
        startupPolicy = StartupPolicy(began: Date()); startupStage = ""
        status("正在打开记忆站", "正在连接你的本机项目记忆……")
        inspect(allowLaunch: true)
    }
    func inspect(allowLaunch: Bool, generation: Int? = nil) {
        let current = generation ?? connectionGeneration
        guard starting, !quitting, current == connectionGeneration else { return }
        var request = URLRequest(url: base.appendingPathComponent("api/health")); request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { [weak self] bytes, response, error in
            DispatchQueue.main.async {
                guard let self = self, !self.quitting, self.starting, current == self.connectionGeneration else { return }
                if let response = response as? HTTPURLResponse {
                    let object = bytes.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                    guard let resolved = realpath(self.data.path, nil) else { self.fail("记忆目录不可用", "请检查本机记忆文件夹后重试。"); return }
                    let path = String(cString: resolved)
                    free(resolved)
                    let expected = SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined()
                    guard response.statusCode == 200, object?["service"] as? String == "project-memory-station", object?["dataId"] as? String == expected else {
                        self.fail("本机连接需要处理", "这个端口正在运行另一份或旧版服务。请先关闭原记忆站启动窗口，再点重新连接。本应用不会停止其他服务。")
                        return
                    }
                    self.starting = false; self.connected = true
                    self.statusItem.button?.title = ""
                    self.checkInbox()
                    self.web.load(URLRequest(url: self.base))
                } else if allowLaunch, let error = error as? URLError, error.code == .cannotConnectToHost {
                    self.launchService()
                } else if self.startupPolicy.shouldWait(at: Date(), processRunning: self.child?.isRunning == true) {
                    if self.startupPolicy.slow(at: Date()) && !self.shownSlow {
                        self.shownSlow = true
                        self.status("仍在等待本机文件或服务", "如果 Mac 正在询问文件访问，请点击允许；应用无法直接确认系统弹窗是否出现。后台仍在运行，我们会继续等待，允许后自动连接，不会因你离开电脑而在 90 秒后停止。")
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + self.startupPolicy.delay(at: Date())) { self.inspect(allowLaunch: false, generation: current) }
                } else {
                    self.fail("启动仍未完成", "自动连接已等待 90 秒。后台没有及时就绪，原因尚未确定；原记录保持不变。请检查是否有文件访问提示，处理后重新连接。")
                }
            }
        }.resume()
    }
    func launchService() {
        if child?.isRunning == true { inspect(allowLaunch: false); return }
        let process = Process()
        process.executableURL = resources.appendingPathComponent("runtime/node")
        process.arguments = [station.appendingPathComponent("hub.mjs").path, "--no-open"]
        process.currentDirectoryURL = station
        var env = ProcessInfo.processInfo.environment
        env["MEMORY_STATION_DATA_DIR"] = data.path
        env["MEMORY_STATION_PORT"] = String(port)
        env["MEMORY_STATION_EMPTY"] = "1"
        // Finder has a minimal PATH; preserve common user-installed AI command locations.
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        env["PATH"] = [resources.appendingPathComponent("runtime").path, home + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", env["PATH"] ?? "/usr/bin:/bin"].joined(separator: ":")
        process.environment = env
        process.standardOutput = FileHandle.nullDevice
        let pipe = Pipe(); startupPipe = pipe; startupBuffer = Data()
        process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self, weak process] handle in
            let bytes = handle.availableData
            if bytes.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async { if let self = self, self.child === process { self.readStartup(bytes) } }
        }
        process.terminationHandler = { [weak self] ended in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                guard let self = self, !self.quitting, self.child === ended else { return }
                self.child = nil
                if self.connected {
                    self.fail("后台服务已停止", "已保存记忆和待检查记录仍在本机，请重新连接。")
                } else if self.startupStage == "permission_denied" || self.startupStage == "configuration_error" {
                    // The explicit category already provided an actionable message.
                } else if self.starting && self.startupPolicy.allowRestart(at: Date()) {
                    let current = self.connectionGeneration
                    self.status("正在重新启动本机服务", "上次启动未完成，正在自动重试。原有记录保持不变。")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        guard self.starting, !self.quitting, current == self.connectionGeneration else { return }
                        self.inspect(allowLaunch: true, generation: current)
                    }
                } else {
                    self.fail("后台服务未能启动", "自动重试后仍未成功。请检查本机组件或配置，再重新连接；原有记忆和待检查记录保持不变。")
                }
            }
        }
        do { try process.run(); child = process; inspect(allowLaunch: false) }
        catch { fail("启动没有完成", "应用组件无法运行，请重新安装本机版。原有记忆文件不受影响。") }
    }
    func readStartup(_ bytes: Data) {
        guard !quitting else { return }
        // Bounded, in-memory fixed-category parsing. Never retain process output.
        startupBuffer.append(bytes)
        while let newline = startupBuffer.firstIndex(of: 10) {
            let line = String(decoding: startupBuffer[..<newline].prefix(128), as: UTF8.self)
            startupBuffer.removeSubrange(...newline)
            guard line.hasPrefix("MEMORY_STATION_STARTUP:") else { continue }
            let stage = String(line.dropFirst("MEMORY_STATION_STARTUP:".count))
            guard ["reading_config", "starting_service", "ready", "permission_denied", "configuration_error", "service_error"].contains(stage) else { continue }
            if ["permission_denied", "configuration_error"].contains(startupStage) { continue }
            startupStage = stage
            if stage == "permission_denied" {
                fail("需要文件夹访问权限", "系统明确拒绝了本机文件访问。请在 Mac 的文件与文件夹权限中允许记忆站访问你选择的记忆目录，然后重新连接。不会改用空目录。")
            } else if stage == "configuration_error" {
                fail("本机工具配置需要检查", "本机工具配置无法解析。请修复配置后重新连接；记忆站不会覆盖原配置或项目记录。")
            }
        }
        if startupBuffer.count > 4096 { startupBuffer.removeAll(keepingCapacity: false) }
    }
    func fail(_ title: String, _ detail: String) {
        starting = false; connected = false; connectionGeneration += 1; status(title, detail)
        if smoke { finishSmoke(["ok": false, "error": title]) }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if !smoke {
            let alert = NSAlert(); alert.messageText = "退出记忆站？"
            alert.informativeText = child?.isRunning == true ? "本应用启动的后台服务会停止，正在运行的整理任务可能中断。只想收起窗口，请选择继续后台运行。" : "应用将退出。已在其他窗口启动的服务会继续运行，记忆文件会保留。"
            alert.addButton(withTitle: "继续后台运行"); alert.addButton(withTitle: "退出")
            if alert.runModal() == .alertFirstButtonReturn { hideWindow(); return .terminateCancel }
        }
        quitting = true
        if let process = child, process.isRunning {
            process.terminationHandler = nil
            process.terminate()
            // The hub handles SIGTERM and gracefully drains its own child after the UI exits.
            return .terminateNow
        }
        return .terminateNow
    }
    func local(_ url: URL?) -> Bool { url?.scheme == "http" && url?.host == "127.0.0.1" && url?.port == port }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, local(message.frameInfo.request.url) else { replyHandler(nil, "请求来源无效"); return }
        if message.name == "memoryFolder" {
            guard message.body as? String == "choose-project" else { replyHandler(nil, "文件夹请求无效"); return }
            let panel = NSOpenPanel()
            panel.title = "选择要接续的项目"
            panel.message = "连接文件夹位置，不会自动导入文件内容或聊天。"
            panel.prompt = "选择这个项目"
            panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
            panel.beginSheetModal(for: window) { result in replyHandler(result == .OK ? ["directory": panel.url?.path ?? ""] : [:], nil) }
            return
        }
        guard message.name == "memoryClipboard", let text = message.body as? String, text.utf8.count <= 3_000_000 else { replyHandler(nil, "复制请求无效"); return }
        NSPasteboard.general.clearContents()
        let copied = NSPasteboard.general.setString(text, forType: .string)
        replyHandler(copied, copied ? nil : "暂时无法复制")
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if webView.url?.absoluteString == "about:blank" && url.absoluteString == "memory-station://authorize" { decisionHandler(.cancel); authorizeData(); return }
        if webView.url?.absoluteString == "about:blank" && url.absoluteString == "memory-station://retry" { decisionHandler(.cancel); reconnect(); return }
        if navigationAction.shouldPerformDownload && (local(url) || url.scheme == "blob") { decisionHandler(.download); return }
        if local(url) || url.absoluteString == "about:blank" { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated && ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard local(frame.request.url) else { completionHandler(nil); return }
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = parameters.allowsMultipleSelection; panel.canChooseDirectories = parameters.allowsDirectories
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        if smoke { completionHandler(data.appendingPathComponent("native-export-check.txt")); return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.url : nil) }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        let alert = NSAlert(); alert.messageText = "文件未能导出"; alert.informativeText = "请重新尝试，或从窗口菜单在浏览器中打开后导出。"; alert.runModal()
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard local(frame.request.url) else { completionHandler(false); return }
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "确定"); alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard local(webView.url) else { return }
        checkInbox()
        if inboxRequested { inboxRequested = false; DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.openInbox() } }
        guard smoke else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            webView.callAsyncJavaScript("const health = await (await fetch('/api/health')).json(); const projects = await (await fetch('/api/projects')).json(); await navigator.clipboard.writeText('memory-desktop-isolated-check'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['native-export-check'])); link.download = 'native-export-check.txt'; link.click(); return {service:health.service,projects:projects.projects.length,text:document.body.innerText};", arguments: [:], in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    let info = value as? [String: Any] ?? [:]
                    let ok = info["service"] as? String == "project-memory-station" && (info["text"] as? String ?? "").contains("换一个 AI") && NSPasteboard.general.string(forType: .string) == "memory-desktop-isolated-check"
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        let exported = (try? String(contentsOf: self.data.appendingPathComponent("native-export-check.txt"), encoding: .utf8)) == "native-export-check"
                        self.window.orderOut(nil)
                        let background = !self.window.isVisible
                        self.showWindow()
                        self.openInbox()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                            webView.evaluateJavaScript("document.body.innerText.includes('新记录都在这里')") { value, _ in
                                let inboxOpened = value as? Bool == true
                                self.finishSmoke(["ok": ok && exported && self.lastInboxCount != nil && inboxOpened, "menuCount": self.lastInboxCount ?? -1, "menuOpensInbox": inboxOpened, "service": info["service"] ?? "", "projects": info["projects"] ?? -1, "nativeWindow": self.window.isVisible, "clipboard": ok, "export": exported, "closeAndReopen": background && self.window.isVisible])
                            }
                        }
                    }
                case .failure: self.finishSmoke(["ok": false, "error": "Native web view evaluation failed"])
                }
            }
        }
    }
    func finishSmoke(_ result: [String: Any]) {
        NSPasteboard.general.clearContents()
        for (type, bytes) in savedClipboard { NSPasteboard.general.setData(bytes, forType: type) }
        if let file = smokeFile, let bytes = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted]) { try? bytes.write(to: URL(fileURLWithPath: file)) }
        NSApp.terminate(nil)
    }
}
@main
struct MemoryStationMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = MemoryStation()
        app.setActivationPolicy(.regular)
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
