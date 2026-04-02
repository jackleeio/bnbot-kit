/**
 * MarkdownPasteProcessor
 *
 * Intercepts paste events on Twitter's Article Editor (Draft.js based)
 * and converts Markdown to HTML, writing it to clipboard for re-paste.
 */

interface CodeBlock {
    lang: string;
    code: string;
}

interface ImageBlock {
    index: number;
    url: string;
}

export class MarkdownPasteProcessor {
    private toastTimeout: ReturnType<typeof setTimeout> | null = null;
    private static readonly MARKER = '<!-- bnbot-md-converted -->';
    private pendingCodeBlocks: CodeBlock[] = [];
    private static isInsertingCodeBlocks = false; // Static flag to prevent concurrent runs across instances

    // Static storage for image blocks (used by ArticleCard)
    private static _staticPendingImageBlocks: ImageBlock[] = [];

    constructor() {
        this.init();
    }

    // Static method to process markdown and return HTML with code blocks
    public static processMarkdownStatic(text: string): { html: string; codeBlocks: CodeBlock[]; imageBlocks: ImageBlock[]; marker: string } {
        const processor = new MarkdownPasteProcessor();
        // Don't init the paste listener for static usage
        document.removeEventListener('paste', processor.handlePaste.bind(processor), true);

        const { html, codeBlocks, imageBlocks } = processor.processMarkdown(text);
        return {
            html: MarkdownPasteProcessor.MARKER + html,
            codeBlocks,
            imageBlocks,
            marker: MarkdownPasteProcessor.MARKER
        };
    }

    // Get the marker for external use
    public static getMarker(): string {
        return MarkdownPasteProcessor.MARKER;
    }

    // Set pending code blocks for external use (e.g., publish button)
    public static setPendingCodeBlocks(codeBlocks: CodeBlock[]): void {
        // Store in a static variable that can be accessed by the instance
        MarkdownPasteProcessor._staticPendingCodeBlocks = codeBlocks;
    }

    // Set pending image blocks for external use
    public static setPendingImageBlocks(imageBlocks: ImageBlock[]): void {
        MarkdownPasteProcessor._staticPendingImageBlocks = imageBlocks;
    }

    // Get pending image blocks
    public static getPendingImageBlocks(): ImageBlock[] {
        return MarkdownPasteProcessor._staticPendingImageBlocks;
    }

    private static _staticPendingCodeBlocks: CodeBlock[] = [];

    private init() {
        console.log('[BNBot] MarkdownPasteProcessor initializing...');
        document.addEventListener('paste', this.handlePaste.bind(this), true);
    }

    private async handlePaste(e: ClipboardEvent) {
        // Only on Article Editor page
        if (!window.location.pathname.includes('/compose/articles/edit')) {
            return;
        }

        // Check if target is Draft.js editor
        const target = e.target as HTMLElement;
        const editor = target.closest('.public-DraftEditor-content') ||
                       target.closest('[data-testid="composer"]');
        if (!editor) {
            console.log('[BNBot] Not in editor, skipping');
            return;
        }

        const clipboardData = e.clipboardData;
        if (!clipboardData) {
            console.log('[BNBot] No clipboard data');
            return;
        }

        // Check if clipboard contains files (images) - let DraftJS handle it natively
        if (clipboardData.files && clipboardData.files.length > 0) {
            const hasImage = Array.from(clipboardData.files).some(f => f.type.startsWith('image/'));
            if (hasImage) {
                console.log('[BNBot] Clipboard contains image file, letting DraftJS handle');
                return;
            }
        }

        const html = clipboardData.getData('text/html');

        // Check if this is our converted HTML (second paste)
        if (html && html.includes(MarkdownPasteProcessor.MARKER)) {
            console.log('[BNBot] Detected our converted HTML');

            // Check for static pending code blocks first (set by publish button)
            if (MarkdownPasteProcessor._staticPendingCodeBlocks.length > 0) {
                this.pendingCodeBlocks = MarkdownPasteProcessor._staticPendingCodeBlocks;
                MarkdownPasteProcessor._staticPendingCodeBlocks = []; // Clear after use
                console.log('[BNBot] Using static pending code blocks:', this.pendingCodeBlocks.length);
            }
            // Extract code blocks from the HTML if pendingCodeBlocks is still empty
            else if (this.pendingCodeBlocks.length === 0) {
                // Parse code block placeholders from HTML: [CODE_X:lang]
                const placeholderRegex = /\[CODE_(\d+):(\w+)\]/g;
                const text = clipboardData.getData('text/plain');
                if (text) {
                    // Re-extract code blocks from the original markdown
                    const { codeBlocks } = this.processMarkdown(text);
                    this.pendingCodeBlocks = codeBlocks;
                    console.log('[BNBot] Re-extracted code blocks from plain text:', codeBlocks.length);
                }
            }

            // Always let Draft.js handle MARKER paste — Draft.js understands the HTML
            // and creates proper content blocks (headers, bold, lists, etc.).
            console.log('[BNBot] Letting Draft.js handle trusted MARKER paste');
            if (this.pendingCodeBlocks.length > 0) {
                setTimeout(() => this.showCodeBlockUI(), 500);
            }
            return;
        }

        // If HTML has real formatting (not from us), let Draft.js handle
        if (html && html.trim()) {
            // Check for real formatting tags (excluding pre/code which Draft.js doesn't handle well)
            const hasRealFormatting = /<(h[1-6]|strong|em|b|i|ul|ol|li|blockquote)[^>]*>/i.test(html);
            if (hasRealFormatting) {
                console.log('[BNBot] HTML with real formatting in clipboard, letting Draft.js handle');
                return;
            }
            console.log('[BNBot] HTML is just wrapper, will check for markdown');
        }

        const text = clipboardData.getData('text/plain');
        console.log('[BNBot] Paste text:', text?.substring(0, 100));

        if (!text) {
            console.log('[BNBot] No text in clipboard');
            return;
        }

        const isMd = this.isMarkdown(text);
        console.log('[BNBot] Is markdown:', isMd);

        if (!isMd) {
            console.log('[BNBot] Not markdown, skipping');
            return;
        }

        console.log('[BNBot] Detected Markdown, converting to HTML...');
        e.preventDefault();
        e.stopPropagation();

        // Extract code blocks and convert markdown
        const { html: convertedHtml, codeBlocks } = this.processMarkdown(text);
        this.pendingCodeBlocks = codeBlocks;

        const finalHtml = MarkdownPasteProcessor.MARKER + convertedHtml;
        console.log('[BNBot] Converted HTML:', finalHtml);
        console.log('[BNBot] Code blocks extracted:', codeBlocks.length);

        // Synthetic paste events (from MCP/action automation) do not trigger native Draft.js paste handling.
        // Handle them fully inside the processor.
        if (!e.isTrusted) {
            console.log('[BNBot] Synthetic paste detected, using direct markdown insert');
            const expandedHtml = this.expandConvertedHtml(convertedHtml, codeBlocks);
            const inserted = this.insertConvertedHtmlDirectly(editor as HTMLElement, expandedHtml);
            if (!inserted) {
                document.execCommand('insertText', false, text);
            }
            this.pendingCodeBlocks = [];
            return;
        }

        // In MCP/background-triggered flows the document is often not focused.
        // Clipboard API will throw NotAllowedError in that case.
        if (!document.hasFocus()) {
            console.warn('[BNBot] Document not focused, using direct markdown insert');
            const expandedHtml = this.expandConvertedHtml(convertedHtml, codeBlocks);
            const inserted = this.insertConvertedHtmlDirectly(editor as HTMLElement, expandedHtml);
            if (!inserted) {
                document.execCommand('insertText', false, text);
            }
            this.pendingCodeBlocks = [];
            return;
        }

        // Write HTML to clipboard
        try {
            const htmlBlob = new Blob([finalHtml], { type: 'text/html' });
            const textBlob = new Blob([this.stripMarkdown(text)], { type: 'text/plain' });

            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': htmlBlob,
                    'text/plain': textBlob
                })
            ]);

            console.log('[BNBot] HTML written to clipboard');
            this.showToast(codeBlocks.length > 0 ? 'convertedWithCode' : 'converted');
        } catch (err) {
            console.error('[BNBot] Failed to write to clipboard:', err);
            // Fallback: clipboard may be blocked when document is not focused.
            // Insert converted HTML directly so MCP flow can still complete automatically.
            const expandedHtml = this.expandConvertedHtml(convertedHtml, codeBlocks);
            const inserted = this.insertConvertedHtmlDirectly(editor as HTMLElement, expandedHtml);
            if (inserted) {
                this.pendingCodeBlocks = [];
                return;
            }
            // Last fallback: plain text
            document.execCommand('insertText', false, text);
        }
    }

    private expandConvertedHtml(html: string, codeBlocks: CodeBlock[]): string {
        return html.replace(/\[CODE_(\d+):([a-zA-Z0-9_-]+)\]/g, (_m, idxStr) => {
            const idx = parseInt(idxStr, 10) - 1;
            const block = codeBlocks[idx];
            if (!block) return '';
            return `<pre><code>${this.escapeHtml(block.code || '')}</code></pre>`;
        });
    }

    private insertConvertedHtmlDirectly(editor: HTMLElement, html: string): boolean {
        try {
            editor.focus();

            let inserted = document.execCommand('insertHTML', false, html);
            if (!inserted) {
                const selection = window.getSelection();
                if (!selection) return false;

                let range: Range;
                if (selection.rangeCount > 0) {
                    range = selection.getRangeAt(0);
                } else {
                    range = document.createRange();
                    range.selectNodeContents(editor);
                    range.collapse(false);
                }

                const fragment = range.createContextualFragment(html);
                range.deleteContents();
                range.insertNode(fragment);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
                inserted = true;
            }

            editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[BNBot] Inserted converted HTML directly');
            return true;
        } catch (e) {
            console.error('[BNBot] Direct HTML insert failed:', e);
            return false;
        }
    }

    private isMarkdown(text: string): boolean {
        const markers = [
            /^#{1,6}\s/m,           // Headers
            /\*\*[^*]+\*\*/,        // Bold
            /__[^_]+__/,            // Bold
            /\*[^*]+\*/,            // Italic
            /_[^_]+_/,              // Italic
            /`[^`]+`/,              // Inline code
            /```[\s\S]*?```/,       // Code blocks
            /^\s*[-*+]\s/m,         // Unordered lists
            /^\s*\d+\.\s/m,         // Ordered lists
            /^\s*>\s/m,             // Blockquotes
            /\[.+?\]\(.+?\)/        // Links
        ];
        return markers.some(r => r.test(text));
    }

    private stripMarkdown(text: string): string {
        // Remove code blocks first
        let result = text.replace(/```[\s\S]*?```/g, (match) => {
            // Extract code content without the fences
            const lines = match.split('\n');
            lines.shift(); // Remove opening ```
            lines.pop();   // Remove closing ```
            return lines.join('\n');
        });

        return result
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/__([^_]+)__/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/_([^_]+)_/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/^\s*[-*+]\s+/gm, '')
            .replace(/^\s*\d+\.\s+/gm, '')
            .replace(/^\s*>\s+/gm, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    }

    public processMarkdown(text: string): { html: string; codeBlocks: CodeBlock[]; imageBlocks: ImageBlock[] } {
        // First, extract all image placeholders and replace them with simple markers
        // Pattern: [📷 图片N](url) or [📷图片N](url)
        const imageBlocks: ImageBlock[] = [];
        const imagePattern = /\[📷\s*图片(\d+)\]\((https?:\/\/[^)]+)\)/g;
        let imageMatch;
        while ((imageMatch = imagePattern.exec(text)) !== null) {
            const imageNum = parseInt(imageMatch[1]);
            const imageUrl = imageMatch[2];
            imageBlocks.push({ index: imageNum, url: imageUrl });
        }
        // Replace image placeholders with simple ASCII markers (no emoji to avoid selection issues)
        let processedText = text.replace(imagePattern, (_, num) => `[IMG_${num}]`);

        const lines = processedText.split('\n');
        let html = '';
        let inCodeBlock = false;
        let codeBlockContent = '';
        let codeBlockLang = '';
        let inList = false;
        let listType = '';
        const codeBlocks: CodeBlock[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Code blocks - check for opening/closing ```
            const codeBlockMatch = trimmed.match(/^```(\w*)$/);
            if (codeBlockMatch !== null || trimmed === '```') {
                if (inCodeBlock) {
                    // Closing code block - store it and add placeholder
                    codeBlocks.push({
                        lang: codeBlockLang || 'text',
                        code: codeBlockContent.trim()
                    });
                    // Use a simple placeholder: [CODE_1:yaml]
                    html += `<p>[CODE_${codeBlocks.length}:${codeBlockLang || 'text'}]</p>`;
                    codeBlockContent = '';
                    codeBlockLang = '';
                    inCodeBlock = false;
                } else {
                    // Opening code block
                    if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; }
                    codeBlockLang = codeBlockMatch ? codeBlockMatch[1] : '';
                    inCodeBlock = true;
                }
                continue;
            }

            if (inCodeBlock) {
                codeBlockContent += line + '\n';
                continue;
            }

            // Empty line
            if (trimmed === '') {
                if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; }
                continue;
            }

            // Headers
            const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
            if (headerMatch) {
                if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; }
                const level = headerMatch[1].length;
                const content = this.formatInline(this.escapeHtml(headerMatch[2]));
                html += `<h${level}>${content}</h${level}>`;
                continue;
            }

            // Blockquote
            if (trimmed.startsWith('>')) {
                if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; }
                const content = this.formatInline(this.escapeHtml(trimmed.substring(1).trim()));
                html += `<blockquote>${content}</blockquote>`;
                continue;
            }

            // Unordered list
            const ulMatch = line.match(/^\s*[-*+]\s+(.+)$/);
            if (ulMatch) {
                if (!inList || listType !== 'ul') {
                    if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
                    html += '<ul>';
                    inList = true;
                    listType = 'ul';
                }
                html += `<li>${this.formatInline(this.escapeHtml(ulMatch[1]))}</li>`;
                continue;
            }

            // Ordered list
            const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
            if (olMatch) {
                if (!inList || listType !== 'ol') {
                    if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
                    html += '<ol>';
                    inList = true;
                    listType = 'ol';
                }
                html += `<li>${this.formatInline(this.escapeHtml(olMatch[1]))}</li>`;
                continue;
            }

            // Horizontal rule
            if (/^[-*_]{3,}$/.test(trimmed)) {
                if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; }
                html += '<hr>';
                continue;
            }

            // Regular paragraph
            if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; }
            html += `<p>${this.formatInline(this.escapeHtml(trimmed))}</p>`;
        }

        if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
        if (inCodeBlock) {
            // Unclosed code block
            codeBlocks.push({
                lang: codeBlockLang || 'text',
                code: codeBlockContent.trim()
            });
            html += `<p>[CODE_${codeBlocks.length}:${codeBlockLang || 'text'}]</p>`;
        }

        return { html, codeBlocks, imageBlocks };
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    private formatInline(text: string): string {
        return text
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/__([^_]+)__/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/_([^_]+)_/g, '<em>$1</em>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    }

    private async showCodeBlockUI() {
        if (this.pendingCodeBlocks.length === 0) return;

        // Prevent concurrent runs (static flag shared across all instances)
        if (MarkdownPasteProcessor.isInsertingCodeBlocks) {
            console.log('[BNBot] Already inserting code blocks, skipping duplicate call');
            return;
        }
        MarkdownPasteProcessor.isInsertingCodeBlocks = true;

        // Wait longer for the paste to complete in the editor
        await this.delay(1500);

        // Show progress toast
        this.showToast('insertingCode');

        // Auto-insert code blocks one by one
        let failedIndex = -1;
        for (let i = 0; i < this.pendingCodeBlocks.length; i++) {
            const block = this.pendingCodeBlocks[i];
            console.log(`[BNBot] Inserting code block ${i + 1}/${this.pendingCodeBlocks.length}: ${block.lang}`);

            const success = await this.insertCodeBlock(block.lang, block.code, i);
            if (!success) {
                console.error(`[BNBot] Failed to insert code block ${i + 1}`);
                failedIndex = i;
                break;
            }

            // Wait longer between insertions
            if (i < this.pendingCodeBlocks.length - 1) {
                await this.delay(800);
            }
        }

        if (failedIndex >= 0) {
            // Some blocks failed, show manual UI for remaining blocks
            const remainingBlocks = this.pendingCodeBlocks.slice(failedIndex);
            this.pendingCodeBlocks = remainingBlocks;
            MarkdownPasteProcessor.isInsertingCodeBlocks = false;
            this.showManualFallbackUI();
        } else {
            // All succeeded
            this.pendingCodeBlocks = [];
            MarkdownPasteProcessor.isInsertingCodeBlocks = false;
            this.showToast('codeInserted');
        }
    }

    private async showManualFallbackUI() {
        // Detect language from extension settings
        let isZh = false;
        try {
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                const result = await chrome.storage.local.get('language');
                isZh = result.language === 'zh';
            }
        } catch {
            isZh = navigator.language.startsWith('zh');
        }

        // Remove existing UI
        const existing = document.getElementById('bnbot-codeblock-ui');
        if (existing) existing.remove();

        const container = document.createElement('div');
        container.id = 'bnbot-codeblock-ui';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            padding: 16px;
            z-index: 10001;
            max-width: 420px;
            max-height: 70vh;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <strong style="font-size: 14px;">⚠️ ${isZh ? `${this.pendingCodeBlocks.length} 个代码块需手动插入` : `${this.pendingCodeBlocks.length} Code Blocks Need Manual Insert`}</strong>
                <button id="bnbot-codeblock-close" style="background: none; border: none; cursor: pointer; font-size: 18px; color: #666;">×</button>
            </div>

            <p style="font-size: 12px; color: #666; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #eee;">
                ${isZh
                    ? '自动插入失败，请手动复制代码，使用工具栏 Insert → 代码'
                    : 'Auto-insert failed. Copy code and use toolbar Insert → Code'}
            </p>

            <div id="bnbot-codeblock-list"></div>
        `;

        const list = container.querySelector('#bnbot-codeblock-list')!;

        this.pendingCodeBlocks.forEach((block, index) => {
            const item = document.createElement('div');
            item.style.cssText = `
                background: #f8f9fa;
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 8px;
                border: 1px solid #e9ecef;
            `;
            item.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-size: 12px; font-weight: 600; color: #1d9bf0; background: #e8f5fd; padding: 2px 8px; border-radius: 4px;">${block.lang}</span>
                    <button class="bnbot-copy-code" data-index="${index}" style="
                        background: #1d9bf0;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        padding: 4px 12px;
                        font-size: 12px;
                        cursor: pointer;
                    ">${isZh ? '复制代码' : 'Copy Code'}</button>
                </div>
                <pre style="
                    background: #1e1e1e;
                    color: #d4d4d4;
                    padding: 10px;
                    border-radius: 6px;
                    font-size: 11px;
                    font-family: 'SF Mono', Monaco, 'Courier New', monospace;
                    overflow-x: auto;
                    margin: 0;
                    max-height: 120px;
                    white-space: pre-wrap;
                    word-break: break-all;
                    line-height: 1.4;
                ">${this.escapeHtml(block.code.substring(0, 300))}${block.code.length > 300 ? '\n...' : ''}</pre>
            `;
            list.appendChild(item);
        });

        document.body.appendChild(container);

        // Event: Close button
        container.querySelector('#bnbot-codeblock-close')?.addEventListener('click', () => {
            container.remove();
            this.pendingCodeBlocks = [];
        });

        // Event: Copy buttons
        container.querySelectorAll('.bnbot-copy-code').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const index = parseInt((e.target as HTMLElement).dataset.index || '0');
                const code = this.pendingCodeBlocks[index].code;

                try {
                    await navigator.clipboard.writeText(code);
                    (e.target as HTMLElement).textContent = isZh ? '✓ 已复制' : '✓ Copied';
                    (e.target as HTMLElement).style.background = '#4caf50';
                    setTimeout(() => {
                        (e.target as HTMLElement).textContent = isZh ? '复制代码' : 'Copy Code';
                        (e.target as HTMLElement).style.background = '#1d9bf0';
                    }, 2000);
                } catch (err) {
                    console.error('[BNBot] Failed to copy:', err);
                }
            });
        });
    }

    private async insertCodeBlock(lang: string, code: string, index: number): Promise<boolean> {
        try {
            // Placeholder format: [CODE_1:yaml]
            const placeholder = `[CODE_${index + 1}:${lang}]`;
            const editor = document.querySelector('.public-DraftEditor-content');
            if (!editor) {
                console.error('[BNBot] Editor not found');
                return false;
            }

            // Find the block containing the placeholder
            const blocks = Array.from(editor.querySelectorAll('[data-block="true"]'));
            let placeholderBlock: HTMLElement | null = null;

            for (const block of blocks) {
                const text = block.textContent?.trim() || '';
                if (text === placeholder) {
                    placeholderBlock = block as HTMLElement;
                    break;
                }
            }

            if (!placeholderBlock) {
                console.error('[BNBot] Placeholder not found:', placeholder);
                return false;
            }

            console.log('[BNBot] Found placeholder:', placeholder);

            // Step 1: Click on the placeholder to position cursor there
            placeholderBlock.click();
            await this.delay(100);

            // Select the placeholder content to position cursor
            const selection = window.getSelection();
            if (selection) {
                const range = document.createRange();
                range.selectNodeContents(placeholderBlock);
                selection.removeAllRanges();
                selection.addRange(range);
            }
            await this.delay(100);

            // Step 2: Delete the placeholder first (so code block takes its place)
            document.execCommand('delete', false);
            await this.delay(200);

            console.log('[BNBot] Placeholder deleted, now inserting code block');

            // Step 3: Now insert the code block at cursor position
            // Find the insert button using toolbar id
            let insertButton: HTMLButtonElement | null = null;

            // Method 1: Find via toolbar-styling-buttons container
            const toolbar = document.querySelector('#toolbar-styling-buttons');
            if (toolbar) {
                // The insert button is in the last child div, find button with "插入" text or aria-label
                const lastDiv = toolbar.querySelector(':scope > div:last-child');
                if (lastDiv) {
                    insertButton = lastDiv.querySelector('button[aria-label="添加媒体内容"]') as HTMLButtonElement;
                    if (!insertButton) {
                        // Find button containing "插入" text
                        const buttons = lastDiv.querySelectorAll('button');
                        for (const btn of buttons) {
                            if (btn.textContent?.includes('插入') || btn.textContent?.includes('Insert')) {
                                insertButton = btn as HTMLButtonElement;
                                break;
                            }
                        }
                    }
                }
            }

            // Method 2: Fallback to direct selector
            if (!insertButton) {
                insertButton = document.querySelector('button[aria-label="添加媒体内容"]') as HTMLButtonElement;
            }
            if (!insertButton) {
                insertButton = document.querySelector('button[aria-label="Add media"]') as HTMLButtonElement;
            }

            if (!insertButton) {
                console.error('[BNBot] Insert button not found');
                return false;
            }

            console.log('[BNBot] Found insert button:', insertButton.getAttribute('aria-label') || insertButton.textContent?.substring(0, 20));
            insertButton.click();

            // Wait for dropdown menu to appear with retry
            let menu: Element | null = null;
            for (let attempt = 0; attempt < 10; attempt++) {
                await this.delay(200);
                menu = document.querySelector('[role="menu"]');
                if (menu) {
                    console.log('[BNBot] Menu appeared on attempt', attempt + 1);
                    break;
                }
            }

            if (!menu) {
                console.error('[BNBot] Menu did not appear after clicking insert button');
                return false;
            }

            // Find the "代码" menu item within the menu
            const menuItems = menu.querySelectorAll('[role="menuitem"]');
            console.log('[BNBot] Found menu items:', menuItems.length);

            let codeMenuItem: HTMLElement | null = null;

            for (const item of menuItems) {
                const text = item.textContent?.trim();
                console.log('[BNBot] Menu item:', text);
                if (text === '代码' || text === 'Code' || text?.includes('代码') || text?.includes('Code')) {
                    codeMenuItem = item as HTMLElement;
                    break;
                }
            }

            if (!codeMenuItem) {
                console.error('[BNBot] Code menu item not found in menu');
                // Close menu
                document.body.click();
                return false;
            }

            console.log('[BNBot] Clicking code menu item');
            codeMenuItem.click();
            await this.delay(800);

            // Step 4: Wait for modal to appear with retry logic
            let modal: Element | null = null;
            for (let attempt = 0; attempt < 5; attempt++) {
                modal = document.querySelector('[data-testid="sheetDialog"]');
                if (modal) {
                    console.log('[BNBot] Modal found on attempt', attempt + 1);
                    break;
                }
                console.log('[BNBot] Modal not found, waiting... attempt', attempt + 1);
                await this.delay(300);
            }

            if (!modal) {
                console.error('[BNBot] Code modal not found after retries');
                return false;
            }

            // Set the language
            const langInput = modal.querySelector('[data-testid="programming-language-input"]') as HTMLInputElement;
            if (langInput) {
                const langMap: Record<string, string> = {
                    'js': 'javascript',
                    'ts': 'typescript',
                    'py': 'python',
                    'sh': 'bash',
                    'shell': 'bash',
                    'text': '',
                    'markdown': 'markdown',
                    'md': 'markdown'
                };
                const mappedLang = langMap[lang.toLowerCase()] || lang;

                langInput.focus();
                langInput.value = mappedLang;
                langInput.dispatchEvent(new Event('input', { bubbles: true }));
                await this.delay(200);
                langInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                await this.delay(200);
            }

            // Set the code
            const codeInput = modal.querySelector('textarea[name="code-input"]') as HTMLTextAreaElement;
            if (!codeInput) {
                console.error('[BNBot] Code textarea not found');
                const closeBtn = modal.querySelector('[data-testid="app-bar-close"]') as HTMLButtonElement;
                closeBtn?.click();
                return false;
            }

            codeInput.focus();
            codeInput.value = code;
            codeInput.dispatchEvent(new Event('input', { bubbles: true }));
            await this.delay(200);

            // Click the Insert button in modal
            const buttons = modal.querySelectorAll('button');
            let insertBtn: HTMLButtonElement | null = null;

            for (const btn of buttons) {
                const text = btn.textContent?.trim();
                if (text === '插入' || text === 'Insert') {
                    if (!btn.hasAttribute('data-testid') || btn.getAttribute('data-testid') !== 'app-bar-close') {
                        insertBtn = btn as HTMLButtonElement;
                    }
                }
            }

            if (!insertBtn || insertBtn.disabled) {
                console.error('[BNBot] Insert button not found or disabled');
                const closeBtn = modal.querySelector('[data-testid="app-bar-close"]') as HTMLButtonElement;
                closeBtn?.click();
                return false;
            }

            insertBtn.click();
            await this.delay(500);

            console.log('[BNBot] Code block inserted successfully at placeholder position');

            return true;
        } catch (err) {
            console.error('[BNBot] Error inserting code block:', err);
            return false;
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async showToast(messageKey: 'converted' | 'convertedWithCode' | 'insertingCode' | 'codeInserted') {
        // Detect language from extension settings (stored in chrome.storage)
        let isZh = false;
        try {
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                const result = await chrome.storage.local.get('language');
                isZh = result.language === 'zh';
            }
        } catch {
            // Fallback to browser language if storage not available
            isZh = navigator.language.startsWith('zh');
        }

        const messages = {
            converted: isZh
                ? 'Markdown 已转换，请再次粘贴 (Cmd+V / Ctrl+V)'
                : 'Markdown converted, please paste again (Cmd+V / Ctrl+V)',
            convertedWithCode: isZh
                ? 'Markdown 已转换，请再次粘贴。代码块将自动插入'
                : 'Markdown converted, please paste again. Code blocks will be auto-inserted',
            insertingCode: isZh
                ? '⏳ 正在自动插入代码块...'
                : '⏳ Auto-inserting code blocks...',
            codeInserted: isZh
                ? '✅ 代码块插入完成！'
                : '✅ Code blocks inserted!'
        };

        const message = messages[messageKey];

        // Remove existing toast
        const existing = document.getElementById('bnbot-md-toast');
        if (existing) existing.remove();
        if (this.toastTimeout) clearTimeout(this.toastTimeout);

        const toast = document.createElement('div');
        toast.id = 'bnbot-md-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: #1d9bf0;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: bnbot-toast-in 0.3s ease;
        `;

        // Add animation style
        if (!document.getElementById('bnbot-toast-style')) {
            const style = document.createElement('style');
            style.id = 'bnbot-toast-style';
            style.textContent = `
                @keyframes bnbot-toast-in {
                    from { opacity: 0; transform: translateX(-50%) translateY(20px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);

        this.toastTimeout = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    public destroy() {
        document.removeEventListener('paste', this.handlePaste.bind(this), true);
    }
}
