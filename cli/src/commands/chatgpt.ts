import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket, { type RawData } from 'ws';

const CHATGPT_BUNDLE_ID = 'com.openai.chat';
const CHATGPT_DISPLAY_NAME = 'ChatGPT';
const CHATGPT_PROCESS_NAME = 'ChatGPT';
const DEFAULT_CHATGPT_PORT = 9236;
const MAX_SWIFT_BUFFER = 10 * 1024 * 1024;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_CDP_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 2_000;
const ARTIFACT_LIMIT = 10;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

interface CDPTarget {
  id?: string;
  type?: string;
  url?: string;
  title?: string;
  webSocketDebuggerUrl?: string;
}

interface RuntimeEvaluateResult<T> {
  result?: {
    value?: T;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
      value?: string;
    };
  };
}

interface ConnectResult {
  client: CDPClient;
  endpoint: string;
  target: CDPTarget;
  launched: boolean;
}

interface TurnSnapshot {
  count: number;
  text: string;
  turns: Array<{
    index: number;
    role?: string;
    text: string;
  }>;
  busy: boolean;
  title: string;
  url: string;
}

interface ImageArtifact {
  index: number;
  type: 'image' | 'canvas' | 'file';
  source: string;
  mime: string;
  width?: number;
  height?: number;
  alt?: string;
  bytes?: number;
  base64?: string;
  error?: string;
  path?: string;
}

interface AxImageCandidate {
  role?: string;
  description?: string;
  title?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
}

class CDPClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  async connect(wsUrl: string, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Timed out connecting to ChatGPT CDP after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      ws.on('open', () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      });

      ws.on('message', (raw: RawData) => this.handleMessage(raw));
      ws.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      ws.on('close', () => {
        this.rejectPending(new Error('ChatGPT CDP connection closed'));
        this.ws = null;
      });
    });

    await this.send('Runtime.enable').catch(() => undefined);
    await this.send('Page.enable').catch(() => undefined);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.rejectPending(new Error('ChatGPT CDP connection closed'));
  }

  async send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_CDP_TIMEOUT_MS,
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('ChatGPT CDP connection is not open');
    }

    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string, timeoutMs = DEFAULT_CDP_TIMEOUT_MS): Promise<T> {
    const result = await this.send<RuntimeEvaluateResult<T>>(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      timeoutMs,
    );

    if (result.exceptionDetails) {
      const detail =
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.exception?.value ||
        result.exceptionDetails.text ||
        'Unknown Runtime.evaluate error';
      throw new Error(detail);
    }

    return result.result?.value as T;
  }

  async pressEnter(): Promise<void> {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
  }

  async pressNewConversationShortcut(): Promise<void> {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const modifiers = process.platform === 'darwin' ? 4 : 2;
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: modifier,
      code: modifier === 'Meta' ? 'MetaLeft' : 'ControlLeft',
      windowsVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
      nativeVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'n',
      code: 'KeyN',
      windowsVirtualKeyCode: 78,
      nativeVirtualKeyCode: 78,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'n',
      code: 'KeyN',
      windowsVirtualKeyCode: 78,
      nativeVirtualKeyCode: 78,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: modifier,
      code: modifier === 'Meta' ? 'MetaLeft' : 'ControlLeft',
      windowsVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
      nativeVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
    });
  }

  async pressPasteShortcut(): Promise<void> {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const modifiers = process.platform === 'darwin' ? 4 : 2;
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: modifier,
      code: modifier === 'Meta' ? 'MetaLeft' : 'ControlLeft',
      windowsVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
      nativeVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'v',
      code: 'KeyV',
      windowsVirtualKeyCode: 86,
      nativeVirtualKeyCode: 86,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'v',
      code: 'KeyV',
      windowsVirtualKeyCode: 86,
      nativeVirtualKeyCode: 86,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: modifier,
      code: modifier === 'Meta' ? 'MetaLeft' : 'ControlLeft',
      windowsVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
      nativeVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
    });
  }

  async setFileInputFiles(files: string[], selector = 'input[type="file"]'): Promise<void> {
    await this.send('DOM.enable').catch(() => undefined);
    const doc = await this.send<{ root?: { nodeId?: number } }>('DOM.getDocument', {
      depth: -1,
      pierce: true,
    });
    const rootNodeId = doc.root?.nodeId;
    if (!rootNodeId) throw new Error('Could not read DOM root for file upload');

    const queried = await this.send<{ nodeId?: number }>('DOM.querySelector', {
      nodeId: rootNodeId,
      selector,
    });
    if (!queried.nodeId) {
      throw new Error(`Could not find file input matching ${selector}`);
    }

    await this.send('DOM.setFileInputFiles', {
      nodeId: queried.nodeId,
      files,
    }, 60_000);
  }

  private handleMessage(raw: RawData): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (!msg.id) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(msg.error.message || 'CDP command failed'));
    } else {
      pending.resolve(msg.result);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

const AX_READ_SCRIPT = `
import Cocoa
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
    return value as AnyObject?
}

func s(_ el: AXUIElement, _ name: String) -> String? {
    if let v = attr(el, name) as? String, !v.isEmpty { return v }
    return nil
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute as String) as? [AnyObject] ?? []).map { $0 as! AXUIElement }
}

func collectLists(_ el: AXUIElement, into out: inout [AXUIElement]) {
    let role = s(el, kAXRoleAttribute as String) ?? ""
    if role == kAXListRole as String { out.append(el) }
    for c in children(el) { collectLists(c, into: &out) }
}

func collectTexts(_ el: AXUIElement, into out: inout [String]) {
    let role = s(el, kAXRoleAttribute as String) ?? ""
    if role == kAXStaticTextRole as String {
        if let text = s(el, kAXDescriptionAttribute as String), !text.isEmpty {
            out.append(text)
        }
    }
    for c in children(el) { collectTexts(c, into: &out) }
}

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.chat").first else {
    fputs("ChatGPT not running\\n", stderr)
    exit(1)
}

let axApp = AXUIElementCreateApplication(app.processIdentifier)
guard let win = attr(axApp, kAXFocusedWindowAttribute as String) as! AXUIElement? else {
    fputs("No focused ChatGPT window\\n", stderr)
    exit(1)
}

var lists: [AXUIElement] = []
collectLists(win, into: &lists)

var best: [String] = []
for list in lists {
    var texts: [String] = []
    collectTexts(list, into: &texts)
    if texts.count > best.count {
        best = texts
    }
}

let data = try! JSONSerialization.data(withJSONObject: best, options: [])
print(String(data: data, encoding: .utf8)!)
`;

const AX_SEND_SCRIPT = `
import Cocoa
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
    return value as AnyObject?
}

func s(_ el: AXUIElement, _ name: String) -> String? {
    if let v = attr(el, name) as? String { return v }
    return nil
}

func isEnabled(_ el: AXUIElement) -> Bool {
    (attr(el, kAXEnabledAttribute as String) as? Bool) ?? true
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute as String) as? [AnyObject] ?? []).map { $0 as! AXUIElement }
}

func collectEditableInputs(_ el: AXUIElement, into out: inout [AXUIElement], depth: Int = 0) {
    guard depth < 25 else { return }
    let role = s(el, kAXRoleAttribute as String) ?? ""
    if (role == kAXTextAreaRole as String || role == kAXTextFieldRole as String) && isEnabled(el) {
        out.append(el)
    }
    for c in children(el) { collectEditableInputs(c, into: &out, depth: depth + 1) }
}

func isInput(_ el: AXUIElement) -> Bool {
    let role = s(el, kAXRoleAttribute as String) ?? ""
    return role == kAXTextAreaRole as String || role == kAXTextFieldRole as String
}

func focusedInput(_ axApp: AXUIElement) -> AXUIElement? {
    guard let focused = attr(axApp, kAXFocusedUIElementAttribute as String) as! AXUIElement? else {
        return nil
    }
    return isInput(focused) && isEnabled(focused) ? focused : nil
}

func findByDescriptions(_ el: AXUIElement, _ targets: [String], depth: Int = 0) -> AXUIElement? {
    guard depth < 25 else { return nil }
    let role = s(el, kAXRoleAttribute as String) ?? ""
    let desc = s(el, kAXDescriptionAttribute as String) ?? ""
    if role == "AXButton" && targets.contains(desc) && isEnabled(el) { return el }
    for c in children(el) {
        if let found = findByDescriptions(c, targets, depth: depth + 1) { return found }
    }
    return nil
}

func press(_ el: AXUIElement) {
    AXUIElementPerformAction(el, kAXPressAction as CFString)
}

let args = CommandLine.arguments
guard args.count > 1 else {
    fputs("Missing prompt text\\n", stderr)
    exit(1)
}
let text = args[1]

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.chat").first else {
    fputs("ChatGPT not running\\n", stderr)
    exit(1)
}

let axApp = AXUIElementCreateApplication(app.processIdentifier)
guard let win = attr(axApp, kAXFocusedWindowAttribute as String) as! AXUIElement? else {
    fputs("No focused ChatGPT window\\n", stderr)
    exit(1)
}

var inputs: [AXUIElement] = []
collectEditableInputs(win, into: &inputs)
guard let input = focusedInput(axApp) ?? inputs.last else {
    fputs("Could not find editable input area\\n", stderr)
    exit(1)
}

guard AXUIElementSetAttributeValue(input, kAXValueAttribute as CFString, text as CFTypeRef) == .success else {
    fputs("Failed to set input value\\n", stderr)
    exit(1)
}

Thread.sleep(forTimeInterval: 0.2)

guard s(input, kAXValueAttribute as String) == text else {
    fputs("Failed to verify input value after AX set\\n", stderr)
    exit(1)
}

guard let sendButton = findByDescriptions(win, ["发送", "傳送", "Send"]) else {
    fputs("Could not find send button\\n", stderr)
    exit(1)
}

press(sendButton)

var submitted = false
for _ in 0..<15 {
    Thread.sleep(forTimeInterval: 0.1)
    if s(input, kAXValueAttribute as String) != text {
        submitted = true
        break
    }
}

guard submitted else {
    fputs("Prompt did not leave input after pressing send\\n", stderr)
    exit(1)
}

print("Sent")
`;

const AX_MODEL_SCRIPT = `
import Cocoa
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
    return value as AnyObject?
}

func s(_ el: AXUIElement, _ name: String) -> String? {
    if let v = attr(el, name) as? String, !v.isEmpty { return v }
    return nil
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute as String) as? [AnyObject] ?? []).map { $0 as! AXUIElement }
}

func press(_ el: AXUIElement) {
    AXUIElementPerformAction(el, kAXPressAction as CFString)
}

func findByDesc(_ el: AXUIElement, _ target: String, prefix: Bool = false, depth: Int = 0) -> AXUIElement? {
    guard depth < 20 else { return nil }
    let desc = s(el, kAXDescriptionAttribute as String) ?? ""
    if prefix ? desc.hasPrefix(target) : (desc == target) { return el }
    for c in children(el) {
        if let found = findByDesc(c, target, prefix: prefix, depth: depth + 1) { return found }
    }
    return nil
}

func findPopover(_ el: AXUIElement, depth: Int = 0) -> AXUIElement? {
    guard depth < 20 else { return nil }
    let role = s(el, kAXRoleAttribute as String) ?? ""
    if role == "AXPopover" { return el }
    for c in children(el) {
        if let found = findPopover(c, depth: depth + 1) { return found }
    }
    return nil
}

func pressEscape() {
    let src = CGEventSource(stateID: .combinedSessionState)
    if let esc = CGEvent(keyboardEventSource: src, virtualKey: 0x35, keyDown: true) { esc.post(tap: .cghidEventTap) }
    if let esc = CGEvent(keyboardEventSource: src, virtualKey: 0x35, keyDown: false) { esc.post(tap: .cghidEventTap) }
}

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.chat").first else {
    fputs("ChatGPT not running\\n", stderr); exit(1)
}
let axApp = AXUIElementCreateApplication(app.processIdentifier)
guard let win = attr(axApp, kAXFocusedWindowAttribute as String) as! AXUIElement? else {
    fputs("No focused ChatGPT window\\n", stderr); exit(1)
}

let args = CommandLine.arguments
let target = args.count > 1 ? args[1] : ""
let needsLegacy = args.count > 2 && args[2] == "legacy"

var optionsBtn: AXUIElement? = nil
if let btn = findByDesc(win, "Options") { optionsBtn = btn }
else if let btn = findByDesc(win, "选项") { optionsBtn = btn }
else if let btn = findByDesc(win, "選項") { optionsBtn = btn }
guard let options = optionsBtn else {
    fputs("Could not find Options button\\n", stderr); exit(1)
}
press(options)
Thread.sleep(forTimeInterval: 0.8)

guard let popover = findPopover(win) else {
    pressEscape()
    fputs("Popover did not appear\\n", stderr); exit(1)
}

if needsLegacy {
    guard let legacyBtn = findByDesc(popover, "Legacy models") else {
        pressEscape()
        fputs("Could not find Legacy models button\\n", stderr); exit(1)
    }
    press(legacyBtn)
    Thread.sleep(forTimeInterval: 0.8)
}

guard let modelBtn = findByDesc(popover, target, prefix: true) else {
    pressEscape()
    fputs("Could not find button starting with '\\(target)' in popover\\n", stderr); exit(1)
}
press(modelBtn)
print("Selected: \\(target)")
`;

const AX_GENERATING_SCRIPT = `
import Cocoa
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
    return value as AnyObject?
}

func s(_ el: AXUIElement, _ name: String) -> String? {
    if let v = attr(el, name) as? String, !v.isEmpty { return v }
    return nil
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute as String) as? [AnyObject] ?? []).map { $0 as! AXUIElement }
}

func window(_ axApp: AXUIElement) -> AXUIElement? {
    if let focused = attr(axApp, kAXFocusedWindowAttribute as String) as! AXUIElement? { return focused }
    if let windows = attr(axApp, kAXWindowsAttribute as String) as? [AnyObject], let first = windows.first {
        return first as! AXUIElement
    }
    return nil
}

func hasButton(_ el: AXUIElement, desc target: String, depth: Int = 0) -> Bool {
    guard depth < 15 else { return false }
    let role = s(el, kAXRoleAttribute as String) ?? ""
    let desc = s(el, kAXDescriptionAttribute as String) ?? ""
    if role == "AXButton" && desc == target { return true }
    for c in children(el) {
        if hasButton(c, desc: target, depth: depth + 1) { return true }
    }
    return false
}

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.chat").first else {
    print("false"); exit(0)
}
let axApp = AXUIElementCreateApplication(app.processIdentifier)
guard let win = window(axApp) else {
    print("false"); exit(0)
}
let targets = ["Stop generating", "停止生成"]
print(targets.contains(where: { hasButton(win, desc: $0) }) ? "true" : "false")
`;

const AX_FOCUS_INPUT_SCRIPT = `
import Cocoa
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
    return value as AnyObject?
}

func s(_ el: AXUIElement, _ name: String) -> String? {
    if let v = attr(el, name) as? String { return v }
    return nil
}

func isEnabled(_ el: AXUIElement) -> Bool {
    (attr(el, kAXEnabledAttribute as String) as? Bool) ?? true
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute as String) as? [AnyObject] ?? []).map { $0 as! AXUIElement }
}

func window(_ axApp: AXUIElement) -> AXUIElement? {
    if let focused = attr(axApp, kAXFocusedWindowAttribute as String) as! AXUIElement? { return focused }
    if let windows = attr(axApp, kAXWindowsAttribute as String) as? [AnyObject], let first = windows.first {
        return first as! AXUIElement
    }
    return nil
}

func collectEditableInputs(_ el: AXUIElement, into out: inout [AXUIElement], depth: Int = 0) {
    guard depth < 25 else { return }
    let role = s(el, kAXRoleAttribute as String) ?? ""
    if (role == kAXTextAreaRole as String || role == kAXTextFieldRole as String) && isEnabled(el) {
        out.append(el)
    }
    for c in children(el) { collectEditableInputs(c, into: &out, depth: depth + 1) }
}

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.chat").first else {
    fputs("ChatGPT not running\\n", stderr)
    exit(1)
}

let axApp = AXUIElementCreateApplication(app.processIdentifier)
guard let win = window(axApp) else {
    fputs("No ChatGPT window\\n", stderr)
    exit(1)
}

var inputs: [AXUIElement] = []
collectEditableInputs(win, into: &inputs)
guard let input = inputs.last else {
    fputs("Could not find editable input area\\n", stderr)
    exit(1)
}

AXUIElementSetAttributeValue(axApp, kAXFocusedUIElementAttribute as CFString, input)
AXUIElementPerformAction(input, kAXPressAction as CFString)
print("Focused")
`;

const AX_IMAGE_SNAPSHOT_SCRIPT = `
import Cocoa
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
    return value as AnyObject?
}

func s(_ el: AXUIElement, _ name: String) -> String? {
    if let v = attr(el, name) as? String, !v.isEmpty { return v }
    return nil
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute as String) as? [AnyObject] ?? []).map { $0 as! AXUIElement }
}

func window(_ axApp: AXUIElement) -> AXUIElement? {
    if let focused = attr(axApp, kAXFocusedWindowAttribute as String) as! AXUIElement? { return focused }
    if let windows = attr(axApp, kAXWindowsAttribute as String) as? [AnyObject], let first = windows.first {
        return first as! AXUIElement
    }
    return nil
}

func point(_ el: AXUIElement) -> CGPoint? {
    guard let value = attr(el, kAXPositionAttribute as String) else { return nil }
    var p = CGPoint.zero
    if AXValueGetValue(value as! AXValue, .cgPoint, &p) { return p }
    return nil
}

func size(_ el: AXUIElement) -> CGSize? {
    guard let value = attr(el, kAXSizeAttribute as String) else { return nil }
    var s = CGSize.zero
    if AXValueGetValue(value as! AXValue, .cgSize, &s) { return s }
    return nil
}

func collect(_ el: AXUIElement, into out: inout [[String: Any]], depth: Int = 0) {
    guard depth < 30 else { return }
    let role = s(el, kAXRoleAttribute as String) ?? ""
    let desc = s(el, kAXDescriptionAttribute as String) ?? ""
    let title = s(el, kAXTitleAttribute as String) ?? ""
    if let p = point(el), let z = size(el) {
        let area = z.width * z.height
        let label = "\\(desc) \\(title)"
        let imageLike = role == kAXImageRole as String || label.lowercased().contains("generated image") || label.lowercased().contains("image")
        if imageLike && z.width >= 80 && z.height >= 80 && area >= 6400 {
            out.append([
                "role": role,
                "description": desc,
                "title": title,
                "x": Double(p.x),
                "y": Double(p.y),
                "width": Double(z.width),
                "height": Double(z.height),
                "area": Double(area)
            ])
        }
    }
    for c in children(el) { collect(c, into: &out, depth: depth + 1) }
}

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.chat").first else {
    fputs("ChatGPT not running\\n", stderr)
    exit(1)
}

let axApp = AXUIElementCreateApplication(app.processIdentifier)
guard let win = window(axApp) else {
    fputs("No ChatGPT window\\n", stderr)
    exit(1)
}

var rows: [[String: Any]] = []
collect(win, into: &rows)
let data = try! JSONSerialization.data(withJSONObject: rows, options: [])
print(String(data: data, encoding: .utf8)!)
`;

const MODEL_MAP: Record<string, { desc: string; legacy?: boolean }> = {
  auto: { desc: 'Auto' },
  instant: { desc: 'Instant' },
  thinking: { desc: 'Thinking' },
  '5.2-instant': { desc: 'GPT-5.2 Instant', legacy: true },
  '5.2-thinking': { desc: 'GPT-5.2 Thinking', legacy: true },
};

const MODEL_CHOICES = Object.keys(MODEL_MAP);

interface ChatGPTAskOptions {
  timeout?: string;
  model?: string;
}

interface ChatGPTSendOptions {
  model?: string;
}

interface ChatGPTReadOptions {
  limit?: string;
}

interface ChatGPTImageGenerateOptions {
  timeout?: string;
  model?: string;
  size?: string;
  quality?: string;
  image?: string[];
  responseFormat?: string;
  artifactDir?: string;
  inlineArtifacts?: boolean;
  new?: boolean;
  port?: string;
  endpoint?: string;
  launch?: boolean;
  restart?: boolean;
}

export async function chatgptStatusCommand(): Promise<void> {
  ensureDarwin();
  try {
    const running = execSync(`osascript -e 'application id "${CHATGPT_BUNDLE_ID}" is running'`, {
      encoding: 'utf8',
    }).trim() === 'true';
    printJson({
      success: running,
      app: CHATGPT_DISPLAY_NAME,
      running,
      message: running ? 'ChatGPT Desktop is running.' : 'ChatGPT Desktop is not running.',
    });
  } catch (error) {
    printJson({
      success: false,
      app: CHATGPT_DISPLAY_NAME,
      running: false,
      error: getErrorMessage(error),
    });
  }
}

export async function chatgptNewCommand(): Promise<void> {
  ensureDarwin();
  activateChatGPT();
  execSync("osascript -e 'tell application \"System Events\" to keystroke \"n\" using command down'");
  printJson({ success: true, action: 'new', app: CHATGPT_DISPLAY_NAME });
}

export async function chatgptSendCommand(textArg: string, options: ChatGPTSendOptions): Promise<void> {
  ensureDarwin();
  const text = await readTextArgument(textArg);
  if (options.model) selectModel(options.model);
  activateChatGPT();
  const result = sendPrompt(text);
  printJson({
    success: true,
    action: 'send',
    app: CHATGPT_DISPLAY_NAME,
    model: options.model ?? null,
    chars: text.length,
    result,
  });
}

export async function chatgptReadCommand(options: ChatGPTReadOptions): Promise<void> {
  ensureDarwin();
  activateChatGPT(0.3);
  const limit = parseLimit(options.limit, 20);
  const messages = getVisibleChatMessages();
  const limited = messages.slice(-limit);
  printJson({
    success: true,
    action: 'read',
    app: CHATGPT_DISPLAY_NAME,
    count: messages.length,
    messages: limited,
    response: limited[limited.length - 1] ?? '',
  });
}

export async function chatgptAskCommand(textArg: string, options: ChatGPTAskOptions): Promise<void> {
  ensureDarwin();
  const text = await readTextArgument(textArg);
  const timeoutMs = parseTimeoutMs(options.timeout, 30_000);
  if (options.model) selectModel(options.model);

  activateChatGPT();
  const before = getVisibleChatMessages();
  sendPrompt(text);

  const startedAt = Date.now();
  let response = '';
  let generationStarted = false;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(2_000);
    const generating = isGenerating();
    if (generating) {
      generationStarted = true;
      continue;
    }
    if (!generationStarted && Date.now() - startedAt < 6_000) continue;

    activateChatGPT(0.2);
    const now = getVisibleChatMessages();
    const newMessages = now.slice(before.length);
    const candidate = [...newMessages].reverse().find((message) => message !== text);
    if (candidate) response = candidate;
    break;
  }

  printJson({
    success: Boolean(response),
    action: 'ask',
    app: CHATGPT_DISPLAY_NAME,
    model: options.model ?? null,
    prompt: text,
    response,
    timedOut: !response,
    timeoutMs,
  });
}

export async function chatgptImageGenerateCommand(
  promptArg: string,
  options: ChatGPTImageGenerateOptions,
): Promise<void> {
  ensureDarwin();
  const prompt = await readTextArgument(promptArg);
  const timeoutMs = parseTimeoutMs(options.timeout, 300_000);
  const responseFormat = options.responseFormat || 'path';
  if (responseFormat !== 'path' && responseFormat !== 'b64_json') {
    throw new Error('--response-format must be one of: path, b64_json');
  }
  const inlineArtifacts = options.inlineArtifacts === true || responseFormat === 'b64_json';
  if (options.model) selectModel(options.model);

  if (!options.endpoint) {
    await chatgptImageGenerateViaAx(prompt, options, timeoutMs, responseFormat, inlineArtifacts);
    return;
  }

  const connected = await connectChatGPT(options);
  try {
    if (options.new) {
      await connected.client.pressNewConversationShortcut();
      await sleep(1_000);
    }

    const before = await readConversation(connected.client, 1);
    const beforeArtifactSources = new Set(
      (await extractArtifacts(connected.client)).map((artifact) => artifact.source),
    );
    const referenceImages = await resolveImageInputs(options.image ?? [], options.artifactDir);
    const attachments = await attachComposerFiles(connected.client, referenceImages);
    if (!attachments.ok) throw new Error(attachments.error || 'Failed to attach reference image(s)');
    const text = buildImageGeneratePrompt(prompt, options.size, options.quality, referenceImages.length);
    const injected = await injectComposerText(connected.client, text);
    if (!injected.ok) throw new Error(injected.error || 'Could not find ChatGPT composer input');
    await sleep(350);
    const submit = await submitComposer(connected.client);

    const baselineIndex = before.turns[before.turns.length - 1]?.index ?? before.count;
    const response = await waitForResponse(
      connected.client,
      baselineIndex,
      timeoutMs,
      async () => (await extractArtifacts(connected.client)).some((artifact) => !beforeArtifactSources.has(artifact.source)),
    );
    const domArtifacts = filterNewArtifacts(await extractArtifacts(connected.client), beforeArtifactSources);
    const artifacts = renumberArtifacts([
      ...collectLocalImageArtifacts(response.text, inlineArtifacts),
      ...persistArtifacts(domArtifacts, options.artifactDir, inlineArtifacts),
    ]);
    const images = artifacts
      .filter((artifact) => isRasterImageMime(artifact.mime))
      .map((artifact) => imageArtifactToApiImage(artifact, responseFormat));

    printJson({
      success: images.length > 0,
      action: 'image-generate',
      app: CHATGPT_DISPLAY_NAME,
      status: images.length > 0 ? 'complete' : response.status,
      prompt,
      model: options.model ?? null,
      size: options.size || null,
      quality: options.quality || null,
      reference_images: referenceImages.length,
      response_format: responseFormat,
      response: response.text,
      submit,
      attachments,
      images,
      artifacts,
      error: images.length > 0 ? undefined : 'No raster image artifact was produced by ChatGPT Desktop.',
      target: summarizeTarget(connected.target),
    });
  } finally {
    connected.client.close();
  }
}

async function chatgptImageGenerateViaAx(
  prompt: string,
  options: ChatGPTImageGenerateOptions,
  timeoutMs: number,
  responseFormat: string,
  inlineArtifacts: boolean,
): Promise<void> {
  activateChatGPT();
  if (options.new) {
    execSync("osascript -e 'tell application \"System Events\" to keystroke \"n\" using command down'");
    await sleep(1_000);
  }

  const referenceImages = await resolveImageInputs(options.image ?? [], options.artifactDir);
  const beforeImages = getAxImageCandidates();
  const attachments = await attachFilesViaPasteboard(referenceImages);
  if (!attachments.ok) throw new Error(attachments.error || 'Failed to attach reference image(s)');
  const afterAttachmentImages = getAxImageCandidates();
  const text = buildImageGeneratePrompt(prompt, options.size, options.quality, referenceImages.length);
  sendPrompt(text);

  const response = await waitForAxImage(afterAttachmentImages, timeoutMs);
  const artifact = response.candidate
    ? captureAxImageCandidate(response.candidate, options.artifactDir, inlineArtifacts)
    : null;
  const artifacts = artifact ? renumberArtifacts([artifact]) : [];
  const images = artifacts
    .filter((item) => isRasterImageMime(item.mime))
    .map((item) => imageArtifactToApiImage(item, responseFormat));

  printJson({
    success: images.length > 0,
    action: 'image-generate',
    app: CHATGPT_DISPLAY_NAME,
    status: images.length > 0 ? 'complete' : response.status,
    prompt,
    model: options.model ?? null,
    size: options.size || null,
    quality: options.quality || null,
    reference_images: referenceImages.length,
    response_format: responseFormat,
    response: '',
    submit: { ok: true, method: 'ax-send' },
    attachments,
    images,
    artifacts,
    error: images.length > 0 ? undefined : 'No visible generated image was captured from ChatGPT Desktop.',
    capture: response.candidate ?? null,
    before_images: beforeImages.length,
  });
}

async function attachFilesViaPasteboard(
  files: string[],
): Promise<{ ok: boolean; attached: number; files: string[]; method: string; error?: string }> {
  if (!files.length) return { ok: true, attached: 0, files: [], method: 'none' };
  try {
    setClipboardFiles(files);
    focusChatGPTInput();
    execSync("osascript -e 'tell application \"System Events\" to keystroke \"v\" using command down'");
    await sleep(2_500);
    return { ok: true, attached: files.length, files, method: 'pasteboard' };
  } catch (error) {
    return { ok: false, attached: 0, files, method: 'pasteboard', error: getErrorMessage(error) };
  }
}

async function waitForAxImage(
  before: AxImageCandidate[],
  timeoutMs: number,
): Promise<{ status: 'complete' | 'timeout'; candidate?: AxImageCandidate }> {
  const beforeKeys = new Set(before.map(candidateKey));
  const deadline = Date.now() + timeoutMs;
  let generationStarted = false;
  let latest: AxImageCandidate | undefined;

  while (Date.now() < deadline) {
    await sleep(DEFAULT_POLL_MS);
    const generating = isGenerating();
    if (generating) generationStarted = true;
    const candidates = getAxImageCandidates();
    latest = pickNewImageCandidate(candidates, beforeKeys) ?? latest;
    if (latest && !generating && generationStarted) {
      return { status: 'complete', candidate: latest };
    }
    if (latest && !generating && Date.now() + 6_000 > deadline) {
      return { status: 'complete', candidate: latest };
    }
  }

  return latest ? { status: 'complete', candidate: latest } : { status: 'timeout' };
}

function pickNewImageCandidate(
  candidates: AxImageCandidate[],
  beforeKeys: Set<string>,
): AxImageCandidate | undefined {
  const fresh = candidates.filter((candidate) => !beforeKeys.has(candidateKey(candidate)));
  const pool = (fresh.length ? fresh : candidates).filter((candidate) => !isPlaceholderImageCandidate(candidate));
  return pool
    .filter((candidate) => candidate.width >= 160 && candidate.height >= 160)
    .sort((a, b) => b.area - a.area)[0];
}

function isPlaceholderImageCandidate(candidate: AxImageCandidate): boolean {
  return /creating image|generating|loading|正在|生成中/i.test(
    `${candidate.description || ''} ${candidate.title || ''}`,
  );
}

function candidateKey(candidate: AxImageCandidate): string {
  return [
    Math.round(candidate.x / 8),
    Math.round(candidate.y / 8),
    Math.round(candidate.width / 8),
    Math.round(candidate.height / 8),
    candidate.description || '',
    candidate.title || '',
  ].join(':');
}

function captureAxImageCandidate(
  candidate: AxImageCandidate,
  artifactDir: string | undefined,
  inlineArtifacts: boolean,
): ImageArtifact {
  const dir = artifactDir || join(tmpdir(), 'bnbot-chatgpt-artifacts');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `chatgpt-capture-${Date.now()}.png`);
  const rect = [
    Math.max(0, Math.floor(candidate.x)),
    Math.max(0, Math.floor(candidate.y)),
    Math.max(1, Math.ceil(candidate.width)),
    Math.max(1, Math.ceil(candidate.height)),
  ].join(',');
  execFileSync('screencapture', ['-x', '-R', rect, path], {
    stdio: 'ignore',
    timeout: 30_000,
  });
  const stat = statSync(path);
  const artifact: ImageArtifact = {
    index: 1,
    type: 'file',
    source: path,
    path,
    mime: 'image/png',
    width: Math.ceil(candidate.width),
    height: Math.ceil(candidate.height),
    bytes: stat.size,
  };
  if (inlineArtifacts && stat.size <= MAX_ARTIFACT_BYTES) {
    artifact.base64 = readFileSync(path).toString('base64');
  }
  return artifact;
}

export async function chatgptModelCommand(modelName: string | undefined): Promise<void> {
  ensureDarwin();
  if (!modelName) {
    printJson({
      success: true,
      action: 'model',
      app: CHATGPT_DISPLAY_NAME,
      choices: MODEL_CHOICES,
      note: 'Pass one model name to switch modes.',
    });
    return;
  }
  const result = selectModel(modelName);
  printJson({
    success: true,
    action: 'model',
    app: CHATGPT_DISPLAY_NAME,
    model: modelName,
    result,
  });
}

function activateChatGPT(delaySeconds = 0.5): void {
  execSync(`osascript -e 'tell application id "${CHATGPT_BUNDLE_ID}" to activate'`);
  execSync(`osascript -e 'delay ${delaySeconds}'`);
}

function selectModel(model: string): string {
  const entry = MODEL_MAP[model];
  if (!entry) {
    throw new Error(`Unknown model "${model}". Choose from: ${MODEL_CHOICES.join(', ')}`);
  }
  activateChatGPT();
  const swiftArgs = ['-', entry.desc];
  if (entry.legacy) swiftArgs.push('legacy');
  return execFileSync('swift', swiftArgs, {
    input: AX_MODEL_SCRIPT,
    encoding: 'utf8',
    maxBuffer: MAX_SWIFT_BUFFER,
  }).trim();
}

function sendPrompt(text: string): string {
  return execFileSync('swift', ['-', text], {
    input: AX_SEND_SCRIPT,
    encoding: 'utf8',
    maxBuffer: MAX_SWIFT_BUFFER,
  }).trim();
}

function isGenerating(): boolean {
  try {
    const output = execFileSync('swift', ['-'], {
      input: AX_GENERATING_SCRIPT,
      encoding: 'utf8',
      maxBuffer: MAX_SWIFT_BUFFER,
    }).trim();
    return output === 'true';
  } catch {
    return false;
  }
}

function focusChatGPTInput(): void {
  execFileSync('swift', ['-'], {
    input: AX_FOCUS_INPUT_SCRIPT,
    encoding: 'utf8',
    maxBuffer: MAX_SWIFT_BUFFER,
  });
}

function getAxImageCandidates(): AxImageCandidate[] {
  try {
    const output = execFileSync('swift', ['-'], {
      input: AX_IMAGE_SNAPSHOT_SCRIPT,
      encoding: 'utf8',
      maxBuffer: MAX_SWIFT_BUFFER,
    }).trim();
    const parsed = JSON.parse(output || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): AxImageCandidate | null => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        const x = Number(row.x);
        const y = Number(row.y);
        const width = Number(row.width);
        const height = Number(row.height);
        const area = Number(row.area);
        if (![x, y, width, height, area].every(Number.isFinite)) return null;
        return {
          role: typeof row.role === 'string' ? row.role : undefined,
          description: typeof row.description === 'string' ? row.description : undefined,
          title: typeof row.title === 'string' ? row.title : undefined,
          x,
          y,
          width,
          height,
          area,
        };
      })
      .filter((item): item is AxImageCandidate => Boolean(item));
  } catch {
    return [];
  }
}

function getVisibleChatMessages(): string[] {
  const output = execFileSync('swift', ['-'], {
    input: AX_READ_SCRIPT,
    encoding: 'utf8',
    maxBuffer: MAX_SWIFT_BUFFER,
  }).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/[\uFFFC\u200B-\u200D\uFEFF]/g, '').trim())
    .filter((item) => item.length > 0);
}

async function connectChatGPT(options: ChatGPTImageGenerateOptions): Promise<ConnectResult> {
  const { endpoint, port, launched } = await resolveEndpoint(options);
  const target = endpoint.startsWith('ws://') || endpoint.startsWith('wss://')
    ? { webSocketDebuggerUrl: endpoint, type: 'page', title: CHATGPT_DISPLAY_NAME }
    : await selectTargetFromEndpoint(endpoint);
  if (!target.webSocketDebuggerUrl) {
    throw new Error(`Selected ChatGPT target has no webSocketDebuggerUrl: ${JSON.stringify(target)}`);
  }

  const client = new CDPClient();
  await client.connect(target.webSocketDebuggerUrl);
  return { client, endpoint, target, launched };
}

async function resolveEndpoint(
  options: ChatGPTImageGenerateOptions,
): Promise<{ endpoint: string; port: number; launched: boolean }> {
  const port = parsePort(options.port);
  const endpoint = options.endpoint || `http://127.0.0.1:${port}`;

  if (options.endpoint?.startsWith('ws://') || options.endpoint?.startsWith('wss://')) {
    return { endpoint: options.endpoint, port, launched: false };
  }

  if (await probeEndpoint(endpoint, port)) {
    return { endpoint, port, launched: false };
  }

  if (options.launch === false) {
    throw new Error(`ChatGPT CDP is not listening on ${endpoint}`);
  }

  const running = isProcessRunning(CHATGPT_PROCESS_NAME);
  if (running && !options.restart) {
    throw new Error(
      `ChatGPT is running without CDP on port ${port}. Quit ChatGPT and rerun, or pass --restart to terminate and relaunch it with --remote-debugging-port=${port}.`,
    );
  }

  if (running && options.restart) {
    killProcess(CHATGPT_PROCESS_NAME);
    await waitForProcessExit(CHATGPT_PROCESS_NAME, 5_000);
  }

  await launchChatGPT(port);
  await waitForPort(port, 20_000);
  return { endpoint, port, launched: true };
}

async function selectTargetFromEndpoint(endpoint: string): Promise<CDPTarget> {
  const deadline = Date.now() + 15_000;
  let lastCount = 0;

  while (Date.now() < deadline) {
    const targets = await fetchJson<CDPTarget[]>(`${endpoint.replace(/\/$/, '')}/json`);
    lastCount = targets.length;
    const inspectable = targets.filter((target) => target.webSocketDebuggerUrl && target.type !== 'browser');
    const preferred =
      inspectable.find((target) => /chatgpt|openai/i.test(`${target.title || ''} ${target.url || ''}`)) ||
      inspectable.find((target) => target.type === 'page') ||
      inspectable[0];

    if (preferred) return preferred;
    await sleep(500);
  }

  throw new Error(`No inspectable targets returned by ${endpoint}/json after 15s (last target count: ${lastCount})`);
}

async function probeEndpoint(endpoint: string, fallbackPort: number): Promise<boolean> {
  if (endpoint.startsWith('ws://') || endpoint.startsWith('wss://')) return true;
  try {
    const url = new URL(endpoint);
    const port = Number.parseInt(url.port, 10) || fallbackPort;
    return probePort(port);
  } catch {
    return false;
  }
}

async function probePort(port: number): Promise<boolean> {
  try {
    await fetchJson<unknown[]>(`http://127.0.0.1:${port}/json`, 2_000);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson<T>(url: string, timeoutMs = 5_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

function isProcessRunning(processName: string): boolean {
  try {
    execFileSync('pgrep', ['-x', processName], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function killProcess(processName: string): void {
  try {
    execFileSync('pkill', ['-x', processName], { stdio: 'ignore' });
  } catch {
    // Already stopped.
  }
}

async function waitForProcessExit(processName: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(processName)) return;
    await sleep(250);
  }
  throw new Error(`${processName} did not exit within ${timeoutMs / 1000}s`);
}

async function launchChatGPT(port: number): Promise<void> {
  const appPath = discoverChatGPTAppPath();
  if (!appPath) throw new Error('Could not find ChatGPT.app on this machine.');

  const candidates = [
    join(appPath, 'Contents', 'MacOS', CHATGPT_PROCESS_NAME),
    join(appPath, 'Contents', 'MacOS', 'Electron'),
  ];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(`Could not find ChatGPT executable under ${appPath}/Contents/MacOS`);
  }

  const child = spawn(
    executable,
    [`--remote-debugging-port=${port}`, '--remote-allow-origins=*'],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
}

function discoverChatGPTAppPath(): string | null {
  try {
    const result = execFileSync(
      'osascript',
      ['-e', `POSIX path of (path to application "${CHATGPT_DISPLAY_NAME}")`],
      { encoding: 'utf8', timeout: 5_000, stdio: 'pipe' },
    ).trim();
    if (result) return result.replace(/\/$/, '');
  } catch {
    // Fall through to common paths.
  }

  const candidates = [
    '/Applications/ChatGPT.app',
    join(homedir(), 'Applications', 'ChatGPT.app'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(port)) return;
    await sleep(500);
  }
  throw new Error(`ChatGPT launched, but CDP did not become available on port ${port}.`);
}

async function readConversation(client: CDPClient, limit: number): Promise<TurnSnapshot> {
  return client.evaluate<TurnSnapshot>(conversationScript(limit));
}

function conversationScript(limit: number): string {
  return `
    (() => {
      const clean = (value) => String(value || '').replace(/[\\t ]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      const cleanMessage = (value) => clean(value).replace(/\\d{1,2}:\\d{2}\\s?(?:AM|PM)?$/i, '').trim();
      let turns = Array.from(document.querySelectorAll('[data-message-author-role]')).map((node, index) => {
        const role = node.getAttribute('data-message-author-role') || '';
        return { index: index + 1, role, text: cleanMessage(node.innerText || node.textContent || '') };
      }).filter((turn) => turn.text);

      if (!turns.length) {
        const unitNodes = Array.from(document.querySelectorAll('[data-content-search-unit-key], [data-turn-key]'));
        turns = unitNodes.map((node, index) => {
          const key = node.getAttribute('data-content-search-unit-key') || node.getAttribute('data-turn-key') || '';
          const role = key.includes(':assistant') ? 'assistant' : key.includes(':user') ? 'user' : '';
          return { index: index + 1, role, text: cleanMessage(node.innerText || node.textContent || '') };
        }).filter((turn) => turn.text);
      }

      if (!turns.length) {
        const container = document.querySelector('[role="log"], [data-testid="conversation"], main') || document.body;
        const text = clean(container?.innerText || container?.textContent || '');
        turns = text ? [{ index: 1, text }] : [];
      }

      const buttons = Array.from(document.querySelectorAll('button'));
      const busy = buttons.some((button) => {
        const label = clean(button.innerText || button.textContent || button.getAttribute('aria-label') || '');
        return /stop|cancel|停止|中止/i.test(label);
      });

      const selected = turns.slice(Math.max(0, turns.length - ${limit}));
      return {
        count: turns.length,
        text: selected.map((turn) => turn.text).join('\\n\\n---\\n\\n'),
        turns: selected,
        busy,
        title: document.title || '',
        url: window.location.href || ''
      };
    })()
  `;
}

async function waitForResponse(
  client: CDPClient,
  previousTurnIndex: number,
  timeoutMs: number,
  hasNewArtifact?: () => Promise<boolean>,
): Promise<{ status: 'complete' | 'timeout'; text: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  let stableSince = 0;

  while (Date.now() < deadline) {
    await sleep(DEFAULT_POLL_MS);
    const snapshot = await readConversation(client, 10);
    const responseTurn = [...snapshot.turns]
      .reverse()
      .find((turn) => turn.index > previousTurnIndex && (turn.role === 'assistant' || !turn.role));
    const text = responseTurn?.text || '';

    if (!text) {
      if (!snapshot.busy && hasNewArtifact && await hasNewArtifact()) {
        return { status: 'complete', text: '' };
      }
      continue;
    }

    if (text === lastText) stableSince += DEFAULT_POLL_MS;
    else {
      lastText = text;
      stableSince = 0;
    }

    if (!snapshot.busy && stableSince >= DEFAULT_POLL_MS) {
      return { status: 'complete', text };
    }
  }

  return { status: 'timeout', text: lastText };
}

async function extractArtifacts(client: CDPClient): Promise<ImageArtifact[]> {
  return client.evaluate<ImageArtifact[]>(artifactScript(), 60_000);
}

function artifactScript(): string {
  return `
    (async () => {
      const limit = ${ARTIFACT_LIMIT};
      const maxBytes = ${MAX_ARTIFACT_BYTES};
      const artifacts = [];
      const seen = new Set();

      const toBase64 = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const value = String(reader.result || '');
          resolve(value.includes(',') ? value.split(',')[1] : value);
        };
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });

      const add = async (item) => {
        if (artifacts.length >= limit) return;
        if (item.source && seen.has(item.source)) return;
        if (item.source) seen.add(item.source);
        artifacts.push(item);
      };

      const assistantNodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"], [data-content-search-unit-key*=":assistant"]'));
      const root = assistantNodes[assistantNodes.length - 1] || document;

      const imgNodes = Array.from(root.querySelectorAll('img')).filter((img) => {
        const rect = img.getBoundingClientRect?.();
        const width = img.naturalWidth || rect?.width || 0;
        const height = img.naturalHeight || rect?.height || 0;
        return width >= 48 && height >= 48 && img.src;
      });

      for (const img of imgNodes) {
        if (artifacts.length >= limit) break;
        const source = img.currentSrc || img.src;
        const base = {
          index: artifacts.length + 1,
          type: 'image',
          source,
          width: img.naturalWidth || undefined,
          height: img.naturalHeight || undefined,
          alt: img.alt || undefined,
          mime: 'application/octet-stream'
        };

        try {
          if (source.startsWith('data:image/')) {
            const match = source.match(/^data:([^;]+);base64,(.*)$/);
            await add({ ...base, mime: match?.[1] || 'image/png', base64: match?.[2] || '', bytes: match?.[2] ? Math.floor(match[2].length * 0.75) : undefined });
            continue;
          }

          const response = await fetch(source, { credentials: 'include' });
          const blob = await response.blob();
          if (blob.size > maxBytes) {
            await add({ ...base, mime: blob.type || base.mime, bytes: blob.size, error: 'artifact_too_large' });
            continue;
          }
          await add({
            ...base,
            mime: blob.type || response.headers.get('content-type') || base.mime,
            bytes: blob.size,
            base64: await toBase64(blob)
          });
        } catch (error) {
          await add({ ...base, error: error instanceof Error ? error.message : String(error) });
        }
      }

      const canvases = Array.from(root.querySelectorAll('canvas')).filter((canvas) => {
        const rect = canvas.getBoundingClientRect?.();
        return (canvas.width || rect?.width || 0) >= 48 && (canvas.height || rect?.height || 0) >= 48;
      });

      for (const canvas of canvases) {
        if (artifacts.length >= limit) break;
        try {
          const dataUrl = canvas.toDataURL('image/png');
          const base64 = dataUrl.split(',')[1] || '';
          await add({
            index: artifacts.length + 1,
            type: 'canvas',
            source: 'canvas',
            mime: 'image/png',
            width: canvas.width,
            height: canvas.height,
            bytes: Math.floor(base64.length * 0.75),
            base64
          });
        } catch (error) {
          await add({ index: artifacts.length + 1, type: 'canvas', source: 'canvas', mime: 'image/png', error: error instanceof Error ? error.message : String(error) });
        }
      }

      return artifacts;
    })()
  `;
}

function collectLocalImageArtifacts(text: string, inlineArtifacts = false): ImageArtifact[] {
  const paths = new Set<string>();
  const pathRegex = /(?:^|["'\s])((?:~|\/)[^"'\s]+?\.(?:png|jpe?g|webp|gif|svg))(?:$|["'\s,}])/gi;
  let match: RegExpExecArray | null;

  while ((match = pathRegex.exec(text)) !== null) {
    paths.add(match[1].replace(/^~/, homedir()));
  }

  const artifacts: ImageArtifact[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) continue;

    const artifact: ImageArtifact = {
      index: artifacts.length + 1,
      type: 'file',
      source: path,
      path,
      mime: mimeFromPath(path),
      bytes: stat.size,
    };

    if (inlineArtifacts) artifact.base64 = readFileSync(path).toString('base64');
    artifacts.push(artifact);
  }

  return artifacts;
}

function buildImageGeneratePrompt(
  prompt: string,
  size?: string,
  quality?: string,
  referenceCount = 0,
): string {
  return [
    'Generate one real raster image file (PNG/JPG/WebP), not SVG, HTML, canvas code, Python drawing, or a placeholder.',
    size ? `Target size/aspect: ${size}.` : '',
    quality ? `Rendering quality target: ${quality}.` : '',
    referenceCount > 0 ? `Use the ${referenceCount} attached reference image(s) as visual references where relevant.` : '',
    'Do not add captions, logos, or watermarks unless the user explicitly asked for them.',
    'After the image is generated, do not do extra reasoning; just leave the generated image visible in the chat.',
    '',
    `Prompt: ${prompt}`,
  ].filter(Boolean).join('\\n');
}

async function attachComposerFiles(
  client: CDPClient,
  files: string[],
): Promise<{ ok: boolean; attached: number; files: string[]; method: string; error?: string }> {
  if (!files.length) return { ok: true, attached: 0, files: [], method: 'none' };

  await revealFileInput(client).catch(() => undefined);
  await sleep(500);
  try {
    await client.setFileInputFiles(files);
    await sleep(1_500);
    return { ok: true, attached: files.length, files, method: 'DOM.setFileInputFiles' };
  } catch (error) {
    const domError = getErrorMessage(error);
    try {
      setClipboardFiles(files);
      await focusComposer(client);
      await client.pressPasteShortcut();
      await sleep(2_500);
      return { ok: true, attached: files.length, files, method: 'pasteboard', error: domError };
    } catch (pasteError) {
      return {
        ok: false,
        attached: 0,
        files,
        method: 'pasteboard',
        error: `${domError}; paste fallback failed: ${getErrorMessage(pasteError)}`,
      };
    }
  }
}

async function revealFileInput(client: CDPClient): Promise<void> {
  await client.evaluate<void>(`
    (() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      };
      if (document.querySelector('input[type="file"]')) return;
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible);
      const button = buttons.find((btn) => {
        const label = clean(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '');
        return /attach|upload|file|image|photo|添加|附件|上传|圖片|图片/i.test(label);
      });
      button?.click();
    })()
  `);
}

async function focusComposer(client: CDPClient): Promise<void> {
  const focused = await client.evaluate<{ ok: boolean; error?: string }>(`
    (() => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      };
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(visible);
      const textarea = Array.from(document.querySelectorAll('textarea')).filter(visible).pop();
      const composer = editables.length ? editables[editables.length - 1] : textarea;
      if (!composer) return { ok: false, error: 'composer_not_found' };
      composer.focus();
      return { ok: true };
    })()
  `);
  if (!focused.ok) throw new Error(focused.error || 'Could not focus composer');
}

function setClipboardFiles(files: string[]): void {
  if (process.platform !== 'darwin') {
    throw new Error('file paste fallback requires macOS');
  }
  const fileList = files
    .map((file) => `POSIX file ${JSON.stringify(file)}`)
    .join(', ');
  execFileSync('osascript', ['-e', `set the clipboard to {${fileList}}`], {
    stdio: 'ignore',
    timeout: 10_000,
  });
}

async function injectComposerText(client: CDPClient, text: string): Promise<{ ok: boolean; tag?: string; error?: string }> {
  return client.evaluate<{ ok: boolean; tag?: string; error?: string }>(`
    ((text) => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      };
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(visible);
      const textarea = Array.from(document.querySelectorAll('textarea')).filter(visible).pop();
      const composer = editables.length ? editables[editables.length - 1] : textarea;
      if (!composer) return { ok: false, error: 'composer_not_found' };

      composer.focus();
      if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') {
        const input = composer;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.value = input.value.slice(0, start) + text + input.value.slice(end);
        input.selectionStart = input.selectionEnd = start + text.length;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      } else {
        document.execCommand('insertText', false, text);
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }

      return { ok: true, tag: composer.tagName.toLowerCase() };
    })(${JSON.stringify(text)})
  `);
}

async function submitComposer(client: CDPClient): Promise<{ ok: boolean; method: string; error?: string }> {
  const clicked = await client.evaluate<{ ok: boolean; method: string; error?: string }>(`
    (() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      };
      const composer = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).filter(visible).pop();
      if (!composer) return { ok: false, method: 'dom-click', error: 'composer_not_found' };

      let root = composer;
      for (let i = 0; i < 8 && root?.parentElement; i += 1) {
        root = root.parentElement;
        const buttons = Array.from(root.querySelectorAll('button')).filter((button) => visible(button) && !button.disabled);
        if (buttons.length >= 3) break;
      }

      const buttons = Array.from((root || document).querySelectorAll('button')).filter((button) => visible(button) && !button.disabled);
      const labeled = buttons.find((button) => /send|submit|发送|提交/i.test(clean(button.innerText || button.textContent || button.getAttribute('aria-label') || button.getAttribute('title') || '')));
      const iconOnly = [...buttons].reverse().find((button) => {
        const label = clean(button.innerText || button.textContent || button.getAttribute('aria-label') || button.getAttribute('title') || '');
        return !label;
      });
      const button = labeled || iconOnly;
      if (!button) return { ok: false, method: 'dom-click', error: 'submit_button_not_found' };

      button.click();
      return { ok: true, method: 'dom-click' };
    })()
  `);

  if (clicked.ok) return clicked;
  await client.pressEnter();
  return { ok: true, method: 'enter-fallback', error: clicked.error };
}

async function resolveImageInputs(values: string[], artifactDir?: string): Promise<string[]> {
  const out: string[] = [];
  const dir = artifactDir || join(tmpdir(), 'bnbot-chatgpt-artifacts');
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed) continue;
    out.push(await resolveImageInput(trimmed, dir));
  }
  return out;
}

async function resolveImageInput(value: string, dir: string): Promise<string> {
  if (value.startsWith('data:image/')) return writeDataUrlImage(value, dir);
  if (/^https?:\/\//i.test(value)) return downloadImage(value, dir);
  const path = value.replace(/^~/, homedir());
  if (!existsSync(path)) throw new Error(`reference image not found: ${value}`);
  return path;
}

function writeDataUrlImage(value: string, dir: string): string {
  const match = value.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) throw new Error('invalid data URL reference image');
  mkdirSync(dir, { recursive: true });
  const ext = mimeToExt(match[1]);
  const path = join(dir, `chatgpt-reference-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
  writeFileSync(path, Buffer.from(match[2], 'base64'));
  return path;
}

async function downloadImage(url: string, dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to download reference image ${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const mime = response.headers.get('content-type') || 'image/png';
  if (!/^image\//i.test(mime)) throw new Error(`reference URL is not an image: ${url}`);
  const ext = mimeToExt(mime);
  const path = join(dir, `chatgpt-reference-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
  writeFileSync(path, bytes);
  return path;
}

function imageArtifactToApiImage(
  artifact: ImageArtifact,
  responseFormat: string,
): Record<string, unknown> {
  const image: Record<string, unknown> = {
    mime: artifact.mime,
    width: artifact.width,
    height: artifact.height,
    bytes: artifact.bytes,
  };
  if (artifact.path) image.path = artifact.path;
  if (responseFormat === 'b64_json' && artifact.base64) image.b64_json = artifact.base64;
  return image;
}

function isRasterImageMime(mime: string): boolean {
  return /^image\/(?:png|jpe?g|webp|gif)$/i.test(mime);
}

function persistArtifacts(
  artifacts: ImageArtifact[],
  artifactDir?: string,
  inlineArtifacts = false,
): ImageArtifact[] {
  if (!artifacts.length) return artifacts;
  const dir = artifactDir || join(tmpdir(), 'bnbot-chatgpt-artifacts');
  mkdirSync(dir, { recursive: true });

  return artifacts.map((artifact, index) => {
    const localPath = localPathFromArtifactSource(artifact.source);
    if (!artifact.base64 && localPath && existsSync(localPath)) {
      const stat = statSync(localPath);
      const fileArtifact: ImageArtifact = {
        index: artifact.index,
        type: 'file',
        source: artifact.source,
        path: localPath,
        mime: mimeFromPath(localPath),
        width: artifact.width,
        height: artifact.height,
        alt: artifact.alt,
        bytes: stat.size,
      };
      if (inlineArtifacts && stat.size <= MAX_ARTIFACT_BYTES) {
        fileArtifact.base64 = readFileSync(localPath).toString('base64');
      }
      return fileArtifact;
    }

    if (!artifact.base64) return artifact;
    const ext = mimeToExt(artifact.mime);
    const path = join(dir, `chatgpt-artifact-${Date.now()}-${index + 1}.${ext}`);
    writeFileSync(path, Buffer.from(artifact.base64, 'base64'));
    if (inlineArtifacts) return { ...artifact, path };
    const { base64: _base64, ...withoutBase64 } = artifact;
    return { ...withoutBase64, path };
  });
}

function filterNewArtifacts(artifacts: ImageArtifact[], beforeSources: Set<string>): ImageArtifact[] {
  return artifacts.filter((artifact) => !beforeSources.has(artifact.source));
}

function renumberArtifacts(artifacts: ImageArtifact[]): ImageArtifact[] {
  return artifacts.map((artifact, index) => ({ ...artifact, index: index + 1 }));
}

function summarizeTarget(target: CDPTarget): Record<string, unknown> {
  return {
    id: target.id,
    type: target.type,
    title: target.title,
    url: target.url,
  };
}

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value || String(DEFAULT_CHATGPT_PORT), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function mimeToExt(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('svg')) return 'svg';
  return 'png';
}

function mimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

function localPathFromArtifactSource(source: string): string | null {
  if (source.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(source).pathname);
    } catch {
      return null;
    }
  }
  return null;
}

async function readTextArgument(textArg: string): Promise<string> {
  if (textArg !== '-') return textArg;

  return new Promise<string>((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function parseLimit(value: string | undefined, fallback: number): number {
  const limit = Number.parseInt(value || String(fallback), 10);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid limit: ${value}`);
  }
  return limit;
}

function parseTimeoutMs(value: string | undefined, fallbackMs: number): number {
  const seconds = Number.parseInt(value || String(Math.ceil(fallbackMs / 1000)), 10);
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new Error(`Invalid timeout seconds: ${value}`);
  }
  return seconds * 1000;
}

function ensureDarwin(): void {
  if (process.platform !== 'darwin') {
    throw new Error('ChatGPT Desktop integration requires macOS Accessibility APIs.');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
