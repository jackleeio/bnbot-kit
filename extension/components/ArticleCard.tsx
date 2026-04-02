import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLanguage } from './LanguageContext';
import { useTheme } from './ThemeContext';
import { Clock, Tag, BookOpen, ExternalLink, Sparkles, FileText, X, Check, Pencil, Copy } from 'lucide-react';
import { ImageWithSkeleton } from './ImageWithSkeleton';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import { authService } from '../services/authService';
import { mediaService } from '../services/mediaService';
import { MarkdownPasteProcessor } from '../utils/MarkdownPasteProcessor';

// TipTap imports
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import { marked } from 'marked';

// Configure marked for sync parsing
marked.setOptions({
    async: false,
    gfm: true,
    breaks: true,
});

// Helper to convert Markdown to HTML
const markdownToHtml = (markdown: string): string => {
    if (!markdown) return '';
    // If it looks like HTML already, return as-is
    if (markdown.trim().startsWith('<')) {
        return markdown;
    }
    // Convert markdown to HTML
    return marked.parse(markdown) as string;
};

// Helper to convert HTML/Markdown to plain text (for X article publishing)
const htmlToPlainText = (html: string): string => {
    // Create a temporary element to parse HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Get text content, preserving line breaks
    const getText = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || '';
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            const tag = el.tagName.toLowerCase();

            // Block elements that should have line breaks
            const blockTags = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'br', 'hr'];
            const isBlock = blockTags.includes(tag);

            let text = '';
            for (const child of Array.from(node.childNodes)) {
                text += getText(child);
            }

            // Add line breaks after block elements
            if (isBlock && text.trim()) {
                text += '\n';
            }

            // Special handling for list items
            if (tag === 'li') {
                text = '• ' + text;
            }

            return text;
        }

        return '';
    };

    let result = getText(temp);

    // Clean up multiple newlines
    result = result.replace(/\n{3,}/g, '\n\n');

    return result.trim();
};

// Helper to convert Markdown to plain text
const markdownToPlainText = (markdown: string): string => {
    if (!markdown) return '';

    // If it's already HTML, convert to plain text
    if (markdown.trim().startsWith('<')) {
        return htmlToPlainText(markdown);
    }

    // Convert markdown to HTML first, then to plain text
    const html = marked.parse(markdown) as string;
    return htmlToPlainText(html);
};

// Helper to render code block as image (returns base64 data URL)
const renderCodeBlockToImage = async (code: string, language?: string): Promise<string> => {
    // Create a canvas to render the code block
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // Calculate dimensions
    const padding = 32;
    const lineHeight = 24;
    const fontSize = 14;
    const lines = code.split('\n');
    const maxLineLength = Math.max(...lines.map(l => l.length));

    // Set canvas size
    canvas.width = Math.max(400, Math.min(800, maxLineLength * 8.5 + padding * 2));
    canvas.height = lines.length * lineHeight + padding * 2 + (language ? 30 : 0);

    // Draw background
    ctx.fillStyle = '#1e1e1e';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 12);
    ctx.fill();

    // Draw language label if present
    let yOffset = padding;
    if (language) {
        ctx.fillStyle = '#6a9955';
        ctx.font = `bold 12px "SF Mono", Monaco, Consolas, monospace`;
        ctx.fillText(language.toUpperCase(), padding, yOffset);
        yOffset += 24;
    }

    // Draw code lines
    ctx.fillStyle = '#d4d4d4';
    ctx.font = `${fontSize}px "SF Mono", Monaco, Consolas, monospace`;

    lines.forEach((line, index) => {
        // Simple syntax highlighting
        let displayLine = line;
        ctx.fillStyle = '#d4d4d4';

        // Highlight comments
        if (line.trim().startsWith('//') || line.trim().startsWith('#')) {
            ctx.fillStyle = '#6a9955';
        }
        // Highlight strings
        else if (line.includes('"') || line.includes("'")) {
            ctx.fillStyle = '#ce9178';
        }
        // Highlight keywords
        else if (/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await)\b/.test(line)) {
            ctx.fillStyle = '#569cd6';
        }

        ctx.fillText(displayLine, padding, yOffset + (index + 1) * lineHeight);
    });

    return canvas.toDataURL('image/png');
};

// Extract code blocks from markdown and replace with placeholders
const extractCodeBlocks = (markdown: string): { content: string; codeBlocks: Array<{ code: string; language?: string }> } => {
    const codeBlocks: Array<{ code: string; language?: string }> = [];
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;

    const content = markdown.replace(codeBlockRegex, (_, language, code) => {
        const index = codeBlocks.length;
        codeBlocks.push({ code: code.trim(), language: language || undefined });
        return `\n[CODE_BLOCK_${index}]\n`;
    });

    return { content, codeBlocks };
};

// TipTap WYSIWYG Editor Component
interface TipTapEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

const TipTapEditor: React.FC<TipTapEditorProps> = ({ value, onChange, placeholder }) => {
    const initializedRef = useRef(false);
    const [initialHtml] = useState(() => markdownToHtml(value));

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: {
                    levels: [1, 2, 3],
                },
                bulletList: {
                    keepMarks: true,
                    keepAttributes: false,
                },
                orderedList: {
                    keepMarks: true,
                    keepAttributes: false,
                },
            }),
            Placeholder.configure({
                placeholder: placeholder || '开始写作... (输入 # 空格 创建标题，**文字** 加粗)',
            }),
            Typography,
        ],
        content: initialHtml,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML());
        },
        editorProps: {
            attributes: {
                class: 'tiptap-editor p-3 min-h-[200px] outline-none text-sm text-[var(--text-primary)] leading-relaxed focus:outline-none',
            },
        },
    });

    // Update content when value changes externally (e.g., from backend)
    useEffect(() => {
        if (editor && value && !initializedRef.current) {
            const html = markdownToHtml(value);
            editor.commands.setContent(html);
            initializedRef.current = true;
        }
    }, [editor, value]);

    return (
        <div className="tiptap-container overflow-hidden">
            <EditorContent editor={editor} />
            <style>{`
                .tiptap-container {
                    position: relative;
                }
                .tiptap-container .tiptap {
                    min-height: 200px;
                }
                .tiptap-container .tiptap p.is-editor-empty:first-child::before {
                    content: attr(data-placeholder);
                    float: left;
                    color: var(--text-secondary);
                    pointer-events: none;
                    height: 0;
                }
                .tiptap-container .tiptap p { margin-bottom: 0.5rem; }
                .tiptap-container .tiptap h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.75rem; }
                .tiptap-container .tiptap h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem; }
                .tiptap-container .tiptap h3 { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.5rem; }
                .tiptap-container .tiptap ul { list-style-type: disc; padding-left: 1.5rem; margin-bottom: 0.5rem; }
                .tiptap-container .tiptap ol { list-style-type: decimal; padding-left: 1.5rem; margin-bottom: 0.5rem; }
                .tiptap-container .tiptap li { margin-bottom: 0.25rem; }
                .tiptap-container .tiptap blockquote { border-left: 3px solid var(--border-color); padding-left: 1rem; font-style: italic; color: var(--text-secondary); margin: 0.5rem 0; }
                .tiptap-container .tiptap code { background: var(--bg-tertiary); padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-family: monospace; font-size: 0.875rem; }
                .tiptap-container .tiptap pre { background: var(--bg-tertiary); padding: 0.75rem; border-radius: 0.5rem; font-family: monospace; overflow-x: auto; margin: 0.5rem 0; }
                .tiptap-container .tiptap pre code { background: none; padding: 0; }
                .tiptap-container .tiptap strong { font-weight: 700; }
                .tiptap-container .tiptap em { font-style: italic; }
                .tiptap-container .tiptap s { text-decoration: line-through; }
                .tiptap-container .tiptap hr { border: none; border-top: 1px solid var(--border-color); margin: 1rem 0; }
            `}</style>
        </div>
    );
};

// Article data structure from backend
export interface ArticleData {
    title: string;
    subtitle?: string;
    summary: string;
    header_image?: {
        prompt: string;
        description: string;
        url?: string;
    };
    content: string;
    inline_images?: Array<{
        position: string;
        prompt: string;
        description: string;
        url?: string;
    }>;
    tags: string[];
    estimated_read_time: string;
    reference_sources?: Array<{
        title: string;
        url: string;
    }>;
}

export interface ArticleCardProps {
    data: ArticleData;
    currentUser?: {
        name: string;
        handle: string;
        avatar: string;
        verified: boolean;
    } | null;
    onGenerateHeaderImage?: () => void;
    isGeneratingImage?: boolean;
    onPublish?: (editedData: ArticleData) => void;
    isPublishing?: boolean;
    onSaveDraft?: (editedData: ArticleData) => void;
    isSavingDraft?: boolean;
    onDataChange?: (editedData: ArticleData) => void;
    borderless?: boolean; // 无边框模式，用于草稿箱
}

export const ArticleCard: React.FC<ArticleCardProps> = ({
    data,
    currentUser,
    onGenerateHeaderImage,
    isGeneratingImage = false,
    onPublish,
    isPublishing = false,
    onSaveDraft,
    isSavingDraft = false,
    onDataChange,
    borderless = false,
}) => {
    const { t } = useLanguage();
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    // Editable state
    const [editableTitle, setEditableTitle] = useState(data.title);
    const [editableSubtitle, setEditableSubtitle] = useState(data.subtitle || '');
    const [editableSummary, setEditableSummary] = useState(data.summary);
    const [editableContent, setEditableContent] = useState(data.content);
    const [originalMarkdown, setOriginalMarkdown] = useState(data.content); // 保存原始 Markdown 用于复制
    const [showOriginal, setShowOriginal] = useState(false);
    const [draftSaved, setDraftSaved] = useState(false);
    const [autoPublish, setAutoPublish] = useState(true);
    const [copied, setCopied] = useState(false);
    const [processingCodeBlocks, setProcessingCodeBlocks] = useState(false);

    // Image generation state
    const [generatingImage, setGeneratingImage] = useState(false);
    const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(data.header_image?.url || null);
    const [imageError, setImageError] = useState<string | null>(null);

    // Generate header image
    const handleGenerateHeaderImage = async () => {
        const prompt = data.header_image?.prompt;
        if (!prompt) return;

        setGeneratingImage(true);
        setImageError(null);

        try {
            const formData = new FormData();
            formData.append('prompt', prompt);
            formData.append('model', 'nano-banana');

            const response = await authService.fetchWithAuth(`${process.env.API_BASE_URL || 'http://localhost:8000'}/api/v1/ai/generate-image`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                let errorMsg = 'Failed to generate image';
                try {
                    const errorBody = await response.json();
                    if (typeof errorBody.detail === 'string') {
                        errorMsg = errorBody.detail;
                    } else if (errorBody.message) {
                        errorMsg = errorBody.message;
                    }
                } catch {
                    if (response.status === 402) {
                        errorMsg = 'Insufficient credits';
                    } else if (response.status === 401) {
                        errorMsg = 'Please login to generate images';
                    }
                }
                setImageError(errorMsg);
                return;
            }

            const result = await response.json();
            if (result.data && result.data[0]) {
                const src = `data:${result.data[0].mime_type};base64,${result.data[0].b64_json}`;
                setGeneratedImageUrl(src);
            } else {
                setImageError('No image data received');
            }
        } catch (error) {
            console.error('Image generation error:', error);
            setImageError('Network error, please try again');
        } finally {
            setGeneratingImage(false);
        }
    };

    // Sync with incoming data (only on initial load)
    const initializedRef = useRef(false);
    useEffect(() => {
        if (!initializedRef.current) {
            setEditableTitle(data.title);
            setEditableSubtitle(data.subtitle || '');
            setEditableSummary(data.summary);
            setEditableContent(data.content);
            setOriginalMarkdown(data.content); // 保存原始 Markdown
            initializedRef.current = true;
        }
    }, [data]);

    // Get current edited data
    const getEditedData = useCallback((): ArticleData => ({
        ...data,
        title: editableTitle,
        subtitle: editableSubtitle || undefined,
        summary: editableSummary,
        content: editableContent,
        header_image: generatedImageUrl ? {
            ...data.header_image,
            url: generatedImageUrl,
        } : data.header_image,
    }), [data, editableTitle, editableSubtitle, editableSummary, editableContent, generatedImageUrl]);

    // Notify parent of changes
    useEffect(() => {
        if (onDataChange && initializedRef.current) {
            onDataChange(getEditedData());
        }
    }, [editableTitle, editableSubtitle, editableSummary, editableContent]);

    const handlePublish = useCallback(async () => {
        const articleData = getEditedData();
        const title = articleData.title;

        // Use original markdown for processing
        const markdownContent = originalMarkdown;

        // Process markdown to get HTML with code block and image placeholders
        const { html: processedHtml, codeBlocks, imageBlocks } = MarkdownPasteProcessor.processMarkdownStatic(markdownContent);
        console.log('[ArticleCard] Publishing article, code blocks:', codeBlocks.length, 'image blocks:', imageBlocks.length);

        if (!title.trim()) {
            console.error('[ArticleCard] Cannot publish: title is empty');
            return;
        }

        // imageBlocks now contains { index, url } pairs extracted from [📷 图片N](url)
        // The HTML now has simple [IMAGE_N] placeholders instead
        console.log('[ArticleCard] Image blocks:', imageBlocks);

        // Step 1: Check if we're on the articles compose/edit page
        let currentUrl = window.location.href;
        let isOnArticlesPage = currentUrl.startsWith('https://x.com/compose/articles');
        let needsNavigation = !isOnArticlesPage;

        if (needsNavigation) {
            // Store data for after navigation
            localStorage.setItem('bnbot_pending_article', JSON.stringify({
                title,
                content: markdownContent,
                html: processedHtml,
                imageBlocks
            }));

            // Try to find and click a link to trigger SPA navigation
            const articlesLink = document.querySelector('a[href="/compose/articles"]') as HTMLAnchorElement;
            if (articlesLink) {
                articlesLink.click();
            } else {
                // Create a temporary link and click it for SPA navigation
                const tempLink = document.createElement('a');
                tempLink.href = '/compose/articles';
                tempLink.style.display = 'none';
                document.body.appendChild(tempLink);
                tempLink.click();
                document.body.removeChild(tempLink);
            }

            // Wait for navigation to complete and page to load
            console.log('[ArticleCard] Navigating to articles page, waiting for load...');
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Update URL after navigation
            currentUrl = window.location.href;
        }

        // Re-check current state after potential navigation
        const isOnArticleEditPage = currentUrl.includes('/compose/articles/edit');

        // Check if we're already in an article editor with empty content
        const existingEditor = document.querySelector('[data-testid="composer"][contenteditable="true"]') as HTMLElement;
        const existingContent = existingEditor?.textContent?.trim() || '';

        // Only create new if:
        // 1. We're on the articles list page (not edit page) AND there's no empty editor already open
        // 2. OR we're on edit page but the editor has content (user is editing an existing article)
        const hasEmptyEditorReady = existingEditor && existingContent.length === 0;
        const shouldCreateNew = !isOnArticleEditPage && !hasEmptyEditorReady;

        console.log('[ArticleCard] isOnArticleEditPage:', isOnArticleEditPage, 'hasEmptyEditorReady:', hasEmptyEditorReady, 'existingContent length:', existingContent.length, 'shouldCreateNew:', shouldCreateNew);

        // Step 2: Find and click the create button (only if we need to create new)
        if (shouldCreateNew) {
            // Support both Chinese and English UI (case variations)
            const createButton = document.querySelector('button[aria-label="create"], button[aria-label="Create"]') as HTMLButtonElement;
            if (createButton) {
                createButton.click();
                console.log('[ArticleCard] Clicked create button');
                // Wait for the editor to fully load (increase wait time for slower connections)
                await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
                console.warn('[ArticleCard] Create button not found, maybe editor is already open');
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } else {
            console.log('[ArticleCard] Using existing empty editor');
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Step 3: Fill in the title
        const fillTitle = () => {
            // Support both Chinese and English UI
            const titleTextarea = document.querySelector('textarea[name="文章标题"], textarea[placeholder="添加标题"], textarea[name="Article Title"], textarea[placeholder="Add a title"]') as HTMLTextAreaElement;
            if (titleTextarea) {
                titleTextarea.focus();
                titleTextarea.value = title;
                titleTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                titleTextarea.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('[ArticleCard] Filled title:', title);
                return true;
            }
            return false;
        };

        // Step 4: Fill in the content by dispatching paste event
        const fillContent = async () => {
            // Target the contenteditable element directly
            const contentEditor = document.querySelector('[data-testid="composer"][contenteditable="true"]') as HTMLElement;
            if (contentEditor) {
                contentEditor.focus();

                // Wait longer for focus and editor to be ready
                await new Promise(resolve => setTimeout(resolve, 500));

                try {
                    // Set pending code blocks before dispatching paste event
                    MarkdownPasteProcessor.setPendingCodeBlocks(codeBlocks);

                    // Create a DataTransfer with processed HTML and plain text
                    const dataTransfer = new DataTransfer();
                    dataTransfer.setData('text/html', processedHtml);
                    dataTransfer.setData('text/plain', markdownContent);

                    // Create paste event
                    const pasteEvent = new ClipboardEvent('paste', {
                        bubbles: true,
                        cancelable: true,
                        clipboardData: dataTransfer
                    });

                    // Dispatch paste event - MarkdownPasteProcessor will handle it
                    contentEditor.dispatchEvent(pasteEvent);
                    console.log('[ArticleCard] Dispatched paste event with processed HTML, code blocks:', codeBlocks.length);

                    return true;
                } catch (err) {
                    console.error('[ArticleCard] Content fill failed:', err);
                    return false;
                }
            }
            return false;
        };

        // Try to fill with retries
        let titleFilled = false;
        let contentFilled = false;
        let attempts = 0;
        const maxAttempts = 20;

        const tryFill = async () => {
            while (attempts < maxAttempts && (!titleFilled || !contentFilled)) {
                attempts++;

                if (!titleFilled) {
                    titleFilled = fillTitle();
                }

                if (!contentFilled && titleFilled) {
                    contentFilled = await fillContent();
                }

                if (!titleFilled || !contentFilled) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }

            if (attempts >= maxAttempts) {
                console.warn('[ArticleCard] Max attempts reached for filling article');
            }
        };

        await tryFill();

        // Step 5: Upload images if any
        if (imageBlocks.length > 0 && contentFilled) {
            console.log('[ArticleCard] Starting image upload process...');

            // Wait for content to be fully rendered
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 1: Download all images concurrently (using imageBlocks)
            console.log('[ArticleCard] Downloading all images concurrently...');
            const downloadPromises = imageBlocks.map((block) =>
                new Promise<{ index: number; success: boolean; data?: string; mimeType?: string; error?: string }>((resolve) => {
                    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                        chrome.runtime.sendMessage({
                            type: 'FETCH_IMAGE',
                            url: block.url
                        }, (response: { success: boolean; data?: string; mimeType?: string; error?: string }) => {
                            resolve({ index: block.index, ...response });
                        });
                    } else {
                        resolve({ index: block.index, success: false, error: 'Chrome runtime not available' });
                    }
                })
            );

            const downloadedImages = await Promise.all(downloadPromises);
            console.log('[ArticleCard] All images downloaded, successful:', downloadedImages.filter(r => r.success).length);

            // Helper: Wait for upload to complete
            const waitForUploadComplete = async (maxWaitMs: number = 30000): Promise<boolean> => {
                const startTime = Date.now();
                await new Promise(resolve => setTimeout(resolve, 200));

                while (Date.now() - startTime < maxWaitMs) {
                    const cancelButton = Array.from(document.querySelectorAll('button')).find(
                        btn => btn.textContent?.includes('取消上传')
                    );
                    if (!cancelButton) {
                        console.log('[ArticleCard] Upload completed');
                        return true;
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                console.warn('[ArticleCard] Upload timeout');
                return false;
            };

            // Function to upload a single image
            const uploadSingleImage = async (imageNumber: number, base64Data: string, mimeType?: string): Promise<boolean> => {
                try {
                    const editor = document.querySelector('.public-DraftEditor-content') as HTMLElement;
                    if (!editor) return false;

                    // Use simpler placeholder format for easier matching
                    const placeholder = `[IMG_${imageNumber}]`;
                    const legacyPlaceholder = `[🌉IMAGE_${imageNumber}]`;
                    const blocks = Array.from(editor.querySelectorAll('[data-block="true"]'));
                    let placeholderBlock: HTMLElement | null = null;

                    for (const block of blocks) {
                        const text = block.textContent?.trim() || '';
                        // Match both new and legacy placeholder formats
                        if (text === placeholder || text === legacyPlaceholder ||
                            text.includes(placeholder) || text.includes(legacyPlaceholder) ||
                            text.includes(`IMG_${imageNumber}]`) || text.includes(`IMAGE_${imageNumber}]`)) {
                            placeholderBlock = block as HTMLElement;
                            break;
                        }
                    }

                    if (!placeholderBlock) {
                        console.error(`[ArticleCard] Placeholder ${placeholder} not found`);
                        return false;
                    }

                    // Click on the block first
                    placeholderBlock.click();
                    await new Promise(resolve => setTimeout(resolve, 150));

                    // Select entire block content using triple-click simulation or selectNodeContents
                    const selection = window.getSelection();
                    if (selection) {
                        const range = document.createRange();
                        // Select the entire block element, not just its contents
                        range.selectNodeContents(placeholderBlock);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                    await new Promise(resolve => setTimeout(resolve, 150));

                    // Delete the entire selected content
                    document.execCommand('delete', false);
                    await new Promise(resolve => setTimeout(resolve, 300));

                    // Click insert button (support both Chinese and English UI)
                    const toolbar = document.querySelector('#toolbar-styling-buttons');
                    const lastDiv = toolbar?.querySelector(':scope > div:last-child');
                    const insertButton = lastDiv?.querySelector('button[aria-label="添加媒体内容"], button[aria-label="Add Media"]') as HTMLButtonElement;
                    if (!insertButton) return false;

                    insertButton.click();
                    await new Promise(resolve => setTimeout(resolve, 300));

                    // Find menu and click media
                    let menu: Element | null = null;
                    for (let attempt = 0; attempt < 10; attempt++) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                        menu = document.querySelector('[role="menu"]');
                        if (menu) break;
                    }
                    if (!menu) return false;

                    const menuItems = menu.querySelectorAll('[role="menuitem"]');
                    const mediaMenuItem = menuItems[0] as HTMLElement;
                    if (mediaMenuItem) {
                        mediaMenuItem.click();
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }

                    // Find file input
                    let sheetDialog: Element | null = null;
                    for (let attempt = 0; attempt < 5; attempt++) {
                        sheetDialog = document.querySelector('[data-testid="sheetDialog"]');
                        if (sheetDialog) break;
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                    if (!sheetDialog) return false;

                    const fileInput = sheetDialog.querySelector('input[data-testid="fileInput"]') as HTMLInputElement;
                    if (!fileInput) return false;

                    // Create and upload file
                    const mime = mimeType || 'image/jpeg';
                    const byteString = atob(base64Data);
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let j = 0; j < byteString.length; j++) {
                        ia[j] = byteString.charCodeAt(j);
                    }
                    const blob = new Blob([ab], { type: mime });
                    const file = new File([blob], `image_${imageNumber}.${mime.split('/')[1] || 'jpg'}`, { type: mime });

                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);
                    fileInput.files = dataTransfer.files;
                    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

                    console.log(`[ArticleCard] Triggered upload for image ${imageNumber}`);
                    await waitForUploadComplete();
                    return true;

                } catch (e) {
                    console.error(`[ArticleCard] Error uploading image ${imageNumber}:`, e);
                    return false;
                }
            };

            // Create floating UI for image uploads (next to editor)
            const showImageUploadUI = () => {
                const existingUI = document.getElementById('bnbot-image-upload-ui');
                if (existingUI) existingUI.remove();

                // Find the composer container to position relative to it
                const composerContainer = document.querySelector('[data-testid="composerRichTextInputContainer"]') as HTMLElement;
                if (!composerContainer) {
                    console.error('[ArticleCard] Composer container not found');
                    return;
                }

                // Detect language from page
                const isEnglish = document.documentElement.lang?.startsWith('en') ||
                    document.querySelector('html')?.getAttribute('lang')?.startsWith('en') ||
                    !document.querySelector('textarea[name="文章标题"]');

                // Bilingual text
                const i18n = {
                    imagesToUpload: isEnglish ? 'Images to Upload' : '待上传图片',
                    uploadAll: isEnglish ? 'Upload All' : '全部上传',
                    image: isEnglish ? 'Image' : '图片',
                    upload: isEnglish ? 'Upload' : '上传',
                    uploaded: isEnglish ? 'uploaded' : '已上传',
                    retry: isEnglish ? 'Retry' : '重试',
                    count: isEnglish ? '' : '张',
                };

                // Get composer position
                const rect = composerContainer.getBoundingClientRect();

                const container = document.createElement('div');
                container.id = 'bnbot-image-upload-ui';
                container.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    left: ${Math.max(20, rect.left - 340)}px;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
                    padding: 16px;
                    z-index: 10001;
                    width: 300px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    transition: all 0.3s ease;
                `;

                const successfulImages = downloadedImages.filter(r => r.success);

                container.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; cursor: pointer;" id="bnbot-image-header">
                        <strong style="font-size: 14px;">${i18n.imagesToUpload} (${successfulImages.length}${i18n.count})</strong>
                        <span id="bnbot-image-toggle" style="font-size: 14px; color: #666; transition: transform 0.3s ease;">▼</span>
                    </div>
                    <div id="bnbot-image-content">
                        <div id="bnbot-image-list" style="margin-bottom: 12px; max-height: 40vh; overflow-y: auto;"></div>
                        <button id="bnbot-upload-all" style="
                            width: 100%;
                            background: #0f1419;
                            color: white;
                            border: none;
                            border-radius: 9999px;
                            padding: 10px;
                            font-size: 14px;
                            font-weight: 700;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            gap: 6px;
                        "><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.59 5.58L20 12l-8-8-8 8z"/></svg>${i18n.uploadAll}</button>
                    </div>
                `;

                const list = container.querySelector('#bnbot-image-list')!;

                successfulImages.forEach((img) => {
                    const item = document.createElement('div');
                    item.id = `bnbot-image-item-${img.index}`;
                    item.style.cssText = `
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        padding: 8px;
                        background: #f7f9f9;
                        border-radius: 8px;
                        margin-bottom: 8px;
                    `;
                    item.innerHTML = `
                        <span style="font-size: 13px; flex: 1;">${i18n.image} ${img.index}</span>
                        <button class="bnbot-upload-single" data-index="${img.index}" style="
                            background: #0f1419;
                            color: white;
                            border: none;
                            border-radius: 9999px;
                            padding: 6px 16px;
                            font-size: 13px;
                            font-weight: 700;
                            cursor: pointer;
                        ">${i18n.upload}</button>
                    `;
                    list.appendChild(item);
                });

                document.body.appendChild(container);

                // Listen for URL changes to hide panel when leaving articles page
                const checkUrl = () => {
                    const currentUrl = window.location.href;
                    if (!currentUrl.includes('/compose/articles')) {
                        container.remove();
                        // Clean up observer
                        if (urlObserver) urlObserver.disconnect();
                    }
                };

                // Use MutationObserver to detect SPA navigation
                const urlObserver = new MutationObserver(() => {
                    checkUrl();
                });
                urlObserver.observe(document.body, { childList: true, subtree: true });

                // Also listen for popstate (browser back/forward)
                const popstateHandler = () => checkUrl();
                window.addEventListener('popstate', popstateHandler);

                // Clean up when container is removed
                const containerObserver = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        for (const node of mutation.removedNodes) {
                            if (node === container) {
                                urlObserver.disconnect();
                                window.removeEventListener('popstate', popstateHandler);
                                containerObserver.disconnect();
                                return;
                            }
                        }
                    }
                });
                containerObserver.observe(document.body, { childList: true });

                // Helper to disable/enable all buttons
                const setButtonsDisabled = (disabled: boolean) => {
                    container.querySelectorAll('button').forEach(btn => {
                        (btn as HTMLButtonElement).disabled = disabled;
                        btn.style.opacity = disabled ? '0.5' : '1';
                        btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
                    });
                };

                // Toggle collapse/expand
                let isCollapsed = false;
                const header = container.querySelector('#bnbot-image-header');
                const content = container.querySelector('#bnbot-image-content') as HTMLElement;
                const toggle = container.querySelector('#bnbot-image-toggle') as HTMLElement;

                header?.addEventListener('click', () => {
                    isCollapsed = !isCollapsed;
                    const headerEl = header as HTMLElement;
                    if (isCollapsed) {
                        content.style.display = 'none';
                        toggle.style.transform = 'rotate(-90deg)';
                        container.style.padding = '12px 16px';
                        headerEl.style.marginBottom = '0';
                    } else {
                        content.style.display = 'block';
                        toggle.style.transform = 'rotate(0deg)';
                        container.style.padding = '16px';
                        headerEl.style.marginBottom = '12px';
                    }
                });

                // Single upload buttons
                container.querySelectorAll('.bnbot-upload-single').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const target = e.target as HTMLButtonElement;
                        if (target.disabled) return;

                        const index = parseInt(target.dataset.index || '0');
                        const img = downloadedImages.find(d => d.index === index);
                        if (!img) return;

                        // Disable all buttons during upload
                        setButtonsDisabled(true);
                        target.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';

                        const success = await uploadSingleImage(img.index, img.data!, img.mimeType);

                        if (success) {
                            const item = document.getElementById(`bnbot-image-item-${index}`);
                            if (item) {
                                item.innerHTML = `<span style="font-size: 13px; color: #22c55e;">✓ ${i18n.image} ${index} ${i18n.uploaded}</span>`;
                            }
                        } else {
                            target.textContent = i18n.retry;
                            target.style.background = '#ef4444';
                        }

                        // Re-enable buttons
                        setButtonsDisabled(false);
                    });
                });

                // Upload all button
                container.querySelector('#bnbot-upload-all')?.addEventListener('click', async () => {
                    const uploadAllBtn = container.querySelector('#bnbot-upload-all') as HTMLButtonElement;
                    if (uploadAllBtn.disabled) return;

                    // Disable all buttons
                    setButtonsDisabled(true);
                    uploadAllBtn.innerHTML = '<span class="loading loading-spinner loading-sm"></span>';

                    for (const img of successfulImages) {
                        const item = document.getElementById(`bnbot-image-item-${img.index}`);
                        if (!item || item.textContent?.includes(i18n.uploaded)) continue;

                        const btn = item.querySelector('.bnbot-upload-single') as HTMLButtonElement;
                        if (btn) {
                            btn.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';
                        }

                        const success = await uploadSingleImage(img.index, img.data!, img.mimeType);

                        if (success && item) {
                            item.innerHTML = `<span style="font-size: 13px; color: #22c55e;">✓ ${i18n.image} ${img.index} ${i18n.uploaded}</span>`;
                        }
                    }

                    uploadAllBtn.textContent = isEnglish ? 'All Done ✓' : '全部完成 ✓';
                    uploadAllBtn.style.background = '#22c55e';
                    setTimeout(() => container.remove(), 2000);
                });
            };

            // Show the upload UI
            showImageUploadUI();
            console.log('[ArticleCard] Image upload UI displayed');
        }

        // Call onPublish callback if provided
        if (onPublish) {
            onPublish(articleData);
        }
    }, [onPublish, getEditedData, originalMarkdown]);

    const handleSaveDraft = useCallback(async () => {
        if (onSaveDraft) {
            try {
                let articleData = getEditedData();

                // Upload header image if it's base64
                if (generatedImageUrl && mediaService.isBase64Url(generatedImageUrl)) {
                    console.log('[ArticleCard] Uploading header image before save...');
                    const uploaded = await mediaService.uploadBase64Image(
                        generatedImageUrl,
                        `article-header-${Date.now()}`
                    );
                    console.log('[ArticleCard] Header image uploaded:', uploaded.url);

                    // Update local state with uploaded URL
                    setGeneratedImageUrl(uploaded.url);

                    // Update article data with uploaded URL
                    articleData = {
                        ...articleData,
                        header_image: {
                            ...articleData.header_image,
                            url: uploaded.url,
                        },
                    };
                }

                onSaveDraft(articleData);
                // 显示保存成功状态
                setTimeout(() => {
                    setDraftSaved(true);
                    // 2秒后恢复
                    setTimeout(() => setDraftSaved(false), 2000);
                }, 500);
            } catch (error) {
                console.error('[ArticleCard] Failed to save draft:', error);
            }
        }
    }, [onSaveDraft, getEditedData, generatedImageUrl]);

    return (
        <div
            data-no-selection-menu="true"
            data-color-mode={isDark ? 'dark' : 'light'}
            className={`flex flex-col gap-0 bg-[var(--bg-primary)] overflow-hidden ${borderless ? '' : 'rounded-2xl'}`}
            style={borderless ? {} : { border: '1px solid var(--border-color)' }}
        >
            {/* Header Image */}
            {generatedImageUrl ? (
                <div className="w-full aspect-video bg-[var(--bg-secondary)] overflow-hidden relative group">
                    <ImageWithSkeleton
                        src={generatedImageUrl}
                        alt={editableTitle}
                        className="w-full h-full object-cover"
                    />
                    {/* Regenerate button on hover */}
                    {data.header_image?.prompt && (
                        <button
                            onClick={handleGenerateHeaderImage}
                            disabled={generatingImage}
                            className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] text-xs font-medium hover:opacity-90 transition-all shadow-sm disabled:opacity-50 cursor-pointer opacity-0 group-hover:opacity-100"
                        >
                            <Sparkles size={12} />
                            {generatingImage ? '生成中...' : '重新生成'}
                        </button>
                    )}
                </div>
            ) : data.header_image?.prompt ? (
                <div className="w-full aspect-video bg-[#fafafa] dark:bg-[#1a1a1a] relative flex items-center justify-center p-6 group">
                    {/* Generate Button - Top Right - Show on hover */}
                    <button
                        onClick={handleGenerateHeaderImage}
                        disabled={generatingImage}
                        className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] text-xs font-medium hover:opacity-90 transition-all shadow-sm disabled:opacity-50 cursor-pointer opacity-0 group-hover:opacity-100"
                    >
                        <Sparkles size={12} />
                        {generatingImage ? '生成中...' : '生成图片'}
                    </button>

                    {generatingImage ? (
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-10 h-10 rounded-full border-2 border-[var(--text-secondary)] border-t-transparent animate-spin" />
                            <span className="text-sm text-[var(--text-secondary)]">生成图片中...</span>
                        </div>
                    ) : imageError ? (
                        <div className="flex flex-col items-center gap-2">
                            <p className="text-xs text-red-500 text-center">{imageError}</p>
                            <p className="text-xs text-[var(--text-tertiary)] text-center max-w-[80%] leading-relaxed">
                                {data.header_image.description}
                            </p>
                        </div>
                    ) : (
                        <p className="text-xs text-[var(--text-tertiary)] text-center max-w-[80%] leading-relaxed">
                            {data.header_image.description}
                        </p>
                    )}
                </div>
            ) : null}

            {/* Content Section */}
            <div className="px-4 pt-2 pb-4">
                {/* Title */}
                <div className="mb-2">
                    <AutoResizeTextarea
                        value={editableTitle}
                        onChange={(e) => setEditableTitle(e.target.value)}
                        className="w-full text-xl font-bold bg-transparent border-none outline-none resize-none p-0 text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
                        placeholder="文章标题..."
                    />
                </div>

                {/* Main Content - TipTap WYSIWYG Editor or Raw Markdown */}
                <div className="article-content mb-3">
                    {showOriginal ? (
                        <pre className="text-sm text-[var(--text-primary)] whitespace-pre-wrap font-mono p-3 min-h-[200px] leading-relaxed">
                            {originalMarkdown}
                        </pre>
                    ) : (
                        <TipTapEditor
                            value={editableContent}
                            onChange={setEditableContent}
                            placeholder="开始写作... (输入 # 空格 创建标题，**文字** 加粗)"
                        />
                    )}
                </div>

                {/* Show Original Button - Below editor */}
                <div className="mt-2 flex items-center gap-2">
                    <button
                        onClick={() => setShowOriginal(!showOriginal)}
                        className="flex items-center gap-1.5 px-3 h-8 rounded-full text-xs text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] transition-colors cursor-pointer"
                    >
                        <FileText size={14} />
                        <span>{showOriginal ? (t.article?.showEditor || 'Show Editor') : (t.article?.showOriginal || 'Show Original')}</span>
                    </button>
                    <button
                        onClick={async () => {
                            try {
                                // Process markdown and generate HTML with code block placeholders
                                const { html, codeBlocks } = MarkdownPasteProcessor.processMarkdownStatic(originalMarkdown);

                                console.log('[ArticleCard] Copying processed HTML, code blocks:', codeBlocks.length);

                                // Copy with both HTML and plain text
                                const htmlBlob = new Blob([html], { type: 'text/html' });
                                const textBlob = new Blob([originalMarkdown], { type: 'text/plain' });

                                await navigator.clipboard.write([
                                    new ClipboardItem({
                                        'text/html': htmlBlob,
                                        'text/plain': textBlob
                                    })
                                ]);

                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            } catch (err) {
                                console.error('[ArticleCard] Copy failed:', err);
                                // Fallback to plain text
                                await navigator.clipboard.writeText(originalMarkdown);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            }
                        }}
                        className={`flex items-center gap-1.5 px-3 h-8 rounded-full text-xs transition-colors cursor-pointer ${copied
                            ? 'text-green-500'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
                            }`}
                    >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copied ? (t.article?.copied || 'Copied') : (t.article?.copyContent || 'Copy Content')}</span>
                    </button>
                </div>

                {/* Tags */}
                {data.tags && data.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[var(--border-color)]">
                        {data.tags.map((tag, index) => (
                            <span
                                key={index}
                                className="px-2.5 py-1 rounded-full bg-[var(--bg-secondary)] text-xs text-[#1d9bf0] font-medium hover:bg-[var(--hover-bg)] cursor-pointer transition-colors"
                                onClick={(e) => e.stopPropagation()}
                            >
                                #{tag}
                            </span>
                        ))}
                    </div>
                )}

                {/* Reference Sources */}
                {data.reference_sources && data.reference_sources.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
                        <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">Sources</div>
                        <div className="flex flex-col gap-1.5">
                            {data.reference_sources.map((source, index) => {
                                // 兼容两种格式：字符串数组或对象数组
                                const url = typeof source === 'string' ? source : source.url;
                                const title = typeof source === 'string' ? null : source.title;

                                if (!url) return null;

                                return (
                                    <a
                                        key={index}
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 text-xs text-[#1d9bf0] hover:underline cursor-pointer"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <ExternalLink size={10} className="shrink-0" />
                                        <span className="truncate">{title || url}</span>
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex justify-between items-center gap-3 mt-4 pt-4 border-t border-[var(--border-color)]">
                    {/* Left side - Auto Publish Toggle */}
                    <div
                        className="flex items-center gap-2 cursor-pointer group"
                        onClick={(e) => {
                            e.stopPropagation();
                            setAutoPublish(!autoPublish);
                        }}
                        title={autoPublish ? (t.article?.autoPublishOn || "Auto-publish enabled") : (t.article?.autoPublishOff || "Auto-publish disabled")}
                    >
                        <span className="text-[11px] text-[var(--text-secondary)] font-medium group-hover:text-[var(--text-primary)] transition-colors">
                            {t.article?.autoPublish || 'Auto-publish'}
                        </span>
                        <div
                            className={`w-9 h-5 rounded-full transition-colors flex items-center shadow-sm ${autoPublish ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                        >
                            <div
                                className="w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200"
                                style={{ transform: autoPublish ? 'translateX(17px)' : 'translateX(2px)' }}
                            />
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={handleSaveDraft}
                            disabled={isSavingDraft || draftSaved || !editableTitle.trim()}
                            className={`px-4 h-9 rounded-full font-bold text-sm transition-all duration-200 flex items-center justify-center gap-2 border ${draftSaved
                                    ? 'border-green-500 text-green-500 cursor-default'
                                    : isSavingDraft || !editableTitle.trim()
                                        ? 'border-[var(--border-color)] text-[var(--text-secondary)] cursor-not-allowed opacity-50'
                                        : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--hover-bg)] cursor-pointer'
                                }`}
                        >
                            {draftSaved ? (
                                <>
                                    <Check size={14} />
                                    <span>{t.article?.saved || 'Saved'}</span>
                                </>
                            ) : isSavingDraft ? (
                                <>
                                    <span className="loading loading-spinner loading-xs"></span>
                                    <span>{t.article?.saving || 'Saving...'}</span>
                                </>
                            ) : (
                                <span>{t.article?.saveDraft || 'Save Draft'}</span>
                            )}
                        </button>

                        <button
                            onClick={handlePublish}
                            disabled={isPublishing || !editableTitle.trim()}
                            className={`px-6 h-9 rounded-full font-bold text-sm transition-colors duration-200 flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] ${
                                isPublishing || !editableTitle.trim()
                                    ? 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] cursor-not-allowed opacity-50'
                                    : isDark
                                        ? 'bg-[#eff3f4] text-[#0f1419] hover:opacity-90 cursor-pointer'
                                        : 'bg-[#0f1419] text-white hover:opacity-90 cursor-pointer'
                            }`}
                        >
                        {isPublishing ? (
                            <>
                                <span className="loading loading-spinner loading-xs"></span>
                                <span>{t.article?.publishing || 'Publishing...'}</span>
                            </>
                        ) : (
                            <span>{t.article?.publish || 'Publish'}</span>
                        )}
                    </button>
                </div>
            </div>
        </div >

        </div >
    );
};
