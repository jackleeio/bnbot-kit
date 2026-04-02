/**
 * Media Utilities - Shared helpers for local file to data URL conversion
 */

import { readFileSync } from 'fs';
import { extname } from 'path';

export const VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.webm'];
const MAX_MEDIA_SIZE_MB = 50;
const REMOTE_FETCH_TIMEOUT_MS = 45000;

export function localFileToDataUrl(filePath: string): { dataUrl: string; isVideo: boolean } {
  const buffer = readFileSync(filePath);
  const ext = extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.webm': 'video/webm',
  };
  const mime = mimeMap[ext] || 'application/octet-stream';
  const sizeMB = buffer.length / 1024 / 1024;
  if (sizeMB > MAX_MEDIA_SIZE_MB) {
    throw new Error(`File too large: ${sizeMB.toFixed(1)}MB (max ${MAX_MEDIA_SIZE_MB}MB)`);
  }
  return {
    dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
    isVideo: VIDEO_EXTS.includes(ext),
  };
}

function guessMimeFromPath(pathOrUrl: string): string {
  const ext = extname(pathOrUrl.split('?')[0]).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.webm': 'video/webm',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function isLikelyLocalPath(src: string): boolean {
  return src.startsWith('/') || src.startsWith('~');
}

function isHttpUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

function isVideoSource(src: string, mime?: string): boolean {
  if (mime?.startsWith('video/')) return true;
  const clean = src.split('?')[0].toLowerCase();
  return VIDEO_EXTS.some((ext) => clean.endsWith(ext));
}

async function remoteUrlToDataUrl(url: string): Promise<{ dataUrl: string; isVideo: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  const response = await fetch(url, { signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch media URL (${response.status})`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_MEDIA_SIZE_MB * 1024 * 1024) {
    throw new Error(`Remote file too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB (max ${MAX_MEDIA_SIZE_MB}MB)`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const sizeMB = buffer.length / 1024 / 1024;
  if (sizeMB > MAX_MEDIA_SIZE_MB) {
    throw new Error(`Remote file too large: ${sizeMB.toFixed(1)}MB (max ${MAX_MEDIA_SIZE_MB}MB)`);
  }

  const contentType = response.headers.get('content-type') || guessMimeFromPath(url);
  const isVideo = isVideoSource(url, contentType);
  return {
    dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
    isVideo,
  };
}

export async function resolveSingleMediaSource(
  src: string
): Promise<{ type: 'photo' | 'video'; url: string }> {
  if (src.startsWith('data:')) {
    const isVideo = src.startsWith('data:video/');
    return { type: isVideo ? 'video' : 'photo', url: src };
  }

  if (isLikelyLocalPath(src)) {
    const resolved = src.replace(/^~/, process.env.HOME || '');
    const { dataUrl, isVideo } = localFileToDataUrl(resolved);
    return { type: isVideo ? 'video' : 'photo', url: dataUrl };
  }

  if (isHttpUrl(src)) {
    // Prefer converting remote media to data URL to avoid browser-side CORS on x.com.
    try {
      const { dataUrl, isVideo } = await remoteUrlToDataUrl(src);
      return { type: isVideo ? 'video' : 'photo', url: dataUrl };
    } catch {
      // Fallback to original URL to preserve previous behavior when remote fetch fails.
      return { type: isVideoSource(src) ? 'video' : 'photo', url: src };
    }
  }

  return { type: isVideoSource(src) ? 'video' : 'photo', url: src };
}

export function resolveMediaList(sources: string[]): Array<{ type: string; url: string }> {
  return sources.map(src => {
    if (isLikelyLocalPath(src)) {
      const resolved = src.replace(/^~/, process.env.HOME || '');
      const { dataUrl, isVideo } = localFileToDataUrl(resolved);
      return { type: isVideo ? 'video' : 'photo', url: dataUrl };
    }
    const isVideo = VIDEO_EXTS.some(ext => src.toLowerCase().includes(ext));
    return { type: isVideo ? 'video' : 'photo', url: src };
  });
}

export async function resolveMediaListAsync(sources: string[]): Promise<Array<{ type: 'photo' | 'video'; url: string }>> {
  return Promise.all(sources.map((src) => resolveSingleMediaSource(src)));
}
