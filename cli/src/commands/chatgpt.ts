import { execFileSync, execSync, spawn } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import WebSocket, { type RawData } from 'ws';
import { stripImageWatermarks } from '../tools/watermark';

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
const CHATGPT_UI_LOCK_PATH = join(tmpdir(), 'bnbot-chatgpt-ui.lock');
const CHATGPT_UI_LOCK_STALE_MS = 600_000;
const CHATGPT_CACHE_CLAIM_LOCK_PATH = join(tmpdir(), 'bnbot-chatgpt-cache-claims.lock');
const CHATGPT_CACHE_CLAIMS_PATH = join(tmpdir(), 'bnbot-chatgpt-cache-claims.json');
const CHATGPT_CACHE_CLAIM_LOCK_STALE_MS = 120_000;
const CHATGPT_KINGFISHER_CACHE_DIR = join(
  homedir(),
  'Library/Caches/com.openai.chat/com.onevcat.Kingfisher.ImageCache/com.onevcat.Kingfisher.ImageCache.com.openai.chat',
);
const CHATGPT_CACHE_MIN_IMAGE_BYTES = 100_000;

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
  watermark_metadata_stripped?: boolean;
  watermark_metadata_error?: string;
}

interface ChatGPTCacheImage {
  name: string;
  path: string;
  mime: string;
  size: number;
  mtimeMs: number;
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

  async navigate(url: string): Promise<void> {
    await this.send('Page.navigate', { url });
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

const AX_PASTE_FILES_SCRIPT = `
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

func postKey(_ key: CGKeyCode, command: Bool = false) {
    let src = CGEventSource(stateID: .combinedSessionState)
    let flags: CGEventFlags = command ? .maskCommand : []
    if let down = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: true) {
        down.flags = flags
        down.post(tap: .cghidEventTap)
    }
    if let up = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: false) {
        up.flags = flags
        up.post(tap: .cghidEventTap)
    }
}

let paths = Array(CommandLine.arguments.dropFirst())
guard !paths.isEmpty else {
    fputs("No files to paste\\n", stderr)
    exit(1)
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

var inputs: [AXUIElement] = []
collectEditableInputs(win, into: &inputs)
guard let input = inputs.last else {
    fputs("Could not find editable input area\\n", stderr)
    exit(1)
}
AXUIElementSetAttributeValue(input, kAXFocusedAttribute as CFString, kCFBooleanTrue)
Thread.sleep(forTimeInterval: 0.2)

let pasteboard = NSPasteboard.general
pasteboard.clearContents()
let urls = paths.map { NSURL(fileURLWithPath: $0) }
guard pasteboard.writeObjects(urls) else {
    fputs("Failed to write image files to pasteboard\\n", stderr)
    exit(1)
}

postKey(0x09, command: true)
Thread.sleep(forTimeInterval: 1.2)
print("Pasted \\(paths.count)")
`;

const AX_NEW_CHAT_SCRIPT = `
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

func isEnabled(_ el: AXUIElement) -> Bool {
    (attr(el, kAXEnabledAttribute as String) as? Bool) ?? true
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute as String) as? [AnyObject] ?? []).map { $0 as! AXUIElement }
}

func findButton(_ el: AXUIElement, targets: [String], depth: Int = 0) -> AXUIElement? {
    guard depth < 25 else { return nil }
    let role = s(el, kAXRoleAttribute as String) ?? ""
    let desc = s(el, kAXDescriptionAttribute as String) ?? ""
    let title = s(el, kAXTitleAttribute as String) ?? ""
    if role == "AXButton" && isEnabled(el) {
        for target in targets {
            if desc == target || title == target { return el }
        }
    }
    for c in children(el) {
        if let found = findButton(c, targets: targets, depth: depth + 1) { return found }
    }
    return nil
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

let labels = ["New chat", "新聊天", "新增聊天", "新對話", "New Chat"]
guard let button = findButton(win, targets: labels) else {
    fputs("Could not find New chat button\\n", stderr)
    exit(1)
}
AXUIElementPerformAction(button, kAXPressAction as CFString)
Thread.sleep(forTimeInterval: 0.8)
print("New chat")
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
  startNewChatGPTConversationViaAx();
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

  // Image generation artifacts must come from real image bytes (DOM/CDP fetch,
  // data URL, canvas export, or local file). Do not use the macOS AX screenshot
  // fallback here: a screen capture is only a debug artifact, not the generated
  // image file the caller asked for.
  let connected: ConnectResult;
  try {
    connected = await connectChatGPT(options);
  } catch (error) {
    if (!shouldUseNativeChatGPTFallback(error, options)) throw error;
    await chatgptImageGenerateViaNativeCache(
      prompt,
      options,
      responseFormat,
      inlineArtifacts,
      getErrorMessage(error),
    );
    return;
  }
  try {
    const referenceImages = await resolveImageInputs(options.image ?? [], options.artifactDir);
    const prepared = await withChatGPTUiLock(async () => {
      const previousUrl = await currentChatGPTUrl(connected.client).catch(() => '');
      if (options.new) {
        await startNewChatGPTConversation(connected.client);
        await waitForChatGPTComposer(connected.client);
      }

      const before = await readConversation(connected.client, 1);
      const beforeArtifactSources = new Set(
        (await extractArtifacts(connected.client)).map((artifact) => artifact.source),
      );
      const attachments = await attachComposerFiles(connected.client, referenceImages);
      if (!attachments.ok) throw new Error(attachments.error || 'Failed to attach reference image(s)');
      const text = buildImageGeneratePrompt(prompt, options.size, options.quality, referenceImages.length);
      const injected = await injectComposerText(connected.client, text);
      if (!injected.ok) throw new Error(injected.error || 'Could not find ChatGPT composer input');
      await sleep(350);
      const submit = await submitComposer(connected.client);
      const conversationUrl = await waitForChatGPTConversationUrlAfterSubmit(connected.client, previousUrl)
        .catch(() => currentChatGPTUrl(connected.client).catch(() => previousUrl));
      return {
        before,
        beforeArtifactSources,
        attachments,
        injected,
        submit,
        conversationUrl,
      };
    }, Math.min(90_000, Math.max(30_000, timeoutMs)));

    const baselineIndex = prepared.before.turns[prepared.before.turns.length - 1]?.index ?? prepared.before.count;
    const response = await waitForChatGPTConversationResponse(
      connected.client,
      prepared.conversationUrl,
      baselineIndex,
      timeoutMs,
      prepared.beforeArtifactSources,
    );
    const persisted = renumberArtifacts([
      ...collectLocalImageArtifacts(response.text, inlineArtifacts),
      ...persistArtifacts(filterNewArtifacts(response.artifacts, prepared.beforeArtifactSources), options.artifactDir, inlineArtifacts),
    ]);
    const artifacts = await stripArtifactMetadata(persisted, inlineArtifacts);
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
      conversation_url: response.url || prepared.conversationUrl || null,
      submit: prepared.submit,
      attachments: prepared.attachments,
      composer: prepared.injected,
      watermark_removal: metadataSummary(artifacts),
      images,
      artifacts,
      error: images.length > 0 ? undefined : 'No raster image artifact was produced by ChatGPT Desktop.',
      target: summarizeTarget(connected.target),
    });
  } finally {
    connected.client.close();
  }
}

function shouldUseNativeChatGPTFallback(error: unknown, options: ChatGPTImageGenerateOptions): boolean {
  if (options.endpoint) return false;
  const message = getErrorMessage(error);
  return /without CDP|CDP is not listening|did not become available|No inspectable targets/i.test(message);
}

async function chatgptImageGenerateViaNativeCache(
  prompt: string,
  options: ChatGPTImageGenerateOptions,
  responseFormat: string,
  inlineArtifacts: boolean,
  cdpError: string,
): Promise<void> {
  const timeoutMs = parseTimeoutMs(options.timeout, 300_000);
  const referenceImages = await resolveImageInputs(options.image ?? [], options.artifactDir);
  const text = buildImageGeneratePrompt(prompt, options.size, options.quality, referenceImages.length);

  const generated = await withChatGPTUiLock(async () => {
    const beforeCache = new Set(listChatGPTCacheImages().map((image) => image.name));
    const submittedAt = Date.now();
    activateChatGPT();
    if (options.new) {
      startNewChatGPTConversationViaAx();
      await sleep(900);
    }
    let prepared: { result: string; pasted: string | null; method: string };
    if (referenceImages.length > 0) {
      const pasted = pasteFilesIntoChatGPTComposer(referenceImages);
      await sleep(1_800);
      const result = sendPrompt(text);
      prepared = { result, pasted, method: 'ax-send-with-file-paste' };
    } else {
      const result = sendPrompt(text);
      prepared = { result, pasted: null, method: 'ax-send' };
    }
    const cacheImages = await waitForNewChatGPTCacheImages(beforeCache, submittedAt, timeoutMs);
    return {
      ...prepared,
      cacheImages,
      baselineCount: beforeCache.size,
    };
  }, Math.max(90_000, timeoutMs + 120_000));

  const persisted = await persistChatGPTCacheArtifacts(generated.cacheImages, options.artifactDir, inlineArtifacts);
  const artifacts = await stripArtifactMetadata(renumberArtifacts(persisted), inlineArtifacts);
  const images = artifacts
    .filter((artifact) => isRasterImageMime(artifact.mime))
    .map((artifact) => imageArtifactToApiImage(artifact, responseFormat));

  printJson({
    success: images.length > 0,
    action: 'image-generate',
    app: CHATGPT_DISPLAY_NAME,
    status: images.length > 0 ? 'complete' : 'timeout',
    prompt,
    model: options.model ?? null,
    size: options.size || null,
    quality: options.quality || null,
    reference_images: referenceImages.length,
    response_format: responseFormat,
    response: '',
    conversation_url: null,
    submit: { ok: generated.result === 'Sent', method: generated.method, result: generated.result },
    attachments: referenceImages.length > 0
      ? { ok: Boolean(generated.pasted), attached: referenceImages.length, files: referenceImages, method: 'native-paste', result: generated.pasted }
      : { ok: true, attached: 0, files: [], method: 'none' },
    composer: { ok: true, tag: 'native-ax' },
    extraction: {
      method: 'kingfisher-cache-diff',
      cache_dir: CHATGPT_KINGFISHER_CACHE_DIR,
      cdp_fallback_reason: cdpError,
      baseline_count: generated.baselineCount,
      matched_cache_files: generated.cacheImages.length,
      concurrency: 'serialized',
      note: 'Native ChatGPT Desktop does not expose DOM/CDP image URLs in this build; the command holds the UI lock until cache extraction completes to avoid returning another request’s image. Extracted artifacts are real cached image bytes, not screenshots.',
    },
    watermark_removal: metadataSummary(artifacts),
    images,
    artifacts,
    error: images.length > 0 ? undefined : 'No new raster image artifact was found in ChatGPT Desktop cache before timeout.',
    target: { type: 'native', title: CHATGPT_DISPLAY_NAME },
  });
}

function metadataSummary(artifacts: ImageArtifact[]): Record<string, unknown> {
  const stripped = artifacts.filter((a) => a.watermark_metadata_stripped).length;
  const failed = artifacts
    .filter((a) => a.watermark_metadata_error)
    .map((a) => ({ index: a.index, error: a.watermark_metadata_error }));
  return {
    method: 'metadata-strip',
    metadata_stripped: stripped,
    total: artifacts.length,
    failed: failed.length > 0 ? failed : undefined,
  };
}

async function stripArtifactMetadata(
  artifacts: ImageArtifact[],
  inlineArtifacts: boolean,
): Promise<ImageArtifact[]> {
  const out: ImageArtifact[] = [];
  for (const artifact of artifacts) {
    if (!artifact.path || artifact.error || !isRasterImageMime(artifact.mime)) {
      out.push(artifact);
      continue;
    }
    const result = await stripImageWatermarks(artifact.path, { removeVisibleWatermark: false });
    const cleaned = readFileSync(artifact.path);
    const next: ImageArtifact = {
      ...artifact,
      bytes: cleaned.length,
      watermark_metadata_stripped: result.metadata_stripped,
    };
    if (result.error) next.watermark_metadata_error = result.error;
    if (inlineArtifacts && cleaned.length <= MAX_ARTIFACT_BYTES) {
      next.base64 = cleaned.toString('base64');
    } else if (artifact.base64) {
      next.base64 = cleaned.toString('base64');
    }
    out.push(next);
  }
  return out;
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

function startNewChatGPTConversationViaAx(): void {
  try {
    execFileSync('swift', ['-'], {
      input: AX_NEW_CHAT_SCRIPT,
      encoding: 'utf8',
      maxBuffer: MAX_SWIFT_BUFFER,
    });
  } catch {
    execSync("osascript -e 'tell application \"System Events\" to keystroke \"n\" using command down'");
  }
}

function pasteFilesIntoChatGPTComposer(files: string[]): string {
  return execFileSync('swift', ['-', ...files], {
    input: AX_PASTE_FILES_SCRIPT,
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

function listChatGPTCacheImages(): ChatGPTCacheImage[] {
  if (!existsSync(CHATGPT_KINGFISHER_CACHE_DIR)) return [];
  const out: ChatGPTCacheImage[] = [];
  for (const name of readdirSync(CHATGPT_KINGFISHER_CACHE_DIR)) {
    const path = join(CHATGPT_KINGFISHER_CACHE_DIR, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size < CHATGPT_CACHE_MIN_IMAGE_BYTES || stat.size > MAX_ARTIFACT_BYTES) {
      continue;
    }
    const mime = sniffImageMime(path);
    if (!mime || !isRasterImageMime(mime)) continue;
    out.push({ name, path, mime, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

function sniffImageMime(path: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, head.length, 0);
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
    if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (head.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

async function waitForNewChatGPTCacheImages(
  beforeNames: Set<string>,
  submittedAtMs: number,
  timeoutMs: number,
): Promise<ChatGPTCacheImage[]> {
  const deadline = Date.now() + timeoutMs;
  let lastSignature = '';
  let stableSince = 0;
  let lastCandidates: ChatGPTCacheImage[] = [];
  const minMtime = submittedAtMs - 5_000;

  while (Date.now() < deadline) {
    await sleep(DEFAULT_POLL_MS);
    const candidates = listChatGPTCacheImages()
      .filter((image) => !beforeNames.has(image.name) && image.mtimeMs >= minMtime)
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
      .slice(0, ARTIFACT_LIMIT);
    const signature = candidates.map((image) => `${image.name}:${image.size}:${Math.round(image.mtimeMs)}`).join('|');
    if (signature && signature === lastSignature) {
      stableSince += DEFAULT_POLL_MS;
    } else {
      stableSince = 0;
      lastSignature = signature;
    }
    lastCandidates = candidates;
    if (candidates.length > 0 && stableSince >= DEFAULT_POLL_MS) {
      const claimed = await claimChatGPTCacheImages(candidates, 1);
      if (claimed.length > 0) return claimed;
      lastSignature = '';
      stableSince = 0;
    }
  }

  return claimChatGPTCacheImages(lastCandidates, 1);
}

async function persistChatGPTCacheArtifacts(
  images: ChatGPTCacheImage[],
  artifactDir?: string,
  inlineArtifacts = false,
): Promise<ImageArtifact[]> {
  if (!images.length) return [];
  const dir = artifactDir || join(tmpdir(), 'bnbot-chatgpt-artifacts');
  mkdirSync(dir, { recursive: true });

  const artifacts: ImageArtifact[] = [];
  for (const image of images) {
    const ext = mimeToExt(image.mime);
    const path = join(dir, `chatgpt-desktop-cache-${Date.now()}-${artifacts.length + 1}.${ext}`);
    copyFileSync(image.path, path);
    let width: number | undefined;
    let height: number | undefined;
    try {
      const metadata = await sharp(path).metadata();
      width = metadata.width;
      height = metadata.height;
    } catch {
      // Keep the real artifact even if metadata probing fails.
    }
    const artifact: ImageArtifact = {
      index: artifacts.length + 1,
      type: 'file',
      source: `chatgpt-cache://${image.name}`,
      path,
      mime: image.mime,
      width,
      height,
      bytes: statSync(path).size,
    };
    if (inlineArtifacts && artifact.bytes && artifact.bytes <= MAX_ARTIFACT_BYTES) {
      artifact.base64 = readFileSync(path).toString('base64');
    }
    artifacts.push(artifact);
  }
  return artifacts;
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
      `ChatGPT is running without CDP on port ${port}. Image export requires real DOM/CDP image bytes; screenshot fallback is disabled. Quit ChatGPT and rerun, or pass --restart to terminate and relaunch it with --remote-debugging-port=${port}.`,
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

async function withChatGPTUiLock<T>(fn: () => Promise<T>, timeoutMs = 90_000): Promise<T> {
  const fd = await acquireChatGPTUiLock(timeoutMs);
  try {
    return await fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(CHATGPT_UI_LOCK_PATH);
    } catch {
      // Another process may have already removed a stale lock.
    }
  }
}

async function acquireChatGPTUiLock(timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const fd = openSync(CHATGPT_UI_LOCK_PATH, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return fd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (isChatGPTUiLockStale()) {
        try { unlinkSync(CHATGPT_UI_LOCK_PATH); } catch { /* ignore */ }
        continue;
      }
      await sleep(250);
    }
  }
  throw new Error(`Timed out waiting for ChatGPT UI lock after ${timeoutMs / 1000}s`);
}

function isChatGPTUiLockStale(): boolean {
  try {
    return Date.now() - statSync(CHATGPT_UI_LOCK_PATH).mtimeMs > CHATGPT_UI_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

async function withChatGPTCacheClaimLock<T>(fn: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  const fd = await acquireFileLock(
    CHATGPT_CACHE_CLAIM_LOCK_PATH,
    CHATGPT_CACHE_CLAIM_LOCK_STALE_MS,
    timeoutMs,
    'ChatGPT cache claim',
  );
  try {
    return await fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(CHATGPT_CACHE_CLAIM_LOCK_PATH);
    } catch {
      // Another process may have already removed a stale lock.
    }
  }
}

async function acquireFileLock(
  lockPath: string,
  staleMs: number,
  timeoutMs: number,
  label: string,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return fd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let stale = true;
      try {
        stale = Date.now() - statSync(lockPath).mtimeMs > staleMs;
      } catch {
        stale = true;
      }
      if (stale) {
        try { unlinkSync(lockPath); } catch { /* ignore */ }
        continue;
      }
      await sleep(100);
    }
  }
  throw new Error(`Timed out waiting for ${label} lock after ${timeoutMs / 1000}s`);
}

async function claimChatGPTCacheImages(
  candidates: ChatGPTCacheImage[],
  limit: number,
): Promise<ChatGPTCacheImage[]> {
  if (!candidates.length) return [];
  return withChatGPTCacheClaimLock(async () => {
    const claimed = readChatGPTCacheClaims();
    const chosen = candidates.filter((image) => !claimed.has(image.name)).slice(0, limit);
    if (!chosen.length) return [];
    for (const image of chosen) claimed.add(image.name);
    writeChatGPTCacheClaims(claimed);
    return chosen;
  });
}

function readChatGPTCacheClaims(): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(CHATGPT_CACHE_CLAIMS_PATH, 'utf8')) as { claimed?: unknown };
    if (!Array.isArray(parsed.claimed)) return new Set();
    return new Set(parsed.claimed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set();
  }
}

function writeChatGPTCacheClaims(claimed: Set<string>): void {
  const values = [...claimed].slice(-1_000);
  writeFileSync(CHATGPT_CACHE_CLAIMS_PATH, JSON.stringify({
    updatedAt: new Date().toISOString(),
    claimed: values,
  }, null, 2));
}

async function currentChatGPTUrl(client: CDPClient): Promise<string> {
  return client.evaluate<string>('window.location.href || ""');
}

async function startNewChatGPTConversation(client: CDPClient): Promise<{ ok: boolean; method: string; label?: string; error?: string }> {
  const clicked = await client.evaluate<{ ok: boolean; method: string; label?: string; error?: string }>(`
    (() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      };
      const controls = Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(visible);
      const button = controls.find((control) => {
        const label = clean(control.innerText || control.textContent || control.getAttribute('aria-label') || control.getAttribute('title') || '');
        return /^(new chat|新聊天)$/i.test(label) || /new chat|新聊天|start new/i.test(label);
      });
      if (!button) return { ok: false, method: 'dom-click', error: 'new_chat_button_not_found' };
      const label = clean(button.getAttribute('aria-label') || button.innerText || button.textContent || '');
      button.click();
      return { ok: true, method: 'dom-click', label };
    })()
  `);
  if (clicked.ok) {
    await sleep(750);
    return clicked;
  }

  await client.pressNewConversationShortcut();
  await sleep(750);
  return { ok: true, method: 'shortcut', error: clicked.error };
}

async function waitForChatGPTComposer(client: CDPClient, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate<{ ok: boolean }>(`
      (() => {
        const visible = (el) => {
          const rect = el.getBoundingClientRect?.();
          return !!rect && rect.width > 0 && rect.height > 0;
        };
        return {
          ok: Array.from(document.querySelectorAll('[contenteditable="true"], .ProseMirror, textarea')).some(visible)
        };
      })()
    `).catch(() => ({ ok: false }));
    if (ready.ok) return;
    await sleep(300);
  }
  throw new Error('ChatGPT composer did not become ready before timeout');
}

async function waitForChatGPTConversationUrlAfterSubmit(
  client: CDPClient,
  previousUrl: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = '';
  while (Date.now() < deadline) {
    lastUrl = await currentChatGPTUrl(client).catch(() => '');
    if (lastUrl && lastUrl !== previousUrl && /\/c\//.test(lastUrl)) return lastUrl;
    if (lastUrl && !previousUrl && /\/c\//.test(lastUrl)) return lastUrl;
    await sleep(300);
  }
  return lastUrl || previousUrl;
}

async function waitForChatGPTDocumentReady(client: CDPClient, timeoutMs = 10_000): Promise<void> {
  await client.evaluate<void>(`
    new Promise((resolve) => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, ${timeoutMs});
      window.addEventListener('DOMContentLoaded', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    })
  `, timeoutMs + 1_000).catch(() => undefined);
}

async function activateChatGPTConversation(client: CDPClient, conversationUrl: string): Promise<string> {
  if (!conversationUrl || !/^https?:\/\//i.test(conversationUrl)) {
    return currentChatGPTUrl(client).catch(() => '');
  }
  const current = await currentChatGPTUrl(client).catch(() => '');
  if (current === conversationUrl) return current;
  await client.navigate(conversationUrl);
  await waitForChatGPTDocumentReady(client);
  await sleep(750);
  return currentChatGPTUrl(client).catch(() => conversationUrl);
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

async function waitForChatGPTConversationResponse(
  client: CDPClient,
  conversationUrl: string,
  previousTurnIndex: number,
  timeoutMs: number,
  beforeArtifactSources: Set<string>,
): Promise<{ status: 'complete' | 'timeout'; text: string; artifacts: ImageArtifact[]; url?: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  let stableSince = 0;
  let lastArtifacts: ImageArtifact[] = [];
  let lastUrl = conversationUrl;

  while (Date.now() < deadline) {
    await sleep(DEFAULT_POLL_MS);
    const poll = await withChatGPTUiLock(async () => {
      const activeUrl = await activateChatGPTConversation(client, conversationUrl);
      const snapshot = await readConversation(client, 10);
      const responseTurn = [...snapshot.turns]
        .reverse()
        .find((turn) => turn.index > previousTurnIndex && (turn.role === 'assistant' || !turn.role));
      const text = responseTurn?.text || '';
      const artifacts = filterNewArtifacts(await extractArtifacts(client), beforeArtifactSources);
      return {
        busy: snapshot.busy,
        text,
        artifacts,
        url: snapshot.url || activeUrl,
      };
    }, 30_000);
    lastArtifacts = poll.artifacts;
    lastUrl = poll.url || lastUrl;

    if (!poll.text) {
      if (!poll.busy && poll.artifacts.length > 0) {
        return { status: 'complete', text: '', artifacts: poll.artifacts, url: poll.url };
      }
      continue;
    }

    if (poll.text === lastText) stableSince += DEFAULT_POLL_MS;
    else {
      lastText = poll.text;
      stableSince = 0;
    }

    if (!poll.busy && poll.artifacts.length > 0) {
      return { status: 'complete', text: poll.text, artifacts: poll.artifacts, url: poll.url };
    }
    if (!poll.busy && stableSince >= DEFAULT_POLL_MS) {
      return { status: 'complete', text: poll.text, artifacts: poll.artifacts, url: poll.url };
    }
  }

  return { status: 'timeout', text: lastText, artifacts: lastArtifacts, url: lastUrl };
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

      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width >= 48 && rect.height >= 48;
      };
      const elementLabel = (el) => clean([
        el.alt,
        el.title,
        el.getAttribute?.('aria-label'),
        el.getAttribute?.('data-testid'),
        el.getAttribute?.('class'),
        el.getAttribute?.('role')
      ].filter(Boolean).join(' ')).toLowerCase();
      const decorative = (el) => {
        const rect = el.getBoundingClientRect?.();
        const width = el.naturalWidth || rect?.width || 0;
        const height = el.naturalHeight || rect?.height || 0;
        if (width < 80 || height < 80) return true;
        return /avatar|profile|logo|icon|sprite|gizmo|user-avatar|emoji|attachment-preview|upload-preview|thumbnail/i.test(elementLabel(el));
      };
      const mimeFromDataUrl = (value) => {
        const match = String(value || '').match(/^data:([^;]+);base64,/);
        return match?.[1] || 'image/png';
      };
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

      const exportCanvasImage = async (img, base) => {
        if (!img || !(img.naturalWidth || img.width) || !(img.naturalHeight || img.height)) {
          throw new Error('canvas_source_unavailable');
        }
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas_context_unavailable');
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1] || '';
        await add({
          ...base,
          mime: 'image/png',
          bytes: Math.floor(base64.length * 0.75),
          base64
        });
      };

      const fetchImageSource = async (source, base, img) => {
        try {
          if (source.startsWith('data:image/')) {
            const base64 = source.split(',')[1] || '';
            await add({
              ...base,
              mime: mimeFromDataUrl(source),
              bytes: Math.floor(base64.length * 0.75),
              base64
            });
            return;
          }

          const response = await fetch(source, { credentials: 'include' });
          if (!response.ok) throw new Error('fetch_status_' + response.status);
          const blob = await response.blob();
          if (blob.size > maxBytes) {
            await add({ ...base, mime: blob.type || base.mime, bytes: blob.size, error: 'artifact_too_large' });
            return;
          }
          await add({
            ...base,
            mime: blob.type || response.headers.get('content-type') || base.mime,
            bytes: blob.size,
            base64: await toBase64(blob)
          });
        } catch (fetchError) {
          if (img) {
            try {
              await exportCanvasImage(img, base);
              return;
            } catch (canvasError) {
              await add({
                ...base,
                error: (fetchError instanceof Error ? fetchError.message : String(fetchError))
                  + '; canvas_fallback_failed: '
                  + (canvasError instanceof Error ? canvasError.message : String(canvasError))
              });
              return;
            }
          }
          await add({ ...base, error: fetchError instanceof Error ? fetchError.message : String(fetchError) });
        }
      };

      const imgNodes = Array.from(root.querySelectorAll('img')).filter((img) => visible(img) && !decorative(img) && (img.currentSrc || img.src));

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
        await fetchImageSource(source, base, img);
      }

      const backgroundNodes = Array.from(root.querySelectorAll('*')).filter((el) => visible(el) && !decorative(el));
      for (const el of backgroundNodes) {
        if (artifacts.length >= limit) break;
        const backgroundImage = getComputedStyle(el).backgroundImage || '';
        for (const match of backgroundImage.matchAll(/url\\((['"]?)(.*?)\\1\\)/g)) {
          if (artifacts.length >= limit) break;
          const source = match[2];
          if (!source || source === 'none' || source.startsWith('data:image/svg')) continue;
          const rect = el.getBoundingClientRect();
          await fetchImageSource(source, {
            index: artifacts.length + 1,
            type: 'image',
            source,
            width: Math.round(rect.width) || undefined,
            height: Math.round(rect.height) || undefined,
            alt: undefined,
            mime: 'application/octet-stream'
          }, null);
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
            source: dataUrl,
            mime: 'image/png',
            width: canvas.width,
            height: canvas.height,
            bytes: Math.floor(base64.length * 0.75),
            base64
          });
        } catch (error) {
          await add({ index: artifacts.length + 1, type: 'canvas', source: 'canvas:' + artifacts.length, mime: 'image/png', error: error instanceof Error ? error.message : String(error) });
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
    `Image request: ${prompt}`,
    '',
    'Generate one real raster image file (PNG/JPG/WebP), not SVG, HTML, canvas code, Python drawing, or a placeholder.',
    size ? `Target size/aspect: ${size}.` : '',
    quality ? `Rendering quality target: ${quality}.` : '',
    referenceCount > 0 ? `Use the ${referenceCount} attached reference image(s) as visual references where relevant.` : '',
    'Do not add captions, logos, or watermarks unless the user explicitly asked for them.',
    'After the image is generated, do not do extra reasoning; just leave the generated image visible in the chat.',
  ].filter(Boolean).join('\\n');
}

async function attachComposerFiles(
  client: CDPClient,
  files: string[],
): Promise<{ ok: boolean; attached: number; files: string[]; method: string; error?: string }> {
  if (!files.length) return { ok: true, attached: 0, files: [], method: 'none' };

  try {
    const attached = await attachFilesViaDomPaste(client, files);
    if (attached >= files.length) {
      return { ok: true, attached, files, method: 'dom-paste' };
    }
    return {
      ok: false,
      attached,
      files,
      method: 'dom-paste',
      error: `Only ${attached}/${files.length} reference image(s) appeared in the composer`,
    };
  } catch (domPasteError) {
    const pasteError = getErrorMessage(domPasteError);
    try {
      await revealFileInput(client).catch(() => undefined);
      await sleep(500);
      await client.setFileInputFiles(files);
      await sleep(1_500);
      return { ok: true, attached: files.length, files, method: 'DOM.setFileInputFiles', error: pasteError };
    } catch (error) {
      const domError = getErrorMessage(error);
      try {
        setClipboardFiles(files);
        await focusComposer(client);
        await client.pressPasteShortcut();
        await sleep(2_500);
        return { ok: true, attached: files.length, files, method: 'pasteboard', error: `${pasteError}; ${domError}` };
      } catch (pasteErrorFallback) {
        return {
          ok: false,
          attached: 0,
          files,
          method: 'pasteboard',
          error: `${pasteError}; ${domError}; paste fallback failed: ${getErrorMessage(pasteErrorFallback)}`,
        };
      }
    }
  }
}

async function attachFilesViaDomPaste(client: CDPClient, files: string[]): Promise<number> {
  const payload = files.map((file) => ({
    name: basename(file),
    mime: mimeFromPath(file),
    base64: readFileSync(file).toString('base64'),
  }));

  const result = await client.evaluate<{ ok: boolean; attached: number; error?: string }>(`
    (async (payload) => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      };
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"], .ProseMirror, textarea')).filter(visible);
      const target = editables.length ? editables[editables.length - 1] : document.body;
      if (!target) return { ok: false, attached: 0, error: 'composer_not_found' };

      const countAttached = () => {
        const removeLabels = Array.from(document.querySelectorAll('button[aria-label]'))
          .map((el) => el.getAttribute('aria-label') || '');
        return payload.reduce((count, item) => (
          count + removeLabels.filter((label) => label === 'Remove ' + item.name).length
        ), 0);
      };

      const before = countAttached();
      const dataTransfer = new DataTransfer();
      for (const item of payload) {
        const binary = atob(item.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        dataTransfer.items.add(new File([bytes], item.name, { type: item.mime }));
      }

      target.focus?.();
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });
      target.dispatchEvent(event);

      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        const attached = countAttached() - before;
        if (attached >= payload.length) return { ok: true, attached };
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return { ok: false, attached: Math.max(0, countAttached() - before), error: 'attachment_preview_timeout' };
    })(${JSON.stringify(payload)})
  `, 15_000);

  if (!result.ok) throw new Error(result.error || 'DOM paste attachment failed');
  return result.attached;
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
