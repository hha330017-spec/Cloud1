import { config } from '../config';

/**
 * Telegram start params are limited to 1–64 chars from the base64url-safe set
 * [A-Za-z0-9_-]. We use compact, prefixed payloads (product_<id>, cat_<slug>,
 * ref_<code>) and ALWAYS validate before trusting them — a payload arrives from
 * an untrusted external link.
 */
const START_PARAM_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface ParsedPayload {
  kind: 'product' | 'category' | 'referral' | 'unknown';
  value: string;
}

/** Validate + classify an inbound /start payload. Returns null if malformed. */
export function parseStartPayload(raw: string | undefined): ParsedPayload | null {
  if (!raw) return null;
  if (!START_PARAM_RE.test(raw)) return null; // reject anything not base64url-safe

  let m: RegExpMatchArray | null;
  if ((m = raw.match(/^(?:product|p)_([A-Za-z0-9-]+)$/))) {
    return { kind: 'product', value: m[1]! };
  }
  if ((m = raw.match(/^(?:category|cat)_([A-Za-z0-9-]+)$/))) {
    return { kind: 'category', value: m[1]! };
  }
  if ((m = raw.match(/^ref_([A-Za-z0-9-]+)$/))) {
    return { kind: 'referral', value: m[1]! };
  }
  return { kind: 'unknown', value: raw };
}

/**
 * Build a Direct Mini App link that opens the TMA at a specific route.
 *   https://t.me/<bot>/<shortName>?startapp=<payload>
 * The TMA reads `tgWebAppStartParam` on boot (see web deeplink.ts) and routes.
 */
export function miniAppDeepLink(payload: string): string {
  return `https://t.me/${config.botUsername}/${config.miniAppShortName}?startapp=${encodeURIComponent(payload)}`;
}

export function productDeepLink(productId: string): string {
  return miniAppDeepLink(`product_${productId}`);
}
