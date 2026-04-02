/**
 * Video Cache Service
 * 用于预下载和缓存视频，避免组件渲染时才开始下载
 */

type DownloadProgress = {
    loaded: number;
    total: number;
    percentage: number;
};

type DownloadCallback = (progress: DownloadProgress) => void;

// 缓存状态
interface CacheEntry {
    blobUrl: string;
    status: 'downloading' | 'ready' | 'error';
    error?: string;
}

// 下载中的 Promise 追踪，避免重复下载
const downloadingPromises = new Map<string, Promise<string>>();

// 视频缓存
const videoCache = new Map<string, CacheEntry>();

// 进度回调
const progressCallbacks = new Map<string, Set<DownloadCallback>>();

export const videoCacheService = {
    /**
     * 获取缓存的 blob URL
     */
    get(url: string): string | undefined {
        const entry = videoCache.get(url);
        if (entry?.status === 'ready') {
            return entry.blobUrl;
        }
        return undefined;
    },

    /**
     * 检查是否已缓存
     */
    has(url: string): boolean {
        const entry = videoCache.get(url);
        return entry?.status === 'ready';
    },

    /**
     * 检查是否正在下载
     */
    isDownloading(url: string): boolean {
        return downloadingPromises.has(url);
    },

    /**
     * 获取下载状态
     */
    getStatus(url: string): 'downloading' | 'ready' | 'error' | 'none' {
        const entry = videoCache.get(url);
        return entry?.status || 'none';
    },

    /**
     * 订阅下载进度
     */
    onProgress(url: string, callback: DownloadCallback): () => void {
        if (!progressCallbacks.has(url)) {
            progressCallbacks.set(url, new Set());
        }
        progressCallbacks.get(url)!.add(callback);

        // 返回取消订阅函数
        return () => {
            progressCallbacks.get(url)?.delete(callback);
        };
    },

    /**
     * 预下载视频并缓存
     * 如果已经在下载中，返回现有的 Promise
     */
    async preload(url: string): Promise<string> {
        // 已经缓存了
        const cached = this.get(url);
        if (cached) {
            console.log('[VideoCache] Already cached:', url.substring(0, 60));
            return cached;
        }

        // 正在下载中，返回现有 Promise
        const existingPromise = downloadingPromises.get(url);
        if (existingPromise) {
            console.log('[VideoCache] Already downloading:', url.substring(0, 60));
            return existingPromise;
        }

        console.log('[VideoCache] Starting preload:', url.substring(0, 60));

        // 开始新的下载
        const downloadPromise = this._download(url);
        downloadingPromises.set(url, downloadPromise);

        try {
            const blobUrl = await downloadPromise;
            return blobUrl;
        } finally {
            downloadingPromises.delete(url);
        }
    },

    /**
     * 内部下载方法
     */
    async _download(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (typeof chrome === 'undefined' || !chrome.runtime?.connect) {
                reject(new Error('Chrome runtime not available'));
                return;
            }

            videoCache.set(url, { blobUrl: '', status: 'downloading' });

            const port = chrome.runtime.connect({ name: 'DOWNLOAD_PORT' });
            const chunks: Uint8Array[] = [];
            let totalSize = 0;
            let loadedSize = 0;

            const notifyProgress = () => {
                const callbacks = progressCallbacks.get(url);
                if (callbacks) {
                    const progress: DownloadProgress = {
                        loaded: loadedSize,
                        total: totalSize,
                        percentage: totalSize > 0 ? Math.round((loadedSize / totalSize) * 100) : 0
                    };
                    callbacks.forEach(cb => cb(progress));
                }
            };

            port.onMessage.addListener((msg: any) => {
                switch (msg.type) {
                    case 'DOWNLOAD_START':
                        totalSize = msg.total || 0;
                        console.log('[VideoCache] Download started, size:', totalSize);
                        notifyProgress();
                        break;

                    case 'DOWNLOAD_CHUNK':
                        const chunk = new Uint8Array(msg.chunk);
                        chunks.push(chunk);
                        loadedSize += chunk.length;
                        notifyProgress();
                        break;

                    case 'DOWNLOAD_END':
                        console.log('[VideoCache] Download complete');
                        try {
                            const blob = new Blob(chunks, { type: 'video/mp4' });
                            const blobUrl = URL.createObjectURL(blob);
                            videoCache.set(url, { blobUrl, status: 'ready' });
                            port.disconnect();
                            resolve(blobUrl);
                        } catch (e) {
                            videoCache.set(url, { blobUrl: '', status: 'error', error: String(e) });
                            port.disconnect();
                            reject(e);
                        }
                        break;

                    case 'DOWNLOAD_ERROR':
                        console.error('[VideoCache] Download error:', msg.error);
                        videoCache.set(url, { blobUrl: '', status: 'error', error: msg.error });
                        port.disconnect();
                        reject(new Error(msg.error));
                        break;
                }
            });

            port.onDisconnect.addListener(() => {
                if (!videoCache.has(url) || videoCache.get(url)?.status === 'downloading') {
                    videoCache.set(url, { blobUrl: '', status: 'error', error: 'Port disconnected' });
                    reject(new Error('Port disconnected without completing download'));
                }
            });

            // 开始下载
            port.postMessage({ type: 'START_DOWNLOAD', url });
        });
    },

    /**
     * 清理缓存
     */
    clear(url?: string) {
        if (url) {
            const entry = videoCache.get(url);
            if (entry?.blobUrl) {
                URL.revokeObjectURL(entry.blobUrl);
            }
            videoCache.delete(url);
            progressCallbacks.delete(url);
        } else {
            // 清理所有
            videoCache.forEach(entry => {
                if (entry.blobUrl) {
                    URL.revokeObjectURL(entry.blobUrl);
                }
            });
            videoCache.clear();
            progressCallbacks.clear();
        }
    }
};

export default videoCacheService;
