import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../context';
import { config } from '../config';
import { parseStartPayload, miniAppDeepLink } from '../lib/deeplink';
import { welcomeKeyboard } from '../keyboards';
import { t } from '../lib/i18n';

/**
 * /start handler.
 *
 * grammy passes the start payload as the command's "match" (everything after
 * "/start "). We validate it as base64url-safe, then:
 *   - product_<id> / cat_<slug> -> reply with a card whose button DEEP-LINKS
 *     straight into the TMA at that route (one tap -> product page).
 *   - ref_<code>                -> welcome, and the referral rides along into
 *     the Mini App so checkout can attribute it.
 *   - no/invalid payload        -> show the welcome interaction board.
 */
export async function handleStart(ctx: BotContext): Promise<void> {
  const locale = ctx.locale;
  const payload = parseStartPayload(ctx.match?.toString());

  if (payload && (payload.kind === 'product' || payload.kind === 'category')) {
    const raw =
      payload.kind === 'product'
        ? `product_${payload.value}`
        : `category_${payload.value}`;
    const kb = new InlineKeyboard().webApp(t(locale, 'open_shop'), miniAppDeepLink(raw));
    await ctx.reply(
      payload.kind === 'product'
        ? '🛍 Tap below to view this product in the shop:'
        : '🛍 Tap below to browse this category:',
      { reply_markup: kb },
    );
    return;
  }

  if (payload?.kind === 'referral') {
    const kb = new InlineKeyboard().webApp(
      t(locale, 'open_shop'),
      miniAppDeepLink(`ref_${payload.value}`),
    );
    await ctx.reply(t(locale, 'welcome'), { reply_markup: kb });
    return;
  }

  // Default: welcome interaction board.
  await ctx.reply(t(locale, 'welcome'), { reply_markup: welcomeKeyboard(locale) });
}

/** Fallback for environments where miniAppUrl isn't configured yet. */
export function assertMiniAppConfigured(): void {
  if (!config.miniAppUrl) throw new Error('TELEGRAM_MINIAPP_URL is required');
}
