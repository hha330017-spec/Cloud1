import { createHmac, timingSafeEqual } from 'node:crypto';

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface VerifiedInitData {
  valid: boolean;
  /** Parsed `user` field (if present and valid). */
  user?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
  authDate?: Date;
}

/**
 * Timing-attack-safe Telegram WebApp initData verification.
 *
 * Algorithm (per Telegram spec):
 *   1. Parse the query string; pull out and remove the `hash` field.
 *   2. Build the data-check-string: every remaining key=value pair sorted by
 *      key, joined with "\n".
 *   3. secret_key = HMAC_SHA256(key="WebAppData", message=bot_token)
 *      ^ NOTE the argument order — "WebAppData" is the HMAC KEY, the bot token
 *        is the MESSAGE. Reversing it "works" in tests but is exploitable.
 *   4. computed = HMAC_SHA256(key=secret_key, message=data_check_string)
 *   5. Constant-time compare computed vs the provided hash.
 *   6. Reject replays: auth_date older than 1 hour is rejected.
 *
 * Returns a boolean-bearing result; never throws on malformed input.
 */
export function verifyTelegramInitData(initData: string, botToken: string): boolean {
  return verifyTelegramInitDataDetailed(initData, botToken).valid;
}

/** Same as verifyTelegramInitData but returns the parsed user + authDate. */
export function verifyTelegramInitDataDetailed(
  initData: string,
  botToken: string,
): VerifiedInitData {
  if (!initData || !botToken) return { valid: false };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { valid: false };
  }

  const hash = params.get('hash');
  if (!hash) return { valid: false };
  params.delete('hash');

  // 2) sorted data-check-string
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  // 3) secret key
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();

  // 4) computed hash
  const computedHex = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // 5) constant-time compare (lengths must match for timingSafeEqual)
  const a = Buffer.from(computedHex, 'hex');
  let b: Buffer;
  try {
    b = Buffer.from(hash, 'hex');
  } catch {
    return { valid: false };
  }
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false };
  }

  // 6) freshness / replay protection
  const authDateRaw = params.get('auth_date');
  const authDateSec = authDateRaw ? Number(authDateRaw) : NaN;
  if (!Number.isFinite(authDateSec)) return { valid: false };
  const authDate = new Date(authDateSec * 1000);
  if (Date.now() - authDate.getTime() > ONE_HOUR_MS) {
    return { valid: false }; // stale -> reject
  }

  // Parse user (best-effort; failure here doesn't invalidate the signature).
  let user: VerifiedInitData['user'];
  const userRaw = params.get('user');
  if (userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch {
      /* leave undefined */
    }
  }

  return { valid: true, user, authDate };
}
