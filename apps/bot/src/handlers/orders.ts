import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../context';
import { fetchUserOrders } from '../lib/api';
import { miniAppDeepLink } from '../lib/deeplink';
import { t } from '../lib/i18n';
import { formatCents } from '@repo/types';

/**
 * Renders the user's recent orders inline (callback from the welcome board).
 * Each order links into the TMA order detail route. This is a read-only summary,
 * not a management grid — deep actions happen in the Mini App.
 */
export async function handleOrdersList(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => undefined);

  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  let orders;
  try {
    orders = (await fetchUserOrders(telegramId)).items;
  } catch {
    await ctx.reply('⚠️ Couldn’t load your orders right now. Please try again.');
    return;
  }

  if (orders.length === 0) {
    await ctx.reply(t(ctx.locale, 'no_orders'));
    return;
  }

  const kb = new InlineKeyboard();
  for (const o of orders) {
    kb.webApp(
      `${o.orderNumber} · ${o.status} · ${formatCents(o.totalCents, o.currency)}`,
      miniAppDeepLink(`order_${o.id}`),
    ).row();
  }

  await ctx.reply(t(ctx.locale, 'your_orders'), { reply_markup: kb });
}
