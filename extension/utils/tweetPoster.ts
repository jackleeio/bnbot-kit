
import { RewrittenTweet } from '../components/panels/RewrittenTimeline';
import { TweetPostInterceptor } from './TweetPostInterceptor';
import { PostVerifier, PostVerifyResult } from './PostVerifier';

/**
 * Utility to handle posting a thread of tweets to Twitter/X.
 */
export const tweetPoster = {
    /**
     * Posts a thread of tweets.
     * @param tweets The list of tweets to post
     * @param onProgress Optional callback to report progress (current step, total steps)
     * @param onMediaUpload Optional callback to report media upload status
     */
    async postThread(tweets: RewrittenTweet[], onProgress?: (current: number, total: number) => void, onMediaUpload?: (isUploading: boolean) => void) {
        if (!tweets || tweets.length === 0) return;

        // Check extension context is still valid
        try { void chrome?.runtime?.id; } catch {
            throw new Error('扩展已更新，请刷新页面后重试');
        }
        if (!chrome?.runtime?.id) {
            throw new Error('扩展已更新，请刷新页面后重试');
        }

        try {
            // 1. Click "New Tweet" button
            // This is on the main page (SideNav), so we DO NOT scope this to dialog.
            const newTweetBtn = await this.waitForElement('[data-testid="SideNav_NewTweet_Button"]', 10000);
            if (!newTweetBtn) throw new Error('New Tweet button not found');
            newTweetBtn.click();

            // Wait for initial composer container INSIDE the modal
            await this.waitForElement('[role="dialog"] [data-testid="tweetTextarea_0RichTextInputContainer"]', 5000);

            // 2. Loop through tweets
            for (let i = 0; i < tweets.length; i++) {
                // Check if modal still exists/URL is valid
                if (!this.isComposeModalOpen()) {
                    console.warn('Compose modal disappeared, stopping auto-post.');
                    break;
                }

                if (onProgress) onProgress(i + 1, tweets.length);
                const tweet = tweets[i];

                // --- STEP: Find Container & Focus ---
                await this.focusTweetInput(i);

                // --- STEP: Insert Text with Persistence Verification ---
                console.log(`Filling tweet ${i} text...`);
                let persisted = false;
                let attempts = 0;
                const maxAttempts = 5;

                while (!persisted && attempts < maxAttempts) {
                    attempts++;
                    const activeEl = document.activeElement as HTMLElement;

                    if (activeEl) {
                        activeEl.focus();

                        // Select all to clear any partial state
                        document.execCommand('selectAll', false, null);

                        // 1. Paste Simulation
                        this.simulatePaste(activeEl, tweet.text);
                        await this.delay(50); // FAST: 50ms

                        // 2. "Shake" the editor: Type space then delete it
                        // This forces React to register a change event if the paste was ignored
                        document.execCommand('insertText', false, ' ');
                        activeEl.dispatchEvent(new InputEvent('input', { data: ' ', inputType: 'insertText', bubbles: true }));
                        await this.delay(20); // FAST: 20ms

                        document.execCommand('delete', false, null); // Or Backspace
                        activeEl.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));

                        // 3. Dispatch general events
                        activeEl.dispatchEvent(new Event('input', { bubbles: true }));
                        activeEl.dispatchEvent(new Event('change', { bubbles: true }));

                        // BLUR to test persistence (mimics clicking away)
                        activeEl.blur();
                        await this.delay(100); // FAST: 100ms

                        // Check if text remained
                        if (activeEl.innerText && activeEl.innerText.trim().length > 0) {
                            // Double check: does the "progress circle" exist?
                            const progressCircle = document.querySelector('[role="dialog"] [data-testid="dual-phase-countdown-circle"]');
                            if (progressCircle) {
                                persisted = true;
                                console.log(`DEBUG: Tweet ${i} text persisted on attempt ${attempts}.`);
                            } else {
                                console.warn(`DEBUG: Text visible but no progress circle on attempt ${attempts}. Retrying...`);
                            }
                        } else {
                            console.warn(`DEBUG: Tweet ${i} text lost on blur on attempt ${attempts}. Retrying...`);
                        }

                        if (!persisted) {
                            // Focus back for next attempt
                            await this.focusTweetInput(i);
                        }
                    } else {
                        console.warn('No active element found, retrying focus...');
                        await this.focusTweetInput(i);
                    }
                }

                if (!persisted) {
                    console.error(`Failed to persist text for tweet ${i} after ${maxAttempts} attempts.`);
                }

                // --- STEP: Upload Media ---
                if (tweet.media && tweet.media.length > 0) {
                    console.log(`Uploading media for tweet ${i}...`);
                    if (onMediaUpload) onMediaUpload(true);
                    try {
                        await this.uploadMedia(tweet.media);
                        // Wait for media to process a bit (reduced to 1s)
                        await this.delay(1000);
                    } catch (mediaErr) {
                        console.error(`Failed to upload media for tweet ${i}`, mediaErr);
                    } finally {
                        // Keep notification visible for a moment
                        await this.delay(2000);
                        if (onMediaUpload) onMediaUpload(false);
                    }
                }

                // --- STEP: Add Next Tweet (if applicable) ---
                if (i < tweets.length - 1) {
                    console.log(`DEBUG: Finding toolBar for tweet ${i}...`);
                    console.log(`DEBUG: document.hasFocus() = ${document.hasFocus()}`);
                    console.log(`DEBUG: document.activeElement = ${document.activeElement?.tagName}[${document.activeElement?.getAttribute('data-testid')}]`);
                    console.log(`DEBUG: window.location.href = ${window.location.href}`);

                    // First find the toolbar strictly inside the dialog
                    const toolBar = await this.waitForElement('[role="dialog"] [data-testid="toolBar"]');
                    if (toolBar) {
                        const addBtn = toolBar.querySelector('[data-testid="addButton"]') as HTMLElement;

                        if (addBtn) {
                            addBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });

                            // Check disabled state one last time
                            const isDisabled = addBtn.hasAttribute('disabled') || addBtn.getAttribute('aria-disabled') === 'true';
                            const btnRect = addBtn.getBoundingClientRect();
                            console.log(`DEBUG: addBtn disabled=${isDisabled}, visible=${btnRect.width > 0 && btnRect.height > 0}, rect=${JSON.stringify({top: btnRect.top, left: btnRect.left, w: btnRect.width, h: btnRect.height})}`);
                            console.log(`DEBUG: addBtn outerHTML = ${addBtn.outerHTML.substring(0, 200)}`);

                            if (isDisabled) {
                                console.warn(`DEBUG: Add button disabled. Text persistence check might have failed false-positive.`);
                            }

                            // Re-focus textarea before clicking Add to ensure toolBar is interactive
                            console.log(`DEBUG: Re-focusing tweet input ${i} before Add click...`);
                            await this.focusTweetInput(i);
                            await this.delay(50);

                            console.log(`DEBUG: Clicking add button (native click)...`);
                            // Count textareas BEFORE click
                            const textareasBefore = document.querySelectorAll('[role="dialog"] [data-testid*="tweetTextarea_"][data-testid*="RichTextInputContainer"]');
                            console.log(`DEBUG: textareas before click: ${textareasBefore.length}`);

                            await this.robustClick(addBtn);
                            console.log(`DEBUG: Click command issued.`);

                            // Check immediately after click
                            await this.delay(100);
                            const textareasAfterClick = document.querySelectorAll('[role="dialog"] [data-testid*="tweetTextarea_"][data-testid*="RichTextInputContainer"]');
                            console.log(`DEBUG: textareas after click (100ms): ${textareasAfterClick.length}`);

                            // SCROLL TO BOTTOM to reveal next input
                            console.log('Scrolling to bottom of modal...');
                            this.scrollToBottom();

                            await this.delay(250); // TUNED: 250ms to allow smooth scroll animation

                            const textareasAfterScroll = document.querySelectorAll('[role="dialog"] [data-testid*="tweetTextarea_"][data-testid*="RichTextInputContainer"]');
                            console.log(`DEBUG: textareas after scroll (250ms): ${textareasAfterScroll.length}`);
                            // Log all textarea data-testids
                            textareasAfterScroll.forEach((el, idx) => {
                                console.log(`DEBUG: textarea[${idx}] testid=${el.getAttribute('data-testid')}`);
                            });

                            // Wait for the NEXT input container to appear clearly
                            const nextIndex = i + 1;
                            console.log(`Waiting for input area ${nextIndex}...`);

                            // Explicitly wait for the container of the next tweet INSIDE THE DIALOG
                            await this.waitForElement(`[role="dialog"] [data-testid="tweetTextarea_${nextIndex}RichTextInputContainer"]`, 10000);
                        } else {
                            throw new Error('Add Tweet button not found inside toolBar');
                        }
                    } else {
                        throw new Error('Toolbar not found in dialog');
                    }
                }
            }

            // Scroll to bottom to show final tweet
            this.scrollToBottom();

            console.log('Thread filled successfully!');

        } catch (error) {
            console.error('Error posting thread:', error);
            throw error;
        }
    },

    /**
     * Focuses the correct input area for tweet index i using strict container hierarchy within modal.
     */
    async focusTweetInput(index: number) {
        const containerId = `tweetTextarea_${index}RichTextInputContainer`;
        // Hardcoded strict selector
        const selector = `[role="dialog"] [data-testid="${containerId}"]`;
        console.log(`Looking for container: ${selector}`);

        const container = await this.waitForElement(selector);
        if (!container) throw new Error(`Container ${containerId} not found in dialog`);

        // Ensure container is in view
        // 'nearest' -> avoids large vertical jumps if element is at least partially visible
        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        await this.delay(250); // TUNED: 250ms for scroll animation

        const textareaId = `tweetTextarea_${index}`;
        const textarea = container.querySelector(`[data-testid="${textareaId}"]`) as HTMLElement;

        if (textarea) {
            textarea.focus();
            textarea.click();
            await this.delay(50); // FAST: 50ms focus is fine
        } else {
            throw new Error(`Could not find textarea ${textareaId} within container`);
        }
    },

    simulatePaste(element: HTMLElement, text: string) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(text, 'text/plain');

        const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dataTransfer
        });

        element.dispatchEvent(pasteEvent);
    },

    async uploadMedia(mediaItems: any[]) {
        const fileInput = document.querySelector('[role="dialog"] input[data-testid="fileInput"]') as HTMLInputElement;
        if (!fileInput) throw new Error('File input not found inside dialog');

        // Parallelize fetching
        const filePromises = mediaItems.map(async (item) => {
            try {
                const urlToFetch = (item.type === 'video' || item.type === 'animated_gif')
                    ? (item.video_url || item.media_url || item.url)
                    : (item.media_url || item.url);

                let blob: Blob;

                try {
                    blob = await this.fetchMediaBlob(urlToFetch);
                } catch (e) {
                    console.error('All fetch methods failed for:', urlToFetch, e);
                    return null;
                }

                let type = blob.type;
                let ext = 'jpg';
                // ... rest of extension logic ...
                if (item.type === 'video' || item.type === 'animated_gif') {
                    ext = 'mp4';
                    if (!type) type = 'video/mp4';
                } else {
                    if (!type) type = 'image/jpeg';
                    // Use correct extension based on mime type
                    if (type === 'image/png') ext = 'png';
                    else if (type === 'image/webp') ext = 'webp';
                    else if (type === 'image/gif') ext = 'gif';
                }

                // Add random string to avoid name collisions in parallel
                const filename = `media_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${ext}`;
                return new File([blob], filename, { type });
            } catch (e) {
                console.error('Error processing media item:', item, e);
                return null;
            }
        });

        const files = (await Promise.all(filePromises)).filter(f => f !== null) as File[];

        if (files.length === 0) return;

        const dataTransfer = new DataTransfer();
        files.forEach(file => dataTransfer.items.add(file));
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    },

    /**
     * Helper to fetch media as Blob, with base64 support and canvas fallback
     */
    async fetchMediaBlob(url: string): Promise<Blob> {
        // 1. Handle base64
        if (url.startsWith('data:')) {
            const parts = url.split(',');
            if (parts.length !== 2) throw new Error('Invalid data URL');
            const mimeMatch = parts[0].match(/data:([^;]+)/);
            const mime = mimeMatch ? mimeMatch[1] : 'image/png';
            const byteString = atob(parts[1]);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            return new Blob([ab], { type: mime });
        }

        // 2. Handle blob URLs (already local)
        if (url.startsWith('blob:')) {
            const response = await fetch(url);
            return await response.blob();
        }

        // 3. TikTok videos need to be fetched through background script (CORS bypass)
        if (url.includes('tiktok') || url.includes('tiktokcdn')) {
            console.log('[TweetPoster] Fetching TikTok video through background script:', url.substring(0, 80));
            return new Promise((resolve, reject) => {
                let port: chrome.runtime.Port;
                try {
                    port = chrome.runtime.connect({ name: 'DOWNLOAD_PORT' });
                } catch {
                    return reject(new Error('扩展已更新，请刷新页面后重试'));
                }
                const chunks: Uint8Array[] = [];

                port.onMessage.addListener((msg: any) => {
                    switch (msg.type) {
                        case 'DOWNLOAD_START':
                            console.log('[TweetPoster] TikTok download started, size:', msg.total);
                            break;
                        case 'DOWNLOAD_CHUNK':
                            chunks.push(new Uint8Array(msg.chunk));
                            break;
                        case 'DOWNLOAD_END':
                            console.log('[TweetPoster] TikTok download complete');
                            const blob = new Blob(chunks, { type: 'video/mp4' });
                            port.disconnect();
                            resolve(blob);
                            break;
                        case 'DOWNLOAD_ERROR':
                            console.error('[TweetPoster] TikTok download error:', msg.error);
                            port.disconnect();
                            reject(new Error(msg.error));
                            break;
                    }
                });

                port.onDisconnect.addListener(() => {
                    if (chunks.length === 0) {
                        reject(new Error('Port disconnected without data'));
                    }
                });

                port.postMessage({ type: 'START_DOWNLOAD', url });
            });
        }

        // 4. Try Direct Fetch for other URLs
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
            return await response.blob();
        } catch (fetchErr) {
            console.warn('Direct fetch failed, trying background proxy for:', url);

            // 5. Background proxy via FETCH_BLOB (bypasses CORS/mixed content)
            if (chrome?.runtime?.sendMessage) {
                try {
                    let blob = await new Promise<Blob>((resolve, reject) => {
                        chrome.runtime.sendMessage({ type: 'FETCH_BLOB', url }, (response: any) => {
                            if (response?.success && response?.data) {
                                // Convert data URL to Blob
                                const dataUrl = response.data as string;
                                const parts = dataUrl.split(',');
                                if (parts.length !== 2) return reject(new Error('Invalid data URL from proxy'));
                                const mimeMatch = parts[0].match(/data:([^;]+)/);
                                const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                                const byteString = atob(parts[1]);
                                const ab = new ArrayBuffer(byteString.length);
                                const ia = new Uint8Array(ab);
                                for (let i = 0; i < byteString.length; i++) {
                                    ia[i] = byteString.charCodeAt(i);
                                }
                                resolve(new Blob([ab], { type: mime }));
                            } else {
                                reject(new Error('Background proxy fetch failed'));
                            }
                        });
                    });
                    // Convert webp to PNG since Twitter doesn't support webp uploads
                    if (blob.type === 'image/webp') {
                        try {
                            const bitmap = await createImageBitmap(blob);
                            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                            const ctx = canvas.getContext('2d')!;
                            ctx.drawImage(bitmap, 0, 0);
                            blob = await canvas.convertToBlob({ type: 'image/png' });
                            bitmap.close();
                        } catch (e) {
                            console.warn('Webp conversion failed, using original:', e);
                        }
                    }
                    return blob;
                } catch (proxyErr) {
                    console.warn('Background proxy failed, trying canvas fallback for:', url);
                }
            }

            // 6. Canvas Fallback (Only works for images)
            // If it's a video/gif URL, we can't really use canvas fallback easily, so rethrow
            if (url.endsWith('.mp4') || url.includes('video')) {
                throw fetchErr;
            }

            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return reject(new Error('Canvas context failed'));
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob((blob) => {
                        if (blob) resolve(blob);
                        else reject(new Error('Canvas toBlob failed'));
                    }, 'image/png');
                };
                img.onerror = () => reject(new Error('Image canvas load failed'));
                img.src = url;
            });
        }
    },

    isComposeModalOpen(): boolean {
        return window.location.href.includes('compose/post');
    },

    async robustClick(element: HTMLElement) {
        console.log(`DEBUG robustClick: element=${element.tagName}[${element.getAttribute('data-testid')}], document.hasFocus()=${document.hasFocus()}`);
        // Method 1: Focus and Native Click
        element.focus();
        console.log(`DEBUG robustClick: after focus, activeElement=${document.activeElement?.tagName}[${document.activeElement?.getAttribute('data-testid')}]`);
        element.click();
        console.log(`DEBUG robustClick: click() dispatched`);
        await this.delay(50);

        // Method 2: Keyboard Fallback (Enter key)
        console.log(`DEBUG robustClick: dispatching Enter key events...`);
        const activeDef = {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        };
        element.dispatchEvent(new KeyboardEvent('keydown', activeDef));
        element.dispatchEvent(new KeyboardEvent('keypress', activeDef));
        element.dispatchEvent(new KeyboardEvent('keyup', activeDef));
        console.log(`DEBUG robustClick: Enter key events dispatched`);
    },

    scrollToBottom() {
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog) {
            // Twitter usually puts the scrollable area in a specifically marked div
            // We can look for the main viewport
            const viewport = dialog.querySelector('[data-viewportview="true"]') || dialog;
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
        } else {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }
    },

    waitForElement(selector: string, timeout = 10000): Promise<HTMLElement> {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const el = document.querySelector(selector) as HTMLElement;
            if (el) return resolve(el);

            const intervalId = setInterval(() => {
                if (!window.location.href.includes('compose/post') && !selector.includes('SideNav')) {
                    clearInterval(intervalId);
                    reject(new Error('Compose modal closed'));
                    return;
                }

                const el = document.querySelector(selector) as HTMLElement;
                if (el) {
                    clearInterval(intervalId);
                    resolve(el);
                    return;
                }
                if (Date.now() - startTime > timeout) {
                    clearInterval(intervalId);
                    reject(new Error(`Timeout waiting for selector: ${selector}`));
                }
            }, 200);
        });
    },

    waitForFunction<T>(predicate: () => T | null, timeout = 10000): Promise<T> {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const intervalId = setInterval(() => {
                if (!window.location.href.includes('compose/post')) {
                    clearInterval(intervalId);
                    reject(new Error('Compose modal closed'));
                    return;
                }
                const result = predicate();
                if (result) {
                    clearInterval(intervalId);
                    resolve(result);
                    return;
                }
                if (Date.now() - startTime > timeout) {
                    clearInterval(intervalId);
                    reject(new Error('Timeout waiting for condition'));
                }
            }, 200);
        });
    },

    delay(ms: number) {
        return new Promise((resolve, reject) => {
            const end = Date.now() + ms;
            const check = () => {
                if (!window.location.href.includes('compose/post')) {
                    reject(new Error('Compose modal closed during delay'));
                    return;
                }
                if (Date.now() >= end) {
                    resolve(undefined);
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    },

    /**
     * Post a single tweet with verification
     * Returns reliable post result with tweetId if available
     */
    async postTweetWithVerify(text: string, media?: any[]): Promise<PostVerifyResult> {
        // 0. Check extension context is still valid
        try { void chrome?.runtime?.id; } catch {
            return { success: false, error: '扩展已更新，请刷新页面后重试', verifiedBy: 'timeout' };
        }
        if (!chrome?.runtime?.id) {
            return { success: false, error: '扩展已更新，请刷新页面后重试', verifiedBy: 'timeout' };
        }

        // 1. Ensure interceptor is injected
        TweetPostInterceptor.inject();

        // 2. Open composer
        const newTweetBtn = await this.waitForElement('[data-testid="SideNav_NewTweet_Button"]', 5000).catch(() => null);
        if (!newTweetBtn) {
            return { success: false, error: '新推文按钮未找到，请确保在 Twitter 页面', verifiedBy: 'timeout' };
        }
        newTweetBtn.click();

        // 3. Wait for composer to open
        try {
            await this.waitForElement('[role="dialog"] [data-testid="tweetTextarea_0"]', 5000);
            await this.delaySimple(300);
        } catch {
            return { success: false, error: '推文编辑器未打开', verifiedBy: 'timeout' };
        }

        // 4. Fill content
        await this.focusTweetInput(0);
        const activeEl = document.activeElement as HTMLElement;
        if (activeEl) {
            this.simulatePaste(activeEl, text);
            await this.delaySimple(200);
        }

        // 5. Upload media if provided
        if (media && media.length > 0) {
            try {
                await this.uploadMedia(media);
                await this.delaySimple(2000);
            } catch (e) {
                console.warn('[tweetPoster] Media upload failed:', e);
            }
        }

        // 6. Click post button
        const tweetButton = document.querySelector('[role="dialog"] [data-testid="tweetButton"]') as HTMLElement;
        if (!tweetButton) {
            return { success: false, error: '发布按钮未找到', verifiedBy: 'timeout' };
        }
        if (tweetButton.getAttribute('aria-disabled') === 'true') {
            return { success: false, error: '发布按钮不可用，请检查内容', verifiedBy: 'timeout' };
        }

        tweetButton.click();

        // 7. Verify result
        return await PostVerifier.verify();
    },

    /**
     * Post a thread with verification
     * Fills all tweets first, then clicks post and verifies
     */
    async postThreadWithVerify(
        tweets: Array<{ text: string; media?: any[] }>,
        onProgress?: (current: number, total: number) => void
    ): Promise<PostVerifyResult> {
        // 0. Check extension context is still valid
        try { void chrome?.runtime?.id; } catch {
            return { success: false, error: '扩展已更新，请刷新页面后重试', verifiedBy: 'timeout' };
        }
        if (!chrome?.runtime?.id) {
            return { success: false, error: '扩展已更新，请刷新页面后重试', verifiedBy: 'timeout' };
        }

        if (!tweets || tweets.length === 0) {
            return { success: false, error: '没有推文内容', verifiedBy: 'timeout' };
        }

        // 1. Ensure interceptor is injected
        TweetPostInterceptor.inject();

        try {
            // 2. Use existing postThread to fill all tweets (it doesn't auto-submit)
            await this.postThread(tweets as RewrittenTweet[], onProgress);

            // 3. Find and click the final post button
            const tweetButton = document.querySelector('[role="dialog"] [data-testid="tweetButton"]') as HTMLElement;
            if (!tweetButton) {
                return { success: false, error: '发布按钮未找到', verifiedBy: 'timeout' };
            }

            if (tweetButton.getAttribute('aria-disabled') === 'true') {
                return { success: false, error: '发布按钮不可用', verifiedBy: 'timeout' };
            }

            tweetButton.click();

            // 4. Verify result
            return await PostVerifier.verify();
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Thread 填充失败',
                verifiedBy: 'timeout'
            };
        }
    },

    /**
     * Simple delay without compose modal check (for pre-modal operations)
     */
    delaySimple(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};
