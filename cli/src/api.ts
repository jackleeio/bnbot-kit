/**
 * Backend API client for BNBot draft management.
 * Uses clawmoney API key for authentication.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname, basename } from 'path';
import { homedir } from 'os';
import { createHash, randomBytes } from 'crypto';

const API_BASE = process.env.BNBOT_API_BASE || 'https://api.bnbot.ai';
const CLAWMONEY_CONFIG = join(homedir(), '.clawmoney', 'config.yaml');
const DEVICE_KEY_FILE = join(homedir(), '.bnbot', 'device.key');

/**
 * Read the clawmoney API key from ~/.clawmoney/config.yaml.
 * Returns null if not found (does not exit).
 */
export function tryGetApiKey(): string | null {
  if (!existsSync(CLAWMONEY_CONFIG)) return null;
  const content = readFileSync(CLAWMONEY_CONFIG, 'utf-8');
  const match = content.match(/^api_key:\s*(.+)$/m);
  const apiKey = match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  return apiKey || null;
}

/**
 * Read the clawmoney API key, exit if not found.
 */
function getApiKey(): string {
  const key = tryGetApiKey();
  if (!key) {
    console.error('Not logged in. Run "bnbot login" first.');
    process.exit(1);
  }
  return key;
}

/**
 * Get or create a device key for anonymous API access.
 */
export function getOrCreateDeviceKey(): string {
  if (existsSync(DEVICE_KEY_FILE)) {
    return readFileSync(DEVICE_KEY_FILE, 'utf-8').trim();
  }
  const key = createHash('sha256')
    .update(randomBytes(32))
    .digest('hex');
  mkdirSync(join(homedir(), '.bnbot'), { recursive: true });
  writeFileSync(DEVICE_KEY_FILE, key + '\n');
  return key;
}

/**
 * Check if user is authenticated (has clawmoney API key).
 */
export function isAuthenticated(): boolean {
  return tryGetApiKey() !== null;
}

/**
 * Get the base path for draft API calls (authenticated vs anonymous).
 */
function draftBasePath(): string {
  return isAuthenticated() ? '/api/v1/drafts' : '/api/v1/public/drafts';
}

/**
 * Get auth headers for backend API calls.
 * Uses clawmoney API key if available, otherwise device_key.
 */
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const apiKey = tryGetApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    return headers;
  }

  headers['X-Device-Key'] = getOrCreateDeviceKey();
  return headers;
}

/**
 * Make an authenticated API call to the backend.
 */
async function apiCall<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: getAuthHeaders(),
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    const detail = err.detail || `HTTP ${res.status}`;
    throw new Error(`API error: ${detail}`);
  }

  return res.json() as Promise<T>;
}

// ── Draft API functions ─────────────────────────────────────

export interface Draft {
  id: string;
  draft_type: string;
  title?: string;
  content: unknown;
  scheduled_at?: string;
  publish_status?: string;
  published_at?: string;
  created_at: string;
  updated_at?: string;
  share_key?: string;
}

interface DraftListResponseRaw {
  data: Draft[];
  count: number;
}

interface DraftListResponse {
  drafts: Draft[];
  total: number;
}

interface ShareResponse {
  share_url: string;
  share_key: string;
}

/**
 * Create a new draft.
 */
export async function createDraft(
  draftType: string,
  content: unknown,
  title?: string
): Promise<Draft> {
  return apiCall<Draft>('POST', draftBasePath(), {
    draft_type: draftType,
    content,
    title,
  });
}

/**
 * List drafts with optional filters.
 */
export async function listDrafts(params?: {
  scheduled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<DraftListResponse> {
  const query = new URLSearchParams();
  if (params?.scheduled) query.set('scheduled', 'true');
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  const raw = await apiCall<DraftListResponseRaw>('GET', `${draftBasePath()}${qs ? `?${qs}` : ''}`);
  return { drafts: raw.data, total: raw.count };
}

/**
 * Schedule a draft for publishing.
 */
export async function scheduleDraft(
  draftId: string,
  scheduledAt: string
): Promise<Draft> {
  return apiCall<Draft>('PUT', `${draftBasePath()}/${draftId}/schedule`, {
    scheduled_at: scheduledAt,
  });
}

/**
 * Cancel a draft's schedule.
 */
export async function unscheduleDraft(draftId: string): Promise<Draft> {
  return apiCall<Draft>('DELETE', `${draftBasePath()}/${draftId}/schedule`);
}

/**
 * Delete a draft.
 */
export async function deleteDraft(draftId: string): Promise<void> {
  await apiCall('DELETE', `${draftBasePath()}/${draftId}`);
}

/**
 * Get or create a schedule share link.
 */
export async function shareSchedule(): Promise<ShareResponse> {
  return apiCall<ShareResponse>('POST', `${draftBasePath()}/share-schedule`);
}

/**
 * Get or create a share link for a single draft.
 */
export async function shareDraft(draftId: string): Promise<ShareResponse> {
  return apiCall<ShareResponse>('POST', `${draftBasePath()}/${draftId}/share`);
}

// ── Media upload ────────────────────────────────────────────

interface PresignedUrlResponse {
  upload_url: string;
  file_url: string;
  file_key: string;
  expires_in: number;
}

async function getPresignedUrl(filename: string, contentType: string, fileSize: number): Promise<PresignedUrlResponse> {
  const basePath = isAuthenticated() ? '/api/v1/media' : '/api/v1/public/media';
  return apiCall<PresignedUrlResponse>('POST', `${basePath}/presigned-url`, {
    filename, content_type: contentType, file_size: fileSize,
  });
}

async function uploadToR2(uploadUrl: string, fileBuffer: Buffer, contentType: string): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: new Uint8Array(fileBuffer),
  });
  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
}

export async function uploadMedia(filePath: string): Promise<{ url: string; type: 'photo' | 'video' }> {
  const resolved = filePath.replace(/^~/, process.env.HOME || '');
  const buffer = readFileSync(resolved);
  const ext = extname(resolved).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  };
  const contentType = mimeMap[ext] || 'application/octet-stream';
  const isVideo = contentType.startsWith('video/');

  const { upload_url, file_url } = await getPresignedUrl(
    basename(resolved), contentType, buffer.length
  );

  await uploadToR2(upload_url, buffer, contentType);

  return { url: file_url, type: isVideo ? 'video' : 'photo' };
}
