/**
 * Image compression utility for profile avatars, QR codes, and thumbnails.
 *
 * Accepts a base64 data-URL (e.g. `data:image/png;base64,...`), resizes it
 * to a bounded dimension, re-encodes as WebP at optimized quality, and
 * returns a new data-URL.  Keeps the final payload well under 100 KB for
 * fast page loads even on slow mobile connections.
 *
 * Uses Sharp (already a dependency) for server-side processing.
 */
import sharp from 'sharp';

interface CompressOptions {
  /** Maximum width in px  (default 400) */
  maxWidth?: number;
  /** Maximum height in px (default 400) */
  maxHeight?: number;
  /** WebP quality 1-100 (default 70) */
  quality?: number;
}

const DEFAULTS: Required<CompressOptions> = {
  maxWidth: 400,
  maxHeight: 400,
  quality: 70,
};

/**
 * Compress a base64 data-URL image.
 * Returns a WebP data-URL (`data:image/webp;base64,...`).
 * If the input is not a valid image data-URL it is returned unchanged.
 */
export async function compressImageDataUrl(
  dataUrl: string,
  opts?: CompressOptions,
): Promise<string> {
  // Quick validation — only process data URLs with a recognizable image MIME.
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl;

  const { maxWidth, maxHeight, quality } = { ...DEFAULTS, ...opts };

  try {
    // Strip the prefix, decode the base64 payload
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) return dataUrl;

    const raw = Buffer.from(dataUrl.slice(commaIdx + 1), 'base64');

    // Resize + convert to WebP with aggressive compression
    const compressed = await sharp(raw)
      .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 6, smartSubsample: true })
      .toBuffer();

    return `data:image/webp;base64,${compressed.toString('base64')}`;
  } catch {
    // If Sharp fails (corrupt image, unsupported format), return the original.
    return dataUrl;
  }
}

/** QR codes need lossless + crisp lines — use higher quality and slightly smaller bound. */
export async function compressQrCode(dataUrl: string): Promise<string> {
  return compressImageDataUrl(dataUrl, {
    maxWidth: 300,
    maxHeight: 300,
    quality: 80,
  });
}

/**
 * Generate a tiny thumbnail preview (64x64 WebP at q=50).
 * Ideal for list views, notifications, and quick loading placeholder.
 */
export async function generateThumbnail(dataUrl: string): Promise<string> {
  return compressImageDataUrl(dataUrl, {
    maxWidth: 64,
    maxHeight: 64,
    quality: 50,
  });
}
