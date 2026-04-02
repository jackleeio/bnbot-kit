import { authService } from './authService';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';

export interface PresignedUrlRequest {
  filename: string;
  content_type: string;
  file_size?: number;
}

export interface PresignedUrlResponse {
  upload_url: string;
  file_url: string;
  file_key: string;
  expires_in: number;
}

export interface MediaItem {
  type: 'image' | 'video' | 'photo';
  url: string;
  file_key?: string;
  thumbnail?: string;
}

export interface MediaConfig {
  allowed_image_types: string[];
  allowed_video_types: string[];
  max_image_size_mb: number;
  max_video_size_mb: number;
  r2_enabled: boolean;
}

class MediaService {
  private config: MediaConfig | null = null;

  /**
   * Get media configuration (allowed types, size limits)
   */
  async getConfig(): Promise<MediaConfig> {
    if (this.config) return this.config;

    const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/media/config`);
    if (!response.ok) {
      throw new Error('Failed to get media config');
    }

    this.config = await response.json();
    return this.config!;
  }

  /**
   * Get presigned URL for uploading
   */
  async getPresignedUrl(request: PresignedUrlRequest): Promise<PresignedUrlResponse> {
    const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/media/presigned-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.detail || `Failed to get presigned URL: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Upload file directly to R2 using presigned URL
   */
  async uploadToR2(
    uploadUrl: string,
    file: File | Blob,
    contentType: string,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
      }

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          resolve();
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Upload failed: network error')));
      xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.send(file);
    });
  }

  /**
   * Upload a file and return the media item
   */
  async uploadMedia(
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<MediaItem> {
    console.log(`[MediaService] Uploading file: ${file.name} (${file.type}, ${file.size} bytes)`);

    // 1. Get presigned URL
    const { upload_url, file_url, file_key } = await this.getPresignedUrl({
      filename: file.name,
      content_type: file.type,
      file_size: file.size,
    });

    console.log(`[MediaService] Got presigned URL, uploading to R2...`);

    // 2. Upload to R2
    await this.uploadToR2(upload_url, file, file.type, onProgress);

    console.log(`[MediaService] Upload complete: ${file_url}`);

    // 3. Return media item
    return {
      type: file.type.startsWith('video/') ? 'video' : 'image',
      url: file_url,
      file_key,
    };
  }

  /**
   * Convert base64 string to File object
   */
  base64ToFile(base64: string, filename: string, mimeType: string): File {
    // Remove data URL prefix if present
    const base64Data = base64.replace(/^data:[^;]+;base64,/, '');

    // Decode base64
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });

    return new File([blob], filename, { type: mimeType });
  }

  /**
   * Upload a base64 image (e.g., from AI generation)
   */
  async uploadBase64Image(
    base64: string,
    filename: string = 'image.png',
    onProgress?: (percent: number) => void
  ): Promise<MediaItem> {
    // Detect mime type from data URL or default to png
    let mimeType = 'image/png';
    const dataUrlMatch = base64.match(/^data:([^;]+);base64,/);
    if (dataUrlMatch) {
      mimeType = dataUrlMatch[1];
    }

    // Determine file extension
    const ext = mimeType.split('/')[1] || 'png';
    const finalFilename = filename.includes('.') ? filename : `${filename}.${ext}`;

    const file = this.base64ToFile(base64, finalFilename, mimeType);
    return this.uploadMedia(file, onProgress);
  }

  /**
   * Check if a URL is a base64 data URL
   */
  isBase64Url(url: string): boolean {
    return url.startsWith('data:');
  }

  /**
   * Check if a URL is already uploaded to our storage
   */
  isUploadedUrl(url: string): boolean {
    return url.includes('media.bnbot.ai') || url.includes('r2.cloudflarestorage.com');
  }

  /**
   * Delete a file from R2
   */
  async deleteFile(fileKey: string): Promise<void> {
    const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/media/file`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_key: fileKey }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.detail || 'Failed to delete file');
    }
  }

  /**
   * Process media items - upload any base64 or external URLs
   * Returns updated media array with all URLs pointing to our storage
   */
  async processMediaItems(
    mediaItems: MediaItem[],
    onProgress?: (index: number, percent: number) => void
  ): Promise<MediaItem[]> {
    const processed: MediaItem[] = [];

    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];

      // Skip if already uploaded to our storage
      if (this.isUploadedUrl(item.url)) {
        processed.push(item);
        continue;
      }

      // Upload base64 images
      if (this.isBase64Url(item.url)) {
        console.log(`[MediaService] Processing base64 media item ${i + 1}/${mediaItems.length}`);
        const uploaded = await this.uploadBase64Image(
          item.url,
          `media-${Date.now()}-${i}`,
          (percent) => onProgress?.(i, percent)
        );
        processed.push({
          ...item,
          ...uploaded,
        });
        continue;
      }

      // For external URLs (like Twitter CDN), we could optionally download and re-upload
      // For now, keep the original URL
      console.log(`[MediaService] Keeping external URL: ${item.url.substring(0, 50)}...`);
      processed.push(item);
    }

    return processed;
  }
}

export const mediaService = new MediaService();
