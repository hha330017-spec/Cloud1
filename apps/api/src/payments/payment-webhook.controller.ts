import {
  BadRequestException,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaymentWebhookService } from './payment-webhook.service';

/**
 * Public webhook endpoint. Deliberately:
 *   - NOT behind JwtAuthGuard (the provider has no JWT) — authenticity comes
 *     from the HMAC signature instead.
 *   - excluded from the global 'v1' prefix (see main.ts) so the URL is stable:
 *     POST /webhooks/payments/:provider
 *   - returns 200 as fast as possible; all real work is queued so the provider
 *     never times out and stops retrying.
 */
@Controller('webhooks/payments')
export class PaymentWebhookController {
  constructor(private readonly webhooks: PaymentWebhookService) {}

  @Post(':provider')
  @HttpCode(200)
  async handle(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: true }> {
    if (!req.rawBody) {
      throw new BadRequestException('Raw body unavailable');
    }
    const signature =
      (req.headers['stripe-signature'] as string | undefined) ??
      (req.headers['x-webhook-signature'] as string | undefined);

    return this.webhooks.intake(provider, req.rawBody, signature);
  }
}
