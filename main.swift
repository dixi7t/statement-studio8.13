import Cocoa
import WebKit

class DownloadBridge: NSObject, WKScriptMessageHandler, WKDownloadDelegate {
    weak var window: NSWindow?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeDownload",
              let body = message.body as? [String: Any],
              let filename = body["filename"] as? String,
              let dataUrl = body["dataUrl"] as? String else {
            return
        }

        // dataUrl format: data:<mime>;base64,<encoded>
        guard let commaIndex = dataUrl.firstIndex(of: ",") else { return }
        let base64String = String(dataUrl[dataUrl.index(after: commaIndex)...])
        guard let data = Data(base64Encoded: base64String) else { return }

        DispatchQueue.main.async { [weak self] in
            guard let self = self, let win = self.window else { return }
            let savePanel = NSSavePanel()
            savePanel.nameFieldStringValue = filename
            savePanel.canCreateDirectories = true
            savePanel.isExtensionHidden = false
            savePanel.beginSheetModal(for: win) { response in
                if response == .OK, let targetURL = savePanel.url {
                    do {
                        try data.write(to: targetURL)
                        NSWorkspace.shared.activateFileViewerSelecting([targetURL])
                    } catch {
                        let alert = NSAlert()
                        alert.messageText = "Save Failed"
                        alert.informativeText = error.localizedDescription
                        alert.alertStyle = .warning
                        alert.beginSheetModal(for: win, completionHandler: nil)
                    }
                }
            }
        }
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let savePanel = NSSavePanel()
        savePanel.nameFieldStringValue = suggestedFilename
        savePanel.canCreateDirectories = true
        if let win = window {
            savePanel.beginSheetModal(for: win) { result in
                if result == .OK {
                    completionHandler(savePanel.url)
                } else {
                    completionHandler(nil)
                }
            }
        } else {
            let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            completionHandler(downloads?.appendingPathComponent(suggestedFilename))
        }
    }
}

class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    let downloadBridge = DownloadBridge()

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMenu()
        setupWindow()
        loadApp()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func setupWindow() {
        let screenRect = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let winWidth: CGFloat = min(1360, screenRect.width * 0.9)
        let winHeight: CGFloat = min(900, screenRect.height * 0.9)
        let initialRect = NSRect(
            x: screenRect.midX - winWidth / 2,
            y: screenRect.midY - winHeight / 2,
            width: winWidth,
            height: winHeight
        )

        window = NSWindow(
            contentRect: initialRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        window.title = "Statement Studio"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 900, height: 600)
        window.backgroundColor = NSColor(red: 6/255.0, green: 9/255.0, blue: 18/255.0, alpha: 1.0)
        window.isMovableByWindowBackground = false

        downloadBridge.window = window

        // WKWebView Configuration
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        // User script to intercept blob/data downloads
        let scriptSource = """
        (function() {
            document.addEventListener('click', function(e) {
                var a = e.target.closest('a[download]');
                if (a && a.href) {
                    var href = a.getAttribute('href') || a.href;
                    if (href.indexOf('blob:') === 0 || href.indexOf('data:') === 0) {
                        e.preventDefault();
                        e.stopPropagation();
                        fetch(a.href)
                            .then(function(r) { return r.blob(); })
                            .then(function(b) {
                                var reader = new FileReader();
                                reader.onloadend = function() {
                                    window.webkit.messageHandlers.nativeDownload.postMessage({
                                        filename: a.download || 'statement_export',
                                        dataUrl: reader.result
                                    });
                                };
                                reader.readAsDataURL(b);
                            })
                            .catch(function(err) {
                                console.error('Native download intercept error:', err);
                            });
                    }
                }
            }, true);
        })();
        """
        let userScript = WKUserScript(source: scriptSource, injectionTime: .atDocumentEnd, forMainFrameOnly: false)
        config.userContentController.addUserScript(userScript)
        config.userContentController.add(downloadBridge, name: "nativeDownload")

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.underPageBackgroundColor = NSColor(red: 6/255.0, green: 9/255.0, blue: 18/255.0, alpha: 1.0)

        window.contentView?.addSubview(webView)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func loadApp() {
        if let htmlURL = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
        } else {
            // Fallback for development/local execution
            let localURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("index.html")
            webView.loadFileURL(localURL, allowingReadAccessTo: localURL.deletingLastPathComponent())
        }
    }

    // MARK: - WKUIDelegate

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let openPanel = NSOpenPanel()
        openPanel.canChooseFiles = true
        openPanel.canChooseDirectories = false
        openPanel.allowsMultipleSelection = parameters.allowsMultipleSelection
        openPanel.beginSheetModal(for: window) { result in
            if result == .OK {
                completionHandler(openPanel.urls)
            } else {
                completionHandler(nil)
            }
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Statement Studio"
        alert.informativeText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in
            completionHandler()
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Statement Studio"
        alert.informativeText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Statement Studio"
        alert.informativeText = prompt
        let inputField = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        inputField.stringValue = defaultText ?? ""
        alert.accessoryView = inputField
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { response in
            if response == .alertFirstButtonReturn {
                completionHandler(inputField.stringValue)
            } else {
                completionHandler(nil)
            }
        }
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download, preferences)
        } else {
            decisionHandler(.allow, preferences)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = downloadBridge
    }

    // MARK: - Native Menu Setup

    func setupMenu() {
        let mainMenu = NSMenu()

        // App Menu
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "About Statement Studio", action: #selector(showAbout), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Hide Statement Studio", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        let hideOthersItem = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthersItem.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthersItem)
        appMenu.addItem(NSMenuItem(title: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Quit Statement Studio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // File Menu
        let fileMenuItem = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(NSMenuItem(title: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
        fileMenuItem.submenu = fileMenu
        mainMenu.addItem(fileMenuItem)

        // Edit Menu
        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Undo", action: #selector(UndoManager.undo), keyEquivalent: "z"))
        let redoItem = NSMenuItem(title: "Redo", action: #selector(UndoManager.redo), keyEquivalent: "Z")
        editMenu.addItem(redoItem)
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        // View Menu
        let viewMenuItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(NSMenuItem(title: "Reload", action: #selector(reloadApp), keyEquivalent: "r"))
        let forceReloadItem = NSMenuItem(title: "Force Reload", action: #selector(forceReloadApp), keyEquivalent: "R")
        viewMenu.addItem(forceReloadItem)
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(NSMenuItem(title: "Actual Size", action: #selector(zoomReset), keyEquivalent: "0"))
        viewMenu.addItem(NSMenuItem(title: "Zoom In", action: #selector(zoomIn), keyEquivalent: "+"))
        viewMenu.addItem(NSMenuItem(title: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-"))
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(NSMenuItem(title: "Toggle Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f"))
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        // Window Menu
        let windowMenuItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
        windowMenu.addItem(NSMenuItem(title: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: ""))
        windowMenu.addItem(NSMenuItem.separator())
        windowMenu.addItem(NSMenuItem(title: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: ""))
        windowMenuItem.submenu = windowMenu
        mainMenu.addItem(windowMenuItem)

        // Help Menu
        let helpMenuItem = NSMenuItem()
        let helpMenu = NSMenu(title: "Help")
        helpMenu.addItem(NSMenuItem(title: "Contact Support", action: #selector(openSupport), keyEquivalent: ""))
        helpMenuItem.submenu = helpMenu
        mainMenu.addItem(helpMenuItem)

        NSApp.mainMenu = mainMenu
    }

    @objc func showAbout() {
        let alert = NSAlert()
        alert.messageText = "Statement Studio · Offline Edition"
        alert.informativeText = "Version 8.13\n\nCreated by Dixit Prajapati\nSupport: prajapati.dixit@icloud.com\n\nRuns 100% offline on your Mac."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    @objc func reloadApp() {
        webView.reload()
    }

    @objc func forceReloadApp() {
        webView.reloadFromOrigin()
    }

    @objc func zoomIn() {
        webView.pageZoom += 0.1
    }

    @objc func zoomOut() {
        if webView.pageZoom > 0.3 {
            webView.pageZoom -= 0.1
        }
    }

    @objc func zoomReset() {
        webView.pageZoom = 1.0
    }

    @objc func openSupport() {
        if let url = URL(string: "mailto:prajapati.dixit@icloud.com?subject=Statement%20Studio%20Support") {
            NSWorkspace.shared.open(url)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
