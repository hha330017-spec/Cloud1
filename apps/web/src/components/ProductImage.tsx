import { env } from '../lib/env';

interface ProductImageProps {
  /** CDN object path, e.g. "products/abc/main". Extension is added per format. */
  path: string;
  alt: string;
  /** Intrinsic aspect ratio box to prevent layout shift (CLS). */
  width: number;
  height: number;
  /** CSS sizes hint — how wide the image renders at each breakpoint. */
  sizes?: string;
  /** Eager-load only above-the-fold hero images. */
  priority?: boolean;
  className?: string;
}

const WIDTHS = [160, 240, 320, 480, 640, 828, 1080] as const;

function cdnUrl(path: string, w: number, format: 'avif' | 'webp' | 'jpg'): string {
  // Assumes an image CDN with on-the-fly transforms (Cloudflare Images / imgproxy).
  const params = new URLSearchParams({ w: String(w), q: '70', f: format });
  return `${env.cdnBaseUrl}/${path}?${params.toString()}`;
}

function srcSet(path: string, format: 'avif' | 'webp' | 'jpg'): string {
  return WIDTHS.map((w) => `${cdnUrl(path, w, format)} ${w}w`).join(', ');
}

/**
 * Mobile-first responsive image:
 *   - <picture> serves AVIF -> WebP -> JPG so modern phones download the
 *     smallest format their browser supports.
 *   - srcset/sizes let the browser pick the right resolution for the device,
 *     avoiding oversized downloads on slow connections.
 *   - explicit width/height reserve space -> zero layout shift.
 *   - loading="lazy" + decoding="async" defer off-screen work; priority images
 *     opt into eager loading + high fetchpriority for LCP.
 */
export function ProductImage({
  path,
  alt,
  width,
  height,
  sizes = '(max-width: 600px) 50vw, 240px',
  priority = false,
  className,
}: ProductImageProps) {
  return (
    <picture>
      <source type="image/avif" srcSet={srcSet(path, 'avif')} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(path, 'webp')} sizes={sizes} />
      <img
        src={cdnUrl(path, 480, 'jpg')}
        srcSet={srcSet(path, 'jpg')}
        sizes={sizes}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        className={className}
        style={{ aspectRatio: `${width} / ${height}`, width: '100%', height: 'auto' }}
      />
    </picture>
  );
}
