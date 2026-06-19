import { InlineKeyboard } from 'grammy';
import type { InlineQueryResult } from 'grammy/types';
import type { BotContext } from '../context';
import { searchProducts } from '../lib/api';
import { productDeepLink } from '../lib/deeplink';
import { t } from '../lib/i18n';
import { formatCents } from '@repo/types';

/**
 * Inline mode: a user types "@my_bot running shoes" in ANY chat. We query the
 * search backend and return article cards. Each card carries a URL button that
 * deep-links into the Mini App product route:
 *   https://t.me/<bot>/shop?startapp=product_<id>
 *
 * IMPORTANT: inline-result keyboards may NOT use web_app buttons — only a t.me
 * URL button is allowed, which (for a Mini App link) opens the TMA directly.
 * This is the viral sharing loop: products shared into group chats open the
 * product page in the recipient's Mini App with one tap.
 */
export async function handleInlineQuery(ctx: BotContext): Promise<void> {
  const query = ctx.inlineQuery?.query?.trim() ?? '';

  // Empty query -> prompt with a "browse" article instead of an empty result set.
  if (query.length < 2) {
    await ctx.answerInlineQuery([], {
      cache_time: 5,
      button: { text: t(ctx.locale, 'open_shop'), start_parameter: 'inline_open' },
    });
    return;
  }

  let hits;
  try {
    hits = (await searchProducts(query)).items;
  } catch {
    await ctx.answerInlineQuery([], { cache_time: 5 });
    return;
  }

  const results: InlineQueryResult[] = hits.slice(0, 20).map((p) => {
    const link = productDeepLink(p.id);
    const price = formatCents(p.fromPriceCents, p.currency);
    return {
      type: 'article',
      id: p.id, // must be unique per result
      title: p.title,
      description: `${price}${p.description ? ` · ${p.description}` : ''}`,
      ...(p.imageUrl ? { thumbnail_url: p.imageUrl } : {}),
      input_message_content: {
        message_text: `<b>${escapeHtml(p.title)}</b>\n${price}\n${link}`,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: false },
      },
      reply_markup: new InlineKeyboard().url(`🛍 ${p.title} · ${price}`, link),
    };
  });

  await ctx.answerInlineQuery(results, {
    cache_time: 60, // cache identical queries server-side for 60s
    is_personal: true, // results depend on locale/availability
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
