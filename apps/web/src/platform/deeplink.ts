/**
 * Deep-link resolution.
 *
 * Telegram passes a launch payload via `tgWebAppStartParam` when the app is
 * opened through links like:
 *   https://t.me/yourbot/shop?startapp=product_123
 *   https://t.me/yourbot?start=p_123          (bot -> opens Mini App)
 *
 * The param is constrained to 64 url-safe chars, so we use compact prefixes.
 * This module turns a raw param into a concrete router destination so boot code
 * can redirect the user straight to the right screen.
 */

export interface DeepLinkTarget {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
}

const HANDLERS: Array<{
  test: RegExp;
  resolve: (m: RegExpMatchArray) => DeepLinkTarget;
}> = [
  // product_<id>  or  p_<id>  -> product detail page
  {
    test: /^(?:product|p)_([A-Za-z0-9-]+)$/,
    resolve: (m) => ({ to: '/p/$productId', params: { productId: m[1]! } }),
  },
  // cat_<slug>  or  category_<slug>  -> category listing
  {
    test: /^(?:category|cat)_([A-Za-z0-9-]+)$/,
    resolve: (m) => ({ to: '/c/$category', params: { category: m[1]! } }),
  },
  // order_<id> -> order detail
  {
    test: /^order_([A-Za-z0-9-]+)$/,
    resolve: (m) => ({ to: '/orders/$orderId', params: { orderId: m[1]! } }),
  },
  // ref_<code> -> home, but stash referral so checkout can attribute it
  {
    test: /^ref_([A-Za-z0-9-]+)$/,
    resolve: (m) => ({ to: '/', search: { ref: m[1]! } }),
  },
];

/** Resolve a raw start param to a router target, or null if unrecognised. */
export function resolveDeepLink(startParam: string | undefined | null): DeepLinkTarget | null {
  if (!startParam) return null;
  for (const h of HANDLERS) {
    const m = startParam.match(h.test);
    if (m) return h.resolve(m);
  }
  return null;
}

/**
 * Read the effective start param from either:
 *   1. the Telegram launch param (passed in from initPlatform), or
 *   2. a `?startapp=`/`?tgWebAppStartParam=` query on a shared web URL.
 * Telegram value wins when both exist.
 */
export function readStartParam(telegramStartParam?: string): string | undefined {
  if (telegramStartParam) return telegramStartParam;
  const sp = new URLSearchParams(window.location.search);
  return sp.get('startapp') ?? sp.get('tgWebAppStartParam') ?? undefined;
}
