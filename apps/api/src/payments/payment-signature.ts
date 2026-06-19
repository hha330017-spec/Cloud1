import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

/**
 * Webhook authenticity. NEVER trust a webhook body without verifying its
 * signature against the RAW bytes (parsing then re-serialising changes the
 * bytes and breaks HMAC). main.ts enables rawBody so req.rawBody is the exact
 * payload the provider signed.
 *
 * Generic HMAC-SHA256 verifier (Stripe-style: signed "timestamp.payload").
 * Adapt per provider; the constant-time compare + timestamp tolerance are the
 * security-critical parts.
 */
export function verifyHmacSignature(params: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  secret: string;
  /** reject events older than this to block replay (default 5 min). */
  toleranceSeconds?: number;
}): { timestamp: number } {
  const { rawBody, signatureHeader, secret, toleranceSeconds = 300 } = params;
  if (!signatureHeader) throw new BadRequestException('Missing signature header');

  // Header format: "t=<unix>,v1=<hexhmac>"
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => {
      const [k, v] = kv.split('=');
      return [k?.trim(), v?.trim()] as const;
    }),
  );
  const ts = Number(parts['t']);
  const provided = parts['v1'];
  if (!Number.isFinite(ts) || !provided) {
    throw new BadRequestException('Malformed signature header');
  }

  // Replay protection.
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) {
    throw new BadRequestException('Signature timestamp outside tolerance');
  }

  const signedPayload = `${ts}.${rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new BadRequestException('Signature verification failed');
  }

  return { timestamp: ts };
}
