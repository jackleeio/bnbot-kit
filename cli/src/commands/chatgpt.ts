import { execFileSync, execSync } from 'node:child_process';

const CHATGPT_BUNDLE_ID = 'com.openai.chat';
const CHATGPT_DISPLAY_NAME = 'ChatGPT';
const MAX_SWIFT_BUFFER = 10 * 1024 * 1024;

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
guard let win = attr(axApp, kAXFocusedWindowAttribute as String) as! AXUIElement? else {
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
