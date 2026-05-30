/**
 * Watermark Utilities — Gemini visible watermark removal via alpha-blending
 * inversion + EXIF/C2PA/XMP metadata stripping. Sharp re-encodes the image,
 * which inherently drops all ancillary metadata chunks.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';

import sharp from 'sharp';

import type { NodeBufferRemovalOptions } from '../vendor/gemini-watermark-remover/sdk/node.js' with { 'resolution-mode': 'import' };

type GwrModule = typeof import('../vendor/gemini-watermark-remover/sdk/node.js', { with: { 'resolution-mode': 'import' } });
let gwrModulePromise: Promise<GwrModule> | null = null;
function loadGwr(): Promise<GwrModule> {
  if (!gwrModulePromise) {
    gwrModulePromise = import('../vendor/gemini-watermark-remover/sdk/node.js');
  }
  return gwrModulePromise;
}

export type WatermarkMethod = 'alpha-blending' | 'metadata-strip' | 'none';

export interface WatermarkRemovalResult {
  removed: boolean;
  method: WatermarkMethod;
  metadata_stripped: boolean;
  error?: string;
  detail?: {
    applied: boolean;
    skip_reason: string | null;
    position: { x: number; y: number; width: number; height: number } | null;
    pass_count: number;
  };
}

export interface StripOptions {
  /** Apply Gemini visible-watermark alpha-blending removal. Default true. */
  removeVisibleWatermark?: boolean;
  /** Strip EXIF/C2PA/XMP metadata via sharp re-encode. Default true. */
  stripMetadata?: boolean;
}

const SUPPORTED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

function inferMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

/**
 * Tracks whether the source had an alpha channel — captured during decode so
 * we can drop it on re-encode for sources that were RGB (avoids ~2× PNG bloat).
 */
const sourceHadAlpha = new WeakMap<object, boolean>();

const sharpCodecs: Pick<NodeBufferRemovalOptions, 'decodeImageData' | 'encodeImageData'> = {
  async decodeImageData(input) {
    const probe = sharp(Buffer.from(input as Buffer));
    const meta = await probe.metadata();
    const hadAlpha = Boolean(meta.hasAlpha);
    const { data, info } = await sharp(Buffer.from(input as Buffer))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const result = {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    };
    sourceHadAlpha.set(result, hadAlpha);
    return result;
  },
  async encodeImageData(imageData, ctx) {
    const raw = Buffer.from(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
    let image = sharp(raw, {
      raw: { width: imageData.width, height: imageData.height, channels: 4 },
    });
    if (!sourceHadAlpha.get(imageData)) {
      image = image.removeAlpha();
    }
    if (ctx.mimeType === 'image/jpeg') return image.jpeg({ quality: 95 }).toBuffer();
    if (ctx.mimeType === 'image/webp') return image.webp({ quality: 95 }).toBuffer();
    return image.png({ compressionLevel: 9 }).toBuffer();
  },
};

/**
 * Process a single image file in place:
 *   1. Run Gemini alpha-blending watermark removal (if enabled, and PNG/JPEG/WebP).
 *   2. Re-encode via sharp — this strips EXIF / C2PA / XMP / IPTC metadata.
 *
 * If the source is not a supported raster image, returns method='none' with no
 * mutation. Errors are captured as result.error rather than thrown, so callers
 * can decide whether to surface them.
 */
export async function stripImageWatermarks(
  filePath: string,
  options: StripOptions = {},
): Promise<WatermarkRemovalResult> {
  const removeVisible = options.removeVisibleWatermark ?? true;
  const stripMeta = options.stripMetadata ?? true;
  if (!removeVisible && !stripMeta) {
    return { removed: false, method: 'none', metadata_stripped: false };
  }

  const mime = inferMime(filePath);
  if (!SUPPORTED_MIME.has(mime)) {
    return {
      removed: false,
      method: 'none',
      metadata_stripped: false,
      error: `unsupported mime type for watermark removal: ${mime}`,
    };
  }

  try {
    if (removeVisible) {
      const { removeWatermarkFromBuffer } = await loadGwr();
      const input = await readFile(filePath);
      const result = await removeWatermarkFromBuffer(input, {
        ...sharpCodecs,
        mimeType: mime,
        filePath,
      });
      const detail = {
        applied: result.meta.applied,
        skip_reason: result.meta.skipReason,
        position: result.meta.position
          ? {
              x: result.meta.position.x,
              y: result.meta.position.y,
              width: result.meta.position.width,
              height: result.meta.position.height,
            }
          : null,
        pass_count: result.meta.passCount,
      };
      if (result.meta.applied) {
        await writeFile(filePath, result.buffer);
        return { removed: true, method: 'alpha-blending', metadata_stripped: true, detail };
      }
      // Watermark not detected — fall through to a cheap metadata-only round-trip
      // so callers still benefit from EXIF/C2PA stripping. Keep `detail` for telemetry.
      await metadataRoundTrip(filePath, mime);
      return { removed: false, method: 'alpha-blending', metadata_stripped: true, detail };
    }

    await metadataRoundTrip(filePath, mime);
    return { removed: false, method: 'metadata-strip', metadata_stripped: true };
  } catch (error) {
    return {
      removed: false,
      method: removeVisible ? 'alpha-blending' : 'metadata-strip',
      metadata_stripped: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Strip ancillary metadata (EXIF / C2PA / XMP / textual chunks) without
 * touching pixel data. Uses chunk-level surgery so the output is byte-identical
 * to the original on the image bitstream — no recompression bloat.
 *
 * Falls back to a sharp re-encode for formats we don't handle natively (webp).
 */
async function metadataRoundTrip(filePath: string, mime: string): Promise<void> {
  const buffer = await readFile(filePath);
  if (mime === 'image/png') {
    const stripped = stripPngMetadata(buffer);
    await writeFile(filePath, stripped);
    return;
  }
  if (mime === 'image/jpeg') {
    const stripped = stripJpegMetadata(buffer);
    await writeFile(filePath, stripped);
    return;
  }
  // webp / other — fall back to sharp re-encode
  const out = await sharp(buffer).webp({ quality: 95 }).toBuffer();
  await writeFile(filePath, out);
}

/**
 * Walks a PNG byte-by-byte, dropping ancillary chunks known to carry generator
 * metadata. Keeps everything else (IHDR, IDAT, PLTE, tRNS, IEND, …) byte-for-byte.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP_CHUNKS = new Set([
  'tEXt', 'iTXt', 'zTXt', // textual (XMP lives here)
  'eXIf',                 // EXIF
  'caBX',                 // C2PA container (per JPEG XL / C2PA spec, also seen in PNGs)
  'cICP',                 // colour info that some pipelines stamp generator identifiers in
]);

function stripPngMetadata(buffer: Buffer): Buffer {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return buffer;
  const out: Buffer[] = [buffer.subarray(0, 8)];
  let cursor = 8;
  while (cursor + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(cursor);
    const type = buffer.toString('ascii', cursor + 4, cursor + 8);
    const chunkEnd = cursor + 12 + length;
    if (chunkEnd > buffer.length) break;
    if (!PNG_DROP_CHUNKS.has(type)) {
      out.push(buffer.subarray(cursor, chunkEnd));
    }
    cursor = chunkEnd;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}

/**
 * Walks a JPEG file's segment stream and drops APPn segments that carry
 * EXIF / XMP / IPTC / Photoshop / C2PA payloads. SOI/SOFn/SOS/EOI and the
 * compressed scan data are preserved as-is.
 */
function stripJpegMetadata(buffer: Buffer): Buffer {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer;
  const out: Buffer[] = [buffer.subarray(0, 2)]; // SOI
  let cursor = 2;
  while (cursor < buffer.length) {
    if (buffer[cursor] !== 0xff) {
      out.push(buffer.subarray(cursor));
      break;
    }
    let marker = buffer[cursor + 1];
    while (marker === 0xff && cursor + 1 < buffer.length) {
      cursor += 1;
      marker = buffer[cursor + 1];
    }
    if (marker === 0xd9 || marker === 0xda) {
      // EOI or SOS — keep the rest of the file untouched (compressed scan data)
      out.push(buffer.subarray(cursor));
      break;
    }
    const segLen = buffer.readUInt16BE(cursor + 2);
    const segEnd = cursor + 2 + segLen;
    if (segEnd > buffer.length) {
      out.push(buffer.subarray(cursor));
      break;
    }
    const drop = isJpegMetadataMarker(marker, buffer, cursor + 4, segEnd);
    if (!drop) out.push(buffer.subarray(cursor, segEnd));
    cursor = segEnd;
  }
  return Buffer.concat(out);
}

function isJpegMetadataMarker(marker: number, buf: Buffer, payloadStart: number, payloadEnd: number): boolean {
  // APP1 (EXIF/XMP), APP2 (ICC/C2PA), APP13 (Photoshop/IPTC), APP14 (Adobe), COM (comment)
  if (marker === 0xfe) return true;
  if (marker === 0xe1 || marker === 0xe2 || marker === 0xed || marker === 0xee) {
    const id = buf.toString('ascii', payloadStart, Math.min(payloadEnd, payloadStart + 32));
    if (id.startsWith('Exif')) return true;
    if (id.startsWith('http://ns.adobe.com/xap/')) return true;     // XMP
    if (id.startsWith('http://ns.adobe.com/xmp/')) return true;
    if (id.startsWith('Photoshop 3.0')) return true;                 // IPTC
    if (id.startsWith('Adobe')) return true;
    if (id.startsWith('urn:c2pa')) return true;                      // C2PA in JPEG
    if (id.startsWith('JUMBF')) return true;
  }
  return false;
}
