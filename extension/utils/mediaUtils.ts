import React from 'react';

export const downloadWithProgress = async (url: string, label: string, onProgress: (p: number) => void): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'DOWNLOAD_PORT' });
        const chunks: number[] = [];
        let total = 0;
        let received = 0;

        console.log(`[MediaUtils] Starting ${label} download...`);
        onProgress(0);

        // Keep Service Worker alive with pings
        const pingInterval = setInterval(() => {
            try {
                port.postMessage({ type: 'PING' });
            } catch (e) {
                clearInterval(pingInterval);
            }
        }, 15000); // 15s interval

        port.onMessage.addListener((msg) => {
            if (msg.type === 'DOWNLOAD_START') {
                total = msg.total;
                console.log(`[MediaUtils] ${label} download started. Total: ${total}`);
            } else if (msg.type === 'DOWNLOAD_CHUNK') {
                const chunk = msg.chunk; // Array of numbers
                chunks.push(...chunk);
                received += chunk.length;

                if (total > 0) {
                    const percent = Math.round((received / total) * 100);
                    onProgress(percent);
                }
            } else if (msg.type === 'DOWNLOAD_END') {
                console.log(`[MediaUtils] ${label} download finished.`);
                onProgress(100);
                clearInterval(pingInterval);
                port.disconnect();
                resolve(new Uint8Array(chunks));
            } else if (msg.type === 'DOWNLOAD_ERROR') {
                console.error(`[MediaUtils] ${label} download error:`, msg.error);
                clearInterval(pingInterval);
                port.disconnect();
                reject(new Error(msg.error));
            }
        });

        port.onDisconnect.addListener(() => {
            clearInterval(pingInterval);
            if (received < total && total > 0) {
                reject(new Error('Connection closed unexpectedly'));
            }
        });

        port.postMessage({ type: 'START_DOWNLOAD', url });
    });
};

type DownloadTask = {
    promise: Promise<Uint8Array>;
    progress: number;
    listeners: ((p: number) => void)[];
    label: string;
};

// Singleton to manage active downloads
class DownloadManager {
    private tasks: Map<string, DownloadTask> = new Map();

    start(url: string, label: string): Promise<Uint8Array> {
        if (this.tasks.has(url)) {
            console.log(`[DownloadManager] reusing active download for ${label}`);
            return this.tasks.get(url)!.promise;
        }

        console.log(`[DownloadManager] starting new download for ${label}`);
        const task: DownloadTask = {
            promise: null as any, // assigned below
            progress: 0,
            listeners: [],
            label
        };

        task.promise = downloadWithProgress(url, label, (p) => {
            task.progress = p;
            task.listeners.forEach(l => l(p));
        }).catch((error) => {
            // Clear cache on failure so retry can start fresh
            console.log(`[DownloadManager] download failed for ${label}, clearing cache`);
            this.tasks.delete(url);
            throw error; // Re-throw to propagate the error
        });

        this.tasks.set(url, task);
        return task.promise;
    }

    subscribe(url: string, listener: (p: number) => void) {
        const task = this.tasks.get(url);
        if (task) {
            listener(task.progress); // Initial call
            task.listeners.push(listener);
        }
    }

    unsubscribe(url: string, listener: (p: number) => void) {
        const task = this.tasks.get(url);
        if (task) {
            task.listeners = task.listeners.filter(l => l !== listener);
        }
    }

    getTask(url: string) {
        return this.tasks.get(url);
    }
}

export const downloadManager = new DownloadManager();

// Global bridge for drag data (dataTransfer gets cleared across Shadow DOM boundaries)
declare global {
    interface Window {
        __bnbotDragData?: {
            src: string;
            timestamp: number;
        };
    }
}

// Helper to handle image dragging (converts data URLs to files for drop support)
export const handleImageDragStart = (e: React.DragEvent<HTMLImageElement>, src: string) => {
    console.log('[DragStart] Starting drag for image', src.substring(0, 50) + '...');

    e.dataTransfer.effectAllowed = 'copy';

    // Store data in global window object to bridge Shadow DOM boundary
    // (dataTransfer data gets cleared by browser security when crossing Shadow DOM)
    window.__bnbotDragData = {
        src,
        timestamp: Date.now()
    };

    // Also set dataTransfer for non-Shadow DOM scenarios (e.g., dragging to other apps)
    e.dataTransfer.setData('text/plain', `bnbot-img:${src}`);
    e.dataTransfer.setData('text/html', `<img src="${src}">`);

    console.log('[DragStart] Set drag data via window bridge');
};
